// Small helpers shared by the Arrangements screen and the monthly report.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "2026-11-23" -> "23-11-2026"
export function fmtDate(d) {
  return d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
}

export function weekdayName(d) {
  return WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
}

export function monthName(m) {
  return `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

// today's date on this device, as YYYY-MM-DD (not shifted by time zone)
export function todayString() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function thisMonthString() {
  return todayString().slice(0, 7);
}

export function shiftDate(d, days) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

// "13:15" -> "1:15"
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

// "6" + "A" -> "6-A"
export function classSection(cls, section) {
  const m = cls ? String(cls.name).match(/\d+/) : null;
  return `${m ? m[0] : cls?.name || '?'}-${section}`;
}
