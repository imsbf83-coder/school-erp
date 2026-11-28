import { useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import { useSchoolInfo } from '../../context/useSchoolInfo';
import printElement from './printElement';
import { classSection, fmtDate, monthName, thisMonthString, weekdayName } from './arrangementUtils';

// Monthly report: who was on leave, who covered which periods, and how many
// arrangements each teacher took.
export default function ArrangementReport() {
  const SCHOOL_INFO = useSchoolInfo(); // school name from Institute Data
  const [month, setMonth] = useState(thisMonthString());
  const [data, setData] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const printRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [t, c] = await Promise.all([client.get('/timetable/teachers'), client.get('/timetable/classes')]);
        setTeachers(t.data);
        setClasses(c.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load teachers.');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: d } = await client.get('/timetable/arrangements/month', { params: { month } });
        setData(d);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load the report.');
      } finally {
        setLoading(false);
      }
    })();
  }, [month]);

  const name = (id) => teachers.find((t) => t.id === id)?.fullName || '?';
  const cls = (id) => classes.find((c) => c.id === id);

  function summarise() {
    if (!data) return null;
    const taken = new Map();
    for (const a of data.arrangements) taken.set(a.substituteTeacherId, (taken.get(a.substituteTeacherId) || 0) + 1);
    // every teacher is listed (even with 0) so the balance is visible
    const takenRows = teachers
      .filter((t) => t.active || taken.has(t.id)) // a retired teacher only appears if he covered something
      .map((t) => ({ id: t.id, count: taken.get(t.id) || 0, active: t.active }))
      .sort((a, b) => b.count - a.count || name(a.id).localeCompare(name(b.id)));
    // the balance only looks at teachers who are still working
    const counts = takenRows.filter((x) => x.active).map((x) => x.count);
    const balance = counts.length
      ? { max: Math.max(...counts), min: Math.min(...counts), avg: counts.reduce((a, b) => a + b, 0) / counts.length }
      : null;

    const leave = new Map();
    for (const a of data.absences) {
      if (!leave.has(a.teacherId)) leave.set(a.teacherId, { id: a.teacherId, days: 0, fullDays: 0, toCover: 0, arranged: 0 });
      const r = leave.get(a.teacherId);
      r.days += 1;
      if (a.fullDay) r.fullDays += 1;
      r.toCover += a.periodsToCover;
      r.arranged += a.arranged;
    }
    const leaveRows = Array.from(leave.values()).sort((a, b) => b.days - a.days || name(a.id).localeCompare(name(b.id)));

    const totalToCover = data.absences.reduce((s, a) => s + a.periodsToCover, 0);
    return { takenRows, leaveRows, balance, totalToCover, arrangedTotal: data.arrangements.length };
  }

  const sum = summarise();

  function handlePrint() {
    const clone = printRef.current.cloneNode(true);
    printElement(clone, `Arrangement report ${monthName(month)}`);
  }

  const th = 'border border-ink/40 px-2 py-1.5 text-left';
  const td = 'border border-ink/40 px-2 py-1.5';

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6 print:hidden">
        <div>
          <label className="block text-xs text-slate2 mb-1">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
          />
        </div>
        <button
          onClick={handlePrint}
          disabled={!data || (data.arrangements.length === 0 && data.absences.length === 0)}
          className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white disabled:opacity-50"
        >
          Print report
        </button>
      </div>

      {error && <p className="text-absent text-sm mb-4">{error}</p>}
      {loading && <p className="text-slate2">Loading…</p>}

      {data && sum && !loading && (
        data.arrangements.length === 0 && data.absences.length === 0 ? (
          <p className="text-sm text-slate2">No leave or arrangements recorded in {monthName(month)}.</p>
        ) : (
          <div ref={printRef} className="bg-white border border-ink/10 rounded-lg p-4 sm:p-6 text-sm">
            <p className="font-display text-lg text-ink uppercase">{SCHOOL_INFO.name}</p>
            <p className="font-display text-base text-ink mb-3">ARRANGEMENT REPORT - {monthName(month).toUpperCase()}</p>

            <p className="mb-4">
              Leave records: <strong>{data.absences.length}</strong> · Periods needing cover:{' '}
              <strong>{sum.totalToCover}</strong> · Arranged: <strong>{sum.arrangedTotal}</strong> · Not arranged:{' '}
              <strong>{Math.max(0, sum.totalToCover - sum.arrangedTotal)}</strong>
            </p>

            <h3 className="font-semibold mb-1">Arrangements taken, by teacher</h3>
            {sum.balance && (
              <p className="text-slate2 mb-2">
                Most: <strong>{sum.balance.max}</strong> · Least: <strong>{sum.balance.min}</strong> · Difference:{' '}
                <strong>{sum.balance.max - sum.balance.min}</strong> · Average per teacher:{' '}
                <strong>{sum.balance.avg.toFixed(1)}</strong>
              </p>
            )}
            {sum.takenRows.length === 0 ? (
              <p className="text-slate2 mb-5">None.</p>
            ) : (
              <div className="overflow-x-auto mb-5">
                <table className="w-full border-collapse max-w-xl">
                  <thead>
                    <tr><th className={th}>Teacher</th><th className={`${th} w-32`}>Periods covered</th></tr>
                  </thead>
                  <tbody>
                    {sum.takenRows.map((r) => (
                      <tr key={r.id}><td className={td}>{name(r.id)}{r.active ? '' : ' (retired)'}</td><td className={td}>{r.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="font-semibold mb-2">Teachers on leave</h3>
            <div className="overflow-x-auto mb-5">
              <table className="w-full border-collapse max-w-3xl">
                <thead>
                  <tr>
                    <th className={th}>Teacher</th>
                    <th className={th}>Days on leave</th>
                    <th className={th}>Full days</th>
                    <th className={th}>Periods to cover</th>
                    <th className={th}>Arranged</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.leaveRows.map((r) => (
                    <tr key={r.id}>
                      <td className={td}>{name(r.id)}</td>
                      <td className={td}>{r.days}</td>
                      <td className={td}>{r.fullDays}</td>
                      <td className={td}>{r.toCover}</td>
                      <td className={td}>{r.arranged}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="font-semibold mb-2">All arrangements</h3>
            {data.arrangements.length === 0 ? (
              <p className="text-slate2">None.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Date', 'Day', 'Period', 'Class', 'Subject', 'Teacher on leave', 'Arranged with'].map((h) => (
                        <th key={h} className={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.arrangements.map((a) => (
                      <tr key={a.id}>
                        <td className={`${td} whitespace-nowrap`}>{fmtDate(a.date)}</td>
                        <td className={td}>{weekdayName(a.date).slice(0, 3)}</td>
                        <td className={td}>{a.periodNumber}</td>
                        <td className={`${td} whitespace-nowrap`}>{classSection(cls(a.classId), a.section)}</td>
                        <td className={td}>{a.subject}</td>
                        <td className={td}>{name(a.absentTeacherId)}</td>
                        <td className={td}>{name(a.substituteTeacherId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
