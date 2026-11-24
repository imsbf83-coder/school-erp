import { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import { SCHOOL_INFO } from '../../config/schoolInfo';

// [1,2,3,5] -> "1-3,5"  (1 = Monday ... 5 = Friday)
function compressDays(days) {
  const s = [...days].sort((a, b) => a - b);
  const parts = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return parts.join(',');
}

// "9" + "A" -> "9A"  (the teacher-wise draft writes sections without a hyphen)
function sectionLabel(cls, section) {
  const m = String(cls.name).match(/\d+/);
  return `${m ? m[0] : cls.name}${section}`;
}

// One cell can hold several classes. Like the printed draft, the sections,
// subjects and days of a cell line up in order, e.g.
//   6C-8B-8A / LIB / 1,2,3     (6C on Mon, 8B on Tue, 8A on Wed)
//   6B-8A / H/G-CS / 1-3,4     (6B does H/G Mon-Wed, 8A does CS on Thu)
function formatCell(items) {
  const sorted = [...items].sort((a, b) => Math.min(...a.days) - Math.min(...b.days) || a.label.localeCompare(b.label));
  const subjects = sorted.map((x) => x.subject);
  const sameSubject = subjects.every((x) => x === subjects[0]);
  return {
    sections: sorted.map((x) => x.label).join('-'),
    subjects: sameSubject ? subjects[0] : subjects.join('-'),
    days: sorted.map((x) => compressDays(x.days)).join(','),
  };
}

export default function TeacherwiseGrid({ year, onYearChange }) {
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [entries, setEntries] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, c, e, t] = await Promise.all([
          client.get('/timetable/schedules'),
          client.get('/timetable/classes'),
          client.get('/timetable/entries'),
          client.get('/timetable/teachers'),
        ]);
        setSchedules(s.data);
        setClasses(c.data);
        setEntries(e.data);
        setTeachers(t.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load the timetable.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Period columns come from the fullest schedule (the Mon-Thu one).
  const slots = useMemo(() => {
    const best = [...schedules].sort(
      (a, b) =>
        b.days.length - a.days.length ||
        b.slots.filter((x) => x.kind === 'PERIOD').length - a.slots.filter((x) => x.kind === 'PERIOD').length
    )[0];
    return best ? best.slots.filter((x) => x.kind !== 'ACTIVITY') : [];
  }, [schedules]);

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  // teacherId -> periodNumber -> [{ label, subject, days }]
  const byTeacher = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (!e.teacherId) continue;
      const cls = classById.get(e.classId);
      if (!cls) continue;
      if (!m.has(e.teacherId)) m.set(e.teacherId, new Map());
      const periods = m.get(e.teacherId);
      if (!periods.has(e.periodNumber)) periods.set(e.periodNumber, []);
      periods.get(e.periodNumber).push({ label: sectionLabel(cls, e.section), subject: e.subject, days: e.days });
    }
    return m;
  }, [entries, classById]);

  // Periods per week = every (day, period) the teacher is in a class.
  function weeklyLoad(teacherId) {
    const periods = byTeacher.get(teacherId);
    if (!periods) return 0;
    const used = new Set();
    for (const [p, items] of periods) for (const it of items) for (const d of it.days) used.add(`${d}|${p}`);
    return used.size;
  }

  const rows = useMemo(
    () => teachers.filter((t) => byTeacher.has(t.id)).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [teachers, byTeacher]
  );

  if (loading) return <p className="text-slate2">Loading…</p>;
  if (error) return <p className="text-absent text-sm">{error}</p>;

  return (
    <div>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; inset: 0; width: 100%; }
          .print-area .overflow-x-auto { overflow: visible !important; }
          .tw-table { min-width: 0 !important; font-size: 9px; }
          .tw-table tr { break-inside: avoid; }
        }
      `}</style>

      <div className="print:hidden flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-slate2 mb-1">Session</label>
          <input
            value={year}
            onChange={(e) => onYearChange(e.target.value)}
            className="w-28 border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
          />
        </div>
        <button onClick={() => window.print()} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          Print
        </button>
        <p className="text-xs text-slate2 basis-full">
          Built automatically from the Class-wise timetable. To change anything, edit it there.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate2 text-sm">No teaching entries yet. Fill in the Class-wise timetable first.</p>
      ) : (
        <div className="print-area">
          <div className="mb-3">
            <p className="font-display text-lg text-ink uppercase">{SCHOOL_INFO.name}</p>
            <p className="font-display text-base text-ink">TIME TABLE {year} (TEACHERWISE)</p>
          </div>

          <div className="bg-white border border-ink/30 overflow-x-auto">
            <table className="tw-table w-full text-sm min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="border border-ink/30 px-2 py-1.5 text-left font-semibold">TEACHER</th>
                  {slots.map((s) => (
                    <th
                      key={s.id}
                      className={`border border-ink/30 px-1 py-1.5 font-semibold ${s.kind === 'BREAK' ? 'bg-ink/5 w-8 text-[10px]' : ''}`}
                    >
                      {s.kind === 'BREAK' ? 'BREAK' : s.periodNumber}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <th className="border border-ink/30 px-2 py-2 text-left font-semibold whitespace-nowrap align-middle">
                      {t.fullName}
                      <span className="block font-mono text-[11px] font-normal text-slate2">{weeklyLoad(t.id)}</span>
                    </th>
                    {slots.map((s) => {
                      if (s.kind === 'BREAK') return <td key={s.id} className="border border-ink/30 bg-ink/5" />;
                      const items = byTeacher.get(t.id)?.get(s.periodNumber);
                      const f = items && items.length ? formatCell(items) : null;
                      return (
                        <td key={s.id} className="border border-ink/30 px-1.5 py-1 text-center align-middle min-w-[5.5rem]">
                          {f && (
                            <>
                              <div className="text-[11px] leading-tight">{f.sections}</div>
                              <div className="font-semibold text-xs leading-tight">{f.subjects}</div>
                              <div className="font-mono text-[10px] text-slate2 leading-tight">{f.days}</div>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate2 mt-2">
            Number under each name = periods per week. Days: 1 = Monday ... 5 = Friday. When a cell lists
            several classes, the sections, subjects and days line up in order.
          </p>
        </div>
      )}
    </div>
  );
}
