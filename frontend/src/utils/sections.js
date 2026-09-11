// Sections are stored as a CSV string on Class.sections (e.g. "A,B,C" —
// existing data sometimes has spaces, as in "A, B, C", so always trim).
// These helpers turn that into a list for dropdowns.

// The sections defined on one class. Returns [] if the class isn't found or
// has no sections — callers use that to hide the section picker entirely.
export function sectionsFor(classes, classId) {
  const cls = classes.find((c) => String(c.id) === String(classId));
  if (!cls || !cls.sections) return [];
  return cls.sections
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// The union of sections across several classes, de-duplicated
// case-insensitively but keeping the first-seen casing — same rule as
// mergeSections() in the backend's classes route. Pass an empty/omitted
// classIds to get the union across every class.
export function sectionsForMany(classes, classIds) {
  const ids = (classIds || []).map(String);
  const source = ids.length ? classes.filter((c) => ids.includes(String(c.id))) : classes;

  const seen = new Map();
  source.forEach((c) => {
    String(c.sections || '')
      .split(',')
      .forEach((raw) => {
        const s = raw.trim();
        if (!s) return;
        const key = s.toLowerCase();
        if (!seen.has(key)) seen.set(key, s);
      });
  });
  return Array.from(seen.values());
}
