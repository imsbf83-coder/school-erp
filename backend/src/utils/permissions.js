const prisma = require('../prismaClient');

// The fixed set of modules a StaffPermission row can grant. Keep this list
// as the single source of truth — the admin UI that assigns permissions,
// and every route that calls requirePermission(), should both reference
// module names from here rather than typing string literals, so a typo
// can't silently create a permission that never matches anything.
const MODULES = {
  STUDENTS: 'STUDENTS',
  ATTENDANCE: 'ATTENDANCE',
  EXAMS: 'EXAMS',
  ADMISSIONS: 'ADMISSIONS',
  BUS: 'BUS',
  STAFF: 'STAFF',
  CLASSES: 'CLASSES',
  GRADE_SCALES: 'GRADE_SCALES',
  HOLIDAYS: 'HOLIDAYS',
  TIMETABLE: 'TIMETABLE',
};

// Suggested starting permission sets for the two named "incharge" roles,
// for the admin UI to pre-tick when creating an account with that
// designation. Purely a UI convenience — nothing stops admin from
// customizing further per person (that's the whole point of this system).
const ROLE_PRESETS = {
  EXAM_INCHARGE: [MODULES.EXAMS, MODULES.STUDENTS, MODULES.GRADE_SCALES],
  ADMISSION_INCHARGE: [MODULES.ADMISSIONS, MODULES.STUDENTS],
};

/**
 * Returns the set of module names this user has been granted, or `null`
 * only for ADMIN (always full access, unconditionally).
 *
 * TEACHER, ACCOUNTANT, and STAFF are all checked against this table the
 * same way — a teacher's classroom access (attendance, their own
 * students/exam results) stays governed separately by classAccess.js
 * (TeacherClass), but a teacher who ALSO has extra duties (e.g. also the
 * Exam Incharge) gets that extra access by having StaffPermission rows
 * just like a STAFF account would. A user with zero permission rows gets
 * back an empty Set ("no extra modules"), not null — same
 * "restricted-to-nothing" convention as getAllowedClassIds().
 */
async function getUserModules(user) {
  if (!user) return new Set();
  if (user.role === 'ADMIN') return null; // unrestricted

  const rows = await prisma.staffPermission.findMany({
    where: { userId: user.id },
    select: { module: true },
  });
  return new Set(rows.map((r) => r.module));
}

/**
 * True if the user can access `moduleName`, given `userModules` from
 * getUserModules(). `userModules === null` means unrestricted -> true.
 */
function hasModule(userModules, moduleName) {
  if (userModules === null) return true;
  return userModules.has(moduleName);
}

/**
 * Express middleware: restricts a route to users who have been granted at
 * least one of the listed modules.
 *
 * Usage: router.use(requirePermission(MODULES.EXAMS))
 *        router.get('/summary', requirePermission(MODULES.EXAMS, MODULES.STUDENTS), ...)
 *
 * ADMIN always passes. Everyone else (TEACHER, ACCOUNTANT, STAFF) needs an
 * actual StaffPermission row for one of the listed modules — a TEACHER
 * with no admissions/exam-incharge duties gets a 403 here same as any
 * other unrelated staff account. This is separate from, and in addition
 * to, a teacher's own classroom access via classAccess.js
 * (getAllowedClassIds/isClassAllowed), which still applies inside routes
 * like attendance that scope by class/section rather than by module.
 */
function requirePermission(...moduleNames) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userModules = await getUserModules(req.user);
    if (userModules === null) return next(); // ADMIN or TEACHER
    const allowed = moduleNames.some((m) => hasModule(userModules, m));
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to access this module' });
    }
    next();
  };
}

/**
 * Express middleware: lets a fixed set of roles through unconditionally
 * (exactly like requireRole would — no permission row needed), and
 * ADDITIONALLY lets through anyone else who holds one of the listed
 * module permissions.
 *
 * This is the one to use on a route that already works a certain way for
 * some roles (e.g. ADMIN and TEACHER, with TEACHER further scoped by
 * classAccess.js deeper in the route) and you want to layer "OR give this
 * access to a specific STAFF/ACCOUNTANT/TEACHER account via a granted
 * module permission" on top, without changing anything for the roles that
 * already worked. Existing behavior for `roles` is completely unaffected;
 * this only ever widens access, never narrows it.
 *
 * Usage: router.use(requireRoleOrPermission(['ADMIN', 'TEACHER'], MODULES.EXAMS))
 */
function requireRoleOrPermission(roles, ...moduleNames) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (roles.includes(req.user.role)) return next();
    const userModules = await getUserModules(req.user);
    if (userModules === null) return next(); // ADMIN, as a safety net
    const allowed = moduleNames.some((m) => hasModule(userModules, m));
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

module.exports = { MODULES, ROLE_PRESETS, getUserModules, hasModule, requirePermission, requireRoleOrPermission };
