const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAllowedClassIds, getAllowedSections } = require('../utils/classAccess');
const { MODULES, getUserModules, hasModule } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// Combines an existing "A,B" sections string with newly-submitted sections,
// case-insensitively de-duplicated, keeping the first-seen casing and order.
function mergeSections(existingCSV, incomingCSV) {
  const seen = new Map(); // lowercase -> original casing
  for (const csv of [existingCSV, incomingCSV]) {
    for (const raw of String(csv || '').split(',')) {
      const s = raw.trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) seen.set(key, s);
    }
  }
  const merged = Array.from(seen.values());
  return merged.length ? merged.join(',') : null;
}

// A class "name" is treated as the same class if it matches after trimming
// and ignoring case ("9", "9 ", "Grade 9" vs "grade 9"). Matching this way
// in JS (rather than relying only on the DB's exact-string unique
// constraint) prevents near-duplicate rows like "9" and "9 " from ever
// being created in the first place.
function normalizeClassName(name) {
  return String(name || '').trim().toLowerCase();
}

async function findByNormalizedName(name, excludeId) {
  const target = normalizeClassName(name);
  if (!target) return null;
  const all = await prisma.class.findMany();
  return all.find((c) => normalizeClassName(c.name) === target && c.id !== excludeId) || null;
}

// GET /api/classes
//
// For a TEACHER who is restricted to a single section of a given class
// (TeacherClass.section is set, not null), the `sections` field returned
// here is narrowed down to just that one section instead of the class's
// full "A,B,C" list. This is what makes the Attendance page's section
// dropdown show only the teacher's own section — the frontend doesn't need
// any special-casing, it just sees a shorter sections string.
//
// A teacher with no section restriction for that class (TeacherClass.section
// is null, meaning "whole class") gets the full sections list back, same as
// an unrestricted user.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    let allowedClassIds = await getAllowedClassIds(req.user);
    let allowedSections = await getAllowedSections(req.user);

    // A TEACHER who ALSO holds the EXAMS, STUDENTS or BUS module permission
    // (e.g. an Exam Incharge or Admission Incharge who isn't a class
    // teacher at all) should see every class here, not just the ones
    // they're personally assigned to via TeacherClass — otherwise someone
    // with no classes of their own gets an empty list everywhere this
    // endpoint feeds into (the Award List's section picker, Students page
    // filters, etc.). Same override as exams.js#getExamClassScope.
    if (allowedClassIds !== null) {
      const userModules = await getUserModules(req.user);
      if (
        hasModule(userModules, MODULES.EXAMS) ||
        hasModule(userModules, MODULES.STUDENTS) ||
        hasModule(userModules, MODULES.BUS)
      ) {
        allowedClassIds = null;
        allowedSections = null;
      }
    }

    const classes = await prisma.class.findMany({
      where: allowedClassIds !== null ? { id: { in: allowedClassIds } } : {},
      include: { _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });

    const withSectionScope = classes.map((c) => {
      const restrictedTo = allowedSections?.get(c.id);
      return restrictedTo ? { ...c, sections: restrictedTo } : c;
    });

    res.json(withSectionScope);
  })
);

// POST /api/classes  (Admin only)
//
// A class name is unique, but a class can have several sections
// (e.g. "9" with sections A, B, C). Submitting a name that already exists
// (matched trimmed + case-insensitively) does NOT fail — it's treated as
// "add this section to that class" and the new section(s) are merged into
// the existing class's section list instead of creating a duplicate row.
router.post(
  '/',
  requireRole('ADMIN'),
  [body('name').notEmpty()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const existing = await findByNormalizedName(req.body.name);

    if (existing) {
      const mergedSections = mergeSections(existing.sections, req.body.sections);
      const cls = await prisma.class.update({
        where: { id: existing.id },
        data: { sections: mergedSections },
      });
      return res.status(200).json(cls);
    }

    const cls = await prisma.class.create({
      data: { name: req.body.name.trim(), sections: req.body.sections || null },
    });
    res.status(201).json(cls);
  })
);

// PUT /api/classes/:id  (Admin only - rename or edit sections)
router.put(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { name, sections } = req.body;
    const id = Number(req.params.id);

    if (name) {
      const existing = await findByNormalizedName(name, id);
      if (existing) {
        return res.status(409).json({ error: `A class named "${existing.name}" already exists. Use "Merge duplicate classes" below, or pick a different name.` });
      }
    }

    const cls = await prisma.class.update({
      where: { id },
      data: { ...(name ? { name: name.trim() } : {}), ...(sections !== undefined ? { sections } : {}) },
    });
    res.json(cls);
  })
);

// POST /api/classes/merge-duplicates  (Admin only)
//
// One-time cleanup tool: finds any classes whose names match after
// trimming/case-folding (e.g. two separate rows both effectively "9",
// possibly from data created before the app enforced this), merges their
// section lists together, re-points every student (and exam-class link)
// at a single surviving row, and deletes the rest. Safe to run repeatedly —
// it's a no-op once there's nothing left to merge.
router.post(
  '/merge-duplicates',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const all = await prisma.class.findMany({ orderBy: { id: 'asc' } });
    const groups = new Map(); // normalized name -> Class[]
    for (const c of all) {
      const key = normalizeClassName(c.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    const merges = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [keep, ...rest] = group; // keep the oldest (lowest id)
      const mergedSections = rest.reduce(
        (acc, c) => mergeSections(acc, c.sections),
        keep.sections
      );
      const removedIds = rest.map((c) => c.id);

      await prisma.class.update({ where: { id: keep.id }, data: { sections: mergedSections } });

      // Students: no uniqueness concern, safe to bulk re-point.
      await prisma.student.updateMany({ where: { classId: { in: removedIds } }, data: { classId: keep.id } });

      // Exam-class links: (examId, classId) is unique, so if the surviving
      // class and a duplicate are both already linked to the same exam,
      // re-pointing would collide — drop the duplicate link instead of
      // moving it in that case.
      const examLinks = await prisma.examClass.findMany({ where: { classId: { in: removedIds } } });
      for (const link of examLinks) {
        const alreadyLinked = await prisma.examClass.findUnique({
          where: { examId_classId: { examId: link.examId, classId: keep.id } },
        });
        if (alreadyLinked) {
          await prisma.examClass.delete({ where: { id: link.id } });
        } else {
          await prisma.examClass.update({ where: { id: link.id }, data: { classId: keep.id } });
        }
      }

      await prisma.class.deleteMany({ where: { id: { in: removedIds } } });

      merges.push({ name: keep.name, keptId: keep.id, removedIds, sections: mergedSections });
    }

    res.json({ mergedGroups: merges.length, merges });
  })
);

// DELETE /api/classes/:id  (Admin only - blocked if students are still assigned)
router.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const count = await prisma.student.count({ where: { classId: Number(req.params.id) } });
    if (count > 0) {
      return res.status(409).json({ error: `Cannot delete: ${count} student(s) are still assigned to this class.` });
    }
    await prisma.class.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);

module.exports = router;
