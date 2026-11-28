import { classSection, fmtDate, fmtTime, weekdayName } from './arrangementUtils';

// WhatsApp text for the arrangement of one date. *bold* and _italic_ are
// WhatsApp's own formatting marks.

const periodTime = (it) => `${fmtTime(it.startTime)}–${fmtTime(it.endTime)}`;

function leaveText(a, teacherName) {
  return `${teacherName(a.teacherId)} (${a.fullDay ? 'full day' : `period${a.periods.length > 1 ? 's' : ''} ${a.periods.join(', ')}`})`;
}

// One message for the whole staff group.
export function groupMessage({ day, date, teacherName, classById, schoolName }) {
  const lines = [];
  lines.push(`*ARRANGEMENT - ${weekdayName(date)}, ${fmtDate(date)}*`);
  lines.push(`_${schoolName}_`);
  lines.push('');
  lines.push(`*On leave:* ${day.absences.map((a) => leaveText(a, teacherName)).join('; ')}`);
  lines.push('');

  const byPeriod = new Map();
  for (const it of day.items) {
    if (!byPeriod.has(it.periodNumber)) byPeriod.set(it.periodNumber, []);
    byPeriod.get(it.periodNumber).push(it);
  }
  for (const [p, list] of Array.from(byPeriod).sort((a, b) => a[0] - b[0])) {
    lines.push(`*Period ${p}* (${periodTime(list[0])})`);
    for (const it of list) {
      const cls = classSection(classById(it.classId), it.section);
      const who = it.arrangement ? `*${teacherName(it.arrangement.substituteTeacherId)}*` : '_not arranged yet_';
      lines.push(`${cls} ${it.subject}: ${who} (for ${teacherName(it.absentTeacherId)})`);
    }
    lines.push('');
  }
  lines.push('Please take your arranged periods on time.');
  return lines.join('\n');
}

// Everyone who has at least one period to cover that day, with their lines.
export function teacherSchedules({ day, teacherName, classById }) {
  const map = new Map();
  for (const it of day.items) {
    if (!it.arrangement) continue;
    const id = it.arrangement.substituteTeacherId;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(it);
  }
  return Array.from(map, ([teacherId, items]) => ({
    teacherId,
    items: items.sort((a, b) => a.periodNumber - b.periodNumber),
  })).sort((a, b) => teacherName(a.teacherId).localeCompare(teacherName(b.teacherId)));
}

// A private message for one teacher.
export function teacherMessage({ teacherId, items, date, teacherName, classById, schoolName }) {
  const lines = [];
  lines.push(`Assalam o Alaikum ${teacherName(teacherId)},`);
  lines.push('');
  lines.push(`Your arrangement for *${weekdayName(date)}, ${fmtDate(date)}*:`);
  for (const it of items) {
    lines.push(
      `• Period ${it.periodNumber} (${periodTime(it)}): Class ${classSection(classById(it.classId), it.section)} - ${it.subject} (in place of ${teacherName(it.absentTeacherId)})`
    );
  }
  lines.push('');
  lines.push(`Total: ${items.length} period${items.length > 1 ? 's' : ''}. Please be on time.`);
  lines.push(`_${schoolName}_`);
  return lines.join('\n');
}

export const whatsappLink = (text, phone) =>
  `https://wa.me/${phone ? phone : ''}?text=${encodeURIComponent(text)}`;
