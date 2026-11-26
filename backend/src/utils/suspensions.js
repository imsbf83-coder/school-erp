const prisma = require('../prismaClient');

// Suspensions switch a student's status on and off by date:
//   - the day a suspension starts, the student becomes SUSPENDED
//   - the day after its last day, the student becomes REGULAR again
// This runs whenever the server starts, once an hour, and (at most every few
// minutes) before API requests, so it also works on hosting that puts the
// server to sleep. "Today" is the school's calendar day, not the server's.

const TIMEZONE = process.env.SCHOOL_TIMEZONE || 'Asia/Karachi';

// today's calendar date in the school's time zone, as UTC midnight
function todayStart() {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00.000Z`);
}

async function syncSuspensions() {
  const today = todayStart();

  const covering = await prisma.studentSuspension.findMany({
    where: { cancelled: false, startDate: { lte: today }, endDate: { gte: today } },
    select: { studentId: true },
  });
  const activeIds = Array.from(new Set(covering.map((c) => c.studentId)));

  if (activeIds.length) {
    await prisma.student.updateMany({
      where: { id: { in: activeIds }, status: 'REGULAR' },
      data: { status: 'SUSPENDED' },
    });
  }
  // anyone still marked SUSPENDED without a suspension covering today is back
  await prisma.student.updateMany({
    where: { status: 'SUSPENDED', ...(activeIds.length ? { id: { notIn: activeIds } } : {}) },
    data: { status: 'REGULAR' },
  });
}

let lastRun = 0;
let lastDay = '';
let running = null;

// Cheap to call on every request: only does work when the day has changed or
// a few minutes have passed.
function syncIfDue() {
  const day = todayStart().toISOString().slice(0, 10);
  if (running) return running;
  if (day === lastDay && Date.now() - lastRun < 5 * 60 * 1000) return Promise.resolve();
  running = syncSuspensions()
    .then(() => {
      lastRun = Date.now();
      lastDay = day;
    })
    .catch((err) => console.error('Suspension sync failed:', err.message))
    .finally(() => {
      running = null;
    });
  return running;
}

// forces the next syncIfDue() to run (used right after a suspension changes)
async function syncNow() {
  lastRun = 0;
  await syncIfDue();
}

module.exports = { syncSuspensions, syncIfDue, syncNow, todayStart };
