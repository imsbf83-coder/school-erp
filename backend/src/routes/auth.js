const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, phone: user.phone, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// POST /api/auth/login
// Body: { identifier, password } — identifier is either an email address
// (ADMIN/ACCOUNTANT/STAFF accounts) or a mobile number (TEACHER accounts
// created via the Teacher Access module, which log in with phone instead
// of email). Whichever it looks like determines which column is queried.
router.post(
  '/login',
  [body('identifier').notEmpty(), body('password').notEmpty()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { identifier, password } = req.body;
    const isEmail = identifier.includes('@');
    const user = await prisma.user.findUnique({
      where: isEmail ? { email: identifier } : { phone: identifier },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid login details or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid login details or password' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        // Only meaningful for TEACHER accounts — lets the frontend show/limit
        // the class picker without a second request. Empty for every other role.
        teacherClasses: { include: { class: true } },
      },
    });
    res.json(user);
  })
);

// GET /api/auth/users/:id/classes  (Admin only - which classes a teacher is assigned to)
router.get(
  '/users/:id/classes',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const links = await prisma.teacherClass.findMany({
      where: { userId: Number(req.params.id) },
      include: { class: true },
      orderBy: { class: { name: 'asc' } },
    });
    res.json(links.map((l) => l.class));
  })
);

// PUT /api/auth/users/:id/classes  (Admin only - set which class(es) a teacher can access)
// Body: { classIds: [int, ...] } — replaces the teacher's whole assignment set.
// Send a single-element array to give the teacher exactly one class.
router.put(
  '/users/:id/classes',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'TEACHER') {
      return res.status(400).json({ error: 'Class assignment only applies to TEACHER accounts' });
    }

    // Accepts either the newer singular shape ({ classId, section }) used by
    // the Teacher Access screen's one-row-per-teacher UI, or the older
    // { classIds: [...] } shape (section left unset) for compatibility.
    let classId = null;
    let section = null;
    if (req.body.classId !== undefined) {
      classId = req.body.classId ? Number(req.body.classId) : null;
      section = req.body.section || null;
    } else if (Array.isArray(req.body.classIds) && req.body.classIds.length) {
      classId = Number(req.body.classIds[0]);
    }

    if (classId) {
      const found = await prisma.class.findUnique({ where: { id: classId } });
      if (!found) return res.status(400).json({ error: 'That class does not exist' });
    }

    await prisma.$transaction([
      prisma.teacherClass.deleteMany({ where: { userId } }),
      ...(classId ? [prisma.teacherClass.create({ data: { userId, classId, section } })] : []),
    ]);

    const links = await prisma.teacherClass.findMany({
      where: { userId },
      include: { class: true },
      orderBy: { class: { name: 'asc' } },
    });
    res.json(links.map((l) => l.class));
  })
);

// POST /api/auth/users  (Admin only - create staff login accounts)
// TEACHER accounts (the only kind the Teacher Access module creates) are
// built FROM an existing Staff record rather than typed in by hand: pass
// `staffId`, and the name + mobile number are pulled straight from that
// Staff row. Non-TEACHER roles keep the original name/email flow.
router.post(
  '/users',
  requireAuth,
  requireRole('ADMIN'),
  [
    body('role').isIn(['ADMIN', 'TEACHER', 'ACCOUNTANT', 'STAFF']),
    body('password').isLength({ min: 6 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { role, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    // Staff-linked creation: works for every role now (previously only
    // TEACHER used this path). TEACHER logs in by phone, sourced from the
    // staff record; every other role logs in by email, sourced from the
    // staff record unless overridden by req.body.email.
    if (req.body.staffId) {
      const staffId = Number(req.body.staffId);
      const staff = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!staff) return res.status(404).json({ error: 'Staff member not found' });
      if (staff.userId) return res.status(409).json({ error: 'This staff member already has a login account' });

      let identifierField;
      let identifierValue;
      if (role === 'TEACHER') {
        identifierField = 'phone';
        identifierValue = staff.phone;
        if (!identifierValue) {
          return res.status(400).json({ error: 'This staff member has no mobile number on file — add one in Staff first' });
        }
      } else {
        identifierField = 'email';
        identifierValue = req.body.email || staff.email;
        if (!identifierValue) {
          return res.status(400).json({ error: 'This staff member has no email on file — add one in Staff first, or provide one here' });
        }
      }

      const existingUser = await prisma.user.findUnique({ where: { [identifierField]: identifierValue } });
      if (existingUser) return res.status(409).json({ error: `A user with this ${identifierField} already exists` });

      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: `${staff.firstName} ${staff.lastName}`,
            [identifierField]: identifierValue,
            passwordHash,
            role,
          },
          select: { id: true, name: true, email: true, phone: true, role: true },
        });
        await tx.staff.update({ where: { id: staff.id }, data: { userId: created.id } });
        return created;
      });

      return res.status(201).json(user);
    }

    // Fallback: original manual name/email flow, for a standalone account
    // not linked to any Staff record (e.g. the initial admin seed).
    if (!req.body.name || !req.body.email) {
      return res.status(400).json({ error: 'name and email are required for this role' });
    }
    const { name, email } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

    const user = await prisma.user.create({
      data: { name, email, passwordHash, role },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    res.status(201).json(user);
  })
);

// GET /api/auth/users (Admin only - list accounts)
router.get(
  '/users',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        // Empty for every non-TEACHER role. Included here so the admin's
        // teacher-assignment screen doesn't need a follow-up call per row.
        teacherClasses: { include: { class: true } },
        staff: { select: { id: true, employeeId: true, designation: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  })
);

// DELETE /api/auth/users/:id  (Admin only)
//
// Removes a teacher's login entirely. If this account is linked to a
// Staff record, that link is cleared first (not deleted) so the staff
// member becomes available for a fresh login again, and any class
// assignment for this account is removed along with it.
router.delete(
  '/users/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.$transaction([
      prisma.teacherClass.deleteMany({ where: { userId: id } }),
      prisma.staff.updateMany({ where: { userId: id }, data: { userId: null } }),
      prisma.user.delete({ where: { id } }),
    ]);
    res.status(204).send();
  })
);

// POST /api/auth/users/:id/reset-password  (Admin only)
router.post(
  '/users/:id/reset-password',
  requireAuth,
  requireRole('ADMIN'),
  [body('password').isLength({ min: 6 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = Number(req.params.id);
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true, name: true },
    });
    res.json({ ok: true, name: user.name });
  })
);

module.exports = router;
