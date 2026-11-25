const express = require('express');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { MODULES, requireRoleOrPermission } = require('../utils/permissions');

// Arrangements: when teachers are on leave (a whole day or some periods),
// their periods are given to teachers who are free at that time.
// Management function: every endpoint needs ADMIN or the TIMETABLE module.
const router = express.Router();
router.use(requireAuth);
router.use(requireRoleOrPermission(['ADMIN'], MODULES.TIMETABLE));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function isRealDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 1 = Monday ... 5 = Friday, or null on a weekend
function weekdayOf(date) {
  const g = new Date(`${date}T00:00:00Z`).getUTCDay();
  return g >= 1 && g <= 5 ? g : null;
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtMinutes(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function overlaps(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

function classNum(name) {
  const m = String(name).match(/\d+/);
  return m ? Number(m[0]) : 999;
}

// classId -> weekday -> { periodNumber: [startMin, endMin] }
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

const keyOf = (classId, section, periodNumber) => `${classId}|${section}|${periodNumber}`;

function absenceShape(a) {
  return {
    id: a.id,
    date: a.date,
    teacherId: a.teacherId,
    fullDay: a.fullDay,
    periods: a.periods.split(',').filter(Boolean).map(Number),
    reason: a.reason || '',
  };
}

// The periods an absence leaves uncovered on a given weekday.
function neededItems(absence, entries, weekday, map) {
  const periods = new Set(absence.periods.split(',').filter(Boolean).map(Number));
  const out = new Map();
  for (const e of entries) {
    if (e.teacherId !== absence.teacherId) continue;
    if (!e.days.split(',').map(Number).includes(weekday)) continue;
    if (!absence.fullDay && !periods.has(e.periodNumber)) continue;
    const interval = map.get(e.classId)?.[weekday]?.[e.periodNumber];
    if (!interval) continue;
    const k = keyOf(e.classId, e.section, e.periodNumber);
    if (!out.has(k)) {
      out.set(k, {
        key: k,
        classId: e.classId,
        section: e.section,
        periodNumber: e.periodNumber,
        subject: e.subject,
        absentTeacherId: absence.teacherId,
        interval,
      });
    }
  }
  return Array.from(out.values());
}

// Everything the screen needs for one date: who is on leave, which periods
// need cover, who is free for each, and what is already arranged.
async function buildDay(date) {
  const weekday = weekdayOf(date);
  const monthPrefix = date.slice(0, 7);
  const [teachers, classes, absences, dayArrangements, monthArrangements, entries, map] = await Promise.all([
    prisma.timetableTeacher.findMany(),
    prisma.class.findMany(),
    prisma.timetableAbsence.findMany({ where: { date }, orderBy: { id: 'asc' } }),
    prisma.timetableArrangement.findMany({ where: { date } }),
    prisma.timetableArrangement.findMany({ where: { date: { startsWith: monthPrefix } } }),
    prisma.timetableEntry.findMany(),
    loadScheduleMap(),
  ]);

  const result = {
    date,
    weekday,
    schoolDay: weekday !== null,
    periodNumbers: [],
    absences: absences.map(absenceShape),
    items: [],
  };
  if (weekday === null) return result;

  const classById = new Map(classes.map((c) => [c.id, c]));

  // period numbers that exist on this weekday (for the "some periods" picker)
  const nums = new Set();
  for (const byDay of map.values()) Object.keys(byDay[weekday] || {}).forEach((n) => nums.add(Number(n)));
  result.periodNumbers = Array.from(nums).sort((a, b) => a - b);

  const absenceByTeacher = new Map(
    absences.map((a) => [a.teacherId, { fullDay: a.fullDay, periods: new Set(a.periods.split(',').filter(Boolean).map(Number)) }])
  );

  // what each teacher teaches on this weekday: [{ period, interval }]
  const teachingByTeacher = new Map();
  const subjectsByTeacher = new Map();
  for (const e of entries) {
    if (!e.teacherId) continue;
    if (!subjectsByTeacher.has(e.teacherId)) subjectsByTeacher.set(e.teacherId, new Set());
    subjectsByTeacher.get(e.teacherId).add(e.subject);
    if (!e.days.split(',').map(Number).includes(weekday)) continue;
    const interval = map.get(e.classId)?.[weekday]?.[e.periodNumber];
    if (!interval) continue;
    if (!teachingByTeacher.has(e.teacherId)) teachingByTeacher.set(e.teacherId, []);
    teachingByTeacher.get(e.teacherId).push({ period: e.periodNumber, interval });
  }

  const assignments = dayArrangements.map((a) => ({
    key: keyOf(a.classId, a.section, a.periodNumber),
    substituteTeacherId: a.substituteTeacherId,
    interval: map.get(a.classId)?.[weekday]?.[a.periodNumber],
    row: a,
  }));

  const monthCount = new Map();
  for (const a of monthArrangements) monthCount.set(a.substituteTeacherId, (monthCount.get(a.substituteTeacherId) || 0) + 1);

  function isFree(teacherId, item) {
    const ab = absenceByTeacher.get(teacherId);
    if (ab) {
      if (ab.fullDay) return false;
      if (ab.periods.has(item.periodNumber)) return false;
    }
    for (const t of teachingByTeacher.get(teacherId) || []) {
      const onLeaveForIt = ab && ab.periods.has(t.period);
      if (onLeaveForIt) {
        // that class is being covered by someone else, but the teacher is away
        if (overlaps(t.interval, item.interval)) return false;
        continue;
      }
      if (overlaps(t.interval, item.interval)) return false;
    }
    for (const a of assignments) {
      if (a.substituteTeacherId !== teacherId || a.key === item.key || !a.interval) continue;
      if (overlaps(a.interval, item.interval)) return false;
    }
    return true;
  }

  const items = [];
  for (const absence of absences) items.push(...neededItems(absence, entries, weekday, map));
  items.sort(
    (a, b) =>
      a.periodNumber - b.periodNumber ||
      classNum(classById.get(a.classId)?.name) - classNum(classById.get(b.classId)?.name) ||
      a.section.localeCompare(b.section)
  );

  const dayLoad = new Map();
  for (const a of assignments) dayLoad.set(a.substituteTeacherId, (dayLoad.get(a.substituteTeacherId) || 0) + 1);

  result.items = items.map((item) => {
    const current = assignments.find((a) => a.key === item.key);
    const options = teachers
      .filter((t) => t.id !== item.absentTeacherId && isFree(t.id, item))
      .map((t) => {
        const taughtToday = new Set((teachingByTeacher.get(t.id) || []).map((x) => x.period)).size;
        return {
          teacherId: t.id,
          sameSubject: subjectsByTeacher.get(t.id)?.has(item.subject) || false,
          monthCount: monthCount.get(t.id) || 0,
          dayCount: dayLoad.get(t.id) || 0,
          teachingToday: taughtToday,
        };
      })
      .sort(
        (a, b) =>
          Number(b.sameSubject) - Number(a.sameSubject) ||
          a.monthCount - b.monthCount ||
          a.dayCount - b.dayCount ||
          a.teachingToday - b.teachingToday ||
          a.teacherId - b.teacherId
      );
    return {
      classId: item.classId,
      section: item.section,
      periodNumber: item.periodNumber,
      subject: item.subject,
      absentTeacherId: item.absentTeacherId,
      startTime: fmtMinutes(item.interval[0]),
      endTime: fmtMinutes(item.interval[1]),
      arrangement: current
        ? { id: current.row.id, substituteTeacherId: current.row.substituteTeacherId, note: current.row.note || '' }
        : null,
      options,
    };
  });
  return result;
}

// GET /api/timetable/arrangements/day?date=YYYY-MM-DD
router.get(
  '/day',
  asyncHandler(async (req, res) => {
    const date = String(req.query.date || '');
    if (!isRealDate(date)) return res.status(400).json({ error: 'Pick a valid date.' });
    res.json(await buildDay(date));
  })
);

// POST /api/timetable/arrangements/absences
// { date, teacherId, fullDay, periods: [3,4], reason }  (adds or updates)
router.post(
  '/absences',
  asyncHandler(async (req, res) => {
    const date = String(req.body.date || '');
    if (!isRealDate(date)) return res.status(400).json({ error: 'Pick a valid date.' });
    if (weekdayOf(date) === null) return res.status(400).json({ error: 'That date is a weekend, not a school day.' });

    const teacherId = Number(req.body.teacherId);
    const teacher = await prisma.timetableTeacher.findUnique({ where: { id: teacherId } });
    if (!teacher) return res.status(400).json({ error: 'Choose a teacher.' });

    const fullDay = req.body.fullDay !== false;
    const periods = Array.from(new Set((Array.isArray(req.body.periods) ? req.body.periods : []).map(Number)))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
      .sort((a, b) => a - b);
    if (!fullDay && !periods.length) return res.status(400).json({ error: 'Pick at least one period, or choose full day.' });

    const data = {
      fullDay,
      periods: fullDay ? '' : periods.join(','),
      reason: String(req.body.reason || '').trim() || null,
    };
    await prisma.timetableAbsence.upsert({
      where: { date_teacherId: { date, teacherId } },
      update: data,
      create: { date, teacherId, ...data },
    });

    // if the leave got smaller, drop arrangements for periods no longer needing cover
    const day = await buildDay(date);
    const keep = new Set(day.items.map((i) => keyOf(i.classId, i.section, i.periodNumber)));
    const stale = (await prisma.timetableArrangement.findMany({ where: { date, absentTeacherId: teacherId } })).filter(
      (a) => !keep.has(keyOf(a.classId, a.section, a.periodNumber))
    );
    if (stale.length) {
      await prisma.timetableArrangement.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
    }
    res.status(201).json(await buildDay(date));
  })
);

// DELETE /api/timetable/arrangements/absences/:id  (also removes its arrangements)
router.delete(
  '/absences/:id',
  asyncHandler(async (req, res) => {
    const absence = await prisma.timetableAbsence.findUnique({ where: { id: Number(req.params.id) } });
    if (!absence) return res.status(404).json({ error: 'Leave record not found.' });
    await prisma.$transaction([
      prisma.timetableArrangement.deleteMany({ where: { date: absence.date, absentTeacherId: absence.teacherId } }),
      prisma.timetableAbsence.delete({ where: { id: absence.id } }),
    ]);
    res.json(await buildDay(absence.date));
  })
);

// PUT /api/timetable/arrangements/assign
// { date, classId, section, periodNumber, substituteTeacherId (null clears), note }
router.put(
  '/assign',
  asyncHandler(async (req, res) => {
    const date = String(req.body.date || '');
    if (!isRealDate(date)) return res.status(400).json({ error: 'Pick a valid date.' });
    const classId = Number(req.body.classId);
    const section = String(req.body.section || '');
    const periodNumber = Number(req.body.periodNumber);

    const day = await buildDay(date);
    const item = day.items.find((i) => i.classId === classId && i.section === section && i.periodNumber === periodNumber);
    if (!item) return res.status(400).json({ error: 'That period does not need an arrangement on this date.' });

    const subId = req.body.substituteTeacherId;
    if (subId === null || subId === undefined || subId === '') {
      await prisma.timetableArrangement.deleteMany({ where: { date, classId, section, periodNumber } });
      return res.json(await buildDay(date));
    }

    const substituteTeacherId = Number(subId);
    if (!item.options.some((o) => o.teacherId === substituteTeacherId)) {
      return res.status(409).json({ error: 'That teacher is not free for this period.' });
    }
    const note = String(req.body.note || '').trim() || null;
    await prisma.timetableArrangement.upsert({
      where: { date_classId_section_periodNumber: { date, classId, section, periodNumber } },
      update: { substituteTeacherId, absentTeacherId: item.absentTeacherId, subject: item.subject, note },
      create: {
        date,
        classId,
        section,
        periodNumber,
        subject: item.subject,
        absentTeacherId: item.absentTeacherId,
        substituteTeacherId,
        note,
      },
    });
    res.json(await buildDay(date));
  })
);

// GET /api/timetable/arrangements/month?month=YYYY-MM  - data for the monthly report
router.get(
  '/month',
  asyncHandler(async (req, res) => {
    const month = String(req.query.month || '');
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'Pick a valid month.' });

    const [arrangements, absences, entries, map] = await Promise.all([
      prisma.timetableArrangement.findMany({
        where: { date: { startsWith: month } },
        orderBy: [{ date: 'asc' }, { periodNumber: 'asc' }, { classId: 'asc' }, { section: 'asc' }],
      }),
      prisma.timetableAbsence.findMany({ where: { date: { startsWith: month } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      prisma.timetableEntry.findMany(),
      loadScheduleMap(),
    ]);

    res.json({
      month,
      arrangements: arrangements.map((a) => ({
        id: a.id,
        date: a.date,
        classId: a.classId,
        section: a.section,
        periodNumber: a.periodNumber,
        subject: a.subject,
        absentTeacherId: a.absentTeacherId,
        substituteTeacherId: a.substituteTeacherId,
        note: a.note || '',
      })),
      absences: absences.map((a) => {
        const weekday = weekdayOf(a.date);
        const toCover = weekday ? neededItems(a, entries, weekday, map).length : 0;
        const arranged = arrangements.filter((x) => x.date === a.date && x.absentTeacherId === a.teacherId).length;
        return { ...absenceShape(a), periodsToCover: toCover, arranged };
      }),
    });
  })
);

module.exports = router;
