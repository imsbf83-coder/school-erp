const express = require('express');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { MODULES, ROLE_PRESETS } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('ADMIN')); // only admin manages permissions

// GET /api/staff-access/modules
// Returns the fixed list of module names and the two named-role presets,
// so the frontend doesn't need to hardcode either — it just renders
// whatever this returns as checkboxes / preset buttons.
router.get(
  '/modules',
  asyncHandler(async (req, res) => {
    res.json({ modules: Object.values(MODULES), presets: ROLE_PRESETS });
  })
);

// GET /api/staff-access/:userId
// Returns the list of modules this user currently has, plus their name/role
// for display. 404s if the user doesn't exist; empty `modules: []` if they
// exist but have no permissions yet.
router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rows = await prisma.staffPermission.findMany({
      where: { userId },
      select: { module: true },
    });
    res.json({ ...user, modules: rows.map((r) => r.module) });
  })
);

// PUT /api/staff-access/:userId
// Body: { modules: ["EXAMS", "STUDENTS"] }
// Replaces this user's entire permission set with exactly the modules
// given (not additive) — simplest mental model for an admin checkbox UI:
// tick/untick boxes, hit save, done.
router.put(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const { modules } = req.body;

    if (!Array.isArray(modules)) {
      return res.status(400).json({ error: '"modules" must be an array of module names' });
    }

    const validModules = Object.values(MODULES);
    const invalid = modules.filter((m) => !validModules.includes(m));
    if (invalid.length) {
      return res.status(400).json({ error: `Unknown module(s): ${invalid.join(', ')}` });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'Admin accounts already have full access; permissions do not apply to them.' });
    }
    // TEACHER accounts CAN hold module permissions — e.g. a teacher who is
    // also the Exam Incharge gets EXAMS on top of their normal class-scoped
    // access (see utils/permissions.js#getUserModules and exams.js's
    // getExamClassScope, which lets an EXAMS-permission holder see the
    // whole module instead of being limited to their assigned classes).

    await prisma.$transaction([
      prisma.staffPermission.deleteMany({ where: { userId } }),
      prisma.staffPermission.createMany({
        data: modules.map((module) => ({ userId, module })),
      }),
    ]);

    res.json({ userId, modules });
  })
);

module.exports = router;
