prisma.classSubjectTemplate.upsert({
  where: { classId },
  update: { items: { deleteMany: {}, create: items } },
  create: { classId, items: { create: items } },
});
