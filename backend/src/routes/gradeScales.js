const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Bands are always returned highest-first, which is the order they're
// matched in and the order a reader expects to see a grading table.
const bandInclude = { bands: { orderBy: { minPercent: 'desc' } } };

// Rejects the band lists that would leave a percentage ungraded or a grade
// ambiguous. Returns an error string, or null when the list is usable.
function validateBands(bands) {
  if (!Array.isArray(bands) || bands.length === 0) return 'Add at least one grade band.';
  for (const b of bands) {
    if (!String(b.grade || '').trim()) return 'Every band needs a grade label.';
    const min = Number(b.minPercent);
    const point = Number(b.gradePoint);
    if (!Number.isFinite(min) || min < 0 || min > 100) return `"${b.grade}" needs a minimum % between 0 and 100.`;
    if (!Number.isFinite(point) || point < 0) return `"${b.grade}" needs a grade point of 0 or more.`;
  }
  const mins = bands.map((b) => Number(b.minPercent));
  if (new Set(mins).size !== mins.length) return 'Two bands share the same minimum % — each band needs its own lower bound.';
  if (!mins.includes(0)) return 'One band must start at 0%, otherwise the lowest marks fall into no grade.';
  const grades = bands.map((b) => String(b.grade).trim().toUpperCase());
  if (new Set(grades).size !== grades.length) return 'Two bands share the same grade label.';
  return null;
}

// Both null = the fallback scale (any class). Otherwise both are required,
// because a half-open range can't be matched against a class number.
function validateRange(minGrade, maxGrade) {
  const hasMin = minGrade !== null && minGrade !== undefined && minGrade !== '';
  const hasMax = maxGrade !== null && maxGrade !== undefined && maxGrade !== '';
  if (!hasMin && !hasMax) return null;
  if (hasMin !== hasMax) return 'Give both the lowest and highest class number, or leave both blank to apply to every class.';
  if (Number(minGrade) > Number(maxGrade)) return 'The lowest class number must not be greater than the highest.';
  return null;
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v);
}

// GET /api/grade-scales
// Any authenticated user — the broad sheet and the result sheet both need
// the scale to show grades.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const scales = await prisma.gradeScale.findMany({
      include: bandInclude,
      orderBy: [{ minGrade: 'asc' }, { name: 'asc' }],
    });
    res.json(scales);
  })
);

// POST /api/grade-scales  (Admin)
// Body: { name, minGrade?, maxGrade?, bands: [{ grade, minPercent, gradePoint, remarks? }] }
router.post(
  '/',
  requireRole('ADMIN'),
  [body('name').trim().notEmpty(), body('bands').isArray({ min: 1 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, minGrade, maxGrade, bands } = req.body;
    const rangeError = validateRange(minGrade, maxGrade);
    if (rangeError) return res.status(400).json({ error: rangeError });
    const bandError = validateBands(bands);
    if (bandError) return res.status(400).json({ error: bandError });

    const existing = await prisma.gradeScale.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(400).json({ error: 'A grading scale with that name already exists.' });

    const scale = await prisma.gradeScale.create({
      data: {
        name: name.trim(),
        minGrade: toIntOrNull(minGrade),
        maxGrade: toIntOrNull(maxGrade),
        bands: {
          create: bands.map((b) => ({
            grade: String(b.grade).trim(),
            minPercent: Number(b.minPercent),
            gradePoint: Number(b.gradePoint),
            remarks: String(b.remarks || '').trim() || null,
          })),
        },
      },
      include: bandInclude,
    });
    res.status(201).json(scale);
  })
);

// PUT /api/grade-scales/:id  (Admin)
// The band list is replaced wholesale rather than diffed — simpler, and a
// grading table is short enough that rewriting it costs nothing.
router.put(
  '/:id',
  requireRole('ADMIN'),
  [body('name').trim().notEmpty(), body('bands').isArray({ min: 1 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = Number(req.params.id);
    const current = await prisma.gradeScale.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Grading scale not found' });

    const { name, minGrade, maxGrade, bands } = req.body;
    const rangeError = validateRange(minGrade, maxGrade);
    if (rangeError) return res.status(400).json({ error: rangeError });
    const bandError = validateBands(bands);
    if (bandError) return res.status(400).json({ error: bandError });

    const nextMin = toIntOrNull(minGrade);
    const nextMax = toIntOrNull(maxGrade);

    // Something must always be able to grade a class that no ranged scale
    // covers, so the last fallback can't be given a range.
    if (current.minGrade === null && current.maxGrade === null && nextMin !== null) {
      const fallbacks = await prisma.gradeScale.count({ where: { minGrade: null, maxGrade: null } });
      if (fallbacks <= 1) {
        return res.status(400).json({
          error: 'This is the only scale that applies to every class. Add another all-classes scale before giving this one a class range.',
        });
      }
    }

    const clash = await prisma.gradeScale.findUnique({ where: { name: name.trim() } });
    if (clash && clash.id !== id) return res.status(400).json({ error: 'A grading scale with that name already exists.' });

    const [, updated] = await prisma.$transaction([
      prisma.gradeBand.deleteMany({ where: { gradeScaleId: id } }),
      prisma.gradeScale.update({
        where: { id },
        data: {
          name: name.trim(),
          minGrade: nextMin,
          maxGrade: nextMax,
          bands: {
            create: bands.map((b) => ({
              grade: String(b.grade).trim(),
              minPercent: Number(b.minPercent),
              gradePoint: Number(b.gradePoint),
              remarks: String(b.remarks || '').trim() || null,
            })),
          },
        },
        include: bandInclude,
      }),
    ]);
    res.json(updated);
  })
);

// DELETE /api/grade-scales/:id  (Admin)
router.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const scale = await prisma.gradeScale.findUnique({ where: { id } });
    if (!scale) return res.status(404).json({ error: 'Grading scale not found' });

    if (scale.minGrade === null && scale.maxGrade === null) {
      const fallbacks = await prisma.gradeScale.count({ where: { minGrade: null, maxGrade: null } });
      if (fallbacks <= 1) {
        return res.status(400).json({
          error: 'This is the only scale that applies to every class — deleting it would leave classes with no grading scale.',
        });
      }
    }

    // Bands cascade with the scale (onDelete: Cascade in the schema).
    await prisma.gradeScale.delete({ where: { id } });
    res.json({ deleted: true });
  })
);

module.exports = router;
