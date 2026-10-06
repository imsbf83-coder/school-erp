const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  getAllowedClassIds,
  getAllowedSections,
  isClassAllowed,
  isSectionAllowed,
} = require('../utils/classAccess');

const router = express.Router();
router.use(requireAuth);

// GET /api/attendance?date=YYYY-MM-DD&classId=&section=
// Returns attendance for every student in a class on a given date (marked or
// not). An optional `section` narrows the list to one section of the class;
// omit it to get the whole class.
//
// A TEACHER restricted to one section of this class (TeacherClass.section
// set) can only ever see that section: if they explicitly ask for a
// different section, that's a 403; if they ask for "whole class" (no
// section param), the query is silently narrowed to their assigned section
// instead of returning every section.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { date, classId, section } = req.query;

    if (!date || !classId) {
      return res
        .status(400)
        .json({ error: 'date and classId are required query params' });
    }

    const allowedClassIds = await getAllowedClassIds(req.user);

    if (!isClassAllowed(allowedClassIds, classId)) {
      return res
        .status(403)
        .json({ error: 'You do not have access to this class' });
    }

    const allowedSections = await getAllowedSections(req.user);
    let effectiveSection = section;

    if (allowedSections !== null) {
      const requiredSection = allowedSections.get(Number(classId));
      if (requiredSection) {
        if (section && !isSectionAllowed(allowedSections, classId, section)) {
          return res
            .status(403)
            .json({ error: 'You do not have access to this section' });
        }
        effectiveSection = requiredSection;
      }
    }

    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const students = await prisma.student.findMany({
      where: {
        classId: Number(classId),
        status: 'REGULAR',
        ...(effectiveSection ? { section: effectiveSection } : {}),
      },
      orderBy: { admissionNumber: 'asc' },
      include: {
        attendance: {
          where: {
            date: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
        },
      },
    });

    const result = students.map((s) => ({
      studentId: s.id,
      admissionNumber: s.admissionNumber,
      name: `${s.firstName} ${s.lastName}`,
      rollNumber: s.rollNumber,
      section: s.section,
      status: s.attendance[0]?.status || null,
      recordId: s.attendance[0]?.id || null,
    }));

    res.json(result);
  })
);

// POST /api/attendance/bulk
// Body (monthly):  { skipExisting: true, records: [{ studentId, date, status, remarks }] }
// Body (single-day): { date, records: [{ studentId, status, remarks }] }
//
// When skipExisting is true, any (studentId, date) pair that already exists
// is counted as "skipped" and left untouched. When false (or absent), the
// old upsert behaviour applies — existing records are overwritten.
router.post(
  '/bulk',
  requireRole('ADMIN', 'TEACHER', 'STAFF'),
  [body('records').isArray({ min: 1 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      date: topLevelDate,
      records,
      skipExisting,
    } = req.body;

    // --- Build flat list of { studentId, dateObj, status, remarks } ---
    const flat = records
      .filter((r) => r.status) // skip blank-status rows (blank = "don't touch")
      .map((r) => {
        const rawDate = r.date || topLevelDate;

        if (!rawDate || !r.studentId) {
          return null;
        }

        return {
          studentId: Number(r.studentId),
          dateObj: new Date(rawDate),
          status: r.status,
          remarks: r.remarks || null,
        };
      })
      .filter(Boolean);

    if (flat.length === 0) {
      return res.json({
        updated: 0,
        skipped: 0,
        attempted: records.length,
      });
    }

    // --- Access check ---
    // Restricted to allowed classes AND, within an allowed class, to the
    // teacher's assigned section (if any) — this is what stops a teacher
    // from marking attendance for a section they weren't given.
    const allowedClassIds = await getAllowedClassIds(req.user);

    if (allowedClassIds !== null) {
      const allowedSections = await getAllowedSections(req.user);
      const studentIds = [
        ...new Set(flat.map((r) => r.studentId)),
      ];

      const students = await prisma.student.findMany({
        where: {
          id: {
            in: studentIds,
          },
        },
        select: {
          id: true,
          classId: true,
          section: true,
        },
      });

      const disallowed = students.some(
        (s) =>
          !allowedClassIds.includes(s.classId) ||
          !isSectionAllowed(allowedSections, s.classId, s.section)
      );

      const missing = students.length !== studentIds.length;

      if (disallowed || missing) {
        return res.status(403).json({
          error:
            'You do not have access to one or more of these students',
        });
      }
    }

    let updated = 0;
    let skipped = 0;

    if (skipExisting) {
      // --- Monthly import: only insert rows that don't exist yet ---
      for (const rec of flat) {
        const existing =
          await prisma.attendanceRecord.findUnique({
            where: {
              studentId_date: {
                studentId: rec.studentId,
                date: rec.dateObj,
              },
            },
            select: {
              id: true,
            },
          });

        if (existing) {
          skipped += 1;
        } else {
          await prisma.attendanceRecord.create({
            data: {
              studentId: rec.studentId,
              date: rec.dateObj,
              status: rec.status,
              remarks: rec.remarks,
              markedById: req.user.id,
            },
          });

          updated += 1;
        }
      }
    } else {
      // --- Single-day import: upsert (overwrite existing) ---
      const results = await prisma.$transaction(
        flat.map((r) =>
          prisma.attendanceRecord.upsert({
            where: {
              studentId_date: {
                studentId: r.studentId,
                date: r.dateObj,
              },
            },
            update: {
              status: r.status,
              remarks: r.remarks,
              markedById: req.user.id,
            },
            create: {
              studentId: r.studentId,
              date: r.dateObj,
              status: r.status,
              remarks: r.remarks,
              markedById: req.user.id,
            },
          })
        )
      );

      updated = results.length;
    }

    res.json({
      updated,
      skipped,
      attempted: records.length,
    });
  })
);

// GET /api/attendance/student/:studentId?from=&to=
router.get(
  '/student/:studentId',
  asyncHandler(async (req, res) => {
    const allowedClassIds = await getAllowedClassIds(req.user);

    if (allowedClassIds !== null) {
      const student = await prisma.student.findUnique({
        where: {
          id: Number(req.params.studentId),
        },
        select: {
          classId: true,
          section: true,
        },
      });

      const allowedSections = await getAllowedSections(req.user);

      if (
        !student ||
        !allowedClassIds.includes(student.classId) ||
        !isSectionAllowed(allowedSections, student.classId, student.section)
      ) {
        return res.status(403).json({
          error: 'You do not have access to this student',
        });
      }
    }

    const { from, to, section } = req.query;

    // Default: current month
    const now = new Date();

    const fromDate = from
      ? new Date(from)
      : new Date(
          Date.UTC(
            now.getFullYear(),
            now.getMonth(),
            1
          )
        );

    const toDate = to
      ? new Date(to)
      : new Date(
          Date.UTC(
            now.getFullYear(),
            now.getMonth() + 1,
            0
          )
        );

    // Import calendar helpers from attendanceCalendar.js
    const {
      buildDayInfo,
      fetchHolidays,
      summarizeAttendance,
    } = require('../utils/attendanceCalendar');

    // Get student info
    const student = await prisma.student.findUnique({
      where: {
        id: Number(req.params.studentId),
      },
      include: {
        class: true,
      },
    });

    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }

    // Build day info for the period
    const holidays = await fetchHolidays(
      student.classId,
      fromDate,
      toDate
    );

    const dayInfo = buildDayInfo(
      fromDate,
      toDate,
      holidays,
      now
    );

    const workingDays = dayInfo.filter(
      (d) => d.isWorkingDay
    );

    // Get attendance records
    const records =
      await prisma.attendanceRecord.findMany({
        where: {
          studentId: Number(req.params.studentId),
          date: {
            gte: fromDate,
            lte: toDate,
          },
        },
      });

    // Build status map
    const statusByDate = new Map();

    records.forEach((r) => {
      const key = r.date
        .toISOString()
        .slice(0, 10);

      statusByDate.set(key, r.status);
    });

    // Summarize
    const summary = summarizeAttendance(
      workingDays,
      statusByDate
    );

    // Format dates for response
    // IMPORTANT: use different variable names because
    // `from` and `to` already exist in req.query.
    const fromFormatted = fromDate
      .toISOString()
      .slice(0, 10);

    const toFormatted = toDate
      .toISOString()
      .slice(0, 10);

    res.json({
      studentId: student.id,
      name: `${student.firstName} ${student.lastName}`,
      class: student.class?.name,
      section: student.section,
      from: fromFormatted,
      to: toFormatted,
      ...summary,
    });
  })
);

// GET /api/attendance/report?classId=&section=&from=&to=
router.get(
  '/report',
  asyncHandler(async (req, res) => {
    const {
      classId,
      section,
      from,
      to,
    } = req.query;

    if (!classId || !from || !to) {
      return res.status(400).json({
        error:
          'classId, from, and to are required query params',
      });
    }

    const allowedClassIds =
      await getAllowedClassIds(req.user);

    if (!isClassAllowed(allowedClassIds, classId)) {
      return res.status(403).json({
        error: 'You do not have access to this class',
      });
    }

    const allowedSections = await getAllowedSections(req.user);
    let effectiveSection = section;

    if (allowedSections !== null) {
      const requiredSection = allowedSections.get(Number(classId));
      if (requiredSection) {
        if (section && !isSectionAllowed(allowedSections, classId, section)) {
          return res.status(403).json({
            error: 'You do not have access to this section',
          });
        }
        effectiveSection = requiredSection;
      }
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Import calendar helpers
    const {
      buildDayInfo,
      fetchHolidays,
      summarizeAttendance,
    } = require('../utils/attendanceCalendar');

    // Build day info for the period
    const holidays = await fetchHolidays(
      classId,
      fromDate,
      toDate
    );

    const dayInfo = buildDayInfo(
      fromDate,
      toDate,
      holidays,
      new Date()
    );

    const workingDays = dayInfo.filter(
      (d) => d.isWorkingDay
    );

    // Get students
    const students = await prisma.student.findMany({
      where: {
        classId: Number(classId),
        status: 'REGULAR',
        ...(effectiveSection ? { section: effectiveSection } : {}),
      },
      orderBy: {
        admissionNumber: 'asc',
      },
      include: {
        class: true,
        attendance: {
          where: {
            date: {
              gte: fromDate,
              lte: toDate,
            },
          },
        },
      },
    });

    // Build report
    const rows = students.map((s) => {
      const statusByDate = new Map();

      s.attendance.forEach((a) => {
        const key = a.date
          .toISOString()
          .slice(0, 10);

        statusByDate.set(key, a.status);
      });

      const {
        present,
        absent,
        late,
        leave,
        workingDays: totalWorkingDays,
        attendancePercent: percentage,
      } = summarizeAttendance(
        workingDays,
        statusByDate
      );

      return {
        studentId: s.id,
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        rollNumber: s.rollNumber,
        className: s.class?.name,
        section: s.section,
        present,
        late,
        leave,
        absent,
        totalWorkingDays,
        percentage,
      };
    });

    res.json({
      from,
      to,
      section: effectiveSection || null,
      totalWorkingDays: workingDays.length,
      holidays: holidays.length,
      rows,
    });
  })
);

// GET /api/attendance/classwise-summary?date=YYYY-MM-DD
// GET /api/attendance/classwise-summary?month=YYYY-MM
//
// One row per class+section: how many REGULAR students are enrolled there,
// and how their attendance broke down — Present (PRESENT + LATE marked as
// present-but-late are folded together here), On Leave (LEAVE), and Absent.
//
// `date` gives a single day's snapshot. `month` sums the same counts across
// every working day in that month instead (so Present/Leave/Absent can add
// up to more than Total Students — each is a count of markings across the
// whole month, not a headcount). Pass exactly one of the two.
router.get(
  '/classwise-summary',
  asyncHandler(async (req, res) => {
    const { date, month } = req.query;
    if (!date && !month) {
      return res.status(400).json({ error: 'Provide either date or month' });
    }

    const allowedClassIds = await getAllowedClassIds(req.user);

    let fromDate;
    let toDate;
    if (date) {
      fromDate = new Date(date);
      toDate = new Date(date);
      toDate.setHours(23, 59, 59, 999);
    } else {
      const [y, m] = month.split('-').map(Number);
      fromDate = new Date(Date.UTC(y, m - 1, 1));
      toDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    }

    // For a month, non-working days (weekends/holidays) are excluded from
    // the sums the same way the per-student report excludes them — a class
    // isn't dinged for days school wasn't even in session.
    const {
      buildDayInfo,
      fetchHolidays,
    } = require('../utils/attendanceCalendar');
    const holidays = month ? await fetchHolidays(null, fromDate, toDate) : [];
    const workingDateKeys = month
      ? new Set(
          buildDayInfo(fromDate, toDate, holidays, new Date())
            .filter((d) => d.isWorkingDay)
            .map((d) => d.date)
        )
      : null;

    const classes = await prisma.class.findMany({
      where: allowedClassIds !== null ? { id: { in: allowedClassIds } } : {},
      orderBy: { name: 'asc' },
    });

    const rows = [];

    for (const cls of classes) {
      const students = await prisma.student.findMany({
        where: { classId: cls.id, status: 'REGULAR' },
        select: { id: true, section: true },
      });

      const bySection = new Map(); // section (or '' for none) -> { total, present, leave, absent }
      for (const s of students) {
        const key = s.section || '';
        if (!bySection.has(key)) bySection.set(key, { total: 0, present: 0, leave: 0, absent: 0 });
        bySection.get(key).total += 1;
      }

      if (students.length === 0) continue;

      const studentIds = students.map((s) => s.id);
      const records = await prisma.attendanceRecord.findMany({
        where: {
          studentId: { in: studentIds },
          date: { gte: fromDate, lte: toDate },
        },
        select: { studentId: true, date: true, status: true },
      });

      const sectionByStudentId = new Map(students.map((s) => [s.id, s.section || '']));

      for (const rec of records) {
        if (workingDateKeys) {
          const key = rec.date.toISOString().slice(0, 10);
          if (!workingDateKeys.has(key)) continue;
        }
        const bucket = bySection.get(sectionByStudentId.get(rec.studentId));
        if (!bucket) continue;
        if (rec.status === 'PRESENT' || rec.status === 'LATE') bucket.present += 1;
        else if (rec.status === 'LEAVE') bucket.leave += 1;
        else if (rec.status === 'ABSENT') bucket.absent += 1;
      }

      for (const [section, counts] of bySection.entries()) {
        rows.push({
          className: cls.name,
          section: section || null,
          totalStudents: counts.total,
          present: counts.present,
          leave: counts.leave,
          absent: counts.absent,
        });
      }
    }

    res.json({ date: date || null, month: month || null, rows });
  })
);

module.exports = router;
