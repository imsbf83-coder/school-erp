import { useEffect, useState } from 'react';
import client from '../../api/client';
import { sectionsFor } from '../../utils/sections';

// Click a cell to cycle through these, in order, back to blank (unmarked).
const CYCLE = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', null];
const CELL_LABEL = { PRESENT: 'P', ABSENT: 'A', LATE: 'L', LEAVE: 'E' };
const CELL_STYLE = {
  PRESENT: 'bg-present/15 text-present',
  ABSENT: 'bg-absent/15 text-absent',
  LATE: 'bg-late/15 text-late',
  LEAVE: 'bg-slate2/15 text-slate2',
};

function formatDateHeader(iso) {
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}

export default function AttendanceCalendar({ classes }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [month, setMonth] = useState(todayISO.slice(0, 7)); // "YYYY-MM"
  const [dates, setDates] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  // { studentId: { dateISO: status } } — only cells actually changed since
  // load. Kept separate from `rows` so "unsaved changes" is unambiguous.
  const [edits, setEdits] = useState({});

  useEffect(() => {
    if (classes.length && !classId) setClassId(String(classes[0].id));
  }, [classes]);

  const sectionOptions = sectionsFor(classes, classId);

  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [classId]);

  useEffect(() => {
    if (classId) load();
  }, [classId, section, month]);

  function monthRange() {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${month}-${String(lastDay).padStart(2, '0')}`;
    return { from, to };
  }

  async function load() {
    setLoading(true);
    setError('');
    setSavedMsg('');
    setEdits({});
    try {
      const { from, to } = monthRange();
      const { data } = await client.get('/attendance/calendar', {
        params: { classId, from, to, ...(section ? { section } : {}) },
      });
      setDates(data.dates);
      setRows(data.rows);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the attendance calendar.');
      setDates([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function currentStatus(row, dateISO) {
    return edits[row.studentId]?.[dateISO] !== undefined
      ? edits[row.studentId][dateISO]
      : row.statusByDate[dateISO] || null;
  }

  function cycleCell(row, dateISO) {
    const current = currentStatus(row, dateISO);
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    setEdits((prev) => ({
      ...prev,
      [row.studentId]: { ...prev[row.studentId], [dateISO]: next },
    }));
  }

  const dirtyCount = Object.values(edits).reduce((n, byDate) => n + Object.keys(byDate).length, 0);

  async function handleSaveChanges() {
    setSaving(true);
    setSavedMsg('');
    setError('');
    try {
      const records = [];
      for (const [studentId, byDate] of Object.entries(edits)) {
        for (const [date, status] of Object.entries(byDate)) {
          // A cell cycled back to blank sends 'CLEAR' explicitly — the
          // backend deletes that record rather than treating a blank
          // status as "don't touch" (which is right for the CSV import,
          // but wrong here: cycling to blank is a deliberate "erase this").
          records.push({ studentId: Number(studentId), date, status: status || 'CLEAR' });
        }
      }
      if (records.length === 0) {
        setSavedMsg('Nothing to save.');
        setSaving(false);
        return;
      }
      await client.post('/attendance/bulk', { records });
      setSavedMsg(`Saved ${records.length} change${records.length === 1 ? '' : 's'}.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save these changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate2 mb-4">
        A whole month at a glance, editable — click any cell to change that student's status for that
        day, even long after it was first marked. Cycles Present → Absent → Late → Leave → blank.
      </p>

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-sm text-slate2 mb-1">Class</label>
          <select
            value={classId}
            onChange={(e) => { setClassId(e.target.value); setSection(''); }}
            className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
          >
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="">Whole class</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm text-slate2 mb-1">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
          />
        </div>
        <div className="flex gap-3 text-xs text-slate2 items-center pb-2">
          {Object.entries(CELL_LABEL).map(([status, label]) => (
            <span key={status} className="flex items-center gap-1">
              <span className={`inline-flex w-5 h-5 items-center justify-center rounded ${CELL_STYLE[status]}`}>{label}</span>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {error && <p className="text-absent text-sm mb-4">{error}</p>}

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto mb-4">
        <table className="register-table text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-3 py-3 sticky left-0 bg-white">Sr.</th>
              <th className="px-3 py-3 sticky left-0 bg-white">Admission No.</th>
              <th className="px-3 py-3 sticky left-0 bg-white">Name</th>
              {dates.map((d) => (
                <th key={d} className="px-2 py-3 text-center whitespace-nowrap">{formatDateHeader(d)}</th>
              ))}
              <th className="px-3 py-3 text-center">Present</th>
              <th className="px-3 py-3 text-center">Absent</th>
              <th className="px-3 py-3 text-center">Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={dates.length + 6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={dates.length + 6}>No active students in this selection.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.studentId} className="border-b border-ink/5 last:border-0">
                  <td className="px-3 py-2 text-slate2">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.admissionNumber}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                  {dates.map((d) => {
                    const status = currentStatus(r, d);
                    const isDirty = edits[r.studentId]?.[d] !== undefined;
                    return (
                      <td key={d} className="px-1 py-1 text-center">
                        <button
                          onClick={() => cycleCell(r, d)}
                          title="Click to change"
                          className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                            status ? CELL_STYLE[status] : 'bg-paper text-slate2/40 hover:bg-ink/5'
                          } ${isDirty ? 'ring-2 ring-brass-dark' : ''}`}
                        >
                          {status ? CELL_LABEL[status] : '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center text-slate2">{r.present}</td>
                  <td className="px-3 py-2 text-center text-slate2">{r.absent}</td>
                  <td className="px-3 py-2 text-center text-slate2">{r.attendancePercent ?? '—'}{r.attendancePercent !== null ? '%' : ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSaveChanges}
          disabled={saving || dirtyCount === 0}
          className="text-sm px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
        >
          {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Save changes'}
        </button>
        {savedMsg && <p className="text-present text-sm">{savedMsg}</p>}
      </div>
    </div>
  );
}
