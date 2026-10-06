const prisma = require('../prismaClient');

// Saturday and Sunday are always non-working days.
// No database row is needed for weekends.
function isWeekend(date) {
  const dow = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return dow === 0 || dow === 6;
}

// Convert a Date to YYYY-MM-DD.
// Used consistently as the calendar/map key.
function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Return every calendar date from start to end, inclusive.
// Dates are normalized to midnight UTC.
function eachDate(start, end) {
  const dates = [];

  const cur = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate()
    )
  );

  const last = new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate()
    )
  );

  while (cur <= last) {
    dates.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return dates;
}

// Fetch school-wide holidays from the Holiday table.
//
// Actual Prisma Holiday model:
//
// Holiday {
//   id
//   date
//   name
//   createdById
//   createdAt
// }
//
// There is no startDate, endDate, classId, title, or type.
//
// classId remains in the function signature for compatibility with
// existing callers. Holidays are school-wide, so it is intentionally ignored.
async function fetchHolidays(classId, start, end) {
  const startDate = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate()
    )
  );

  const endDate = new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );

  return prisma.holiday.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      date: 'asc',
    },
  });
}

// Convert Holiday database rows into a Map:
//
// YYYY-MM-DD -> {
//   title,
//   type,
//   scope
// }
//
// Although the database calls the holiday name "name", we expose it
// as "title" to keep the existing calendar response structure compatible.
function buildHolidayMap(holidays) {
  const map = new Map();

  if (!Array.isArray(holidays)) {
    return map;
  }

  for (const holiday of holidays) {
    if (!holiday || !holiday.date) {
      continue;
    }

    const key = toDateKey(new Date(holiday.date));

    if (!map.has(key)) {
      map.set(key, {
        title: holiday.name,
        type: 'HOLIDAY',
        scope: 'SCHOOL',
      });
    }
  }

  return map;
}

// Classifies every date in [start, end] as:
// - weekend
// - holiday
// - working day
//
// IMPORTANT:
// Existing attendance.js calls:
//
//   const holidays = await fetchHolidays(...);
//   const dayInfo = buildDayInfo(fromDate, toDate, holidays, now);
//
// Therefore this function accepts either:
//   1. the raw holiday array returned by fetchHolidays()
//   2. an already-created Map
//
// This prevents "holidayMap.get is not a function" errors.
function buildDayInfo(start, end, holidaysOrMap, today) {
  let holidayMap;

  if (holidaysOrMap instanceof Map) {
    // Already a Map.
    holidayMap = holidaysOrMap;
  } else if (Array.isArray(holidaysOrMap)) {
    // Raw Prisma holiday rows.
    holidayMap = buildHolidayMap(holidaysOrMap);
  } else {
    // No holidays supplied.
    holidayMap = new Map();
  }

  const todayKey = toDateKey(today);

  return eachDate(start, end).map((date) => {
    const key = toDateKey(date);
    const holiday = holidayMap.get(key) || null;
    const weekend = isWeekend(date);
    const isFuture = key > todayKey;

    return {
      date: key,
      dayOfWeek: date.getUTCDay(),
      isWeekend: weekend,
      holiday,
      isFuture,

      // Attendance should only be expected on:
      // - weekdays
      // - non-holidays
      // - dates that have already occurred
      isWorkingDay: !weekend && !holiday && !isFuture,
    };
  });
}

// Given a student's status per date:
//
// PRESENT
// ABSENT
// LATE
// LEAVE
//
// Calculate attendance statistics.
//
// PRESENT and LATE count as attended.
// LEAVE is excluded from the percentage denominator.
// Unmarked days are also excluded from the percentage denominator.
function summarizeAttendance(workingDays, statusByDate) {
  let present = 0;
  let absent = 0;
  let late = 0;
  let leave = 0;
  let unmarked = 0;

  for (const day of workingDays) {
    const status = statusByDate.get(day.date);

    if (!status) {
      unmarked += 1;
      continue;
    }

    if (status === 'PRESENT') {
      present += 1;
    } else if (status === 'ABSENT') {
      absent += 1;
    } else if (status === 'LATE') {
      late += 1;
    } else if (status === 'LEAVE') {
      leave += 1;
    }
  }

  // LEAVE and UNMARKED are excluded from the denominator.
  const countable = present + absent + late;

  const percent =
    countable > 0
      ? Math.round(((present + late) / countable) * 1000) / 10
      : null;

  return {
    workingDays: workingDays.length,
    present,
    absent,
    late,
    leave,
    unmarked,
    attendancePercent: percent,
  };
}

module.exports = {
  isWeekend,
  toDateKey,
  eachDate,
  fetchHolidays,
  buildHolidayMap,
  buildDayInfo,
  summarizeAttendance,
};