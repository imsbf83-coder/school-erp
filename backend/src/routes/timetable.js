const express = require('express');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { MODULES, requireRoleOrPermission } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// Anyone logged in can VIEW schedules (teachers/students will need them for
// the class and teacher timetable views later). Creating/editing needs
// ADMIN or the TIMETABLE permission granted in Staff Access.
const canEdit = requireRoleOrPermission(['ADMIN'], MODULES.TIMETABLE);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['PERIOD', 'BREAK', 'ACTIVITY'];
const DAY_NAMES = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const INCLUDE = {
  slots: { orderBy: { position: 'asc' } },
  classes: { include: { class: true } },
};

function shape(s) {
  return {
    id: s.id,
    name: s.name,
    days: s.days.split(',').filter(Boolean).map(Number),
    classIds: s.classes.map((c) => c.classId),
    classNames: s.classes.map((c) => c.class.name),
    slots: s.slots.map((x) => ({
      id: x.id,
      position: x.position,
      kind: x.kind,
      periodNumber: x.periodNumber,
      label: x.label,
      startTime: x.startTime,
      endTime: x.endTime,
      note: x.note || '',
    })),
  };
}

// Validates and normalises a schedule payload. Returns { error } or { data }.
// periodNumber and position are never taken from the client - they are
// derived from the order of the slots so they can't get out of step.
function validatePayload(b) {
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Give this schedule a name.' };

  const days = Array.from(new Set((Array.isArray(b.days) ? b.days : []).map(Number))).sort();
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 5)) {
    return { error: 'Pick at least one school day (Monday to Friday).' };
  }

  const classIds = Array.from(new Set((Array.isArray(b.classIds) ? b.classIds : []).map(Number)));
  if (!classIds.length || classIds.some((c) => !Number.isInteger(c))) {
    return { error: 'Pick at least one class this schedule applies to.' };
  }

  const rawSlots = Array.isArray(b.slots) ? b.slots : [];
  if (!rawSlots.length) return { error: 'Add at least one period.' };

  const slots = [];
  let periodCounter = 0;
  let prevEnd = -1;
  for (let i = 0; i < rawSlots.length; i++) {
    const r = rawSlots[i];
    const where = `Row ${i + 1}`;
    if (!KINDS.includes(r.kind)) return { error: `${where}: type must be Period, Break or Activity.` };
    if (!TIME_RE.test(r.startTime || '') || !TIME_RE.test(r.endTime || '')) {
      return { error: `${where}: enter a start and end time.` };
    }
    const start = toMinutes(r.startTime);
    const end = toMinutes(r.endTime);
    if (end <= start) return { error: `${where}: end time must be after start time.` };
    if (start < prevEnd) return { error: `${where}: starts before the previous row ends.` };
    prevEnd = end;

    const isPeriod = r.kind === 'PERIOD';
    if (isPeriod) periodCounter += 1;
    const label = String(r.label || '').trim() || (isPeriod ? `Period ${periodCounter}` : r.kind === 'BREAK' ? 'Break' : 'Activity');
    slots.push({
      position: i + 1,
      kind: r.kind,
      periodNumber: isPeriod ? periodCounter : null,
      label,
      startTime: r.startTime,
      endTime: r.endTime,
      note: String(r.note || '').trim() || null,
    });
  }
  if (!periodCounter) return { error: 'Add at least one Period (not just breaks/activities).' };

  return { data: { name, days, classIds, slots } };
}

// A class can only follow one bell schedule on any given weekday.
async function findOverlap({ days, classIds }, excludeId) {
  const others = await prisma.timetableSchedule.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      classes: { some: { classId: { in: classIds } } },
    },
    include: { classes: { include: { class: true } } },
  });
  for (const o of others) {
    const oDays = o.days.split(',').map(Number);
    const sharedDays = days.filter((d) => oDays.includes(d));
    if (!sharedDays.length) continue;
    const shared = o.classes.filter((c) => classIds.includes(c.classId));
    if (shared.length) {
      return (
        `${shared.map((c) => c.class.name).join(', ')} already follow "${o.name}" on ` +
        `${sharedDays.map((d) => DAY_NAMES[d]).join(', ')}. A class can only have one schedule per day.`
      );
    }
  }
  return null;
}

// GET /api/timetable/classes  - every class (for the picker). Not scoped to a
// teacher's own classes, because setting up the bell schedule is school-wide.
router.get(
  '/classes',
  asyncHandler(async (req, res) => {
    const classes = await prisma.class.findMany({ orderBy: { name: 'asc' } });
    res.json(classes.map((c) => ({ id: c.id, name: c.name, sections: c.sections || '' })));
  })
);

// GET /api/timetable/schedules
router.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    const rows = await prisma.timetableSchedule.findMany({ include: INCLUDE, orderBy: { id: 'asc' } });
    res.json(rows.map(shape));
  })
);

// POST /api/timetable/schedules
router.post(
  '/schedules',
  canEdit,
  asyncHandler(async (req, res) => {
    const { error, data } = validatePayload(req.body);
    if (error) return res.status(400).json({ error });

    const count = await prisma.class.count({ where: { id: { in: data.classIds } } });
    if (count !== data.classIds.length) return res.status(400).json({ error: 'One of the selected classes no longer exists.' });

    const clash = await findOverlap(data, null);
    if (clash) return res.status(409).json({ error: clash });

    try {
      const created = await prisma.timetableSchedule.create({
        data: {
          name: data.name,
          days: data.days.join(','),
          classes: { create: data.classIds.map((classId) => ({ classId })) },
          slots: { create: data.slots },
        },
        include: INCLUDE,
      });
      res.status(201).json(shape(created));
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'A schedule with this name already exists.' });
      throw e;
    }
  })
);

// PUT /api/timetable/schedules/:id   (replaces name, days, classes and slots)
router.put(
  '/schedules/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.timetableSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Schedule not found.' });

    const { error, data } = validatePayload(req.body);
    if (error) return res.status(400).json({ error });

    const count = await prisma.class.count({ where: { id: { in: data.classIds } } });
    if (count !== data.classIds.length) return res.status(400).json({ error: 'One of the selected classes no longer exists.' });

    const clash = await findOverlap(data, id);
    if (clash) return res.status(409).json({ error: clash });

    try {
      await prisma.$transaction([
        prisma.timetableSlot.deleteMany({ where: { scheduleId: id } }),
        prisma.timetableScheduleClass.deleteMany({ where: { scheduleId: id } }),
        prisma.timetableSchedule.update({
          where: { id },
          data: {
            name: data.name,
            days: data.days.join(','),
            classes: { create: data.classIds.map((classId) => ({ classId })) },
            slots: { create: data.slots },
          },
        }),
      ]);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'A schedule with this name already exists.' });
      throw e;
    }
    const updated = await prisma.timetableSchedule.findUnique({ where: { id }, include: INCLUDE });
    res.json(shape(updated));
  })
);

// DELETE /api/timetable/schedules/:id
router.delete(
  '/schedules/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.timetableSchedule.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);

// POST /api/timetable/schedules/seed-defaults
// One-time convenience: creates the three schedules from the 2026-27 draft
// (VI-VIII Mon-Thu, IX-X Mon-Thu, all classes Friday). Only runs when no
// schedules exist yet. Classes are matched by the number in their name
// (e.g. "6", "Grade 6" and "Class 6" all match 6).
router.post(
  '/schedules/seed-defaults',
  canEdit,
  asyncHandler(async (req, res) => {
    if ((await prisma.timetableSchedule.count()) > 0) {
      return res.status(409).json({ error: 'Schedules already exist. Edit them instead.' });
    }

    const classes = await prisma.class.findMany();
    const byNumber = (nums) =>
      classes.filter((c) => {
        const m = String(c.name).match(/\d+/);
        return m && nums.includes(Number(m[0]));
      });

    const P = (label, startTime, endTime, extra = {}) => ({ kind: 'PERIOD', label, startTime, endTime, ...extra });
    const ACT = (label, startTime, endTime) => ({ kind: 'ACTIVITY', label, startTime, endTime });
    const BRK = (startTime, endTime) => ({ kind: 'BREAK', label: 'Break', startTime, endTime });

    const defs = [
      {
        name: 'Classes VI-VIII (Mon-Thu)',
        days: [1, 2, 3, 4],
        classes: byNumber([6, 7, 8]),
        slots: [
          ACT('Assembly', '08:00', '08:10'),
          ACT('Financial Literacy & Environment Education', '08:10', '08:30'),
          P('Period 1', '08:30', '09:10'),
          P('Period 2', '09:10', '09:50'),
          P('Period 3', '09:50', '10:30'),
          P('Period 4', '10:30', '11:10'),
          BRK('11:10', '11:50'),
          P('Period 5', '11:50', '12:35'),
          P('Period 6', '12:35', '13:15'),
          P('Period 7', '13:15', '13:55'),
        ],
      },
      {
        name: 'Classes IX-X (Mon-Thu)',
        days: [1, 2, 3, 4],
        classes: byNumber([9, 10]),
        slots: [
          ACT('Assembly', '08:00', '08:10'),
          P('Period 1', '08:10', '09:10', { note: 'Includes Financial Literacy & Environment Education (first 20 min)' }),
          P('Period 2', '09:10', '09:50'),
          P('Period 3', '09:50', '10:30'),
          P('Period 4', '10:30', '11:10'),
          BRK('11:10', '11:50'),
          P('Period 5', '11:50', '12:35'),
          P('Period 6', '12:35', '13:15'),
          P('Period 7', '13:15', '13:55'),
        ],
      },
      {
        name: 'All classes (Friday)',
        days: [5],
        classes: byNumber([6, 7, 8, 9, 10]),
        slots: [
          ACT('Assembly', '08:00', '08:10'),
          P('Period 1', '08:10', '08:50'),
          P('Period 2', '08:50', '09:30'),
          P('Period 3', '09:30', '10:10'),
          P('Period 4', '10:10', '10:50'),
          BRK('10:50', '11:10'),
          P('Period 5', '11:10', '11:50'),
          P('Period 6', '11:50', '12:30'),
        ],
      },
    ];

    const created = [];
    const skipped = [];
    for (const d of defs) {
      if (!d.classes.length) {
        skipped.push(d.name);
        continue;
      }
      const v = validatePayload({ ...d, classIds: d.classes.map((c) => c.id) });
      if (v.error) throw new Error(`Default schedule "${d.name}" is invalid: ${v.error}`);
      await prisma.timetableSchedule.create({
        data: {
          name: v.data.name,
          days: v.data.days.join(','),
          classes: { create: v.data.classIds.map((classId) => ({ classId })) },
          slots: { create: v.data.slots },
        },
      });
      created.push(d.name);
    }
    res.status(201).json({ created, skipped });
  })
);

module.exports = router;
