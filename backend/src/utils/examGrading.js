// Shared examination logic: the default subject catalogues, who sits which
// subject, and the single scoring function used by the marks sheet, the
// broad sheet and the subject statistics. Keeping all three on one
// implementation is the point of this file — a student's total depends on
// which subjects they sit, so any divergence would show up as a wrong
// percentage on one screen and a right one on another.

// ---------- grade numbers ----------

// Class names are free text ("9", "8", "Grade 10"), so the grade number is
// the first integer in the name. Null when there isn't one.
function gradeNumberOf(className) {
  const match = String(className || '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

// ---------- default subjects ----------

// `appliesTo` values. Anything other than ALL makes a subject an elective
// that only counts toward the totals of the students who sit it.
const APPLIES_TO = ['ALL', 'MUSLIM', 'NON_MUSLIM', 'GROUP_COMPUTER', 'GROUP_BIOLOGY'];

// The school's fixed subject sets. Pre-fills the create-exam form; the form
// stays editable, so a one-off exam can drop or add subjects freely.
const SUBJECT_CATALOGUES = [
  {
    key: 'MIDDLE',
    label: 'Classes 6-8',
    minGrade: 6,
    maxGrade: 8,
    subjects: [
      { subjectName: 'ENG', appliesTo: 'ALL' },
      { subjectName: 'MATHS', appliesTo: 'ALL' },
      { subjectName: 'G.SCI', appliesTo: 'ALL' },
      { subjectName: 'C.SCI', appliesTo: 'ALL' },
      { subjectName: 'URDU', appliesTo: 'ALL' },
      { subjectName: 'HIS', appliesTo: 'ALL' },
      { subjectName: 'GEO', appliesTo: 'ALL' },
      { subjectName: 'ISL', appliesTo: 'MUSLIM' },
      { subjectName: 'IKH', appliesTo: 'NON_MUSLIM' },
    ],
  },
  {
    key: 'MATRIC',
    label: 'Classes 9-10',
    minGrade: 9,
    maxGrade: 10,
    subjects: [
      { subjectName: 'ENG', appliesTo: 'ALL' },
      { subjectName: 'MATHS', appliesTo: 'ALL' },
      { subjectName: 'PHY', appliesTo: 'ALL' },
      { subjectName: 'CHE', appliesTo: 'ALL' },
      { subjectName: 'C.SCI', appliesTo: 'GROUP_COMPUTER' },
      { subjectName: 'BIO', appliesTo: 'GROUP_BIOLOGY' },
      { subjectName: 'URDU', appliesTo: 'ALL' },
      { subjectName: 'PST', appliesTo: 'ALL', gradeOnly: 10 },
      { subjectName: 'ISL', appliesTo: 'MUSLIM', gradeOnly: 9 },
      { subjectName: 'THQ', appliesTo: 'MUSLIM', gradeOnly: 9 },
      { subjectName: 'IKH', appliesTo: 'NON_MUSLIM', gradeOnly: 9 },
      { subjectName: 'CHR', appliesTo: 'NON_MUSLIM', gradeOnly: 9 },
    ],
  },
];

function catalogueForGrade(gradeNumber) {
  if (gradeNumber === null || gradeNumber === undefined) return null;
  return (
    SUBJECT_CATALOGUES.find((c) => gradeNumber >= c.minGrade && gradeNumber <= c.maxGrade) || null
  );
}

// The subject set for a group of classes. Returns `mixedRanges` when the
// classes span both catalogues, because a single ExamSubject row cannot be
// "C.SCI for everyone in class 8 but only the computer group in class 9" —
// the caller warns and recommends one exam per range.
function defaultSubjectsForGrades(gradeNumbers) {
  const catalogues = [];
  for (const g of gradeNumbers) {
    const cat = catalogueForGrade(g);
    if (cat && !catalogues.includes(cat)) catalogues.push(cat);
  }
  if (!catalogues.length) return { subjects: [], catalogue: null, mixedRanges: false };
  // Lowest range first, so a mixed pick pre-fills from 6-8.
  catalogues.sort((a, b) => a.minGrade - b.minGrade);
  return {
    subjects: catalogues[0].subjects.map((s) => ({ ...s })),
    catalogue: catalogues[0].label,
    mixedRanges: catalogues.length > 1,
  };
}

// ---------- who sits what ----------

const MUSLIM_RELIGIONS = ['muslim', 'islam', 'islamic'];

// Student.religion is free text. Treat the recognised spellings as Muslim
// and everything else as non-Muslim; a *blank* religion can't be placed at
// all, so it is reported as a warning rather than guessed at.
function isMuslim(student) {
  return MUSLIM_RELIGIONS.includes(String(student?.religion || '').trim().toLowerCase());
}

function hasReligion(student) {
  return String(student?.religion || '').trim() !== '';
}

function groupOf(student) {
  return String(student?.studentGroup || '').trim().toUpperCase();
}

// Does this student sit this subject? An unknown appliesTo is treated as
// ALL, so a bad value can never silently drop a subject from a total.
// gradeOnly is checked first and independently of appliesTo — a subject can
// be both grade-restricted and Muslim/group-restricted at once (ISL is both
// "Muslim students" and "grade 9 only" in the same exam).
function subjectAppliesTo(subject, student) {
  if (subject.gradeOnly !== null && subject.gradeOnly !== undefined) {
    const studentGrade = gradeNumberOf(student?.class?.name);
    if (studentGrade !== Number(subject.gradeOnly)) return false;
  }
  switch (subject.appliesTo) {
    case 'MUSLIM':
      return isMuslim(student);
    case 'NON_MUSLIM':
      return hasReligion(student) && !isMuslim(student);
    case 'GROUP_COMPUTER':
      return groupOf(student) === 'COMPUTER';
    case 'GROUP_BIOLOGY':
      return groupOf(student) === 'BIOLOGY';
    default:
      return true;
  }
}

// The data problems that would otherwise silently distort a total: a blank
// religion means neither the Muslim nor the non-Muslim subjects apply, and
// a 9-10 student with no group sits neither C.SCI nor BIO. A student whose
// grade rules a subject out entirely (e.g. a grade-10 student and a
// grade-9-only subject) is never flagged for it — the subject was never
// going to apply to them regardless of religion or group.
function warningsFor(students, subjects) {
  const noReligion = [];
  const noGroup = [];
  for (const s of students) {
    const studentGrade = gradeNumberOf(s?.class?.name);
    const inPlay = (subj) => subj.gradeOnly === null || subj.gradeOnly === undefined || Number(subj.gradeOnly) === studentGrade;
    const needsReligion = subjects.some((subj) => inPlay(subj) && (subj.appliesTo === 'MUSLIM' || subj.appliesTo === 'NON_MUSLIM'));
    const needsGroup = subjects.some((subj) => inPlay(subj) && (subj.appliesTo === 'GROUP_COMPUTER' || subj.appliesTo === 'GROUP_BIOLOGY'));
    if (needsReligion && !hasReligion(s)) noReligion.push(`${s.firstName} ${s.lastName}`);
    if (needsGroup && !['COMPUTER', 'BIOLOGY'].includes(groupOf(s))) noGroup.push(`${s.firstName} ${s.lastName}`);
  }
  const warnings = [];
  if (noReligion.length) {
    warnings.push({
      kind: 'MISSING_RELIGION',
      count: noReligion.length,
      names: noReligion.slice(0, 10),
      message: `${noReligion.length} student(s) have no religion recorded, so neither the Islamiyat nor the Ikhlaqiat subjects count toward their total. Set religion on the Students page.`,
    });
  }
  if (noGroup.length) {
    warnings.push({
      kind: 'MISSING_GROUP',
      count: noGroup.length,
      names: noGroup.slice(0, 10),
      message: `${noGroup.length} student(s) have no elective group, so neither C.SCI nor BIO counts toward their total. Set Computer or Biology on the Students page.`,
    });
  }
  return warnings;
}

// ---------- grade scale ----------

// Used only if the GradeScale table is somehow empty — the migration seeds
// exactly these bands, so this is a safety net, not a second source.
const FALLBACK_BANDS = [
  { grade: 'A+', minPercent: 90, gradePoint: 6, remarks: 'Outstanding' },
  { grade: 'A', minPercent: 80, gradePoint: 5, remarks: 'Excellent' },
  { grade: 'B', minPercent: 70, gradePoint: 4, remarks: 'Very Good' },
  { grade: 'C', minPercent: 60, gradePoint: 3, remarks: 'Good' },
  { grade: 'D', minPercent: 50, gradePoint: 2, remarks: 'Fair' },
  { grade: 'E', minPercent: 40, gradePoint: 1, remarks: 'Satisfactory' },
  { grade: 'F', minPercent: 0, gradePoint: 0, remarks: 'Fail' },
];

const FALLBACK_SCALE = { id: null, name: 'Built-in default', minGrade: null, maxGrade: null, bands: FALLBACK_BANDS };

// The narrowest matching range wins, so a "Classes 9-10" scale overrides
// the range-less fallback for class 9 while class 8 keeps using the default.
function resolveScale(scales, gradeNumber) {
  const withBands = (scales || []).filter((s) => s.bands && s.bands.length);
  if (!withBands.length) return FALLBACK_SCALE;

  const ranged = withBands
    .filter((s) => s.minGrade !== null && s.maxGrade !== null)
    .filter((s) => gradeNumber !== null && gradeNumber >= s.minGrade && gradeNumber <= s.maxGrade)
    .sort((a, b) => a.maxGrade - a.minGrade - (b.maxGrade - b.minGrade));
  if (ranged.length) return ranged[0];

  return withBands.find((s) => s.minGrade === null && s.maxGrade === null) || FALLBACK_SCALE;
}

// Highest band whose lower bound the percentage reaches. Bounds are
// inclusive, so exactly 40% is an E (and a pass) rather than falling to F.
function bandFor(scale, percent) {
  const bands = [...(scale?.bands || FALLBACK_BANDS)].sort((a, b) => b.minPercent - a.minPercent);
  return bands.find((b) => percent >= b.minPercent) || bands[bands.length - 1] || null;
}

// ---------- scoring ----------

function round2(n) {
  return Number(n.toFixed(2));
}

// Score one student against one exam.
//
// Two invariants the rest of the module depends on:
//   * Pass/fail is decided on the percentage (`percent >= exam.passPercent`),
//     not on ExamSubject.passMarks. Rounding 40% of an odd maximum would
//     otherwise let a student "pass" a subject the scale grades F.
//   * Appeared means a mark row exists. No row is an absence, so absent
//     students neither pass nor fail and don't drag the subject GPA down.
function scoreStudent({ exam, subjects, results, student, scale }) {
  const passPercent = exam?.passPercent ?? 40;
  const byId = new Map();
  for (const r of results || []) byId.set(r.examSubjectId, r);

  let totalMarks = 0; // denominator: only the subjects this student sits
  let obtained = 0;
  let appearedCount = 0;
  const failedSubjectNames = [];

  const subjectRows = subjects.map((sub) => {
    const applicable = subjectAppliesTo(sub, student);
    const result = byId.get(sub.id);
    const appeared = applicable && !!result;
    const marks = appeared ? result.marksObtained : null;

    if (!applicable) {
      return {
        examSubjectId: sub.id,
        subjectName: sub.subjectName,
        maxMarks: sub.maxMarks,
        applicable: false,
        appeared: false,
        marks: null,
        percent: null,
        grade: null,
        gradePoint: null,
        passed: null,
      };
    }

    totalMarks += sub.maxMarks;
    const percent = appeared && sub.maxMarks > 0 ? round2((marks / sub.maxMarks) * 100) : null;
    const band = percent === null ? null : bandFor(scale, percent);
    const passed = percent === null ? null : percent >= passPercent;

    if (appeared) {
      obtained += marks;
      appearedCount += 1;
      if (!passed) failedSubjectNames.push(sub.subjectName);
    }

    return {
      examSubjectId: sub.id,
      subjectName: sub.subjectName,
      maxMarks: sub.maxMarks,
      applicable: true,
      appeared,
      marks,
      percent,
      grade: band ? band.grade : null,
      gradePoint: band ? band.gradePoint : null,
      passed,
      remarks: result?.remarks || null,
    };
  });

  const overallPercent = totalMarks > 0 ? round2((obtained / totalMarks) * 100) : 0;
  // No marks at all: leave the overall grade and remarks blank rather than
  // reporting a 0% F for a student nobody has entered marks for yet.
  const anyMarks = appearedCount > 0;
  const overallBand = anyMarks ? bandFor(scale, overallPercent) : null;

  // Either condition unranks a student: a single failed subject, or an
  // overall percentage below the pass mark.
  const isFail = anyMarks && (failedSubjectNames.length > 0 || overallPercent < passPercent);

  return {
    subjects: subjectRows,
    applicableCount: subjectRows.filter((s) => s.applicable).length,
    appearedCount,
    anyMarks,
    totalMarks,
    obtained: round2(obtained),
    overallPercent: anyMarks ? overallPercent : null,
    overallGrade: overallBand ? overallBand.grade : null,
    overallGradePoint: overallBand ? overallBand.gradePoint : null,
    remarks: overallBand ? overallBand.remarks || null : null,
    failedSubjects: failedSubjectNames,
    failedCount: failedSubjectNames.length,
    isFail,
  };
}

// Final-term promotion status. Null for terms 1-3, and null when the exam
// doesn't carry both thresholds — the sheet prints that as a dash rather
// than inventing a result.
function promotionStatus(exam, scored) {
  if (exam?.term !== 4) return null;
  if (exam.maxFailedSubjects === null || exam.maxFailedSubjects === undefined) return null;
  if (exam.minOverallPercent === null || exam.minOverallPercent === undefined) return null;
  if (!scored.anyMarks) return null;

  if (scored.failedCount === 0 && scored.overallPercent >= (exam.passPercent ?? 40)) return 'PASS';
  if (scored.failedCount <= exam.maxFailedSubjects && scored.overallPercent >= exam.minOverallPercent) {
    return 'PROMOTE';
  }
  return 'FAIL';
}

// Dense ranking (1, 2, 2, 3) on marks obtained — students tied on the same
// total share a rank and the next distinct score takes the very next number,
// so a tie never skips a rank. Fail students are skipped entirely and keep
// a null rank.
function assignRanks(rows, key = 'rank') {
  for (const row of rows) row[key] = null;

  const eligible = rows
    .filter((row) => !row.isFail && row.anyMarks)
    .sort((a, b) => b.obtained - a.obtained);

  let currentRank = 0;
  let previousMarks;

  for (const row of eligible) {
    if (row.obtained !== previousMarks) {
      currentRank += 1;
      previousMarks = row.obtained;
    }
    row[key] = currentRank;
  }

  return rows;
}

module.exports = {
  APPLIES_TO,
  SUBJECT_CATALOGUES,
  FALLBACK_BANDS,
  gradeNumberOf,
  catalogueForGrade,
  defaultSubjectsForGrades,
  isMuslim,
  hasReligion,
  subjectAppliesTo,
  warningsFor,
  resolveScale,
  bandFor,
  scoreStudent,
  promotionStatus,
  assignRanks,
  round2,
};
