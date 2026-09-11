-- Catch-up migration.
--
-- `TeacherClass.section` and `Staff.category` are both declared in
-- schema.prisma and both exist in the shipped dev.db, but no migration ever
-- created them — they were applied out of band. (The folder named
-- "add_staff_category" actually rebuilds the Holiday table; it never touches
-- Staff.) Without this file, a fresh `prisma migrate deploy` against an empty
-- database produces a schema missing both columns, and the Teacher Access and
-- Staff modules fail at runtime.
--
-- On a database that already has these columns, do NOT run this — SQLite has
-- no `ADD COLUMN IF NOT EXISTS`, so it would error. Mark it applied instead:
--   npx prisma migrate resolve --applied 20260830090000_catch_up_drift

-- AlterTable
ALTER TABLE "TeacherClass" ADD COLUMN "section" TEXT;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'NON_TEACHING';
