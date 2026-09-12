const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { getUserModules } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/me
// Returns the logged-in user's own basic info plus the modules they can
// access, so the frontend can filter its nav without needing admin rights
// (staff-access.js is admin-only, since it can view/edit ANYONE's
// permissions — this route only ever reveals your own).
//
// `modules: null` means unrestricted (ADMIN) — the frontend should treat
// that as "show everything". Otherwise it's the array of module names this
// user has been explicitly granted (possibly empty).
router.get(
  '/',
  async (req, res) => {
    const [user, userModules] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, role: true },
      }),
      getUserModules(req.user),
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      ...user,
      modules: userModules === null ? null : Array.from(userModules),
    });
  }
);

module.exports = router;
