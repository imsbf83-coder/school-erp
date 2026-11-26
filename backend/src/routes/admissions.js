const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { todayStart } = require('../utils/suspensions');

const router = express.Router();
router.use(requireAuth);

// ---------- Helpers ----------

// FDE form fields that aren't already covered by Student/Admission. Shared
// between the create-admission form and the bulk CSV import so both accept
// exactly the same set of fields.
const FORM_DETAIL_FIELDS = [
  'cnicOrFormAvailable', 'provinceOfBirth', 'districtOfBirth', 'receivingGirlsStipend',
  'nationality', 'nationalityOther', 'domicileDistrict', 'domicileProvince',
  'permanentAddressType', 'permanentAddressDetail', 'permanentHouseNo', 'permanentStreetNo', 'whatsappNumber',
  'presentCity', 'presentAddressType', 'presentAddressDetail', 'presentHouseNo', 'presentStreetNo',
  'motherLanguage', 'bloodGroup', 'isHafiz',
  'fatherAlive', 'fatherLandline', 'fatherQualification', 'fatherProfession', 'fatherProfessionOther',
  'fatherIncome', 'fatherBps', 'fatherDomicileProvince', 'fatherDomicileDistrict',
  'motherName', 'motherAlive', 'motherCnic', 'motherContactNumber', 'motherLandline', 'motherEmail',
  'motherQualification', 'motherProfession', 'motherProfessionOther', 'motherIncome', 'motherBps',
  'orphanGuardianContact', 'orphanGuardianEmail', 'orphanGuardianQualification', 'orphanGuardianProfession',
  'orphanGuardianProfessionOther', 'orphanGuardianIncome', 'orphanGuardianBps',
  'classGroupFde', 'resultPercentageLastClass', 'lastInstitutionUnderFde', 'lastInstitutionOther',
  'shift', 'availingMealProgram', 'mediumOfInstruction', 'yearsToCompletePrimary', 'modeOfStudy',
  'totalSiblings', 'siblingsInOtherFdeInstitutions', 'siblingsInSameInstitution', 'siblingsInPrivateInstitutions',
  'transportFacility', 'isScholarshipRecipient', 'scholarshipDetails', 'hasCoCurricularAchievement', 'achievementDetails',
  'emergencyContactName', 'emergencyContactNumber', 'emergencyContactRelation', 'emergencyContactRelationOther',
  'isRefugeeOrIdp', 'isRegisteredRefugee', 'idpStatus', 'refugeeCardNumber',
  'hasMajorDisability', 'disabilityCertificateAttached', 'disabilityType',
  'hasMentalDisability', 'mentalDisabilityType', 'otherMedicalConditions',
  'isVisuallyFit6by6', 'wearsGlasses', 'difficultySeeingBoard',
  'hasHearingDifficulty', 'usesHearingAid', 'hearingDifficultyDetails', 'difficultyListening',
  'difficultyWalking', 'usesCrutchesOrWalker',
  'difficultyReadingWriting', 'difficultyRemembering', 'difficultyConcentrating',
  'basicVaccinationCompleted',
  'hasDigitalDeviceAtHome', 'digitalDeviceType', 'hasInternetAtHome',
];

const BOOLEAN_FIELDS = new Set([
  'cnicOrFormAvailable', 'receivingGirlsStipend', 'isHafiz', 'fatherAlive', 'motherAlive',
  'availingMealProgram', 'isScholarshipRecipient', 'hasCoCurricularAchievement',
  'isRefugeeOrIdp', 'isRegisteredRefugee', 'hasMajorDisability', 'disabilityCertificateAttached',
  'hasMentalDisability', 'isVisuallyFit6by6', 'wearsGlasses', 'hasHearingDifficulty', 'usesHearingAid',
  'difficultyListening', 'difficultyWalking', 'usesCrutchesOrWalker', 'basicVaccinationCompleted',
  'hasDigitalDeviceAtHome', 'hasInternetAtHome',
]);

const INT_FIELDS = new Set([
  'yearsToCompletePrimary', 'totalSiblings', 'siblingsInOtherFdeInstitutions',
  'siblingsInSameInstitution', 'siblingsInPrivateInstitutions',
]);

const FLOAT_FIELDS = new Set(['fatherIncome', 'motherIncome', 'orphanGuardianIncome']);

// Enum-ish text fields get normalized to CONSTANT_CASE so CSV data typed as
// "govt employee" or "Day Scholar" still matches what the dropdowns store.
// "...Other" free-text fields and bloodGroup (has +/- symbols) are left as-is.
const ENUM_TEXT_FIELDS = new Set([
  'provinceOfBirth', 'domicileProvince', 'fatherDomicileProvince', 'nationality',
  'permanentAddressType', 'presentAddressType', 'motherLanguage',
  'fatherProfession', 'motherProfession', 'orphanGuardianProfession',
  'shift', 'mediumOfInstruction', 'modeOfStudy', 'transportFacility', 'emergencyContactRelation',
  'disabilityType', 'mentalDisabilityType',
  'difficultySeeingBoard', 'difficultyReadingWriting', 'difficultyRemembering', 'difficultyConcentrating',
]);

// true/false/null (not 'not stated' vs explicit no getting conflated) —
// anything unrecognized or blank is left null rather than guessed.
function parseYesNo(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

function normEnumText(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v).trim().toUpperCase().replace(/[\s-]+/g, '_');
}

// Builds a Prisma-ready data object from a raw formDetail payload (either
// the create-admission request body or one CSV row), applying the right
// coercion per field. Fields not present in the input are simply omitted.
function buildFormDetailData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const data = {};
  for (const field of FORM_DETAIL_FIELDS) {
    const v = raw[field];
    if (v === undefined || v === '' ) continue;
    if (BOOLEAN_FIELDS.has(field)) {
      const parsed = parseYesNo(v);
      if (parsed !== null) data[field] = parsed;
    } else if (INT_FIELDS.has(field)) {
      const n = Number(v);
      if (!Number.isNaN(n)) data[field] = Math.trunc(n);
    } else if (FLOAT_FIELDS.has(field)) {
      const n = Number(v);
      if (!Number.isNaN(n)) data[field] = n;
    } else if (ENUM_TEXT_FIELDS.has(field)) {
      data[field] = normEnumText(v);
    } else {
      data[field] = String(v).trim();
    }
  }
  return Object.keys(data).length ? data : null;
}

// ---------- Validation ----------

const admissionValidation = [
  body('studentId').isInt({ min: 1 }).withMessage('Student is required'),
  body('academicYear').trim().notEmpty().withMessage('Academic year is required'),
  // Leaving classId blank ("Leave unchanged" in the form) keeps the
  // student's current placement — only validated as an int when provided.
  body('classId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Class must be valid'),
  body('section').optional({ nullable: true }).trim(),
  body('previousSchool').optional({ nullable: true }).trim(),
  body('documentsReceived').optional({ nullable: true }).trim(),
  body('remarks').optional({ nullable: true }).trim(),
];

const withdrawalValidation = [
  body('studentId').isInt({ min: 1 }).withMessage('Student is required'),
  body('status').isIn(['STRUCK_OFF', 'SLC', 'PASSOUT']).withMessage('Status must be STRUCK_OFF, SLC, or PASSOUT'),
  body('reason').trim().notEmpty().withMessage('Reason is required'),
  body('transferCertIssued').optional().isBoolean().withMessage('transferCertIssued must be true or false'),
  body('remarks').optional({ nullable: true }).trim(),
];

// ---------- GET /admissions ----------

router.get('/', async (req, res, next) => {
  try {
    const admissions = await prisma.admission.findMany({
      include: { student: { include: { class: true } } },
      orderBy: { admissionDate: 'desc' },
    });
    res.json(admissions);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /admissions/withdrawals ----------
// NOTE: registered before '/:id' so "withdrawals" is never parsed as an id.

router.get('/withdrawals', async (req, res, next) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      include: { student: { include: { class: true } } },
      orderBy: { withdrawalDate: 'desc' },
    });
    res.json(withdrawals);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /admissions/:id ----------
// Full record including the FDE form detail, for a future view/edit screen.

router.get('/:id', async (req, res, next) => {
  try {
    const admission = await prisma.admission.findUnique({
      where: { id: Number(req.params.id) },
      include: { student: { include: { class: true } }, formDetail: true },
    });
    if (!admission) return res.status(404).json({ error: 'Admission not found' });
    res.json(admission);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /admissions ----------
// Records (or re-records) an admission for a student. studentId is unique
// on Admission, so this upserts instead of always creating — re-submitting
// an admission for the same student updates it rather than 500ing.
// If classId is provided, the student's placement is moved to that
// class/section in the same transaction; leaving it blank keeps the
// student exactly where they are. An optional `formDetail` object carries
// the FDE form fields and is upserted alongside it.

router.post('/', admissionValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { studentId, academicYear, classId, section, previousSchool, documentsReceived, remarks, formDetail } = req.body;
    const sId = Number(studentId);

    const student = await prisma.student.findUnique({ where: { id: sId } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const admissionData = {
      academicYear,
      previousSchool: previousSchool || null,
      documentsReceived: documentsReceived || null,
      remarks: remarks || null,
    };

    const operations = [
      prisma.admission.upsert({
        where: { studentId: sId },
        update: admissionData,
        create: { studentId: sId, ...admissionData },
      }),
    ];

    if (classId) {
      operations.push(
        prisma.student.update({
          where: { id: sId },
          data: { classId: Number(classId), section: section || null },
        })
      );
    }

    const [admission] = await prisma.$transaction(operations);

    const formDetailData = buildFormDetailData(formDetail);
    if (formDetailData) {
      await prisma.admissionFormDetail.upsert({
        where: { admissionId: admission.id },
        update: formDetailData,
        create: { admissionId: admission.id, ...formDetailData },
      });
    }

    const full = await prisma.admission.findUnique({
      where: { id: admission.id },
      include: { student: { include: { class: true } }, formDetail: true },
    });
    res.status(201).json(full);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /admissions/import ----------
// Bulk-creates brand-new students (with their admission + FDE form detail)
// from CSV rows — this is for fresh intake, not editing existing students.
// Body: { rows: [{ firstName, lastName, gender, dateOfBirth, className,
//   section, academicYear, ...guardian/FDE fields }] }
// Every row is independent: one bad row is reported and skipped rather
// than failing the whole import.

router.post(
  '/import',
  [body('rows').isArray({ min: 1 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { rows } = req.body;
      const results = { created: 0, failed: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 2; // header row is line 1
        try {
          if (!r.firstName || !r.lastName || !r.gender || !r.dateOfBirth || !r.className || !r.guardianName || !r.academicYear) {
            throw new Error('Missing a required field (firstName, lastName, gender, dateOfBirth, className, guardianName, academicYear)');
          }
          if (!['MALE', 'FEMALE', 'OTHER'].includes(String(r.gender).toUpperCase())) {
            throw new Error('gender must be MALE, FEMALE, or OTHER');
          }
          const dob = new Date(r.dateOfBirth);
          if (Number.isNaN(dob.getTime())) {
            throw new Error('dateOfBirth is not a valid date (use YYYY-MM-DD)');
          }

          const cls = await prisma.class.findUnique({ where: { name: r.className } });
          if (!cls) throw new Error(`Class "${r.className}" does not exist — create it first`);

          let admissionNumber = r.admissionNumber ? String(r.admissionNumber).trim() : '';
          if (admissionNumber) {
            const existing = await prisma.student.findUnique({ where: { admissionNumber } });
            if (existing) throw new Error(`Admission number ${admissionNumber} already exists`);
          } else {
            admissionNumber = `STU-${Date.now()}-${i}`;
          }

          const orphanStatus = ['NONE', 'SINGLE', 'DOUBLE'].includes(String(r.orphanStatus).toUpperCase())
            ? String(r.orphanStatus).toUpperCase()
            : 'NONE';
          const studentGroup = ['COMPUTER', 'BIOLOGY'].includes(String(r.studentGroup).toUpperCase())
            ? String(r.studentGroup).toUpperCase()
            : null;

          const student = await prisma.student.create({
            data: {
              admissionNumber,
              firstName: r.firstName.trim(),
              lastName: r.lastName.trim(),
              gender: String(r.gender).toUpperCase(),
              dateOfBirth: dob,
              classId: cls.id,
              section: r.section || null,
              guardianName: r.guardianName.trim(),
              guardianPhone: r.guardianPhone || null,
              guardianEmail: r.guardianEmail || null,
              guardianRelation: r.guardianRelation || null,
              fatherCnic: r.fatherCnic || null,
              bFormNumber: r.bFormNumber || null,
              religion: r.religion || null,
              phone: r.phone || null,
              email: r.email || null,
              address: r.address || null,
              orphanStatus,
              studentGroup,
            },
          });

          const admission = await prisma.admission.create({
            data: {
              studentId: student.id,
              academicYear: r.academicYear,
              previousSchool: r.previousSchool || null,
              documentsReceived: r.documentsReceived || null,
              remarks: r.remarks || null,
            },
          });

          const formDetailData = buildFormDetailData(r);
          if (formDetailData) {
            await prisma.admissionFormDetail.create({
              data: { admissionId: admission.id, ...formDetailData },
            });
          }

          results.created++;
        } catch (err) {
          results.failed++;
          results.errors.push({ row: rowNum, admissionNumber: r.admissionNumber || '(auto)', message: err.message });
        }
      }

      res.json(results);
    } catch (err) {
      next(err);
    }
  }
);

// ---------- POST /admissions/withdrawals ----------
// Records (or re-records) a student's exit and applies the new status to
// their Student row in the same transaction, so the class list and the
// exit report can never disagree about where a student currently stands.

router.post('/withdrawals', withdrawalValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { studentId, status, reason, transferCertIssued, remarks } = req.body;
    const sId = Number(studentId);

    const student = await prisma.student.findUnique({ where: { id: sId } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const withdrawalData = {
      status,
      reason,
      transferCertIssued: Boolean(transferCertIssued),
      remarks: remarks || null,
    };

    const [withdrawal] = await prisma.$transaction([
      prisma.withdrawal.upsert({
        where: { studentId: sId },
        update: withdrawalData,
        create: { studentId: sId, ...withdrawalData },
      }),
      prisma.student.update({ where: { id: sId }, data: { status } }),
    ]);

    res.status(201).json(withdrawal);
  } catch (err) {
    next(err);
  }
});

// ---------- DELETE /admissions/withdrawals/:studentId ----------
// Reverses a withdrawal recorded by mistake: removes the Withdrawal
// record entirely (clearing its exit date/reason/transfer-cert flag) and
// moves the student back to REGULAR, in one transaction. Matches the
// "Reactivate" action already built into the Students page.

router.delete('/withdrawals/:studentId', async (req, res, next) => {
  try {
    const sId = Number(req.params.studentId);
    const student = await prisma.student.findUnique({ where: { id: sId } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await prisma.$transaction([
      // deleteMany (not delete) so this doesn't throw if the student's
      // status was somehow changed without a Withdrawal row ever existing.
      prisma.withdrawal.deleteMany({ where: { studentId: sId } }),
      // if the student was suspended, that suspension ends now too
      prisma.studentSuspension.updateMany({ where: { studentId: sId, cancelled: false, endDate: { gte: todayStart() } }, data: { cancelled: true } }),
      prisma.student.update({ where: { id: sId }, data: { status: 'REGULAR' } }),
    ]);

    res.json({ status: 'REGULAR' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
