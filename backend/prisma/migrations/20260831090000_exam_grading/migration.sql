-- Examination: terms, per-student electives, and an editable grading scale.
--
-- Every added column is nullable or has a default, so rows created before
-- this migration keep working: a NULL `Exam.term` means "no term recorded"
-- and `ExamSubject.appliesTo = 'ALL'` is how every subject behaved before
-- electives existed.
--
-- Safe to run with `prisma migrate deploy` against an existing database.
-- Do NOT use `migrate dev` — this project's dev.db carries pre-existing
-- drift and `migrate dev` offers to reset it.

-- Exam: which term, the subject pass threshold, and the final-term
-- promotion rule.
ALTER TABLE "Exam" ADD COLUMN "term" INTEGER;
ALTER TABLE "Exam" ADD COLUMN "passPercent" REAL NOT NULL DEFAULT 40;
ALTER TABLE "Exam" ADD COLUMN "maxFailedSubjects" INTEGER;
ALTER TABLE "Exam" ADD COLUMN "minOverallPercent" REAL;

-- ExamSubject: who sits the subject, and its display order.
ALTER TABLE "ExamSubject" ADD COLUMN "appliesTo" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "ExamSubject" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- The editable percentage -> grade table.
CREATE TABLE "GradeScale" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "minGrade" INTEGER,
    "maxGrade" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GradeScale_name_key" ON "GradeScale"("name");

CREATE TABLE "GradeBand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gradeScaleId" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "minPercent" REAL NOT NULL,
    "gradePoint" REAL NOT NULL,
    "remarks" TEXT,
    CONSTRAINT "GradeBand_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES "GradeScale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GradeBand_gradeScaleId_idx" ON "GradeBand"("gradeScaleId");

-- Seed the fallback scale so a fresh deploy grades correctly with no extra
-- step. Bounds are inclusive lower bounds, matched highest-first, which is
-- why 40 (the pass mark) belongs to E rather than falling through to F.
INSERT INTO "GradeScale" ("name", "minGrade", "maxGrade")
VALUES ('Default (all classes)', NULL, NULL);

INSERT INTO "GradeBand" ("gradeScaleId", "grade", "minPercent", "gradePoint", "remarks")
SELECT "id", 'A+', 90, 6, 'Outstanding'   FROM "GradeScale" WHERE "name" = 'Default (all classes)'
UNION ALL
SELECT "id", 'A',  80, 5, 'Excellent'     FROM "GradeScale" WHERE "name" = 'Default (all classes)'
UNION ALL
SELECT "id", 'B',  70, 4, 'Very Good'     FROM "GradeScale" WHERE "name" = 'Default (all classes)'
UNION ALL
SELECT "id", 'C',  60, 3, 'Good'          FROM "GradeScale" WHERE "name" = 'Default (all classes)'
UNION ALL
SELECT "id", 'D',  50, 2, 'Fair'          FROM "GradeScale" WHERE "name" = 'Default (all classes)'
UNION ALL
SELECT "id", 'E',  40, 1, 'Satisfactory'  FROM "GradeScale" WHERE "name" = 'Default (all classes)'
UNION ALL
SELECT "id", 'F',   0, 0, 'Fail'          FROM "GradeScale" WHERE "name" = 'Default (all classes)';
