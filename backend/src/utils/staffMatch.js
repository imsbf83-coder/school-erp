// Matches a timetable teacher (written the way the draft timetable spells
// the name, e.g. "ABDUL QAYYM") to a Staff record (e.g. "Abdul Qayyum") so the
// phone number already stored in the Staff module can be used for WhatsApp.
//
// A match is only called "confident" when the Staff record contains EVERY
// name part of the teacher and nobody else does too. Anything less certain is
// returned as a suggestion for a person to confirm, because sending a
// teacher's schedule to the wrong number is worse than asking.

// name parts of 3+ letters ("M." and "UR" are dropped)
function tokens(name) {
  return String(name || '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length >= 3);
}

// same word, or the same word spelled slightly differently
// (QAYYM / QAYYUM: same first four letters)
function similar(a, b) {
  if (a === b) return true;
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4);
}

// Digits only, with the country code (0300 1234567 -> 923001234567).
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `92${d.slice(1)}`;
  if (d.length < 10 || d.length > 15) return undefined;
  return d;
}

// staff: [{ id, firstName, lastName, phone, category }]
// returns { confident: {staffId,name,phone} | null, candidates: [{staffId,name,phone,covers}] }
function matchStaff(teacher, staff) {
  const want = tokens(teacher.fullName);
  const usable = staff.filter((s) => normalizePhone(s.phone));
  const rows = usable.map((s) => {
    const have = tokens(`${s.firstName} ${s.lastName}`);
    const covered = want.filter((w) => have.some((h) => similar(w, h))).length;
    return {
      staffId: s.id,
      name: `${s.firstName} ${s.lastName}`.trim(),
      phone: normalizePhone(s.phone),
      category: s.category,
      covered,
      full: want.length > 0 && covered === want.length,
    };
  });

  let full = rows.filter((r) => r.full);
  // several people share these name parts: prefer the teaching staff
  if (full.length > 1) {
    const teaching = full.filter((r) => r.category === 'TEACHING');
    if (teaching.length >= 1) full = teaching;
  }
  const confident = full.length === 1 ? full[0] : null;

  const candidates = rows
    .filter((r) => r.covered > 0)
    .sort((a, b) => Number(b.full) - Number(a.full) || b.covered - a.covered)
    .slice(0, 4)
    .map(({ staffId, name, phone, covered, full: f }) => ({ staffId, name, phone, covers: f ? 'full' : `${covered}/${want.length}` }));

  return {
    confident: confident ? { staffId: confident.staffId, name: confident.name, phone: confident.phone } : null,
    candidates,
  };
}

module.exports = { matchStaff, normalizePhone, tokens };
