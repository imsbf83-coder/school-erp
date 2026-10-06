#!/usr/bin/env node
// One-off: renames the attendance status EXCUSED -> LEAVE on every existing
// AttendanceRecord row. Safe to re-run — once there are no EXCUSED rows
// left, it just reports 0 updated and does nothing further.
//
// Usage (from the backend/ folder):
//   node Scripts/rename-excused-to-leave.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.attendanceRecord.updateMany({
    where: { status: 'EXCUSED' },
    data: { status: 'LEAVE' },
  });
  console.log(`Updated ${result.count} attendance record(s) from EXCUSED to LEAVE.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
