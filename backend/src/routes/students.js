const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ---------- Validation ----------

const createStudentValidation = [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('gender').isIn(['MALE', 'FEMALE', 'OTHER']).withMessage('Gender must be MALE, FEMALE, or OTHER'),
  body('classId').isInt({ min: 1 }).withMessage('Class is required'),
  body('guardianName').trim().notEmpty().withMessage('Guardian name is required'),
  body('dateOfBirth').optional().isISO8601(),
  body('section').optional({ nullable: true }).trim(),
  body('rollNumber').optional({ nullable: true }).trim(),
  body('studentGroup').optional({ nullable: true }).isIn(['COMPUTER', 'BIOLOGY', '']),
  body('orphanStatus').optional({ nullable: true }).isIn(['NONE', 'SINGLE', 'DOUBLE', '']),
  body('busRouteId').optional({ nullable: true }).isInt({ min: 1 }),
  body('busFeeDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('phone').optional({ nullable: true }).trim(),
  body('email').optional({ nullable: true }).trim(),
  body('address').optional({ nullable: true }).trim(),
  body('guardianPhone').optional({ nullable: true }).trim(),
  body('guardianEmail').optional({ nullable: true }).trim(),
  body('guardianRelation').optional({ nullable: true }).trim(),
  body('fatherCnic').optional({ nullable: true }).trim(),
  body('bFormNumber').optional({ nullable: true }).trim(),
  body('religion').optional({ nullable: true }).trim(),
  body('photoUrl').optional({ nullable: true }).trim(),
  body('busPickupPoint').optional({ nullable: true }).trim(),
  body('busFeeDiscountReason').optional({ nullable: true }).trim(),
];

const updateStudentValidation = [
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('gender').optional().isIn(['MALE', 'FEMALE', 'OTHER']),
  body('classId').optional().isInt({ min: 1 }),
  body('guardianName').optional().trim().notEmpty(),
  body('studentGroup').optional({ nullable: true }).isIn(['COMPUTER', 'BIOLOGY', '']),
  body('orphanStatus').optional({ nullable: true }).isIn(['NONE', 'SINGLE', 'DOUBLE', '']),
  body('busRouteId').optional({ nullable: true }).isInt({ min: 1 }),
  body('busFeeDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('status').optional().isIn(['REGULAR', 'STRUCK_OFF', 'SLC', 'PASSOUT']),
];

// ---------- Helpers ----------

function clean(obj) {
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (v === '' || v === undefined) delete out[k];
  }
  return out;
}

// Real school records tend to abbreviate these ("com"/"bio", "single
// orphan") rather than use the exact enum word — accept the common variants
// rather than rejecting every row that doesn't spell it out in full.
function normStudentGroup(raw) {
  if (!raw) return '';
  const v = String(raw).trim().toUpperCase();
  if (!v) return '';
  if (v.startsWith('COM')) return 'COMPUTER';
  if (v.startsWith('BIO')) return 'BIOLOGY';
  return v; // falls through to the isIn check, reported as a clear error
}

function normOrphanStatus(raw) {
  if (!raw) return 'NONE';
  const v = String(raw).trim().toUpperCase();
  if (!v || v === 'NONE') return 'NONE';
  if (v.includes('DOUBLE')) return 'DOUBLE';
  if (v.includes('SINGLE')) return 'SINGLE';
  return v; // falls through to the isIn check, reported as a clear error
}

// ---------- GET /students ----------

router.get('/', async (req, res, next) => {
  try {
    const {
      admissionNumber, name, guardianName, classId, section,
      studentGroup, orphanStatus, busRouteId, status,
      page = 1, pageSize = 50,
    } = req.query;
    const where = {};

    if (admissionNumber) where.admissionNumber = { contains: admissionNumber };
    if (name) {
      where.OR = [
        { firstName: { contains: name } },
        { lastName: { contains: name } },
      ];
    }
    if (guardianName) where.guardianName = { contains: guardianName };
    if (classId) {
      // Students.jsx sends a single id; Reports.jsx sends a comma-separated
      // list for multi-class filtering. Both go through the same `in`.
      const ids = String(classId).split(',').map(Number).filter((n) => !Number.isNaN(n));
      if (ids.length) where.classId = { in: ids };
    }
    if (section) where.section = section;
    if (studentGroup) where.studentGroup = studentGroup;
    if (orphanStatus) where.orphanStatus = orphanStatus;
    if (busRouteId) where.busRouteId = Number(busRouteId);
    if (status) where.status = status;

    const take = Math.min(Number(pageSize), 200);
    const skip = (Number(page) - 1) * take;

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          class: true,
          // So the list can show "Previously: STU-0042" / "Re-admitted as: STU-0099"
          // without a follow-up request per row.
          previousStudent: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } },
          readmittedAs: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } },
        },
        // Class, then section, then admission number — reads like the
        // school's own register instead of one global admission-number
        // order with every class interleaved together.
        orderBy: [{ classId: 'asc' }, { section: 'asc' }, { admissionNumber: 'asc' }],
        skip,
        take,
      }),
      prisma.student.count({ where }),
    ]);

    res.json({ students, total, page: Number(page), pageSize: take });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /students/:id ----------

router.get('/:id', async (req, res, next) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        class: true,
        admission: true,
        withdrawal: true,
        previousStudent: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } },
        readmittedAs: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } },
      },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /students ----------

router.post('/', createStudentValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const d = clean(req.body);
    const data = {
      firstName: d.firstName,
      lastName: d.lastName,
      gender: d.gender,
      classId: Number(d.classId),
      guardianName: d.guardianName,
      admissionNumber: d.admissionNumber || `STU-${Date.now()}`,
      status: d.status || 'REGULAR',
    };

    // Optional fields
    if (d.dateOfBirth) data.dateOfBirth = new Date(d.dateOfBirth);
    if (d.section) data.section = d.section;
    if (d.rollNumber) data.rollNumber = d.rollNumber;
    if (d.studentGroup) data.studentGroup = d.studentGroup;
    if (d.orphanStatus) data.orphanStatus = d.orphanStatus;
    if (d.phone) data.phone = d.phone;
    if (d.email) data.email = d.email;
    if (d.address) data.address = d.address;
    if (d.guardianPhone) data.guardianPhone = d.guardianPhone;
    if (d.guardianEmail) data.guardianEmail = d.guardianEmail;
    if (d.guardianRelation) data.guardianRelation = d.guardianRelation;
    if (d.fatherCnic) data.fatherCnic = d.fatherCnic;
    if (d.bFormNumber) data.bFormNumber = d.bFormNumber;
    if (d.religion) data.religion = d.religion;
    if (d.photoUrl) data.photoUrl = d.photoUrl;
    if (d.busRouteId) data.busRouteId = Number(d.busRouteId);
    if (d.busPickupPoint) data.busPickupPoint = d.busPickupPoint;
    if (d.busFeeDiscount) data.busFeeDiscount = Number(d.busFeeDiscount);
    if (d.busFeeDiscountReason) data.busFeeDiscountReason = d.busFeeDiscountReason;

    const student = await prisma.student.create({ data });
    res.status(201).json(student);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /students/import ----------
// Bulk-creates new students from CSV rows. Each row is independent — one
// bad row is reported and skipped rather than failing the whole import.
// Body: { rows: [{ admissionNumber, firstName, lastName, gender,
//   guardianName, guardianPhone, dateOfBirth, className, section,
//   bFormNumber, fatherCnic, religion, address, studentGroup, orphanStatus }] }

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
          if (!r.firstName || !r.lastName || !r.guardianName || !r.className) {
            throw new Error('Missing a required field (Student Name, Father Name, Class)');
          }
          // Gender is optional in the CSV — defaults to Male when left
          // blank, matching the "Add student" form's own default.
          const gender = r.gender ? String(r.gender).trim().toUpperCase() : 'MALE';
          if (!['MALE', 'FEMALE', 'OTHER'].includes(gender)) {
            throw new Error('Gender must be Male, Female, or Other (or left blank for Male)');
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

          let dateOfBirth;
          if (r.dateOfBirth) {
            dateOfBirth = new Date(r.dateOfBirth);
            if (Number.isNaN(dateOfBirth.getTime())) {
              throw new Error('Date of Birth is not a valid date (use YYYY-MM-DD)');
            }
          }

          const studentGroupRaw = normStudentGroup(r.studentGroup);
          if (studentGroupRaw && !['COMPUTER', 'BIOLOGY'].includes(studentGroupRaw)) {
            throw new Error('Group must be Computer or Biology (or left blank)');
          }

          const orphanStatusRaw = normOrphanStatus(r.orphanStatus);
          if (!['NONE', 'SINGLE', 'DOUBLE'].includes(orphanStatusRaw)) {
            throw new Error('Orphan Status must be None, Single, or Double');
          }

          await prisma.student.create({
            data: {
              admissionNumber,
              firstName: r.firstName.trim(),
              lastName: r.lastName.trim(),
              gender,
              classId: cls.id,
              section: r.section || null,
              guardianName: r.guardianName.trim(),
              guardianPhone: r.guardianPhone || null,
              dateOfBirth,
              bFormNumber: r.bFormNumber || null,
              fatherCnic: r.fatherCnic || null,
              religion: r.religion || null,
              address: r.address || null,
              studentGroup: studentGroupRaw || null,
              orphanStatus: orphanStatusRaw,
            },
          });

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

// ---------- POST /students/bulk-move ----------
// Moves multiple students to a new class in one request (e.g. promoting a
// whole class at year-end). `section` is only touched if the key is
// present in the body at all: sending it as '' clears every selected
// student's section, omitting it entirely leaves each one's existing
// section untouched (they may not all currently share the same one).

const bulkMoveValidation = [
  body('studentIds').isArray({ min: 1 }).withMessage('Select at least one student'),
  body('studentIds.*').isInt({ min: 1 }).withMessage('Invalid student id'),
  body('classId').isInt({ min: 1 }).withMessage('Class is required'),
  body('section').optional({ nullable: true }).isString(),
];

router.post('/bulk-move', bulkMoveValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { studentIds, classId } = req.body;
    const cls = await prisma.class.findUnique({ where: { id: Number(classId) } });
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const data = { classId: cls.id };
    if (Object.prototype.hasOwnProperty.call(req.body, 'section')) {
      data.section = req.body.section || null;
    }

    const result = await prisma.student.updateMany({
      where: { id: { in: studentIds.map(Number) } },
      data,
    });

    res.json({ moved: result.count, className: cls.name, section: data.section || '' });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /students/:id ----------

router.put('/:id', updateStudentValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const d = clean(req.body);
    const data = {};
    const fields = [
      'firstName', 'lastName', 'gender', 'classId', 'section',
      'rollNumber', 'guardianName', 'guardianPhone', 'guardianEmail',
      'guardianRelation', 'phone', 'email', 'address',
      'fatherCnic', 'bFormNumber', 'religion', 'photoUrl',
      'studentGroup', 'orphanStatus', 'status',
      'busRouteId', 'busPickupPoint', 'busFeeDiscount', 'busFeeDiscountReason',
    ];

    for (const f of fields) {
      if (d[f] !== undefined) {
        data[f] = ['classId', 'busRouteId'].includes(f) ? Number(d[f]) : d[f];
      }
    }

    const student = await prisma.student.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(student);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /students/:id/readmit ----------
// A student who previously left (STRUCK_OFF / SLC / PASSOUT) rejoining the
// school gets a BRAND NEW Student row with a new admission number — their
// old row, and everything attached to it (attendance, exam results, the
// old admission/withdrawal record), is left exactly as it was. The new row
// is linked back to the old one via previousStudentId, so both records
// stay traceable to each other without merging or overwriting any history.

router.post('/:id/readmit', async (req, res, next) => {
  try {
    const oldId = Number(req.params.id);
    const old = await prisma.student.findUnique({ where: { id: oldId } });
    if (!old) return res.status(404).json({ error: 'Student not found' });
    if (old.status === 'REGULAR') {
      return res.status(400).json({
        error: 'This student is already active. Re-admission is for a student who previously left (Struck Off, SLC, or Passout).',
      });
    }

    const { admissionNumber, classId, section, rollNumber } = clean(req.body);
    if (!admissionNumber || !classId) {
      return res.status(400).json({ error: 'A new admission number and class are required.' });
    }

    const existingNumber = await prisma.student.findUnique({ where: { admissionNumber } });
    if (existingNumber) {
      return res.status(409).json({ error: `Admission number "${admissionNumber}" is already in use.` });
    }

    const cls = await prisma.class.findUnique({ where: { id: Number(classId) } });
    if (!cls) return res.status(400).json({ error: 'That class does not exist.' });

    const created = await prisma.student.create({
      data: {
        admissionNumber,
        firstName: old.firstName,
        lastName: old.lastName,
        dateOfBirth: old.dateOfBirth,
        gender: old.gender,
        address: old.address,
        phone: old.phone,
        email: old.email,
        guardianName: old.guardianName,
        guardianPhone: old.guardianPhone,
        guardianEmail: old.guardianEmail,
        guardianRelation: old.guardianRelation,
        fatherCnic: old.fatherCnic,
        bFormNumber: old.bFormNumber,
        religion: old.religion,
        studentGroup: old.studentGroup,
        orphanStatus: old.orphanStatus,
        classId: cls.id,
        section: section || null,
        rollNumber: rollNumber || null,
        status: 'REGULAR',
        previousStudentId: old.id,
      },
      include: { class: true },
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// ---------- DELETE /students/:id ----------

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.student.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Student deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
