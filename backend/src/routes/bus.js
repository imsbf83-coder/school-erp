const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prismaClient');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Why a bus fee was reduced. SIBLING is the common one — two children of the
// same family riding the same bus. PREPAYMENT is for a fee settled ahead of
// time. Kept as a plain string list rather than a Prisma enum, per the note at
// the top of schema.prisma.
const DISCOUNT_REASONS = ['SIBLING', 'PREPAYMENT', 'ORPHAN', 'OTHER'];

// ---- VEHICLES (the physical buses) ----

// GET /api/bus/vehicles
router.get(
  '/vehicles',
  asyncHandler(async (req, res) => {
    const vehicles = await prisma.vehicle.findMany({
      include: { routes: true, _count: { select: { expenses: true } } },
      orderBy: { vehicleNumber: 'asc' },
    });
    res.json(vehicles);
  })
);

// POST /api/bus/vehicles  (Admin/Accountant)
router.post(
  '/vehicles',
  requireRole('ADMIN', 'ACCOUNTANT'),
  [body('vehicleNumber').notEmpty()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { vehicleNumber, model, capacity, driverName, driverPhone, notes } = req.body;
    const existing = await prisma.vehicle.findUnique({ where: { vehicleNumber } });
    if (existing) return res.status(409).json({ error: 'A vehicle with this number already exists' });

    const vehicle = await prisma.vehicle.create({
      data: {
        vehicleNumber,
        model: model || null,
        capacity: capacity ? Number(capacity) : null,
        driverName: driverName || null,
        driverPhone: driverPhone || null,
        notes: notes || null,
      },
    });
    res.status(201).json(vehicle);
  })
);

// PUT /api/bus/vehicles/:id  (Admin/Accountant)
router.put(
  '/vehicles/:id',
  requireRole('ADMIN', 'ACCOUNTANT'),
  asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (data.capacity) data.capacity = Number(data.capacity);
    delete data.id;

    const vehicle = await prisma.vehicle.update({ where: { id: Number(req.params.id) }, data });
    res.json(vehicle);
  })
);

// GET /api/bus/vehicles/:id/expenses  (full maintenance history, independent of route reassignment)
router.get(
  '/vehicles/:id/expenses',
  asyncHandler(async (req, res) => {
    const expenses = await prisma.busExpense.findMany({
      where: { vehicleId: Number(req.params.id) },
      include: { recordedBy: { select: { name: true } } },
      orderBy: { expenseDate: 'desc' },
    });
    res.json(expenses);
  })
);

// ---- BUS ROUTES ----

// GET /api/bus/routes
router.get(
  '/routes',
  asyncHandler(async (req, res) => {
    const routes = await prisma.busRoute.findMany({
      include: { vehicle: true, _count: { select: { students: true, passengers: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(routes);
  })
);

// POST /api/bus/routes  (Admin/Accountant)
router.post(
  '/routes',
  requireRole('ADMIN', 'ACCOUNTANT'),
  [body('name').notEmpty(), body('monthlyFee').isFloat({ min: 0 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, monthlyFee, vehicleId } = req.body;
    const route = await prisma.busRoute.create({
      data: { name, monthlyFee: Number(monthlyFee), vehicleId: vehicleId ? Number(vehicleId) : null },
    });
    res.status(201).json(route);
  })
);

// POST /api/bus/routes/:id/vehicle  (assign or reassign the vehicle serving this route)
// Body: { vehicleId }  — pass null to unassign
// Reassigning does NOT touch expense history: expenses stay attached to the
// vehicle they were logged against, so swapping buses on a route never loses data.
router.post(
  '/routes/:id/vehicle',
  requireRole('ADMIN', 'ACCOUNTANT'),
  asyncHandler(async (req, res) => {
    const { vehicleId } = req.body;
    const route = await prisma.busRoute.update({
      where: { id: Number(req.params.id) },
      data: { vehicleId: vehicleId ? Number(vehicleId) : null },
      include: { vehicle: true },
    });
    res.json(route);
  })
);

// ---- STUDENT ASSIGNMENT (enrolled students) ----

// POST /api/bus/assign  (assign or remove a student's bus route)
// Body: { studentId, busRouteId (null to remove), busPickupPoint }
router.post(
  '/assign',
  requireRole('ADMIN', 'STAFF', 'ACCOUNTANT'),
  [body('studentId').isInt()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { studentId, busRouteId, busPickupPoint } = req.body;
    const student = await prisma.student.update({
      where: { id: Number(studentId) },
      data: {
        busRouteId: busRouteId ? Number(busRouteId) : null,
        busPickupPoint: busPickupPoint || null,
      },
    });
    res.json(student);
  })
);

// ---- BUS PASSENGERS (riders who are NOT enrolled students) ----

// GET /api/bus/passengers?busRouteId=
router.get(
  '/passengers',
  asyncHandler(async (req, res) => {
    const { busRouteId } = req.query;
    const passengers = await prisma.busPassenger.findMany({
      where: {
        active: true,
        ...(busRouteId ? { busRouteId: Number(busRouteId) } : {}),
      },
      include: { busRoute: true },
      orderBy: { name: 'asc' },
    });
    res.json(passengers);
  })
);

// POST /api/bus/passengers  (register a non-student bus rider)
// Body: { name, guardianName, guardianPhone, busRouteId, pickupPoint, note }
router.post(
  '/passengers',
  requireRole('ADMIN', 'STAFF', 'ACCOUNTANT'),
  [
    body('name').notEmpty(),
    body('guardianName').notEmpty(),
    body('guardianPhone').notEmpty(),
    body('busRouteId').isInt(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, guardianName, guardianPhone, busRouteId, pickupPoint, note } = req.body;
    const passenger = await prisma.busPassenger.create({
      data: {
        name,
        guardianName,
        guardianPhone,
        busRouteId: Number(busRouteId),
        pickupPoint: pickupPoint || null,
        note: note || null,
      },
    });
    res.status(201).json(passenger);
  })
);

// PUT /api/bus/passengers/:id  (edit details, change route, or deactivate)
router.put(
  '/passengers/:id',
  requireRole('ADMIN', 'STAFF', 'ACCOUNTANT'),
  asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (data.busRouteId) data.busRouteId = Number(data.busRouteId);
    delete data.id;

    const passenger = await prisma.busPassenger.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(passenger);
  })
);

// DELETE /api/bus/passengers/:id  (soft delete — stops billing them, keeps payment history)
router.delete(
  '/passengers/:id',
  requireRole('ADMIN', 'ACCOUNTANT'),
  asyncHandler(async (req, res) => {
    const passenger = await prisma.busPassenger.update({
      where: { id: Number(req.params.id) },
      data: { active: false },
    });
    res.json(passenger);
  })
);

// ---- COMBINED RIDER LIST ----

// GET /api/bus/riders?busRouteId=
// Returns enrolled students AND bus-only passengers on a route as one list,
// each tagged with riderType so the client knows which fee-payment call to make.
// Each rider carries the route's monthly fee and their own standing discount,
// so the client can show the net payable without a second call.
router.get(
  '/riders',
  asyncHandler(async (req, res) => {
    const { busRouteId } = req.query;
    if (!busRouteId) return res.status(400).json({ error: 'busRouteId is required' });

    const [route, students, passengers] = await Promise.all([
      prisma.busRoute.findUnique({ where: { id: Number(busRouteId) }, select: { monthlyFee: true } }),
      prisma.student.findMany({
        where: { busRouteId: Number(busRouteId), status: 'REGULAR' },
        include: { class: true },
        orderBy: { admissionNumber: 'asc' },
      }),
      prisma.busPassenger.findMany({
        where: { busRouteId: Number(busRouteId), active: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const monthlyFee = route.monthlyFee;
    const netOf = (discount) => Math.max(0, monthlyFee - (discount || 0));

    const riders = [
      ...students.map((s) => ({
        riderType: 'STUDENT',
        riderId: s.id,
        name: `${s.firstName} ${s.lastName}`,
        classLabel: s.class?.name || '—',
        section: s.section,
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
        pickupPoint: s.busPickupPoint,
        monthlyFee,
        busFeeDiscount: s.busFeeDiscount || 0,
        busFeeDiscountReason: s.busFeeDiscountReason,
        netPayable: netOf(s.busFeeDiscount),
      })),
      ...passengers.map((p) => ({
        riderType: 'PASSENGER',
        riderId: p.id,
        name: p.name,
        classLabel: 'Not enrolled',
        guardianName: p.guardianName,
        guardianPhone: p.guardianPhone,
        pickupPoint: p.pickupPoint,
        note: p.note,
        monthlyFee,
        busFeeDiscount: p.busFeeDiscount || 0,
        busFeeDiscountReason: p.busFeeDiscountReason,
        netPayable: netOf(p.busFeeDiscount),
      })),
    ];

    res.json(riders);
  })
);

// POST /api/bus/riders/discount  (Admin/Accountant - set a rider's STANDING
// bus fee discount). This is the recurring one — typically given when two
// siblings ride the same bus — and it pre-fills the discount on each month's
// payment rather than being applied automatically. Send discount = 0 (or null)
// to remove it. A single month's discount is set on the payment itself.
router.post(
  '/riders/discount',
  requireRole('ADMIN', 'ACCOUNTANT'),
  [
    body('riderType').isIn(['STUDENT', 'PASSENGER']),
    body('riderId').isInt(),
    body('discount').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountReason').optional({ nullable: true, checkFalsy: true }).isIn(DISCOUNT_REASONS),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { riderType, riderId, discount, discountReason } = req.body;
    const value = Number(discount || 0);
    const data = {
      busFeeDiscount: value > 0 ? value : null,
      // A discount of zero has no reason to carry.
      busFeeDiscountReason: value > 0 ? discountReason || null : null,
    };

    const rider =
      riderType === 'STUDENT'
        ? await prisma.student.update({ where: { id: Number(riderId) }, data })
        : await prisma.busPassenger.update({ where: { id: Number(riderId) }, data });

    res.json({
      riderType,
      riderId: rider.id,
      busFeeDiscount: rider.busFeeDiscount || 0,
      busFeeDiscountReason: rider.busFeeDiscountReason,
    });
  })
);

// ---- FEE COLLECTION ----

// GET /api/bus/payments?busRouteId=&month=YYYY-MM
router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const { busRouteId, month } = req.query;
    const where = {
      ...(busRouteId ? { busRouteId: Number(busRouteId) } : {}),
      ...(month ? { month } : {}),
    };
    const payments = await prisma.busFeePayment.findMany({
      where,
      include: { student: true, busPassenger: true, busRoute: true },
      orderBy: { paymentDate: 'desc' },
    });
    res.json(payments);
  })
);

// GET /api/bus/dues?busRouteId=&month=YYYY-MM
// Every rider (student or passenger) on the route who has NOT paid for the given month.
// Each unpaid rider carries their standing discount and what's actually owed
// after it, and `totalExpected` is the sum of those — so the outstanding figure
// doesn't overstate what the school can still collect.
router.get(
  '/dues',
  asyncHandler(async (req, res) => {
    const { busRouteId, month } = req.query;
    if (!busRouteId || !month) {
      return res.status(400).json({ error: 'busRouteId and month are required query params' });
    }

    const [route, students, passengers, payments] = await Promise.all([
      prisma.busRoute.findUnique({ where: { id: Number(busRouteId) }, select: { monthlyFee: true } }),
      prisma.student.findMany({
        where: { busRouteId: Number(busRouteId), status: 'REGULAR' },
        include: { class: true },
        orderBy: { admissionNumber: 'asc' },
      }),
      prisma.busPassenger.findMany({
        where: { busRouteId: Number(busRouteId), active: true },
      }),
      prisma.busFeePayment.findMany({
        where: { busRouteId: Number(busRouteId), month },
      }),
    ]);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const monthlyFee = route.monthlyFee;
    const netOf = (discount) => Math.max(0, monthlyFee - (discount || 0));

    const paidStudentIds = new Set(payments.filter((p) => p.studentId).map((p) => p.studentId));
    const paidPassengerIds = new Set(payments.filter((p) => p.busPassengerId).map((p) => p.busPassengerId));

    const dues = [
      ...students
        .filter((s) => !paidStudentIds.has(s.id))
        .map((s) => ({
          riderType: 'STUDENT',
          riderId: s.id,
          name: `${s.firstName} ${s.lastName}`,
          classLabel: s.class?.name,
          monthlyFee,
          busFeeDiscount: s.busFeeDiscount || 0,
          busFeeDiscountReason: s.busFeeDiscountReason,
          netPayable: netOf(s.busFeeDiscount),
        })),
      ...passengers
        .filter((p) => !paidPassengerIds.has(p.id))
        .map((p) => ({
          riderType: 'PASSENGER',
          riderId: p.id,
          name: p.name,
          classLabel: 'Not enrolled',
          monthlyFee,
          busFeeDiscount: p.busFeeDiscount || 0,
          busFeeDiscountReason: p.busFeeDiscountReason,
          netPayable: netOf(p.busFeeDiscount),
        })),
    ];

    res.json({
      month,
      busRouteId: Number(busRouteId),
      totalRiders: students.length + passengers.length,
      totalExpected: dues.reduce((sum, d) => sum + d.netPayable, 0),
      dues,
    });
  })
);

// POST /api/bus/payments  (record a payment for a student OR a bus passenger for a given month)
// Body: { riderType: 'STUDENT' | 'PASSENGER', riderId, busRouteId, month, amount,
//         grossFee, discount, discountReason, paymentMethod, remarks }
//
// `amount` is what was actually received, i.e. already net of `discount` —
// every collection total in the reports sums it, so it must stay net. `grossFee`
// is the route fee at the time of collection, kept so an old receipt still
// reconciles if BusRoute.monthlyFee is changed later. The discount recorded here
// is for this month only; the rider's standing discount is set separately via
// POST /riders/discount and merely pre-fills this one.
router.post(
  '/payments',
  requireRole('ADMIN', 'ACCOUNTANT'),
  [
    body('riderType').isIn(['STUDENT', 'PASSENGER']),
    body('riderId').isInt(),
    body('busRouteId').isInt(),
    body('month').matches(/^\d{4}-\d{2}$/),
    body('amount').isFloat({ min: 0 }),
    body('grossFee').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discount').optional({ nullable: true }).isFloat({ min: 0 }),
    body('discountReason').optional({ nullable: true, checkFalsy: true }).isIn(DISCOUNT_REASONS),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      riderType,
      riderId,
      busRouteId,
      month,
      amount,
      grossFee,
      discount,
      discountReason,
      paymentMethod,
      remarks,
    } = req.body;
    const isStudent = riderType === 'STUDENT';

    // Fall back to the route's current fee when the client didn't send one, so
    // older callers keep working and the receipt still records a gross figure.
    const route = await prisma.busRoute.findUnique({
      where: { id: Number(busRouteId) },
      select: { monthlyFee: true },
    });
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const gross = grossFee === undefined || grossFee === null || grossFee === '' ? route.monthlyFee : Number(grossFee);
    const discountValue = Number(discount || 0);
    if (discountValue > gross) {
      return res.status(400).json({ error: `Discount cannot exceed the fee of ${gross}.` });
    }

    const whereUnique = isStudent
      ? { studentId_month: { studentId: Number(riderId), month } }
      : { busPassengerId_month: { busPassengerId: Number(riderId), month } };

    const feeFields = {
      amount: Number(amount),
      grossFee: gross,
      discount: discountValue,
      // A discount of zero has no reason to carry.
      discountReason: discountValue > 0 ? discountReason || null : null,
      paymentMethod: paymentMethod || 'CASH',
      remarks: remarks || null,
    };

    const payment = await prisma.busFeePayment.upsert({
      where: whereUnique,
      update: feeFields,
      create: {
        studentId: isStudent ? Number(riderId) : null,
        busPassengerId: isStudent ? null : Number(riderId),
        busRouteId: Number(busRouteId),
        month,
        ...feeFields,
      },
    });
    res.status(201).json(payment);
  })
);

// ---- TRANSPORT MAINTENANCE / REPAIR EXPENSES (scoped to a VEHICLE) ----

// GET /api/bus/expenses?vehicleId=&category=&from=&to=
router.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    const { vehicleId, category, from, to } = req.query;
    const where = {
      ...(vehicleId ? { vehicleId: Number(vehicleId) } : {}),
      ...(category ? { category } : {}),
    };
    if (from || to) {
      where.expenseDate = {};
      if (from) where.expenseDate.gte = new Date(from);
      if (to) where.expenseDate.lte = new Date(to);
    }

    const expenses = await prisma.busExpense.findMany({
      where,
      include: { vehicle: true, recordedBy: { select: { name: true } } },
      orderBy: { expenseDate: 'desc' },
    });
    res.json(expenses);
  })
);

// POST /api/bus/expenses  (Admin/Accountant - log a repair/maintenance/fuel expense against a vehicle)
router.post(
  '/expenses',
  requireRole('ADMIN', 'ACCOUNTANT'),
  [
    body('vehicleId').isInt(),
    body('category').isIn(['FUEL', 'REPAIR', 'MAINTENANCE', 'INSURANCE', 'PERMIT_OR_TAX', 'OTHER']),
    body('description').notEmpty(),
    body('amount').isFloat({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { vehicleId, category, description, amount, expenseDate, vendorName, odometerReading, remarks } = req.body;

    const expense = await prisma.busExpense.create({
      data: {
        vehicleId: Number(vehicleId),
        category,
        description,
        amount: Number(amount),
        expenseDate: expenseDate ? new Date(expenseDate) : undefined,
        vendorName: vendorName || null,
        odometerReading: odometerReading ? Number(odometerReading) : null,
        remarks: remarks || null,
        recordedById: req.user.id,
      },
    });
    res.status(201).json(expense);
  })
);

// PUT /api/bus/expenses/:id  (Admin/Accountant)
router.put(
  '/expenses/:id',
  requireRole('ADMIN', 'ACCOUNTANT'),
  asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (data.vehicleId) data.vehicleId = Number(data.vehicleId);
    if (data.amount) data.amount = Number(data.amount);
    if (data.expenseDate) data.expenseDate = new Date(data.expenseDate);
    if (data.odometerReading) data.odometerReading = Number(data.odometerReading);
    delete data.id;
    delete data.recordedById;

    const expense = await prisma.busExpense.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(expense);
  })
);

// DELETE /api/bus/expenses/:id  (Admin only)
router.delete(
  '/expenses/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.busExpense.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);

// GET /api/bus/expenses/summary?routeId=&month=YYYY-MM
// Nets a single route's fee collection against whichever vehicle currently
// serves it. If the vehicle was swapped mid-month, this reflects the
// CURRENT vehicle's costs for that month — the previous vehicle's history
// is unaffected and still visible via /vehicles/:id/expenses.
router.get(
  '/expenses/summary',
  asyncHandler(async (req, res) => {
    const { routeId, month } = req.query;
    if (!routeId || !month) {
      return res.status(400).json({ error: 'routeId and month are required query params' });
    }

    const route = await prisma.busRoute.findUnique({ where: { id: Number(routeId) }, include: { vehicle: true } });
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const monthStart = new Date(`${month}-01T00:00:00`);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const [expenses, payments] = await Promise.all([
      route.vehicleId
        ? prisma.busExpense.findMany({
            where: { vehicleId: route.vehicleId, expenseDate: { gte: monthStart, lt: monthEnd } },
          })
        : Promise.resolve([]),
      prisma.busFeePayment.findMany({ where: { busRouteId: Number(routeId), month } }),
    ]);

    const byCategory = {};
    let totalExpenses = 0;
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      totalExpenses += e.amount;
    }
    const feesCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    // Reported alongside, never subtracted: `amount` is already net of the
    // discount, so netting it again here would double-count.
    const discountsGiven = payments.reduce((sum, p) => sum + (p.discount || 0), 0);

    res.json({
      month,
      routeId: Number(routeId),
      vehicle: route.vehicle,
      totalExpenses,
      byCategory,
      feesCollected,
      discountsGiven,
      net: feesCollected - totalExpenses,
    });
  })
);

// GET /api/bus/fleet-summary?month=YYYY-MM
// Whole-fleet rollup: every route's fees collected, its current vehicle's
// expenses for the month, and the net — plus fleet-wide totals.
router.get(
  '/fleet-summary',
  asyncHandler(async (req, res) => {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month is required' });

    const monthStart = new Date(`${month}-01T00:00:00`);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const routes = await prisma.busRoute.findMany({ include: { vehicle: true } });

    const rows = await Promise.all(
      routes.map(async (route) => {
        const [expenses, payments] = await Promise.all([
          route.vehicleId
            ? prisma.busExpense.findMany({
                where: { vehicleId: route.vehicleId, expenseDate: { gte: monthStart, lt: monthEnd } },
              })
            : Promise.resolve([]),
          prisma.busFeePayment.findMany({ where: { busRouteId: route.id, month } }),
        ]);
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
        const feesCollected = payments.reduce((sum, p) => sum + p.amount, 0);
        const discountsGiven = payments.reduce((sum, p) => sum + (p.discount || 0), 0);
        return {
          routeId: route.id,
          routeName: route.name,
          vehicleNumber: route.vehicle?.vehicleNumber || null,
          feesCollected,
          discountsGiven,
          totalExpenses,
          net: feesCollected - totalExpenses,
        };
      })
    );

    const totals = rows.reduce(
      (acc, r) => ({
        feesCollected: acc.feesCollected + r.feesCollected,
        discountsGiven: acc.discountsGiven + r.discountsGiven,
        totalExpenses: acc.totalExpenses + r.totalExpenses,
        net: acc.net + r.net,
      }),
      { feesCollected: 0, discountsGiven: 0, totalExpenses: 0, net: 0 }
    );

    res.json({ month, routes: rows, totals });
  })
);

module.exports = router;
