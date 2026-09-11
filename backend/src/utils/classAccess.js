const prisma = require('../prismaClient');

/**
 * Returns the list of Class ids a user is restricted to, or `null` if the
 * user is unrestricted (sees the whole school).
 *
 * Only role === 'TEACHER' is ever scoped — ADMIN, ACCOUNTANT, and STAFF
 * always get `null` back. This is the single place that decides "who gets
 * scoped by class", so every route asks this function instead of checking
 * req.user.role directly.
 *
 * A teacher with no classes assigned gets back `[]` (not null) — routes
 * should treat that as "can see nothing yet", not "unrestricted".
 */
async function getAllowedClassIds(user) {
  if (!user || user.role !== 'TEACHER') return null;
  const rows = await prisma.teacherClass.findMany({
    where: { userId: user.id },
    select: { classId: true },
  });
  return rows.map((r) => r.classId);
}

/**
 * Returns a Map of classId -> section for a TEACHER user, where section is
 * either a specific section string (e.g. "B") or null (meaning "whole
 * class" — this teacher's TeacherClass row for that class had no section
 * set). Returns null for unrestricted users (same convention as
 * getAllowedClassIds), since "restrict to a section" only ever applies to
 * a user who is already restricted to specific classes.
 *
 * A teacher could in principle have TeacherClass rows for several
 * different classes, each with its own section (or none) — this returns
 * one section value per classId.
 */
async function getAllowedSections(user) {
  if (!user || user.role !== 'TEACHER') return null;
  const rows = await prisma.teacherClass.findMany({
    where: { userId: user.id },
    select: { classId: true, section: true },
  });
  const map = new Map();
  rows.forEach((r) => map.set(r.classId, r.section));
  return map;
}

/**
 * Narrows a requested list of class ids down to the ones the user is
 * actually allowed to see, given `allowedClassIds` from getAllowedClassIds().
 *
 * - `allowedClassIds === null` (unrestricted user) -> requested ids pass through as-is.
 * - Otherwise -> only ids present in both lists survive.
 *
 * Returns `null` to mean "no classId filter should be applied" (unrestricted
 * user who also didn't ask for specific classes), or an array (possibly
 * empty) of class ids to filter by.
 */
function narrowClassIds(allowedClassIds, requestedClassIds) {
  if (allowedClassIds === null) return requestedClassIds ?? null;
  if (!requestedClassIds) return allowedClassIds;
  return requestedClassIds.filter((id) => allowedClassIds.includes(id));
}

/**
 * True if `classId` is something the user is allowed to see.
 * `allowedClassIds === null` means unrestricted -> always true.
 */
function isClassAllowed(allowedClassIds, classId) {
  if (allowedClassIds === null) return true;
  if (classId === null || classId === undefined) return false;
  return allowedClassIds.includes(Number(classId));
}

/**
 * True if a student's (classId, section) is visible to this user, given
 * `allowedSections` from getAllowedSections(). `allowedSections === null`
 * means unrestricted -> always true. A teacher whose TeacherClass.section
 * is null for that class can see every section of it; otherwise only the
 * exact matching section is allowed. A classId the user has no
 * TeacherClass row for at all is disallowed (should already have been
 * caught by isClassAllowed, but this fails safe either way).
 */
function isSectionAllowed(allowedSections, classId, studentSection) {
  if (allowedSections === null) return true;
  const requiredSection = allowedSections.get(Number(classId));
  if (requiredSection === undefined) return false; // not assigned this class at all
  if (requiredSection === null) return true; // whole class
  return String(studentSection || '').trim().toLowerCase() === requiredSection.trim().toLowerCase();
}

module.exports = {
  getAllowedClassIds,
  getAllowedSections,
  narrowClassIds,
  isClassAllowed,
  isSectionAllowed,
};
