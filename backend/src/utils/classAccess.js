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

module.exports = { getAllowedClassIds, narrowClassIds, isClassAllowed };
