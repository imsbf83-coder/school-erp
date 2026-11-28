import { useEffect, useMemo, useRef, useState } from 'react';
import client from '../../api/client';
import { useSchoolInfo } from '../../context/useSchoolInfo';
import printElement from './printElement';

const DAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
];

// "13:15" -> "1:15"  (12-hour clock without am/pm, like the printed draft)
function fmt(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

// [1,2,3,5] -> "1-3,5"  (the draft's way of writing days; 1 = Monday)
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

function classNumber(name) {
  const m = String(name).match(/\d+/);
  return m ? Number(m[0]) : 999;
}

function sectionLabel(cls, section) {
  const m = String(cls.name).match(/\d+/);
  return `${m ? m[0] : cls.name}-${section}`;
}

export default function TimetableGrid({ canEdit, year, onYearChange }) {
  const SCHOOL_INFO = useSchoolInfo(); // school name from Institute Data
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [entries, setEntries] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState([]);
  const [highlight, setHighlight] = useState('');
  const [cell, setCell] = useState(null); // cell being edited
  const [cellError, setCellError] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const printRef = useRef(null);
  const [printDialog, setPrintDialog] = useState(false);
  const [printChoice, setPrintChoice] = useState('all');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
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
  }

  // Which schedule is each class's "main" one (the one with the most school
  // days, i.e. Mon-Thu rather than Friday)? The printed table uses its times.
  const groups = useMemo(() => {
    const byId = new Map();
    for (const cls of classes) {
      const mine = schedules.filter((s) => s.classIds.includes(cls.id));
      if (!mine.length) continue;
      mine.sort((a, b) => b.days.length - a.days.length || a.id - b.id);
      const primary = mine[0];
      if (!byId.has(primary.id)) byId.set(primary.id, { schedule: primary, classes: [] });
      byId.get(primary.id).classes.push(cls);
    }
    const list = Array.from(byId.values());
    list.forEach((g) => g.classes.sort((a, b) => classNumber(a.name) - classNumber(b.name)));
    list.sort((a, b) => classNumber(a.classes[0].name) - classNumber(b.classes[0].name));
    return list;
  }, [classes, schedules]);

  const entriesByCell = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      const k = `${e.classId}|${e.section}|${e.periodNumber}`;
      if (!m.has(k)) m.set(k, []);
      const list = m.get(k);
      // same subject + teacher in one cell is one entry: join their days
      const same = list.find((x) => x.subject === e.subject && x.teacherId === e.teacherId);
      if (same) same.days = Array.from(new Set([...same.days, ...e.days])).sort((a, b) => a - b);
      else list.push({ ...e, days: [...e.days] });
    }
    return m;
  }, [entries]);

  // The weekdays on which this class actually has a given period.
  function validDays(classId, periodNumber) {
    const out = [];
    for (const s of schedules) {
      if (!s.classIds.includes(classId)) continue;
      if (!s.slots.some((x) => x.kind === 'PERIOD' && x.periodNumber === periodNumber)) continue;
      out.push(...s.days);
    }
    return Array.from(new Set(out)).sort((a, b) => a - b);
  }

  function periodTimes(classId, periodNumber) {
    const s = schedules
      .filter((x) => x.classIds.includes(classId))
      .sort((a, b) => b.days.length - a.days.length)[0];
    const slot = s?.slots.find((x) => x.kind === 'PERIOD' && x.periodNumber === periodNumber);
    return slot ? `${fmt(slot.startTime)} – ${fmt(slot.endTime)}` : '';
  }

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);

  // teachers who actually appear in the timetable (for the highlight list)
  const usedTeachers = useMemo(() => {
    const ids = new Set(entries.map((e) => e.teacherId).filter(Boolean));
    return teachers.filter((t) => ids.has(t.id)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [entries, teachers]);

  // typing suggestions: both the printed short name and the full name work
  const suggestions = useMemo(() => {
    const set = new Set(teachers.filter((t) => t.active).flatMap((t) => [t.shortName, t.fullName]));
    return Array.from(set).sort();
  }, [teachers]);

  const subjectNames = useMemo(
    () => Array.from(new Set(entries.map((e) => e.subject))).sort(),
    [entries]
  );

  // ---------- editing a cell ----------
  function openCell(cls, section, periodNumber) {
    if (!canEdit) return;
    const existing = entriesByCell.get(`${cls.id}|${section}|${periodNumber}`) || [];
    setCellError('');
    setCell({
      cls,
      section,
      periodNumber,
      rows: existing.map((e) => ({
        subject: e.subject,
        days: [...e.days],
        teacherName: teacherById.get(e.teacherId)?.shortName || '',
      })),
    });
  }

  function updateRow(i, patch) {
    setCell((c) => ({ ...c, rows: c.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }

  function addRow() {
    setCell((c) => {
      const used = new Set(c.rows.flatMap((r) => r.days));
      const free = validDays(c.cls.id, c.periodNumber).filter((d) => !used.has(d));
      return { ...c, rows: [...c.rows, { subject: '', days: free, teacherName: '' }] };
    });
  }

  function toggleDay(i, d) {
    setCell((c) => ({
      ...c,
      rows: c.rows.map((r, idx) =>
        idx === i ? { ...r, days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] } : r
      ),
    }));
  }

  async function saveCell() {
    setSaving(true);
    setCellError('');
    try {
      await client.put('/timetable/cell', {
        classId: cell.cls.id,
        section: cell.section,
        periodNumber: cell.periodNumber,
        entries: cell.rows,
      });
      setCell(null);
      const e = await client.get('/timetable/entries');
      setEntries(e.data);
    } catch (err) {
      setCellError(err.response?.data?.error || 'Could not save this period.');
    } finally {
      setSaving(false);
    }
  }

  async function handleImport() {
    if (importing) return;
    setImporting(true);
    setError('');
    setNotice([]);
    try {
      const { data } = await client.post('/timetable/import-draft');
      const lines = [`Imported ${data.imported} entries from the 2026-27 draft.`];
      if (data.addedSections.length) lines.push(`Sections added to classes: ${data.addedSections.join(', ')}.`);
      if (data.missingClasses.length) lines.push(`No class found for: ${data.missingClasses.join(', ')}.`);
      data.dropped.forEach((d) => lines.push(`Skipped: ${d}`));
      await load();
      setNotice(lines);
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not import the draft.';
      // "already has entries" means an earlier click worked: just refresh the grid
      await load();
      setError(msg);
    } finally {
      setImporting(false);
    }
  }

  // Print everything, or just one class. The page is copied first and the
  // other classes' rows are removed from the copy, so the screen is untouched.
  function doPrint() {
    const root = printRef.current;
    if (!root) return;
    const clone = root.cloneNode(true);
    let title = `Class-wise timetable ${year}`;
    if (printChoice !== 'all') {
      const cls = classes.find((c) => String(c.id) === String(printChoice));
      clone.querySelectorAll('tr[data-class-id]').forEach((tr) => {
        if (tr.dataset.classId !== String(printChoice)) tr.remove();
      });
      clone.querySelectorAll('[data-group]').forEach((g) => {
        if (!g.querySelector('tr[data-class-id]')) g.remove();
      });
      clone.querySelectorAll('.break-after-page').forEach((g) => g.classList.remove('break-after-page'));
      const num = cls ? String(cls.name).match(/\d+/) : null;
      const label = cls ? (num ? `CLASS ${num[0]}` : String(cls.name).toUpperCase()) : '';
      clone.querySelectorAll('[data-print-title]').forEach((p) => {
        p.textContent = `${p.textContent} - ${label}`;
      });
      title = `Timetable ${label} ${year}`;
    }
    setPrintDialog(false);
    printElement(clone, title);
  }

  async function handleClear() {
    if (!window.confirm('Delete EVERY entry in the timetable? The period schedules stay. This cannot be undone.')) return;
    try {
      await client.delete('/timetable/entries');
      setNotice(['Timetable cleared.']);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not clear the timetable.');
    }
  }

  if (loading) return <p className="text-slate2">Loading…</p>;

  return (
    <div>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; inset: 0; width: 100%; }
          .print-area .overflow-x-auto { overflow: visible !important; }
          .tt-table { min-width: 0 !important; font-size: 9px; }
        }
      `}</style>

      <div className="print:hidden">
        {error && <p className="text-absent text-sm mb-4">{error}</p>}
        {notice.length > 0 && (
          <div className="text-sm text-present mb-4 space-y-0.5">
            {notice.map((n, i) => <p key={i}>{n}</p>)}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div>
            <label className="block text-xs text-slate2 mb-1">Session</label>
            <input
              value={year}
              onChange={(e) => onYearChange(e.target.value)}
              className="w-28 border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Highlight teacher</label>
            <select
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
              className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
            >
              <option value="">None</option>
              {usedTeachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          </div>
          <button
            onClick={() => { setPrintChoice('all'); setPrintDialog(true); }}
            disabled={groups.length === 0}
            className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white disabled:opacity-50"
          >
            Print
          </button>
          {canEdit && entries.length === 0 && schedules.length > 0 && (
            <button onClick={handleImport} disabled={importing} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50">
              {importing ? 'Importing…' : 'Import the 2026-27 draft timetable'}
            </button>
          )}
          {canEdit && entries.length > 0 && (
            <button onClick={handleClear} className="text-sm px-4 py-2 rounded-md border border-ink/20 text-absent hover:bg-white">
              Clear timetable
            </button>
          )}
        </div>
        {canEdit && entries.length > 0 && (
          <p className="text-xs text-slate2 mb-4">Click any cell to edit that period.</p>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-slate2 text-sm">
          No period schedules are set up yet.{canEdit ? ' Open “Period setup” and create them first.' : ''}
        </p>
      ) : (
        <div className="print-area" ref={printRef}>
          {groups.map((g, gi) => {
            const slots = g.schedule.slots.filter((s) => s.kind !== 'ACTIVITY');
            const activities = g.schedule.slots.filter((s) => s.kind === 'ACTIVITY');
            const groupClassIds = g.classes.map((c) => c.id);
            const otherSchedules = schedules.filter(
              (s) => s.id !== g.schedule.id && s.classIds.some((id) => groupClassIds.includes(id))
            );

            return (
              <div key={g.schedule.id} data-group="1" className={`mb-10 ${gi < groups.length - 1 ? 'break-after-page' : ''}`}>
                <div className="mb-3">
                  <p className="font-display text-lg text-ink uppercase">{SCHOOL_INFO.name}</p>
                  <p data-print-title="1" className="font-display text-base text-ink">TIME TABLE {year}</p>
                  <div className="text-sm mt-1">
                    {activities.map((a) => (
                      <p key={a.id}>
                        <span className="inline-block w-72">{a.label}:</span>
                        {fmt(a.startTime)} - {fmt(a.endTime)}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-ink/30 overflow-x-auto">
                  <table className="tt-table w-full text-sm min-w-[900px] border-collapse">
                    <thead>
                      <tr>
                        <th className="border border-ink/30 px-2 py-1.5 text-left font-semibold w-16">Time</th>
                        {slots.map((s) => (
                          <th
                            key={s.id}
                            className={`border border-ink/30 px-1 py-1.5 font-mono text-[11px] font-medium whitespace-nowrap ${
                              s.kind === 'BREAK' ? 'bg-ink/5 w-8' : ''
                            }`}
                          >
                            {s.kind === 'BREAK' ? '' : `${fmt(s.startTime)} – ${fmt(s.endTime)}`}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        <th className="border border-ink/30 px-2 py-1.5 text-left font-semibold">SEC</th>
                        {slots.map((s) => (
                          <th key={s.id} className={`border border-ink/30 px-1 py-1.5 ${s.kind === 'BREAK' ? 'bg-ink/5' : ''}`}>
                            {s.kind === 'BREAK' ? '' : s.periodNumber}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.classes.flatMap((cls) =>
                        String(cls.sections || '')
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .map((section) => (
                            <tr key={`${cls.id}-${section}`} data-class-id={cls.id}>
                              <th className="border border-ink/30 px-2 py-2 text-left font-semibold whitespace-nowrap align-middle">
                                {sectionLabel(cls, section)}
                              </th>
                              {slots.map((s) => {
                                if (s.kind === 'BREAK') {
                                  return <td key={s.id} className="border border-ink/30 bg-ink/5" />;
                                }
                                const list = entriesByCell.get(`${cls.id}|${section}|${s.periodNumber}`) || [];
                                const covered = new Set(list.flatMap((e) => e.days));
                                const missing = list.length
                                  ? validDays(cls.id, s.periodNumber).filter((d) => !covered.has(d))
                                  : [];
                                const Tag = canEdit ? 'button' : 'div';
                                return (
                                  <td key={s.id} className="border border-ink/30 p-0 align-top">
                                    <Tag
                                      type={canEdit ? 'button' : undefined}
                                      onClick={canEdit ? () => openCell(cls, section, s.periodNumber) : undefined}
                                      className={`block w-full h-full min-h-[3.5rem] px-1.5 py-1 text-center ${
                                        canEdit ? 'hover:bg-brass/10 cursor-pointer print:hover:bg-transparent' : ''
                                      }`}
                                    >
                                      {list.length === 0 && canEdit && (
                                        <span className="text-ink/20 print:hidden">+</span>
                                      )}
                                      {list.map((e, i) => (
                                        <div
                                          key={e.id}
                                          className={`py-0.5 ${i > 0 ? 'border-t border-ink/20' : ''} ${
                                            highlight && String(e.teacherId) === highlight ? 'bg-brass/30' : ''
                                          }`}
                                        >
                                          <div className="font-semibold text-xs leading-tight">{e.subject}</div>
                                          <div className="font-mono text-[10px] text-slate2 leading-tight">
                                            {compressDays(e.days)}
                                          </div>
                                          <div className="text-[11px] leading-tight">{teacherById.get(e.teacherId)?.shortName || ''}</div>
                                        </div>
                                      ))}
                                      {missing.length > 0 && (
                                        <div className="text-[10px] text-late print:hidden">
                                          ⚠ no entry: {missing.map((d) => DAYS.find((x) => x.n === d)?.short).join(', ')}
                                        </div>
                                      )}
                                    </Tag>
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs text-slate2 mt-2 space-y-0.5">
                  <p>Days: 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday. Times shown are for {g.schedule.name}.</p>
                  {otherSchedules.map((s) => (
                    <p key={s.id}>
                      {s.name}:{' '}
                      {s.slots
                        .map((x) => `${x.kind === 'PERIOD' ? `P${x.periodNumber}` : x.label} ${fmt(x.startTime)}–${fmt(x.endTime)}`)
                        .join(' · ')}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- print choice ---------- */}
      {printDialog && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-lg w-full max-w-sm p-4 sm:p-6">
            <h2 className="font-display text-xl text-ink mb-4">Print timetable</h2>
            <label className="block text-sm text-slate2 mb-1">What do you want to print?</label>
            <select
              value={printChoice}
              onChange={(e) => setPrintChoice(e.target.value)}
              className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="all">All classes</option>
              {groups.flatMap((g) => g.classes).map((c) => (
                <option key={c.id} value={c.id}>{c.name} only (all sections)</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-3 mt-6">
              <button onClick={doPrint} className="text-sm px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light">
                Print
              </button>
              <button onClick={() => setPrintDialog(false)} className="text-sm px-5 py-2.5 rounded-md border border-ink/20 hover:bg-paper">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- cell editor ---------- */}
      {cell && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4 overflow-y-auto print:hidden">
          <div className="bg-white rounded-lg w-full max-w-xl p-4 sm:p-6 max-h-full overflow-y-auto">
            <h2 className="font-display text-xl text-ink">
              {sectionLabel(cell.cls, cell.section)} · Period {cell.periodNumber}
            </h2>
            <p className="text-xs text-slate2 mb-4">{periodTimes(cell.cls.id, cell.periodNumber)}</p>

            {cellError && <p className="text-absent text-sm mb-3">{cellError}</p>}

            <datalist id="tt-teachers">
              {suggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
            <datalist id="tt-subjects">
              {subjectNames.map((t) => <option key={t} value={t} />)}
            </datalist>

            <div className="space-y-3">
              {cell.rows.length === 0 && <p className="text-sm text-slate2">Nothing scheduled. Add a subject below.</p>}
              {cell.rows.map((r, i) => {
                const allowed = validDays(cell.cls.id, cell.periodNumber);
                return (
                  <div key={i} className="border border-ink/10 rounded-md p-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <input
                        list="tt-subjects"
                        value={r.subject}
                        onChange={(e) => updateRow(i, { subject: e.target.value })}
                        placeholder="Subject (e.g. ENG)"
                        className="flex-1 min-w-[8rem] border border-ink/20 rounded-md px-2 py-1.5 text-sm bg-white uppercase"
                      />
                      <input
                        list="tt-teachers"
                        value={r.teacherName}
                        onChange={(e) => updateRow(i, { teacherName: e.target.value })}
                        placeholder="Teacher"
                        className="flex-1 min-w-[8rem] border border-ink/20 rounded-md px-2 py-1.5 text-sm bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setCell((c) => ({ ...c, rows: c.rows.filter((_, idx) => idx !== i) }))}
                        aria-label="Remove entry"
                        className="px-2 py-1.5 text-sm border border-ink/20 rounded-md text-absent hover:bg-paper"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((d) => {
                        const ok = allowed.includes(d.n);
                        const on = r.days.includes(d.n);
                        return (
                          <button
                            type="button"
                            key={d.n}
                            disabled={!ok}
                            onClick={() => toggleDay(i, d.n)}
                            className={`text-xs px-3 py-1.5 rounded-full border ${
                              on ? 'bg-ink text-paper border-transparent' : 'border-ink/20 text-slate2 hover:bg-paper'
                            } ${!ok ? 'opacity-30' : ''}`}
                          >
                            {d.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button type="button" onClick={addRow} className="mt-3 text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper">
              + Add subject
            </button>

            <div className="flex flex-wrap gap-3 mt-6">
              <button
                onClick={saveCell}
                disabled={saving}
                className="text-sm px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setCell(null)}
                className="text-sm px-5 py-2.5 rounded-md border border-ink/20 hover:bg-paper"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
