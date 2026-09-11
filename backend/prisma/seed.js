const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // --- Admin user ---
  const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@school.edu' },
    update: {},
    create: {
      name: 'School Administrator',
      email: 'admin@school.edu',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    },
  });

  // --- Teacher user ---
  const teacherPasswordHash = await bcrypt.hash('Teacher@123', 10);
  const teacherUser = await prisma.user.upsert({
    where: { email: 'teacher@school.edu' },
    update: {},
    create: {
      name: 'Jane Teacher',
      email: 'teacher@school.edu',
      passwordHash: teacherPasswordHash,
      role: 'TEACHER',
    },
  });

  // --- Classes ---
  const classNames = ['Grade 6', 'Grade 7', 'Grade 8'];
  const classes = [];
  for (const name of classNames) {
    const cls = await prisma.class.upsert({
      where: { id: classNames.indexOf(name) + 1 },
      update: {},
      create: { name, sections: 'A,B' },
    });
    classes.push(cls);
  }

  // --- Staff record linked to teacher user ---
  await prisma.staff.upsert({
    where: { employeeId: 'EMP-001' },
    update: {},
    create: {
      employeeId: 'EMP-001',
      userId: teacherUser.id,
      firstName: 'Jane',
      lastName: 'Teacher',
      designation: 'Mathematics Teacher',
      department: 'Mathematics',
      employmentType: 'FULL_TIME',
      phone: '555-0100',
      email: 'teacher@school.edu',
      qualifications: 'M.Sc. Mathematics',
    },
  });

  // --- Vehicle (the physical bus, tracked separately from the route so its
  // maintenance history survives a future route reassignment) ---
  const vehicle = await prisma.vehicle.upsert({
    where: { vehicleNumber: 'SCH-101' },
    update: {},
    create: {
      vehicleNumber: 'SCH-101',
      model: 'Toyota Coaster',
      capacity: 30,
      driverName: 'Muhammad Rafiq',
      driverPhone: '555-0300',
    },
  });

  // --- Bus routes ---
  const busRoute = await prisma.busRoute.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Route 1 - City Center',
      monthlyFee: 2500,
      vehicleId: vehicle.id,
    },
  });

  // --- Bus passengers who are NOT enrolled students (e.g. junior-section
  // children too young to be admitted, or siblings who only use the bus) ---
  await prisma.busPassenger.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Hamza Khan',
      guardianName: 'Ali Khan Sr.',
      guardianPhone: '555-0200',
      busRouteId: busRoute.id,
      pickupPoint: 'Main Gate Stop',
      note: 'Junior section - not yet enrolled, younger sibling of STU-0001',
    },
  });

  // --- Sample students (one of each non-regular status, plus regular ones on the bus) ---
  const sampleStudents = [
    { admissionNumber: 'STU-0001', firstName: 'Ali', lastName: 'Khan', gender: 'MALE', classId: classes[0].id, rollNumber: '1', status: 'REGULAR', onBus: true },
    { admissionNumber: 'STU-0002', firstName: 'Fatima', lastName: 'Ahmed', gender: 'FEMALE', classId: classes[0].id, rollNumber: '2', status: 'REGULAR', onBus: false },
    { admissionNumber: 'STU-0003', firstName: 'Bilal', lastName: 'Hussain', gender: 'MALE', classId: classes[1].id, rollNumber: '1', status: 'REGULAR', onBus: true },
    { admissionNumber: 'STU-0004', firstName: 'Sara', lastName: 'Malik', gender: 'FEMALE', classId: classes[2].id, rollNumber: '1', status: 'PASSOUT', onBus: false },
    { admissionNumber: 'STU-0005', firstName: 'Usman', lastName: 'Sheikh', gender: 'MALE', classId: classes[1].id, rollNumber: '2', status: 'STRUCK_OFF', onBus: false },
  ];

  for (const s of sampleStudents) {
    const student = await prisma.student.upsert({
      where: { admissionNumber: s.admissionNumber },
      update: {},
      create: {
        admissionNumber: s.admissionNumber,
        firstName: s.firstName,
        lastName: s.lastName,
        dateOfBirth: new Date('2013-05-15'),
        gender: s.gender,
        classId: s.classId,
        rollNumber: s.rollNumber,
        status: s.status,
        guardianName: `${s.lastName} Guardian`,
        guardianPhone: '555-0200',
        busRouteId: s.onBus ? busRoute.id : null,
        busPickupPoint: s.onBus ? 'Main Gate Stop' : null,
      },
    });

    await prisma.admission.upsert({
      where: { studentId: student.id },
      update: {},
      create: {
        studentId: student.id,
        academicYear: '2026-2027',
        documentsReceived: 'Birth Certificate,Previous Report Card',
      },
    });
  }

  // --- Sample transport expense (logged against the vehicle, not the route) ---
  await prisma.busExpense.create({
    data: {
      vehicleId: vehicle.id,
      category: 'REPAIR',
      description: 'Replaced front brake pads',
      amount: 4500,
      vendorName: 'City Auto Workshop',
      odometerReading: 45210,
      recordedById: admin.id,
    },
  });

  console.log('Seed complete.');
  console.log('---------------------------------------------');
  console.log('Admin login:   admin@school.edu / Admin@123');
  console.log('Teacher login: teacher@school.edu / Teacher@123');
  console.log('---------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
