#!/usr/bin/env node
// Resets a user's password directly in the database — for when you're
// locked out and can't use the app's own "Reset password" feature (which
// requires being logged in as admin already).
//
// Usage (from the backend/ folder):
//   node Scripts/reset-admin-password.js you@yourschool.edu "NewPassword123"
//
// Uses your existing DATABASE_URL from .env (same one the app itself
// connects with), so this updates the real, live Neon database.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const [identifier, newPassword] = process.argv.slice(2);

  if (!identifier || !newPassword) {
    console.error('Usage: node Scripts/reset-admin-password.js <email-or-phone> <newPassword>');
    process.exit(1);
  }
  if (newPassword.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  const isEmail = identifier.includes('@');
  const user = await prisma.user.findUnique({
    where: isEmail ? { email: identifier } : { phone: identifier },
  });

  if (!user) {
    console.error(`No account found with ${isEmail ? 'email' : 'phone'} "${identifier}".`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  console.log('---------------------------------------------');
  console.log(`Password reset for: ${user.name} (${user.role})`);
  console.log(`Login with: ${identifier}`);
  console.log('---------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
