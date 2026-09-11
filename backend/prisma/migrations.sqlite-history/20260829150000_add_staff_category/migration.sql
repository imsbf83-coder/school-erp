-- The earlier "add_holidays" migration attempt (20260828090000) had already
-- created a Holiday table with a different column layout (startDate,
-- endDate, title, type, classId, declaredById) before it was marked as
-- failed — so this migration's plain CREATE TABLE collides with it.
--
-- This version instead: renames the old table out of the way, creates the
-- table in the shape the app actually uses today (date, name,
-- createdById), copies across any existing rows (old startDate -> new
-- date, old title -> new name), then drops the old table.
ALTER TABLE "Holiday" RENAME TO "_Holiday_old";

-- CreateTable
CREATE TABLE "Holiday" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holiday_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Carry over any rows that existed under the old shape.
INSERT INTO "Holiday" ("date", "name", "createdById", "createdAt")
SELECT "startDate", "title", "declaredById", "createdAt" FROM "_Holiday_old";

DROP TABLE "_Holiday_old";

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");
