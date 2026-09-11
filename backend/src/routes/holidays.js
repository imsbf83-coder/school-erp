const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Holidays are declared once here (school-wide) instead of being re-marked
// in every class's daily attendance. Saturdays and Sundays are always
// treated as holidays by the attendance report and are never stored here.

// GET /api/holidays?year=&month=   (month is 1-12, optional)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { year, month } = req.query;
    const where = {};
    if (year) {
      const y = Number(year);
      if (month) {
        const m = Number(month);
        where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
      } else {
        where.date = { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) };
      }
    }
    const holidays = await prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    res.json(holidays);
  })
);

// POST /api/holidays   { date, name }
// Any Admin, Teacher or Staff can declare a holiday — it applies school-wide.
router.post(
  '/',
  requireRole('ADMIN', 'TEACHER', 'STAFF'),
  [body('date').isISO8601(), body('name').notEmpty()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const existing = await prisma.holiday.findUnique({ where: { date: new Date(req.body.date) } });
    if (existing) {
      return res.status(409).json({ error: `${existing.date.toISOString().slice(0, 10)} is already marked as a holiday ("${existing.name}").` });
    }

    const holiday = await prisma.holiday.create({
      data: { date: new Date(req.body.date), name: req.body.name, createdById: req.user.id },
    });
    res.status(201).json(holiday);
  })
);

// POST /api/holidays/range   { startDate, endDate, name }
// Convenience for multi-day closures (summer vacation, Eid break, etc.) —
// creates one Holiday row per calendar day in the range. Dates already
// marked as a holiday are left untouched rather than causing an error.
router.post(
  '/range',
  requireRole('ADMIN', 'TEACHER', 'STAFF'),
  [body('startDate').isISO8601(), body('endDate').isISO8601(), body('name').notEmpty()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { startDate, endDate, name } = req.body;
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    if (endMs < startMs) return res.status(400).json({ error: 'endDate must be on or after startDate' });
    if ((endMs - startMs) / 86400000 > 365) return res.status(400).json({ error: 'Range is too long (max 365 days).' });

    const dates = [];
    for (let t = startMs; t <= endMs; t += 86400000) dates.push(new Date(t));

    const existing = await prisma.holiday.findMany({ where: { date: { in: dates } } });
    const existingIso = new Set(existing.map((h) => h.date.toISOString().slice(0, 10)));
    const toCreate = dates.filter((d) => !existingIso.has(d.toISOString().slice(0, 10)));

    if (toCreate.length) {
      await prisma.holiday.createMany({
        data: toCreate.map((date) => ({ date, name, createdById: req.user.id })),
      });
    }

    res.status(201).json({ created: toCreate.length, skipped: dates.length - toCreate.length });
  })
);

// DELETE /api/holidays/:id
router.delete(
  '/:id',
  requireRole('ADMIN', 'TEACHER', 'STAFF'),
  asyncHandler(async (req, res) => {
    await prisma.holiday.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);

module.exports = router;
