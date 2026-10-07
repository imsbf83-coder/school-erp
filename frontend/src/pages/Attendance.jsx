import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { sectionsFor } from '../utils/sections';
import ImportAttendance from './attendance/ImportAttendance';
import AttendanceCalendar from './attendance/AttendanceCalendar';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'];
const STATUS_STYLES = {
  PRESENT: 'bg-present text-white',
  ABSENT: 'bg-absent text-white',
  LATE: 'bg-late text-white',
  LEAVE: 'bg-slate2 text-white',
};

function isWeekend(iso) {
  if (!iso) return false;
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export default function Attendance() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [showHolidays, setShowHolidays] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMonthlyView, setShowMonthlyView] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [holidaysYear, setHolidaysYear] = useState(() => new Date().getFullYear());
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });
  const [rangeForm, setRangeForm] = useState({ startDate: '', endDate: '', name: '' });
  const [holidayError, setHolidayError] = useState('');
  const [holidaySaving, setHolidaySaving] = useState(false);

  useEffect(() => {
    client.get('/classes').then((res) => {
      setClasses(res.data);
      if (res.data.length) setClassId(String(res.data[0].id));
    });
  }, []);

  useEffect(() => {
    if (classId && date) loadAttendance();
  }, [classId, section, date]);

  useEffect(() => {
    if (showHolidays) loadHolidays();
  }, [showHolidays, holidaysYear]);

  const sectionOptions = sectionsFor(classes, classId);

  // If the class this user can see only has one section available to them
  // (e.g. a teacher restricted to section "B" — the backend already
  // narrows the `sections` list returned for /api/classes to just that one
  // section), auto-select it instead of leaving the picker on "Whole
  // class", which that teacher isn't actually allowed to view.
  useEffect(() => {
    if (sectionOptions.length === 1 && section !== sectionOptions[0]) {
      setSection(sectionOptions[0]);
    }
  }, [sectionOptions.join(',')]);

  function changeClass(nextClassId) {
    setClassId(nextClassId);
    setSection('');
  }

  async function loadAttendance() {
    setLoading(true);
    setSavedMsg('');
    try {
      const { data } = await client.get('/attendance', {
        params: { classId, date, ...(section ? { section } : {}) },
      });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  async function loadHolidays() {
    const { data } = await client.get('/holidays', { params: { year: holidaysYear } });
    setHolidays(data);
  }

  async function handleAddHoliday(e) {
    e.preventDefault();
    setHolidayError('');
    setHolidaySaving(true);
    try {
      await client.post('/holidays', holidayForm);
      setHolidayForm({ date: '', name: '' });
      loadHolidays();
    } catch (err) {
      setHolidayError(err.response?.data?.error || 'Could not save this holiday.');
    } finally {
      setHolidaySaving(false);
    }
  }

  async function handleAddRange(e) {
    e.preventDefault();
    setHolidayError('');
    setHolidaySaving(true);
    try {
      const { data } = await client.post('/holidays/range', rangeForm);
      setRangeForm({ startDate: '', endDate: '', name: '' });
      loadHolidays();
      setHolidayError(data.created ? '' : 'All dates in that range were already marked as holidays.');
    } catch (err) {
      setHolidayError(err.response?.data?.error || 'Could not save this holiday range.');
    } finally {
      setHolidaySaving(false);
    }
  }

  async function handleDeleteHoliday(id) {
    await client.delete(`/holidays/${id}`);
    loadHolidays();
  }

  function setStatus(studentId, status) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, status } : r)));
  }

  function markAll(status) {
    setRows((prev) => prev.map((r) => ({ ...r, status })));
  }

  async function handleSave() {
    setSaving(true);
    setSavedMsg('');
    try {
      const records = rows.filter((r) => r.status).map((r) => ({ studentId: r.studentId, status: r.status }));
      await client.post('/attendance/bulk', { date, records });
      setSavedMsg(`Saved attendance for ${records.length} students.`);
    } finally {
      setSaving(false);
    }
  }

  const dateIsHoliday = holidays.find((h) => h.date.slice(0, 10) === date);
  const dateIsWeekend = isWeekend(date);

  // NEW: derive year/month from selected date for the import modal
  const importYear = Number(date.slice(0, 4));
  const importMonth = Number(date.slice(5, 7));

  const showSectionCol = !section && sectionOptions.length > 0;
  const colCount = showSectionCol ? 4 : 3;

  return (
    <div>
      <PageHeader
        eyebrow="Module 02"
        title="Attendance"
        action={
          <button
            onClick={() => setShowHolidays((v) => !v)}
            className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
          >
            {showHolidays ? 'Close holidays' : 'Manage holidays'}
          </button>
        }
      />

      {showHolidays && (
        <div className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          <p className="text-sm text-slate2 mb-4">
            Saturdays and Sundays are always treated as holidays automatically. Anything else — occasional
            closures, summer vacation, Eid and other breaks — only needs to be marked here <em>once</em>; it
            then applies school-wide and is excluded from every class's monthly/yearly attendance % automatically.
          </p>

          {holidayError && <p className="text-absent text-sm mb-4">{holidayError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <form onSubmit={handleAddHoliday} className="space-y-3">
              <p className="text-sm font-medium text-ink">Single day (e.g. Independence Day)</p>
              <div className="flex gap-2">
                <input
                  required
                  type="date"
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                  className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
                />
                <input
                  required
                  placeholder="Reason (e.g. Eid-ul-Fitr)"
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  className="flex-1 border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={holidaySaving}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                Add holiday
              </button>
            </form>

            <form onSubmit={handleAddRange} className="space-y-3">
              <p className="text-sm font-medium text-ink">Date range (e.g. summer vacation)</p>
              <div className="flex gap-2">
                <input
                  required
                  type="date"
                  value={rangeForm.startDate}
                  onChange={(e) => setRangeForm({ ...rangeForm, startDate: e.target.value })}
                  className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
                />
                <input
                  required
                  type="date"
                  value={rangeForm.endDate}
                  onChange={(e) => setRangeForm({ ...rangeForm, endDate: e.target.value })}
                  className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
                />
              </div>
              <input
                required
                placeholder="Reason (e.g. Summer Vacation)"
                value={rangeForm.name}
                onChange={(e) => setRangeForm({ ...rangeForm, name: e.target.value })}
                className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
              />
              <button
                type="submit"
                disabled={holidaySaving}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                Add range
              </button>
            </form>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <label className="text-sm text-slate2">Year</label>
            <select
              value={holidaysYear}
              onChange={(e) => setHolidaysYear(Number(e.target.value))}
              className="border border-ink/20 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              {[holidaysYear - 1, holidaysYear, holidaysYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="border border-ink/10 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Reason</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {holidays.length === 0 ? (
                  <tr><td className="px-4 py-4 text-slate2" colSpan={3}>No holidays declared for {holidaysYear}.</td></tr>
                ) : (
                  holidays.map((h) => (
                    <tr key={h.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{h.date.slice(0, 10)}</td>
                      <td className="px-4 py-2">{h.name}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => handleDeleteHoliday(h.id)} className="text-xs text-absent hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-2 items-end">
        <div>
          <label className="block text-sm text-slate2 mb-1">Class</label>
          <select
            value={classId}
            onChange={(e) => changeClass(e.target.value)}
            className="border border-ink/20 rounded-md px-3 py-2 bg-white"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white"
            >
              {/* "Whole class" is only a real option when there's more than
                  one section to choose from. A user restricted to exactly
                  one section (sectionOptions.length === 1 — e.g. a teacher
                  assigned only to section B) has no broader option, so
                  showing "Whole class" here would be misleading and, if
                  picked, would be silently narrowed back to their section
                  by the backend anyway. */}
              {sectionOptions.length > 1 && <option value="">Whole class</option>}
              {sectionOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm text-slate2 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-ink/20 rounded-md px-3 py-2 bg-white"
          />
        </div>
        <button onClick={() => markAll('PRESENT')} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          Mark all present
        </button>
        <button onClick={() => markAll(null)} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          Unmark all
        </button>
        <button onClick={() => setShowImport((v) => !v)} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          {showImport ? 'Hide import' : 'Import attendance from a sheet'}
        </button>
        <button onClick={() => setShowMonthlyView((v) => !v)} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          {showMonthlyView ? 'Hide monthly view' : 'Monthly view'}
        </button>
      </div>

      {showImport && (
        <ImportAttendance
          roster={rows}
          year={importYear}
          month={importMonth}
          classLabel={[classes.find((c) => String(c.id) === classId)?.name, section].filter(Boolean).join(' ')}
          onImported={(res) => {
            setShowImport(false);
            if (res) {
              setSavedMsg(
                `Imported ${res.updated} record${res.updated === 1 ? '' : 's'}` +
                (res.skipped ? `, ${res.skipped} already existed` : '') +
                ` (${res.attempted} total)`
              );
            }
            loadAttendance();
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {showMonthlyView ? (
        <AttendanceCalendar classes={classes} />
      ) : (
        <>
          {(dateIsWeekend || dateIsHoliday) && (
            <p className="text-sm text-late mb-4">
              Heads up — {date} is {dateIsHoliday ? `marked as a holiday ("${dateIsHoliday.name}")` : 'a weekend'}, so it
              won't count toward students' working days in the attendance % report even if you save records for it.
            </p>
          )}

          <div className="bg-white border border-ink/10 rounded-lg overflow-hidden mb-4">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Roll</th>
                  <th className="px-4 py-3">Name</th>
                  {showSectionCol && <th className="px-4 py-3">Section</th>}
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={colCount}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={colCount}>
                    {section
                      ? `No active students in section ${section} of this class.`
                      : 'No active students in this class.'}
                  </td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.studentId} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{r.rollNumber || '—'}</td>
                      <td className="px-4 py-3">{r.name}</td>
                      {showSectionCol && <td className="px-4 py-3 text-slate2">{r.section || '—'}</td>}
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              onClick={() => setStatus(r.studentId, s)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                r.status === s ? STATUS_STYLES[s] + ' border-transparent' : 'border-ink/20 text-slate2 hover:bg-paper'
                              }`}
                            >
                              {s.charAt(0) + s.slice(1).toLowerCase()}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={saving || rows.length === 0}
              className="text-sm px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
            {savedMsg && <p className="text-present text-sm">{savedMsg}</p>}
          </div>
        </>
      )}
    </div>
  );
}
