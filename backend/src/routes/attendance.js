const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAllowedClassIds, isClassAllowed } = require('../utils/classAccess');

const router = express.Router();
router.use(requireAuth);

// GET /api/attendance?date=YYYY-MM-DD&classId=&section=
// Returns attendance for every student in a class on a given date (marked or
// not). An optional `section` narrows the list to one section of the class;
// omit it to get the whole class.
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

    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const students = await prisma.student.findMany({
      where: {
        classId: Number(classId),
        status: 'REGULAR',
        ...(section ? { section } : {}),
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
// A record's `status` of 'CLEAR' (only meaningful when skipExisting is
// false/absent) deletes that student's record for that date outright —
// used by the attendance calendar editor when a cell is cycled back to
// blank. This is different from omitting a record entirely, which this
// endpoint always treats as "don't touch, not a real answer yet".
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
    const allowedClassIds = await getAllowedClassIds(req.user);

    if (allowedClassIds !== null) {
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
        },
      });

      const disallowed = students.some(
        (s) => !allowedClassIds.includes(s.classId)
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
      // --- Single-day marking / calendar edit: upsert normal statuses.
      // A status of 'CLEAR' is the calendar editor's explicit "this cell
      // was cycled back to blank — delete the record" signal, distinct
      // from an absent/undefined status elsewhere in this endpoint, which
      // means "leave existing data alone".
      const toUpsert = flat.filter((r) => r.status !== 'CLEAR');
      const toClear = flat.filter((r) => r.status === 'CLEAR');

      const results = await prisma.$transaction([
        ...toUpsert.map((r) =>
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
        ),
        ...toClear.map((r) =>
          prisma.attendanceRecord.deleteMany({
            where: {
              studentId: r.studentId,
              date: r.dateObj,
            },
          })
        ),
      ]);

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
        },
      });

      if (
        !student ||
        !allowedClassIds.includes(student.classId)
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
        ...(section ? { section } : {}),
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
        excused,
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
        excused,
        absent,
        totalWorkingDays,
        percentage,
      };
    });

    res.json({
      from,
      to,
      section: section || null,
      totalWorkingDays: workingDays.length,
      holidays: holidays.length,
      rows,
    });
  })
);

// GET /api/attendance/calendar?classId=&section=&from=&to=
// Same class/period scoping as /report, but returns each student's
// day-by-day status (not just the aggregated totals /report computes and
// discards) so it can be rendered as an editable grid — one column per
// working day, with existing marks fillable/changeable at any time.
// Edits are saved through the existing POST /bulk (no new write endpoint
// needed — it already accepts an arbitrary studentId+date+status per row).
router.get(
  '/calendar',
  asyncHandler(async (req, res) => {
    const { classId, section, from, to } = req.query;

    if (!classId || !from || !to) {
      return res.status(400).json({
        error: 'classId, from, and to are required query params',
      });
    }

    const allowedClassIds = await getAllowedClassIds(req.user);

    if (!isClassAllowed(allowedClassIds, classId)) {
      return res.status(403).json({
        error: 'You do not have access to this class',
      });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    const {
      buildDayInfo,
      fetchHolidays,
      summarizeAttendance,
    } = require('../utils/attendanceCalendar');

    const holidays = await fetchHolidays(classId, fromDate, toDate);
    const dayInfo = buildDayInfo(fromDate, toDate, holidays, new Date());
    const workingDays = dayInfo.filter((d) => d.isWorkingDay);

    const students = await prisma.student.findMany({
      where: {
        classId: Number(classId),
        status: 'REGULAR',
        ...(section ? { section } : {}),
      },
      orderBy: {
        admissionNumber: 'asc',
      },
      include: {
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

    const rows = students.map((s) => {
      const statusByDate = {};

      s.attendance.forEach((a) => {
        statusByDate[a.date.toISOString().slice(0, 10)] = a.status;
      });

      const summary = summarizeAttendance(
        workingDays,
        new Map(Object.entries(statusByDate))
      );

      return {
        studentId: s.id,
        admissionNumber: s.admissionNumber,
        rollNumber: s.rollNumber,
        name: `${s.firstName} ${s.lastName}`,
        section: s.section,
        statusByDate,
        present: summary.present,
        absent: summary.absent,
        late: summary.late,
        excused: summary.excused,
        attendancePercent: summary.attendancePercent,
      };
    });

    res.json({
      dates: workingDays.map((d) => d.date),
      rows,
    });
  })
);

module.exports = router;