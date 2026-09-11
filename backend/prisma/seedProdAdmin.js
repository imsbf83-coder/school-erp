// Run this INSTEAD of prisma/seed.js when going live with real school data.
// It creates exactly one admin login and nothing else — no demo students,
// staff, classes, or bus data. Safe to run on a freshly migrated, empty
// database. It will NOT overwrite an existing account with the same email.
//
// Set your own admin email/password in backend/.env before running:
//   ADMIN_NAME="Your Name"
//   ADMIN_EMAIL="you@yourschool.edu"
//   ADMIN_PASSWORD="choose-a-strong-password"
// If these are not set, it falls back to the same demo credentials as
// prisma/seed.js — change them immediately after logging in if so.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const name = process.env.ADMIN_NAME || 'School Administrator';
  const email = process.env.ADMIN_EMAIL || 'admin@school.edu';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`An account already exists for ${email} — nothing changed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, email, passwordHash, role: 'ADMIN' },
  });

  console.log('---------------------------------------------');
  console.log('Admin account created:');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password === 'Admin@123' ? '(default demo password — change ADMIN_PASSWORD in .env and re-run, or update it once a change-password screen exists)' : '(as set in .env)'}`);
  console.log('---------------------------------------------');
  console.log('No demo students, staff, or classes were created.');
  console.log('Go to Classes first to set up your school\'s real classes,');
  console.log('then use Students / Staff CSV import to bring in real records.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
