const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_CATEGORIES = ['TEACHING', 'NON_TEACHING'];
const CATEGORY_PREFIX = { TEACHING: 'TCH', NON_TEACHING: 'STF' };

function normalizeCategory(value) {
  return VALID_CATEGORIES.includes(value) ? value : 'NON_TEACHING';
}

// Picks the next Employee ID for a category, e.g. "TCH-004" or "STF-012" —
// one number sequence per prefix, based on the highest existing number
// with that prefix (not just a row count), so it stays correct even if
// staff have been deleted or IDs were entered out of order.
async function generateEmployeeId(category) {
  const prefix = CATEGORY_PREFIX[category] || CATEGORY_PREFIX.NON_TEACHING;
  const existing = await prisma.staff.findMany({
    where: { employeeId: { startsWith: `${prefix}-` } },
    select: { employeeId: true },
  });
  let max = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const s of existing) {
    const match = s.employeeId.match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// GET /api/staff?search=&status=&department=&category=&availableForLogin=true
// `availableForLogin=true` restricts to staff who don't already have a
// login account (userId is null) — used by the Teacher Access module's
// "choose teacher" dropdown so only staff still needing an account show up.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search = '', status, department, category, availableForLogin } = req.query;
    const where = {
      AND: [
        search
          ? {
              OR: [
                { firstName: { contains: search } },
                { lastName: { contains: search } },
                { employeeId: { contains: search } },
                { designation: { contains: search } },
              ],
            }
          : {},
        status ? { status } : {},
        department ? { department } : {},
        category ? { category } : {},
        availableForLogin === 'true' ? { userId: null } : {},
      ],
    };
    const staff = await prisma.staff.findMany({
      where,
      // Included on every listing (not just single-record lookups) so the
      // UI can show, per staff member, whether a login already exists and
      // what it looks like — otherwise a staff record that's blocked from
      // getting a *new* login (because userId is already set) becomes
      // invisible everywhere, with no way to see why or fix it.
      include: { user: { select: { id: true, role: true, isActive: true, phone: true, email: true } } },
      orderBy: { dateJoined: 'desc' },
    });
    res.json(staff);
  })
);

// GET /api/staff/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const staff = await prisma.staff.findUnique({
      where: { id: Number(req.params.id) },
      include: { user: { select: { email: true, role: true, isActive: true } } },
    });
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    res.json(staff);
  })
);

// POST /api/staff  (Admin only)
//
// Employee ID is optional: leave it blank and one is generated automatically
// based on category — "TCH-001" for TEACHING, "STF-001" for NON_TEACHING —
// so this never blocks on an ID scheme the admin hasn't decided on yet.
// Passing an explicit employeeId still works (e.g. matching an existing
// physical ID card) as long as it's not already in use.
router.post(
  '/',
  requireRole('ADMIN'),
  [
    body('firstName').notEmpty(),
    body('lastName').notEmpty(),
    body('designation').notEmpty(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const data = req.body;
    const category = normalizeCategory(data.category);

    let employeeId = data.employeeId?.trim();
    if (employeeId) {
      const existing = await prisma.staff.findUnique({ where: { employeeId } });
      if (existing) return res.status(409).json({ error: 'Employee ID already in use' });
    } else {
      employeeId = await generateEmployeeId(category);
    }

    const staff = await prisma.staff.create({
      data: {
        employeeId,
        category,
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        gender: data.gender || null,
        designation: data.designation,
        department: data.department || null,
        employmentType: data.employmentType || 'FULL_TIME',
        dateJoined: data.dateJoined ? new Date(data.dateJoined) : undefined,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        salary: data.salary ? Number(data.salary) : null,
        qualifications: data.qualifications || null,
        emergencyContact: data.emergencyContact || null,
        userId: data.userId ? Number(data.userId) : null,
      },
    });
    res.status(201).json(staff);
  })
);

// POST /api/staff/import  (Admin only - bulk create from CSV)
// Body: { rows: [{ employeeId, firstName, lastName, designation, department, employmentType, ... }] }
router.post(
  '/import',
  requireRole('ADMIN'),
  [body('rows').isArray({ min: 1 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { rows } = req.body;
    const results = { created: 0, failed: 0, errors: [] };
    const validEmploymentTypes = ['FULL_TIME', 'PART_TIME', 'CONTRACT'];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      try {
        if (!r.firstName || !r.lastName || !r.designation) {
          throw new Error('Missing a required field (firstName, lastName, designation)');
        }
        const category = normalizeCategory(r.category);

        let employeeId = r.employeeId ? String(r.employeeId).trim() : '';
        if (employeeId) {
          const existing = await prisma.staff.findUnique({ where: { employeeId } });
          if (existing) throw new Error(`Employee ID ${employeeId} already exists`);
        } else {
          employeeId = await generateEmployeeId(category);
        }

        await prisma.staff.create({
          data: {
            employeeId,
            category,
            firstName: r.firstName,
            lastName: r.lastName,
            designation: r.designation,
            department: r.department || null,
            employmentType: validEmploymentTypes.includes(r.employmentType) ? r.employmentType : 'FULL_TIME',
            dateOfBirth: r.dateOfBirth ? new Date(r.dateOfBirth) : null,
            gender: ['MALE', 'FEMALE', 'OTHER'].includes(r.gender) ? r.gender : null,
            phone: r.phone || null,
            email: r.email || null,
            address: r.address || null,
            qualifications: r.qualifications || null,
            salary: r.salary ? Number(r.salary) : null,
          },
        });
        results.created++;
      } catch (err) {
        results.failed++;
        results.errors.push({ row: rowNum, employeeId: r.employeeId || '(auto)', message: err.message });
      }
    }

    res.json(results);
  })
);

// PUT /api/staff/:id  (Admin only)
router.put(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = { ...req.body };
    if (data.dateOfBirth) data.dateOfBirth = new Date(data.dateOfBirth);
    if (data.dateJoined) data.dateJoined = new Date(data.dateJoined);
    if (data.salary) data.salary = Number(data.salary);
    if (data.userId) data.userId = Number(data.userId);
    delete data.id;

    const staff = await prisma.staff.update({ where: { id }, data });
    res.json(staff);
  })
);

// POST /api/staff/:id/unlink-login  (Admin only)
//
// Detaches this staff record from whatever User account it's currently
// linked to (userId -> null), WITHOUT deleting that User account. This
// exists for cases where a staff member's userId points at an account
// that isn't a usable TEACHER login (e.g. it was created with a different
// role, or has since been deactivated) — unlinking frees the staff record
// up to have a fresh teacher login created for it in Teacher Access,
// without touching whatever the old account is still being used for.
router.post(
  '/:id/unlink-login',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    if (!staff.userId) return res.status(400).json({ error: 'This staff member has no login linked' });

    const updated = await prisma.staff.update({ where: { id }, data: { userId: null } });
    res.json(updated);
  })
);

// DELETE /api/staff/:id  (Admin only)
router.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.staff.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);

module.exports = router;
