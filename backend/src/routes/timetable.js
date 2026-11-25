const express = require('express');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { MODULES, requireRoleOrPermission } = require('../utils/permissions');
const { matchStaff, normalizePhone } = require('../utils/staffMatch');

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

// ======================= WEEKLY GRID (entries) =======================

const DRAFT = require('../data/timetableDraft2026');

function normKey(name) {
  return String(name || '').toUpperCase().replace(/[\s.]/g, '');
}

function shapeEntry(e) {
  return {
    id: e.id,
    classId: e.classId,
    section: e.section,
    periodNumber: e.periodNumber,
    subject: e.subject,
    days: e.days.split(',').filter(Boolean).map(Number),
    teacherId: e.teacherId,
  };
}

function classLabel(cls, section) {
  const m = String(cls.name).match(/\d+/);
  return `${m ? m[0] : cls.name}-${section}`;
}

// classId -> weekday -> { periodNumber: [startMinutes, endMinutes] }
async function loadScheduleMap() {
  const schedules = await prisma.timetableSchedule.findMany({ include: { slots: true, classes: true } });
  const map = new Map();
  for (const s of schedules) {
    const days = s.days.split(',').filter(Boolean).map(Number);
    const periods = {};
    for (const sl of s.slots) {
      if (sl.kind === 'PERIOD') periods[sl.periodNumber] = [toMinutes(sl.startTime), toMinutes(sl.endTime)];
    }
    for (const c of s.classes) {
      if (!map.has(c.classId)) map.set(c.classId, {});
      for (const d of days) map.get(c.classId)[d] = periods;
    }
  }
  return map;
}

// GET /api/timetable/entries
router.get(
  '/entries',
  asyncHandler(async (req, res) => {
    const rows = await prisma.timetableEntry.findMany({
      orderBy: [{ classId: 'asc' }, { section: 'asc' }, { periodNumber: 'asc' }, { id: 'asc' }],
    });
    res.json(rows.map(shapeEntry));
  })
);

// GET /api/timetable/teachers - the people who teach in the timetable
router.get(
  '/teachers',
  asyncHandler(async (req, res) => {
    const rows = await prisma.timetableTeacher.findMany({ orderBy: { fullName: 'asc' } });
    res.json(rows);
  })
);

// PUT /api/timetable/teachers/:id  { phone?, fullName?, shortName? }
router.put(
  '/teachers/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.timetableTeacher.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Teacher not found.' });

    const data = {};
    if (req.body.phone !== undefined) {
      const phone = normalizePhone(req.body.phone);
      if (phone === undefined) return res.status(400).json({ error: 'Enter a valid mobile number, for example 0300 1234567.' });
      data.phone = phone;
    }
    if (req.body.active !== undefined) data.active = Boolean(req.body.active);
    if (req.body.fullName !== undefined) {
      const v = String(req.body.fullName).trim().toUpperCase();
      if (!v) return res.status(400).json({ error: 'The full name cannot be empty.' });
      data.fullName = v;
    }
    if (req.body.shortName !== undefined) {
      const v = String(req.body.shortName).trim().toUpperCase();
      if (!v) return res.status(400).json({ error: 'The short name cannot be empty.' });
      data.shortName = v;
    }
    try {
      res.json(await prisma.timetableTeacher.update({ where: { id }, data }));
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'Another teacher already has that full name.' });
      throw e;
    }
  })
);

// POST /api/timetable/teachers/:id/reassign  { toTeacherId }
// Moves every timetable entry of one teacher (e.g. someone who retired) to
// another teacher. Refused, with the reasons, if the new teacher would be in
// two classes at the same time on any day.
router.post(
  '/teachers/:id/reassign',
  canEdit,
  asyncHandler(async (req, res) => {
    const fromId = Number(req.params.id);
    const toId = Number(req.body.toTeacherId);
    if (!Number.isInteger(toId) || toId === fromId) return res.status(400).json({ error: 'Choose a different teacher to take over.' });
    const [from, to] = await Promise.all([
      prisma.timetableTeacher.findUnique({ where: { id: fromId } }),
      prisma.timetableTeacher.findUnique({ where: { id: toId } }),
    ]);
    if (!from || !to) return res.status(404).json({ error: 'Teacher not found.' });

    const [moving, theirs, map, classes] = await Promise.all([
      prisma.timetableEntry.findMany({ where: { teacherId: fromId } }),
      prisma.timetableEntry.findMany({ where: { teacherId: toId } }),
      loadScheduleMap(),
      prisma.class.findMany(),
    ]);
    if (!moving.length) return res.status(400).json({ error: `${from.fullName} has no periods in the timetable.` });
    const classById = new Map(classes.map((c) => [c.id, c]));

    const clashes = [];
    for (const e of moving) {
      const eDays = e.days.split(',').map(Number);
      for (const o of theirs) {
        const oDays = o.days.split(',').map(Number);
        const hit = [];
        for (const d of eDays) {
          if (!oDays.includes(d)) continue;
          const a = map.get(e.classId)?.[d]?.[e.periodNumber];
          const b = map.get(o.classId)?.[d]?.[o.periodNumber];
          if (a && b && a[0] < b[1] && b[0] < a[1]) hit.push(DAY_NAMES[d]);
        }
        if (hit.length) {
          const c1 = classById.get(e.classId);
          const c2 = classById.get(o.classId);
          clashes.push(
            `${c1 ? classLabel(c1, e.section) : '?'} period ${e.periodNumber} (${e.subject}) clashes with ${to.fullName}'s ` +
              `${c2 ? classLabel(c2, o.section) : '?'} period ${o.periodNumber} on ${hit.join(', ')}.`
          );
        }
      }
    }
    if (clashes.length) {
      return res.status(409).json({
        error: `${to.fullName} is not free for all of these periods. ${Array.from(new Set(clashes)).slice(0, 5).join(' ')}`,
      });
    }

    const r = await prisma.timetableEntry.updateMany({ where: { teacherId: fromId }, data: { teacherId: toId } });
    res.json({ moved: r.count });
  })
);

// GET /api/timetable/teachers/contacts
// The WhatsApp number to use for each teacher, keyed by teacher id:
//   source "saved" - a number typed in the Teachers tab (always wins)
//   source "staff" - taken from the Staff module, when exactly one Staff
//                    record clearly matches the teacher's name
//   no source      - nothing certain; `candidates` lists similar Staff names
//                    so a person can pick one
router.get(
  '/teachers/contacts',
  canEdit,
  asyncHandler(async (req, res) => {
    const [teachers, staff, counts] = await Promise.all([
      prisma.timetableTeacher.findMany(),
      prisma.staff.findMany({
        where: { phone: { not: null }, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
        select: { id: true, firstName: true, lastName: true, phone: true, category: true },
      }),
      prisma.timetableEntry.groupBy({ by: ['teacherId'], _count: { _all: true } }),
    ]);
    const entryCount = new Map(counts.map((c) => [c.teacherId, c._count._all]));
    const out = {};
    for (const t of teachers) {
      const periods = entryCount.get(t.id) || 0;
      if (t.phone) {
        out[t.id] = { phone: t.phone, source: 'saved', staffName: null, candidates: [], periods };
        continue;
      }
      const m = matchStaff(t, staff);
      out[t.id] = m.confident
        ? { phone: m.confident.phone, source: 'staff', staffName: m.confident.name, candidates: m.candidates, periods }
        : { phone: null, source: null, staffName: null, candidates: m.candidates, periods };
    }
    res.json(out);
  })
);

// Finds the teacher a typed name refers to (matching either the full or the
// short name, ignoring spaces, dots and case) or creates a new one.
async function resolveTeacher(typed, cache) {
  const name = String(typed || '').trim().toUpperCase();
  if (!name) return null;
  const key = normKey(name);
  let t = cache.find((x) => normKey(x.fullName) === key || normKey(x.shortName) === key);
  if (!t) {
    t = await prisma.timetableTeacher.create({ data: { fullName: name, shortName: name } });
    cache.push(t);
  }
  return t;
}

// PUT /api/timetable/cell
// { classId, section, periodNumber, entries: [{ subject, days: [1..5], teacherName }] }
// teacherName is typed text; it is matched to (or creates) a teacher.
// Replaces everything in that one cell (class + section + period).
router.put(
  '/cell',
  canEdit,
  asyncHandler(async (req, res) => {
    const classId = Number(req.body.classId);
    const section = String(req.body.section || '').trim();
    const periodNumber = Number(req.body.periodNumber);
    const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : [];

    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) return res.status(404).json({ error: 'Class not found.' });
    const sections = String(cls.sections || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!sections.includes(section)) return res.status(400).json({ error: 'That section does not exist for this class.' });
    if (!Number.isInteger(periodNumber) || periodNumber < 1) return res.status(400).json({ error: 'Invalid period.' });

    const map = await loadScheduleMap();
    const classDays = map.get(classId) || {};

    const teacherCache = await prisma.timetableTeacher.findMany();
    const entries = [];
    const usedDays = new Set();
    for (const e of rawEntries) {
      const subject = String(e.subject || '').trim().toUpperCase();
      if (!subject) return res.status(400).json({ error: 'Every entry needs a subject.' });
      const days = Array.from(new Set((Array.isArray(e.days) ? e.days : []).map(Number))).sort();
      if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 5)) {
        return res.status(400).json({ error: `Pick at least one day for ${subject}.` });
      }
      for (const d of days) {
        if (!classDays[d] || !classDays[d][periodNumber]) {
          return res.status(400).json({ error: `${DAY_NAMES[d]} has no period ${periodNumber} for this class.` });
        }
        if (usedDays.has(d)) {
          return res.status(400).json({ error: `${DAY_NAMES[d]} is used by two entries in this period.` });
        }
        usedDays.add(d);
      }
      entries.push({
        classId,
        section,
        periodNumber,
        subject,
        days: days.join(','),
        teacherId: (await resolveTeacher(e.teacherName, teacherCache))?.id ?? null,
      });
    }

    // Rows with the same subject and teacher are one entry: join their days
    // (e.g. H/G Mon-Wed and H/G Fri by the same teacher -> H/G 1-3,5).
    const mergedRows = new Map();
    for (const e of entries) {
      const k = `${e.subject}|${e.teacherId}`;
      if (mergedRows.has(k)) {
        const m = mergedRows.get(k);
        m.days = Array.from(new Set([...m.days.split(',').map(Number), ...e.days.split(',').map(Number)]))
          .sort((a, b) => a - b)
          .join(',');
      } else {
        mergedRows.set(k, { ...e });
      }
    }
    entries.splice(0, entries.length, ...mergedRows.values());

    // Teacher clash: the same teacher cannot be in two classes at overlapping
    // times on the same day. Compared by real clock time, so a 60-minute
    // period for IX-X is checked against VI-VIII periods that overlap it.
    const classes = await prisma.class.findMany();
    const classById = new Map(classes.map((c) => [c.id, c]));
    const others = (await prisma.timetableEntry.findMany()).filter(
      (o) => !(o.classId === classId && o.section === section && o.periodNumber === periodNumber)
    );
    const clashes = [];
    for (const e of entries) {
      if (!e.teacherId) continue;
      const teacher = teacherCache.find((t) => t.id === e.teacherId);
      const myDays = e.days.split(',').map(Number);
      for (const o of others) {
        if (o.teacherId !== e.teacherId) continue;
        const oDays = o.days.split(',').map(Number);
        const clashDays = [];
        for (const d of myDays) {
          if (!oDays.includes(d)) continue;
          const mine = classDays[d]?.[periodNumber];
          const theirs = map.get(o.classId)?.[d]?.[o.periodNumber];
          if (mine && theirs && mine[0] < theirs[1] && theirs[0] < mine[1]) clashDays.push(d);
        }
        if (clashDays.length) {
          const oc = classById.get(o.classId);
          clashes.push(
            `${teacher.fullName} is already teaching ${oc ? classLabel(oc, o.section) : 'another class'} ` +
              `(period ${o.periodNumber}, ${o.subject}) on ${clashDays.map((d) => DAY_NAMES[d]).join(', ')} at the same time.`
          );
        }
      }
    }
    if (clashes.length) return res.status(409).json({ error: Array.from(new Set(clashes)).join(' ') });

    await prisma.$transaction([
      prisma.timetableEntry.deleteMany({ where: { classId, section, periodNumber } }),
      ...(entries.length ? [prisma.timetableEntry.createMany({ data: entries })] : []),
    ]);
    const saved = await prisma.timetableEntry.findMany({
      where: { classId, section, periodNumber },
      orderBy: { id: 'asc' },
    });
    res.json(saved.map(shapeEntry));
  })
);

// POST /api/timetable/import-draft
// One-time load of the 2026-27 draft timetable (147 entries). Only runs when
// the grid is empty. Days that fall on a period the class does not have that
// day (e.g. period 7 on Friday) are dropped and reported back.
router.post(
  '/import-draft',
  canEdit,
  asyncHandler(async (req, res) => {
    if ((await prisma.timetableEntry.count()) > 0) {
      return res.status(409).json({ error: 'The timetable already has entries. Clear it first if you want to re-import.' });
    }
    const map = await loadScheduleMap();
    if (!map.size) return res.status(400).json({ error: 'Create the period schedules first (Period setup).' });

    const classes = await prisma.class.findMany();
    const classByNum = new Map();
    for (const c of classes) {
      const m = String(c.name).match(/\d+/);
      if (m && !classByNum.has(Number(m[0]))) classByNum.set(Number(m[0]), c);
    }

    // teachers first, so entries can point at them
    const teacherIds = new Map();
    for (const t of DRAFT.teachers) {
      const row = await prisma.timetableTeacher.upsert({
        where: { fullName: t.fullName },
        update: {},
        create: { fullName: t.fullName, shortName: t.shortName },
      });
      teacherIds.set(t.fullName, row.id);
    }

    const rows = [];
    const dropped = [];
    const missingClasses = new Set();
    const touchedClasses = new Map(); // classId -> new sections CSV
    const addedSections = [];

    for (const e of DRAFT.entries) {
      const [numStr, secRaw] = e.sec.split('-');
      const cls = classByNum.get(Number(numStr));
      if (!cls) {
        missingClasses.add(numStr);
        continue;
      }
      const existing = String(cls.sections || '').split(',').map((s) => s.trim()).filter(Boolean);
      let section = existing.find((s) => s.toLowerCase() === secRaw.toLowerCase());
      if (!section) {
        section = secRaw;
        existing.push(secRaw);
        cls.sections = existing.join(',');
        touchedClasses.set(cls.id, cls.sections);
        addedSections.push(`${cls.name} ${secRaw}`);
      }

      const classDays = map.get(cls.id) || {};
      const valid = e.days.filter((d) => classDays[d] && classDays[d][e.period]);
      const bad = e.days.filter((d) => !valid.includes(d));
      if (bad.length) {
        dropped.push(`${e.sec} period ${e.period} ${e.subject}: ${bad.map((d) => DAY_NAMES[d]).join(', ')} (that class has no such period that day)`);
      }
      if (!valid.length) continue;
      rows.push({
        classId: cls.id,
        section,
        periodNumber: e.period,
        subject: e.subject,
        days: valid.join(','),
        teacherId: teacherIds.get(e.teacher) ?? null,
      });
    }

    await prisma.$transaction([
      ...Array.from(touchedClasses).map(([id, sections]) => prisma.class.update({ where: { id }, data: { sections } })),
      prisma.timetableEntry.createMany({ data: rows }),
    ]);

    // Two import clicks that arrive together can both pass the "grid is empty"
    // check above. Remove any exact duplicate rows so that can never leave
    // double entries behind.
    await prisma.$executeRawUnsafe(`
      DELETE FROM "TimetableEntry" a USING "TimetableEntry" b
      WHERE a."id" > b."id"
        AND a."classId" = b."classId" AND a."section" = b."section"
        AND a."periodNumber" = b."periodNumber" AND a."subject" = b."subject"
        AND a."days" = b."days" AND a."teacherId" IS NOT DISTINCT FROM b."teacherId"
    `);

    const total = await prisma.timetableEntry.count();
    res.status(201).json({
      imported: total,
      dropped,
      addedSections: Array.from(new Set(addedSections)),
      missingClasses: Array.from(missingClasses),
    });
  })
);

// DELETE /api/timetable/entries  - clears the whole weekly grid (schedules stay)
router.delete(
  '/entries',
  canEdit,
  asyncHandler(async (req, res) => {
    const r = await prisma.timetableEntry.deleteMany({});
    res.json({ deleted: r.count });
  })
);

module.exports = router;
