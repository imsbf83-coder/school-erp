const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAllowedClassIds } = require('../utils/classAccess');
const { MODULES, requireRoleOrPermission, getUserModules, hasModule } = require('../utils/permissions');
const {
  APPLIES_TO,
  SUBJECT_CATALOGUES,
  gradeNumberOf,
  defaultSubjectsForGrades,
  subjectAppliesTo,
  warningsFor,
  resolveScale,
  scoreStudent,
  promotionStatus,
  assignRanks,
  round2,
} = require('../utils/examGrading');

// A TEACHER normally only sees exams for classes they're assigned to
// (via TeacherClass) — but a TEACHER who ALSO holds the EXAMS module
// permission (e.g. an Exam Incharge who isn't a class teacher at all, or
// has no classes assigned) should see the whole Examinations module
// instead of being narrowed down to nothing. This wraps
// getAllowedClassIds() with that one extra check; every exam route below
// uses this instead of calling getAllowedClassIds() directly.
async function getExamClassScope(user) {
  const classIds = await getAllowedClassIds(user);
  if (classIds === null) return null; // already unrestricted (ADMIN)
  const userModules = await getUserModules(user);
  if (hasModule(userModules, MODULES.EXAMS)) return null;
  return classIds;
}

const router = express.Router();
router.use(requireAuth);
// ADMIN and TEACHER pass through exactly as before — nothing changes for
// them, and TEACHER's own class-scoped visibility (getAllowedClassIds,
// used throughout this file) still applies underneath this. This line only
// ADDS a new path in: an ACCOUNTANT/STAFF account (or a TEACHER account
// with extra duties) that has been granted the EXAMS module via
// StaffPermission now also gets through, instead of previously having no
// access to this router at all.
router.use(requireRoleOrPermission(['ADMIN', 'TEACHER'], MODULES.EXAMS));

// Subjects are always read in the school's own order, not insert order.
const subjectOrder = [{ sortOrder: 'asc' }, { id: 'asc' }];

// Sections live as a CSV string on both Class.sections and ExamClass.sections
// (e.g. "A,B" — existing data sometimes has spaces, so always trim).
// An empty list means "the whole class".
function parseSections(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// The grading scale that applies to a class, loaded once per request.
async function scaleForClass(className) {
  const scales = await prisma.gradeScale.findMany({
    include: { bands: { orderBy: { minPercent: 'desc' } } },
  });
  return resolveScale(scales, gradeNumberOf(className));
}

// GET /api/exams/subject-defaults?classIds=14,15
// The school's fixed subject set for the picked classes, so the create form
// starts from the real list instead of one blank row. Declared above the
// `/:id/...` routes so "subject-defaults" is never read as an exam id.
router.get(
  '/subject-defaults',
  asyncHandler(async (req, res) => {
    const classIds = String(req.query.classIds || '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!classIds.length) return res.json({ subjects: [], gradeNumbers: [], mixedRanges: false, catalogue: null });

    const classRows = await prisma.class.findMany({
      where: { id: { in: classIds } },
      select: { id: true, name: true },
    });
    const gradeNumbers = classRows.map((c) => gradeNumberOf(c.name)).filter((g) => g !== null);
    const { subjects, catalogue, mixedRanges } = defaultSubjectsForGrades(gradeNumbers);
    res.json({ subjects, gradeNumbers, catalogue, mixedRanges });
  })
);

// GET /api/exams/subject-catalogues
// Both fixed subject sets, so the marks-import panel can offer one blank
// sample sheet per grade range. Served from the same constant the create
// form pre-fills from, so a sample sheet can't list subjects the school
// doesn't actually examine.
router.get(
  '/subject-catalogues',
  asyncHandler(async (req, res) => {
    res.json(
      SUBJECT_CATALOGUES.map((c) => ({
        key: c.key,
        label: c.label,
        minGrade: c.minGrade,
        maxGrade: c.maxGrade,
        subjects: c.subjects.map((s) => ({ ...s })),
      }))
    );
  })
);

// GET /api/exams
// A scoped TEACHER only sees exams that include at least one of their
// assigned class(es) — an exam spanning several classes still shows up,
// but see /:id/results below for how the result rows themselves are scoped.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const allowedClassIds = await getExamClassScope(req.user);
    const exams = await prisma.exam.findMany({
      where: allowedClassIds !== null ? { classes: { some: { classId: { in: allowedClassIds } } } } : {},
      include: { classes: { include: { class: true } }, subjects: { orderBy: subjectOrder } },
      orderBy: { startDate: 'desc' },
    });
    res.json(exams);
  })
);

// POST /api/exams  (Admin/Teacher - create exam with subjects)
// Body: { name, academicYear, classIds: [int], startDate, endDate,
//         subjects: [{subjectName, maxMarks, passMarks, appliesTo}],
//         sectionsByClassId?: { "<classId>": ["A", "B"] },
//         term?, passPercent?, maxFailedSubjects?, minOverallPercent? }
//
// `sectionsByClassId` is optional and per-class: listing sections for a class
// means only those sections sit the exam. A class left out of the map (or
// given an empty list) covers the whole class, which is how every exam
// created before this option existed behaves.
//
// `term` 4 is the final term, the only one that decides promotion — and only
// when both maxFailedSubjects and minOverallPercent are given.
router.post(
  '/',
  requireRole('ADMIN', 'TEACHER'),
  [
    body('name').notEmpty(),
    body('classIds').isArray({ min: 1 }),
    body('classIds.*').isInt(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('subjects').isArray({ min: 1 }),
    body('subjects.*.appliesTo').optional({ nullable: true, checkFalsy: true }).isIn(APPLIES_TO),
    body('subjects.*.gradeOnly').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 12 }),
    body('term').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 4 }),
    body('passPercent').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }),
    body('maxFailedSubjects').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }),
    body('minOverallPercent').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      name,
      academicYear,
      classIds,
      startDate,
      endDate,
      subjects,
      sectionsByClassId,
      term,
      passPercent,
      maxFailedSubjects,
      minOverallPercent,
    } = req.body;

    // De-dupe in case the same class was somehow submitted twice
    let uniqueClassIds = [...new Set(classIds.map((id) => Number(id)))];

    // A scoped TEACHER can only create an exam for their own class(es).
    const allowedClassIds = await getExamClassScope(req.user);
    if (allowedClassIds !== null) {
      const outsideAccess = uniqueClassIds.some((id) => !allowedClassIds.includes(id));
      if (outsideAccess) {
        return res.status(403).json({ error: 'You can only create exams for your own class' });
      }
    }

    // Resolve the requested sections against each class's own declared list.
    // A section that doesn't exist on the class would otherwise produce a
    // silently empty result sheet, so reject it here instead.
    const classRows = await prisma.class.findMany({
      where: { id: { in: uniqueClassIds } },
      select: { id: true, name: true, sections: true },
    });
    if (classRows.length !== uniqueClassIds.length) {
      return res.status(404).json({ error: 'One or more of those classes no longer exists' });
    }

    const sectionsFor = {};
    for (const cls of classRows) {
      const requested = parseSections(
        Array.isArray(sectionsByClassId?.[cls.id])
          ? sectionsByClassId[cls.id].join(',')
          : sectionsByClassId?.[cls.id]
      );
      if (!requested.length) {
        sectionsFor[cls.id] = null; // whole class
        continue;
      }

      const declared = parseSections(cls.sections);
      const resolved = [];
      for (const want of requested) {
        // Match case-insensitively but store the class's own casing, so the
        // student `section` comparison later lines up with the real data.
        const match = declared.find((d) => d.toLowerCase() === want.toLowerCase());
        if (!match) {
          return res.status(400).json({
            error: `"${want}" is not a section of ${cls.name}. Its sections are: ${declared.join(', ') || 'none defined'}.`,
          });
        }
        if (!resolved.includes(match)) resolved.push(match);
      }
      // Every section ticked is the same as the whole class — store null so
      // adding a section to the class later automatically includes it.
      sectionsFor[cls.id] = resolved.length === declared.length ? null : resolved.join(',');
    }

    const examPassPercent = passPercent === undefined || passPercent === null || passPercent === '' ? 40 : Number(passPercent);
    const examTerm = term === undefined || term === null || term === '' ? null : Number(term);
    // The promotion rule is meaningless outside the final term, so it's only
    // stored for term 4 — that way switching the term back can't leave a
    // stale threshold behind.
    const isFinal = examTerm === 4;
    const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

    const exam = await prisma.exam.create({
      data: {
        name,
        academicYear,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        term: examTerm,
        passPercent: examPassPercent,
        maxFailedSubjects: isFinal ? num(maxFailedSubjects) : null,
        minOverallPercent: isFinal ? num(minOverallPercent) : null,
        classes: {
          create: uniqueClassIds.map((classId) => ({ classId, sections: sectionsFor[classId] })),
        },
        subjects: {
          create: subjects.map((s, idx) => {
            const maxMarks = s.maxMarks ?? 100;
            return {
              subjectName: s.subjectName,
              maxMarks,
              // Stored unrounded so it always agrees with the percentage
              // test that actually decides pass/fail.
              passMarks: s.passMarks ?? round2((maxMarks * examPassPercent) / 100),
              appliesTo: APPLIES_TO.includes(s.appliesTo) ? s.appliesTo : 'ALL',
              gradeOnly: s.gradeOnly === '' || s.gradeOnly === undefined || s.gradeOnly === null ? null : Number(s.gradeOnly),
              sortOrder: idx,
            };
          }),
        },
      },
      include: { subjects: { orderBy: subjectOrder }, classes: { include: { class: true } } },
    });
    res.status(201).json(exam);
  })
);

// PUT /api/exams/:id  (Admin/Teacher - edit an exam's own details and subjects)
// Body: same shape as POST, minus classIds/sectionsByClassId — which classes
// an exam covers can't be changed here, since narrowing it could orphan
// marks already entered for a class dropped from the list. Create a new
// exam instead if the class scope itself needs to change.
//
// Each subject in the body may carry an `examSubjectId` to update an
// existing row; a subject with no `examSubjectId` is created new. Any
// existing subject left out of the body is removed — but only if it has no
// marks recorded yet, otherwise the whole update is rejected so a typo in
// the sheet can't silently erase entered marks.
router.put(
  '/:id',
  requireRole('ADMIN', 'TEACHER'),
  [
    body('name').notEmpty(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('subjects').isArray({ min: 1 }),
    body('subjects.*.appliesTo').optional({ nullable: true, checkFalsy: true }).isIn(APPLIES_TO),
    body('subjects.*.gradeOnly').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 12 }),
    body('term').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 4 }),
    body('passPercent').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }),
    body('maxFailedSubjects').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }),
    body('minOverallPercent').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const exam = await prisma.exam.findUnique({
      where: { id: Number(req.params.id) },
      include: { subjects: true, classes: true },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    // A scoped TEACHER can only edit an exam that's (still) entirely within
    // their own class(es).
    const allowedClassIds = await getExamClassScope(req.user);
    if (allowedClassIds !== null) {
      const outsideAccess = exam.classes.some((ec) => !allowedClassIds.includes(ec.classId));
      if (outsideAccess) return res.status(403).json({ error: 'You do not have access to this exam' });
    }

    const { name, academicYear, startDate, endDate, subjects, term, passPercent, maxFailedSubjects, minOverallPercent } = req.body;

    const examPassPercent = passPercent === undefined || passPercent === null || passPercent === '' ? exam.passPercent : Number(passPercent);
    const examTerm = term === undefined || term === null || term === '' ? null : Number(term);
    const isFinal = examTerm === 4;
    const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

    const existingIds = new Set(exam.subjects.map((s) => s.id));
    const submittedIds = new Set(
      subjects.filter((s) => s.examSubjectId).map((s) => Number(s.examSubjectId))
    );
    const removedIds = [...existingIds].filter((id) => !submittedIds.has(id));

    // A subject can't be dropped once it has marks — that would silently
    // delete entered marks along with it.
    if (removedIds.length) {
      const withMarks = await prisma.examResult.findMany({
        where: { examSubjectId: { in: removedIds } },
        select: { examSubjectId: true },
        distinct: ['examSubjectId'],
      });
      if (withMarks.length) {
        const names = exam.subjects
          .filter((s) => withMarks.some((w) => w.examSubjectId === s.id))
          .map((s) => s.subjectName);
        return res.status(400).json({
          error: `Can't remove ${names.join(', ')} — marks are already recorded for it. Clear those marks first if you really want to remove the subject.`,
        });
      }
    }

    const toUpdate = subjects.filter((s) => s.examSubjectId && existingIds.has(Number(s.examSubjectId)));
    const toCreate = subjects.filter((s) => !s.examSubjectId || !existingIds.has(Number(s.examSubjectId)));
    const baseSortOrder = exam.subjects.length ? Math.max(...exam.subjects.map((s) => s.sortOrder)) + 1 : 0;

    await prisma.$transaction([
      prisma.exam.update({
        where: { id: exam.id },
        data: {
          name,
          academicYear: academicYear ?? exam.academicYear,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          term: examTerm,
          passPercent: examPassPercent,
          maxFailedSubjects: isFinal ? num(maxFailedSubjects) : null,
          minOverallPercent: isFinal ? num(minOverallPercent) : null,
        },
      }),
      ...(removedIds.length ? [prisma.examSubject.deleteMany({ where: { id: { in: removedIds } } })] : []),
      ...toUpdate.map((s) => {
        const maxMarks = s.maxMarks ?? 100;
        return prisma.examSubject.update({
          where: { id: Number(s.examSubjectId) },
          data: {
            subjectName: s.subjectName,
            maxMarks,
            passMarks: s.passMarks ?? round2((maxMarks * examPassPercent) / 100),
            appliesTo: APPLIES_TO.includes(s.appliesTo) ? s.appliesTo : 'ALL',
            gradeOnly: s.gradeOnly === '' || s.gradeOnly === undefined || s.gradeOnly === null ? null : Number(s.gradeOnly),
          },
        });
      }),
      ...toCreate.map((s, idx) => {
        const maxMarks = s.maxMarks ?? 100;
        return prisma.examSubject.create({
          data: {
            examId: exam.id,
            subjectName: s.subjectName,
            maxMarks,
            passMarks: s.passMarks ?? round2((maxMarks * examPassPercent) / 100),
            appliesTo: APPLIES_TO.includes(s.appliesTo) ? s.appliesTo : 'ALL',
            gradeOnly: s.gradeOnly === '' || s.gradeOnly === undefined || s.gradeOnly === null ? null : Number(s.gradeOnly),
            sortOrder: baseSortOrder + idx,
          },
        });
      }),
    ]);

    const updated = await prisma.exam.findUnique({
      where: { id: exam.id },
      include: { subjects: { orderBy: subjectOrder }, classes: { include: { class: true } } },
    });
    res.json(updated);
  })
);

// DELETE /api/exams/:id  (Admin only — deletes the exam, its subjects, and
// every mark entered against it)
//
// Deliberately Admin-only rather than Admin/Teacher: unlike editing, this
// can't be undone, and a scoped Teacher accidentally wiping a class's
// marks is a much worse outcome than being unable to delete at all — an
// Admin can always do it for them.
router.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const exam = await prisma.exam.findUnique({
      where: { id: Number(req.params.id) },
      include: { subjects: { select: { id: true } } },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const subjectIds = exam.subjects.map((s) => s.id);
    const [deletedResults] = await prisma.$transaction([
      prisma.examResult.deleteMany({ where: { examSubjectId: { in: subjectIds } } }),
      prisma.examSubject.deleteMany({ where: { examId: exam.id } }),
      prisma.examClass.deleteMany({ where: { examId: exam.id } }),
      prisma.exam.delete({ where: { id: exam.id } }),
    ]);

    res.json({ deleted: true, marksDeleted: deletedResults.count });
  })
);

// Shared by /results, /broadsheet and /subject-stats: turn the exam's class
// scopes (plus an optional view filter) into the Prisma `OR` that selects
// exactly the students sitting the exam.
//
// One clause per class, because the sections differ per class: an exam can
// cover the whole of Class 8 but only section A of Class 9.
function buildClassScopes(examClasses, viewSection, onlyClassId) {
  const classScopes = [];
  for (const ec of examClasses) {
    if (onlyClassId && ec.classId !== onlyClassId) continue;
    const scoped = parseSections(ec.sections); // [] = whole class
    let sections = scoped;
    if (viewSection) {
      // A class scoped to sections that don't include the requested one
      // contributes nothing to this view.
      if (scoped.length && !scoped.some((s) => s.toLowerCase() === viewSection.toLowerCase())) continue;
      sections = [viewSection];
    }
    classScopes.push({ classId: ec.classId, ...(sections.length ? { section: { in: sections } } : {}) });
  }
  return classScopes;
}

// Loads the exam, applies TEACHER scoping, and resolves the student list.
// Returns { error } for the caller to hand straight back, so the three
// reporting endpoints can't drift on access control.
async function loadExamScope(req, { classIdParam } = {}) {
  const exam = await prisma.exam.findUnique({
    where: { id: Number(req.params.id) },
    include: { subjects: { orderBy: subjectOrder }, classes: { include: { class: true } } },
  });
  if (!exam) return { error: { status: 404, body: { error: 'Exam not found' } } };

  let examClasses = exam.classes;

  // A scoped TEACHER only sees the result rows for their own class(es),
  // even when the exam spans other classes too.
  const allowedClassIds = await getExamClassScope(req.user);
  if (allowedClassIds !== null) {
    examClasses = examClasses.filter((ec) => allowedClassIds.includes(ec.classId));
    if (!examClasses.length) return { error: { status: 403, body: { error: 'You do not have access to this exam' } } };
  }

  // The section filter arrives as a query param on the reporting GETs and in
  // the body on the import POST.
  const viewSection = String(req.query.section || req.body?.section || '').trim();
  const onlyClassId = classIdParam ? Number(classIdParam) : null;
  if (onlyClassId && !examClasses.some((ec) => ec.classId === onlyClassId)) {
    return { error: { status: 400, body: { error: 'That class is not part of this exam' } } };
  }

  const classScopes = buildClassScopes(examClasses, viewSection, onlyClassId);
  const students = classScopes.length
    ? await prisma.student.findMany({
        where: { status: 'REGULAR', OR: classScopes },
        orderBy: [{ classId: 'asc' }, { section: 'asc' }, { admissionNumber: 'asc' }],
        include: {
          class: true,
          examResults: { where: { examSubject: { examId: exam.id } } },
        },
      })
    : [];

  return { exam, examClasses, students, viewSection, onlyClassId };
}

// GET /api/exams/:id/results?section=A
// Full result sheet for an exam: all students x all subjects. Each class the
// exam covers contributes only the sections it was scoped to; the optional
// `section` param narrows the sheet further, as a view filter.
//
// Rows carry the full scored shape (per-subject applicability, grades, and a
// per-student total over only the subjects that student sits) so the marks
// entry grid can grey out the cells a student doesn't take.
router.get(
  '/:id/results',
  asyncHandler(async (req, res) => {
    const scope = await loadExamScope(req);
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);
    const { exam, students, viewSection } = scope;

    const scales = await prisma.gradeScale.findMany({ include: { bands: { orderBy: { minPercent: 'desc' } } } });

    const rows = students.map((s) => {
      const scale = resolveScale(scales, gradeNumberOf(s.class?.name));
      const scored = scoreStudent({ exam, subjects: exam.subjects, results: s.examResults, student: s, scale });

      // `marks` / `total` / `maxTotal` / `percentage` are the original keys,
      // kept so anything already reading them still works.
      const marks = {};
      scored.subjects.forEach((sub) => {
        marks[sub.subjectName] = sub.marks;
      });

      return {
        studentId: s.id,
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        rollNumber: s.rollNumber,
        className: s.class?.name,
        section: s.section,
        religion: s.religion,
        studentGroup: s.studentGroup,
        marks,
        total: scored.obtained,
        maxTotal: scored.totalMarks,
        percentage: scored.overallPercent ?? 0,
        // Scored shape
        subjects: scored.subjects,
        totalMarks: scored.totalMarks,
        obtained: scored.obtained,
        overallPercent: scored.overallPercent,
        overallGrade: scored.overallGrade,
        remarks: scored.remarks,
        failedSubjects: scored.failedSubjects,
        failedCount: scored.failedCount,
        appearedCount: scored.appearedCount,
        anyMarks: scored.anyMarks,
        isFail: scored.isFail,
      };
    });

    res.json({
      exam,
      section: viewSection || null,
      warnings: warningsFor(students, exam.subjects),
      rows,
    });
  })
);

// GET /api/exams/:id/broadsheet?classId=14&section=A
// The printable broad sheet for one class — whole class, or one section of
// it, which is the classwise vs class/section-wise split.
//
// Rows carry per-subject marks/%/grade, the per-student total (only the
// subjects that student sits), overall %/grade/remarks, rank and — in the
// final term — a promotion status.
router.get(
  '/:id/broadsheet',
  asyncHandler(async (req, res) => {
    const classIdParam = req.query.classId;
    if (!classIdParam) return res.status(400).json({ error: 'A classId is required for the broad sheet' });

    const scope = await loadExamScope(req, { classIdParam });
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);
    const { exam, students, viewSection, onlyClassId } = scope;

    const classRow = exam.classes.find((ec) => ec.classId === onlyClassId)?.class || null;
    const scale = await scaleForClass(classRow?.name);

    const rows = students.map((s) => {
      const scored = scoreStudent({ exam, subjects: exam.subjects, results: s.examResults, student: s, scale });
      return {
        studentId: s.id,
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        guardianName: s.guardianName,
        rollNumber: s.rollNumber,
        className: s.class?.name,
        section: s.section,
        ...scored,
        status: promotionStatus(exam, scored),
      };
    });

    // Rank within each section, then across the whole class. In section
    // scope only one section is present, so the two agree — which is what
    // makes a section's ranks identical in both views.
    const bySection = new Map();
    for (const row of rows) {
      const key = row.section || '';
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key).push(row);
    }
    for (const group of bySection.values()) assignRanks(group, 'rankInSection');
    assignRanks(rows, 'rankInClass');

    res.json({
      exam,
      scale,
      class: classRow,
      section: viewSection || null,
      subjects: exam.subjects,
      warnings: warningsFor(students, exam.subjects),
      rows,
    });
  })
);

// GET /api/exams/:id/subject-stats?classId=14&section=A
// Subject-wise pass % and GPA for the same scope as the broad sheet.
//
// `totalStudents` counts the students who *sit* the subject (so an elective
// isn't penalised for the students who never take it), `appeared` counts
// those with a mark recorded, and the GPA is the mean grade point of those
// who appeared with fails counted as 0.
router.get(
  '/:id/subject-stats',
  asyncHandler(async (req, res) => {
    const classIdParam = req.query.classId;
    if (!classIdParam) return res.status(400).json({ error: 'A classId is required for subject statistics' });

    const scope = await loadExamScope(req, { classIdParam });
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);
    const { exam, students, viewSection, onlyClassId } = scope;

    const classRow = exam.classes.find((ec) => ec.classId === onlyClassId)?.class || null;
    const scale = await scaleForClass(classRow?.name);

    const scored = students.map((s) =>
      scoreStudent({ exam, subjects: exam.subjects, results: s.examResults, student: s, scale })
    );

    const rows = exam.subjects.map((sub, idx) => {
      let totalStudents = 0;
      let appeared = 0;
      let passed = 0;
      let pointSum = 0;
      for (const sc of scored) {
        const cell = sc.subjects[idx];
        if (!cell.applicable) continue;
        totalStudents += 1;
        if (!cell.appeared) continue;
        appeared += 1;
        if (cell.passed) passed += 1;
        pointSum += cell.gradePoint ?? 0;
      }
      return {
        examSubjectId: sub.id,
        subjectName: sub.subjectName,
        appliesTo: sub.appliesTo,
        maxMarks: sub.maxMarks,
        totalStudents,
        appeared,
        absent: totalStudents - appeared,
        passed,
        failed: appeared - passed,
        passPercent: appeared > 0 ? round2((passed / appeared) * 100) : 0,
        gpa: appeared > 0 ? round2(pointSum / appeared) : 0,
      };
    });

    // The overall row is the exam as a whole: one entry per student, using
    // their overall grade rather than an average of the subject averages.
    const withMarks = scored.filter((s) => s.anyMarks);
    const overallPassed = withMarks.filter((s) => !s.isFail).length;
    const overall = {
      totalStudents: students.length,
      appeared: withMarks.length,
      absent: students.length - withMarks.length,
      passed: overallPassed,
      failed: withMarks.length - overallPassed,
      passPercent: withMarks.length ? round2((overallPassed / withMarks.length) * 100) : 0,
      gpa: withMarks.length
        ? round2(withMarks.reduce((sum, s) => sum + (s.overallGradePoint ?? 0), 0) / withMarks.length)
        : 0,
    };

    res.json({
      exam,
      scale,
      class: classRow,
      section: viewSection || null,
      warnings: warningsFor(students, exam.subjects),
      rows,
      overall,
    });
  })
);

// ---------- marks import ----------

// Names are matched loosely — "  ALI   HAIDER " and "Ali Haider" are the same
// student — because the sheet comes back from a spreadsheet someone typed in.
function normaliseName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

// What a cell may say instead of a number to mark the student absent. A
// *blank* cell means "not entered", which leaves whatever is already stored
// alone — otherwise re-importing a partly-filled sheet would wipe marks.
const ABSENT_TOKENS = ['AB', 'ABS', 'ABSENT', 'A', '-', '—', 'N/A'];

// Finds the student a sheet row refers to. Admission No wins, then Roll
// Number (the same "Exam Roll #" filled in on the Award List), otherwise
// it's the name — Class and Section only come in to break a tie between
// two students who share a name or roll number; an exam covering several
// classes (or several sections of one) can easily have namesakes, and roll
// numbers are only unique within a class, not school-wide.
function matchStudent(row, students, indexes) {
  const admissionNo = String(row.admissionNo || '').trim();
  if (admissionNo) {
    const hit = students.find((s) => s.admissionNumber === admissionNo);
    return hit ? { student: hit } : { message: `No student with admission no. ${admissionNo} sits this exam.` };
  }

  const rollNumber = String(row.rollNumber || '').trim();
  if (rollNumber) {
    let hits = students.filter((s) => String(s.rollNumber || '').trim() === rollNumber);
    if (hits.length > 1) {
      const className = String(row.className || '').trim();
      const section = String(row.section || '').trim().toUpperCase();
      if (className) {
        const grade = gradeNumberOf(className);
        hits = hits.filter((s) => {
          const studentClassName = s.class?.name;
          if (grade !== null && gradeNumberOf(studentClassName) === grade) return true;
          return normaliseName(studentClassName) === normaliseName(className);
        });
      }
      if (hits.length > 1 && section) hits = hits.filter((s) => String(s.section || '').toUpperCase() === section);
    }
    if (hits.length === 1) return { student: hits[0] };
    if (hits.length > 1) {
      return { message: `Roll no. ${rollNumber} matches ${hits.length} students — add an Admission No, Class or Section column.` };
    }
    return { message: `No student with roll no. ${rollNumber} sits this exam.` };
  }

  const name = normaliseName(row.name);
  if (!name) return { message: 'This row has no student ID or name.' };

  const className = String(row.className || '').trim();
  const section = String(row.section || '').trim().toUpperCase();
  let hits = indexes.byName.get(name) || [];
  if (hits.length > 1 && className) {
    const grade = gradeNumberOf(className);
    hits = hits.filter((s) => {
      const studentClassName = s.class?.name;
      if (grade !== null && gradeNumberOf(studentClassName) === grade) return true;
      return normaliseName(studentClassName) === normaliseName(className);
    });
  }
  if (hits.length > 1 && section) hits = hits.filter((s) => String(s.section || '').toUpperCase() === section);
  if (hits.length === 1) return { student: hits[0] };
  if (hits.length > 1) {
    return { message: `"${row.name}" matches ${hits.length} students — add an Admission No, Class or Section column.` };
  }
  return { message: `No student called "${row.name}" sits this exam.` };
}

// POST /api/exams/:id/import-marks
// Body: { section?, dryRun?, rows: [{ rowNumber, admissionNo?, rollNumber?, className?, name?, section?, marks: { SUBJECT: value } }] }
//
// Imports a whole sheet of marks in one request. Everything is validated
// first and a sheet with any error writes nothing, so a typo in one row can't
// leave the class half-imported — the response lists the rows to fix. Call it
// with `dryRun` to get that same report without writing, which is what the UI
// shows before the single Import click.
router.post(
  '/:id/import-marks',
  requireRole('ADMIN', 'TEACHER'),
  [body('rows').isArray({ min: 1, max: 2000 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const scope = await loadExamScope(req);
    if (scope.error) return res.status(scope.error.status).json(scope.error.body);
    const { exam, students } = scope;
    if (!students.length) return res.status(400).json({ error: 'No students in this exam\'s scope.' });

    const subjectsByName = new Map(exam.subjects.map((s) => [normaliseName(s.subjectName), s]));

    const indexes = { byName: new Map() };
    for (const s of students) {
      const name = normaliseName(`${s.firstName} ${s.lastName}`);
      if (!indexes.byName.has(name)) indexes.byName.set(name, []);
      indexes.byName.get(name).push(s);
    }

    // A student's elective group (Computer / Biology) normally lives on the
    // Students page, but an import sheet shouldn't be blocked by it being unset
    // or stale — whichever elective a row actually has a real mark for is taken
    // as that student's choice for this import. Only a real number counts as a
    // choice; a blank or absent cell isn't evidence either way.
    function inferGroupFromRow(marks, subjectsByName) {
      const found = {}; // 'COMPUTER' | 'BIOLOGY' -> [subjectName]
      for (const [column, rawValue] of Object.entries(marks || {})) {
        const subject = subjectsByName.get(normaliseName(column));
        if (!subject || (subject.appliesTo !== 'GROUP_COMPUTER' && subject.appliesTo !== 'GROUP_BIOLOGY')) continue;
        const value = String(rawValue ?? '').trim();
        if (value === '' || ABSENT_TOKENS.includes(value.toUpperCase())) continue;
        const group = subject.appliesTo === 'GROUP_COMPUTER' ? 'COMPUTER' : 'BIOLOGY';
        (found[group] = found[group] || []).push(subject.subjectName);
      }
      const groups = Object.keys(found);
      if (groups.length === 0) return { group: null, conflictSubjects: null };
      if (groups.length > 1) return { group: null, conflictSubjects: groups.map((g) => found[g][0]) };
      return { group: groups[0], conflictSubjects: null };
    }

    const rowErrors = [];
    const unmatched = [];
    const writes = [];  // { studentId, examSubjectId, marks }
    const clears = [];  // { studentId, examSubjectId }
    const groupUpdates = [];  // { studentId, name, group }
    const unknownColumns = new Set();
    const subjectsSeen = new Set();
    const seenStudents = new Map();
    let matched = 0;

    req.body.rows.forEach((row, idx) => {
      const rowNumber = row.rowNumber || idx + 2; // +2: header row, 1-based
      const { student, message } = matchStudent(row, students, indexes);
      if (!student) {
        unmatched.push({ rowNumber, name: row.name || '', className: row.className || '', message });
        return;
      }
      if (seenStudents.has(student.id)) {
        rowErrors.push({
          rowNumber,
          name: `${student.firstName} ${student.lastName}`,
          message: `Appears twice in this sheet (also row ${seenStudents.get(student.id)}).`,
        });
        return;
      }
      seenStudents.set(student.id, rowNumber);
      matched += 1;

      const marks = row.marks && typeof row.marks === 'object' ? row.marks : {};
      const { group: inferredGroup, conflictSubjects } = inferGroupFromRow(marks, subjectsByName);
      const name = `${student.firstName} ${student.lastName}`;
      if (conflictSubjects) {
        rowErrors.push({
          rowNumber,
          name,
          message: `${name} has marks for both ${conflictSubjects[0]} and ${conflictSubjects[1]} — a student can only be in one elective group.`,
        });
      }
      const effectiveStudent = inferredGroup ? { ...student, studentGroup: inferredGroup } : student;
      if (inferredGroup && String(student.studentGroup || '').trim().toUpperCase() !== inferredGroup) {
        groupUpdates.push({ studentId: student.id, name, group: inferredGroup });
      }

      for (const [column, rawValue] of Object.entries(marks)) {
        const subject = subjectsByName.get(normaliseName(column));
        if (!subject) {
          unknownColumns.add(String(column).trim());
          continue;
        }
        subjectsSeen.add(subject.subjectName);

        const value = String(rawValue ?? '').trim();
        if (value === '') continue; // not entered — leave what's stored
        const applicable = subjectAppliesTo(subject, effectiveStudent);

        if (ABSENT_TOKENS.includes(value.toUpperCase())) {
          // Marking a student absent for a subject they don't sit is a no-op
          // rather than an error — a filled-in sample sheet often has dashes
          // in the columns that don't apply.
          if (applicable) clears.push({ studentId: student.id, examSubjectId: subject.id });
          continue;
        }

        if (!applicable) {
          rowErrors.push({ rowNumber, name, subject: subject.subjectName, message: `${name} does not sit ${subject.subjectName}.` });
          continue;
        }
        const num = Number(value);
        if (!Number.isFinite(num)) {
          rowErrors.push({ rowNumber, name, subject: subject.subjectName, message: `"${value}" is not a number.` });
          continue;
        }
        if (num < 0) {
          rowErrors.push({ rowNumber, name, subject: subject.subjectName, message: 'Marks cannot be negative.' });
          continue;
        }
        if (num > subject.maxMarks) {
          rowErrors.push({ rowNumber, name, subject: subject.subjectName, message: `${num} is above the maximum of ${subject.maxMarks}.` });
          continue;
        }
        writes.push({ studentId: student.id, examSubjectId: subject.id, marks: num });
      }
    });

    const report = {
      dryRun: Boolean(req.body.dryRun),
      rows: req.body.rows.length,
      matched,
      unmatched,
      errors: rowErrors,
      toWrite: writes.length,
      toClear: clears.length,
      groupChanges: groupUpdates.map((g) => ({ name: g.name, group: g.group })),
      subjects: [...subjectsSeen],
      unknownColumns: [...unknownColumns],
      imported: 0,
      cleared: 0,
    };

    // Unmatched rows are reported but don't block the import — a sheet for the
    // whole class imported into one section is a normal way to work.
    if (rowErrors.length) return res.status(400).json({ ...report, error: 'Nothing was imported — fix the rows below and try again.' });
    if (report.dryRun) return res.json(report);
    if (!writes.length && !clears.length && !groupUpdates.length) return res.json({ ...report, error: 'This sheet has no marks to import.' });

    await prisma.$transaction([
      ...groupUpdates.map((g) =>
        prisma.student.update({ where: { id: g.studentId }, data: { studentGroup: g.group } })
      ),
      ...clears.map((c) =>
        prisma.examResult.deleteMany({ where: { studentId: c.studentId, examSubjectId: c.examSubjectId } })
      ),
      ...writes.map((w) =>
        prisma.examResult.upsert({
          where: { studentId_examSubjectId: { studentId: w.studentId, examSubjectId: w.examSubjectId } },
          update: { marksObtained: w.marks },
          create: { studentId: w.studentId, examSubjectId: w.examSubjectId, marksObtained: w.marks },
        })
      ),
    ]);

    res.json({ ...report, imported: writes.length, cleared: clears.length, groupsSet: groupUpdates.length });
  })
);

// POST /api/exams/marks  (Teacher/Admin - enter or update a single student's marks for a subject)
// Body: { studentId, examSubjectId, marksObtained, grade, remarks }
//
// A blank/null `marksObtained` **deletes** the row, which is how a student is
// marked absent: "appeared" everywhere else means a row exists, so clearing a
// cell has to remove it rather than store a 0.
router.post(
  '/marks',
  requireRole('ADMIN', 'TEACHER'),
  [
    body('studentId').isInt(),
    body('examSubjectId').isInt(),
    body('marksObtained').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { studentId, examSubjectId, marksObtained, grade, remarks } = req.body;
    const blank = marksObtained === '' || marksObtained === null || marksObtained === undefined;

    const student = await prisma.student.findUnique({
      where: { id: Number(studentId) },
      select: { id: true, classId: true, firstName: true, lastName: true, religion: true, studentGroup: true, class: { select: { name: true } } },
    });

    const allowedClassIds = await getExamClassScope(req.user);
    if (allowedClassIds !== null) {
      if (!student || !allowedClassIds.includes(student.classId)) {
        return res.status(403).json({ error: 'You do not have access to this student' });
      }
    }
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (blank) {
      // Idempotent: clearing an already-empty cell is not an error.
      await prisma.examResult.deleteMany({
        where: { studentId: Number(studentId), examSubjectId: Number(examSubjectId) },
      });
      return res.json({ deleted: true, studentId: Number(studentId), examSubjectId: Number(examSubjectId) });
    }

    const check = await validateMarkTarget(examSubjectId, marksObtained, student);
    if (check) return res.status(400).json({ error: check });

    const result = await prisma.examResult.upsert({
      where: { studentId_examSubjectId: { studentId: Number(studentId), examSubjectId: Number(examSubjectId) } },
      update: { marksObtained: Number(marksObtained), grade: grade || null, remarks: remarks || null },
      create: {
        studentId: Number(studentId),
        examSubjectId: Number(examSubjectId),
        marksObtained: Number(marksObtained),
        grade: grade || null,
        remarks: remarks || null,
      },
    });
    res.json(result);
  })
);

// Guards both marks endpoints: a mark can't exceed the subject's maximum,
// and can't be recorded for a subject the student doesn't sit (a Biology-group
// student being given a C.SCI mark would otherwise inflate nothing but still
// sit in the database as an orphan row). Returns an error string, or null.
async function validateMarkTarget(examSubjectId, marksObtained, student) {
  const subject = await prisma.examSubject.findUnique({
    where: { id: Number(examSubjectId) },
    select: { id: true, subjectName: true, maxMarks: true, appliesTo: true, gradeOnly: true },
  });
  if (!subject) return 'That subject is not part of this exam.';
  if (Number(marksObtained) > subject.maxMarks) {
    return `${marksObtained} is above the maximum of ${subject.maxMarks} for ${subject.subjectName}.`;
  }
  if (!subjectAppliesTo(subject, student)) {
    return `${student.firstName} ${student.lastName} does not sit ${subject.subjectName}.`;
  }
  return null;
}

// POST /api/exams/marks/bulk  (Teacher/Admin - enter marks for a whole subject at once)
// Body: { examSubjectId, entries: [{ studentId, marksObtained, grade }] }
router.post(
  '/marks/bulk',
  requireRole('ADMIN', 'TEACHER'),
  [body('examSubjectId').isInt(), body('entries').isArray({ min: 1 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { examSubjectId, entries } = req.body;
    const studentIds = [...new Set(entries.map((e) => Number(e.studentId)))];
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, classId: true, firstName: true, lastName: true, religion: true, studentGroup: true, class: { select: { name: true } } },
    });

    const allowedClassIds = await getExamClassScope(req.user);
    if (allowedClassIds !== null) {
      const disallowed = students.some((s) => !allowedClassIds.includes(s.classId));
      const missing = students.length !== studentIds.length;
      if (disallowed || missing) {
        return res.status(403).json({ error: 'You do not have access to one or more of these students' });
      }
    }
    if (students.length !== studentIds.length) {
      return res.status(404).json({ error: 'One or more of those students no longer exists' });
    }

    // Same two guards as the single-mark endpoint, applied to every entry
    // before anything is written — a rejected batch writes nothing.
    const byId = new Map(students.map((s) => [s.id, s]));
    for (const e of entries) {
      const check = await validateMarkTarget(examSubjectId, e.marksObtained, byId.get(Number(e.studentId)));
      if (check) return res.status(400).json({ error: check });
    }

    const results = await prisma.$transaction(
      entries.map((e) =>
        prisma.examResult.upsert({
          where: {
            studentId_examSubjectId: { studentId: Number(e.studentId), examSubjectId: Number(examSubjectId) },
          },
          update: { marksObtained: Number(e.marksObtained), grade: e.grade || null },
          create: {
            studentId: Number(e.studentId),
            examSubjectId: Number(examSubjectId),
            marksObtained: Number(e.marksObtained),
            grade: e.grade || null,
          },
        })
      )
    );
    res.json({ updated: results.length });
  })
);

module.exports = router;
