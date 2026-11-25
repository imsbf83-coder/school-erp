import { useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import { SCHOOL_INFO } from '../../config/schoolInfo';
import printElement from './printElement';
import { classSection, fmtDate, fmtTime, shiftDate, todayString, weekdayName } from './arrangementUtils';
import { groupMessage, teacherMessage, teacherSchedules, whatsappLink } from './arrangementMessages';

// Daily arrangements: mark teachers on leave (whole day or some periods), see
// the periods that need cover, pick a free teacher for each, print the sheet.
export default function ArrangementPanel({ year }) {
  const [date, setDate] = useState(todayString());
  const [day, setDay] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [opened, setOpened] = useState(new Set()); // teachers whose WhatsApp chat was opened for this date
  const [copied, setCopied] = useState(false);
  const [contacts, setContacts] = useState({}); // teacherId -> { phone, source, staffName }
  const [form, setForm] = useState({ teacherId: '', mode: 'full', periods: [], reason: '' });
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
      try {
        const { data } = await client.get('/timetable/teachers/contacts');
        setContacts(data);
      } catch {
        // numbers are optional: the page still works without them
      }
    })();
  }, []);

  useEffect(() => {
    loadDay(date);
  }, [date]);

  async function loadDay(d) {
    setLoading(true);
    setError('');
    setNotice('');
    setOpened(new Set());
    try {
      const { data } = await client.get('/timetable/arrangements/day', { params: { date: d } });
      setDay(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load this date.');
    } finally {
      setLoading(false);
    }
  }

  const teacherName = (id) => teachers.find((t) => t.id === id)?.fullName || '?';
  const teacherShort = (id) => teachers.find((t) => t.id === id)?.shortName || '?';
  const classById = (id) => classes.find((c) => c.id === id);

  async function call(fn) {
    setBusy(true);
    setError('');
    try {
      const { data } = await fn();
      setDay(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function addAbsence(e) {
    e.preventDefault();
    if (!form.teacherId) {
      setError('Choose the teacher who is on leave.');
      return;
    }
    await call(() =>
      client.post('/timetable/arrangements/absences', {
        date,
        teacherId: Number(form.teacherId),
        fullDay: form.mode === 'full',
        periods: form.periods,
        reason: form.reason,
      })
    );
    setForm({ teacherId: '', mode: 'full', periods: [], reason: '' });
  }

  function removeAbsence(a) {
    if (!window.confirm(`Remove ${teacherName(a.teacherId)}'s leave? Their arrangements for this day are removed too.`)) return;
    call(() => client.delete(`/timetable/arrangements/absences/${a.id}`));
  }

  function assign(item, value) {
    call(() =>
      client.put('/timetable/arrangements/assign', {
        date,
        classId: item.classId,
        section: item.section,
        periodNumber: item.periodNumber,
        substituteTeacherId: value === '' ? null : Number(value),
      })
    );
  }

  async function autoArrange() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await client.post('/timetable/arrangements/auto', { date });
      setDay(data.day);
      const parts = [`Arranged ${data.assigned} period${data.assigned === 1 ? '' : 's'}.`];
      if (data.unfilled) parts.push(`${data.unfilled} could not be filled: no teacher is free then. Arrange those by hand.`);
      setNotice(parts.join(' '));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not arrange automatically.');
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    if (!window.confirm('Remove every arrangement for this date? The leave records stay.')) return;
    setNotice('');
    call(() => client.post('/timetable/arrangements/clear', { date }));
  }

  // ---------- WhatsApp ----------
  const ctx = { day, date, teacherName, classById };
  const schedules = day ? teacherSchedules(ctx) : [];
  const phoneOf = (id) => contacts[id]?.phone || '';

  function openGroup() {
    window.open(whatsappLink(groupMessage(ctx)), '_blank');
  }

  async function copyGroup() {
    try {
      await navigator.clipboard.writeText(groupMessage(ctx));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this message:', groupMessage(ctx));
    }
  }

  function openTeacher(sch) {
    const phone = phoneOf(sch.teacherId);
    if (!phone) return;
    window.open(whatsappLink(teacherMessage({ ...ctx, teacherId: sch.teacherId, items: sch.items }), phone), '_blank');
    setOpened((s) => new Set(s).add(sch.teacherId));
  }

  const nextToSend = schedules.find((s) => phoneOf(s.teacherId) && !opened.has(s.teacherId));

  function togglePeriod(n) {
    setForm((f) => ({
      ...f,
      periods: f.periods.includes(n) ? f.periods.filter((x) => x !== n) : [...f.periods, n].sort((a, b) => a - b),
    }));
  }

  function handlePrint() {
    const clone = printRef.current.cloneNode(true);
    clone.classList.remove('hidden');
    printElement(clone, `Arrangement ${fmtDate(date)}`);
  }

  const items = day?.items || [];
  const arrangedCount = items.filter((i) => i.arrangement).length;
  const periodLabel = (a) => (a.fullDay ? 'Full day' : `Periods ${a.periods.join(', ')}`);

  return (
    <div>
      {/* date picker */}
      <div className="flex flex-wrap items-end gap-2 mb-6">
        <button onClick={() => setDate(shiftDate(date, -1))} className="px-3 py-2 text-sm border border-ink/20 rounded-md hover:bg-white" aria-label="Previous day">‹</button>
        <div>
          <label className="block text-xs text-slate2 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
          />
        </div>
        <button onClick={() => setDate(shiftDate(date, 1))} className="px-3 py-2 text-sm border border-ink/20 rounded-md hover:bg-white" aria-label="Next day">›</button>
        <button onClick={() => setDate(todayString())} className="px-3 py-2 text-sm border border-ink/20 rounded-md hover:bg-white">Today</button>
        <span className="text-sm text-slate2 pb-2">{weekdayName(date)}</span>
      </div>

      {error && <p className="text-absent text-sm mb-4">{error}</p>}
      {loading && !day && <p className="text-slate2">Loading…</p>}

      {day && !day.schoolDay && (
        <p className="text-sm text-slate2">{weekdayName(date)} is not a school day (the timetable runs Monday to Friday).</p>
      )}

      {day && day.schoolDay && (
        <>
          {/* 1. teachers on leave */}
          <section className="bg-white border border-ink/10 rounded-lg p-4 sm:p-5 mb-6">
            <h2 className="font-display text-lg text-ink mb-3">Teachers on leave</h2>

            {day.absences.length === 0 ? (
              <p className="text-sm text-slate2 mb-4">No leave marked for this date.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-4">
                {day.absences.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-2 text-sm border border-ink/20 rounded-full pl-3 pr-1 py-1 bg-paper">
                    <span>
                      <strong>{teacherName(a.teacherId)}</strong> · {periodLabel(a)}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </span>
                    <button
                      onClick={() => removeAbsence(a)}
                      disabled={busy}
                      aria-label="Remove leave"
                      className="w-6 h-6 rounded-full text-absent hover:bg-white"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <form onSubmit={addAbsence} className="space-y-3 border-t border-ink/10 pt-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs text-slate2 mb-1">Teacher</label>
                  <select
                    value={form.teacherId}
                    onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm"
                  >
                    <option value="">Choose a teacher…</option>
                    {teachers.filter((t) => t.active).map((t) => (
                      <option key={t.id} value={t.id}>{t.fullName}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[10rem]">
                  <label className="block text-xs text-slate2 mb-1">Reason (optional)</label>
                  <input
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-2 py-2 bg-white text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={form.mode === 'full'} onChange={() => setForm({ ...form, mode: 'full' })} />
                  Full day
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={form.mode === 'periods'} onChange={() => setForm({ ...form, mode: 'periods' })} />
                  Some periods only
                </label>
              </div>

              {form.mode === 'periods' && (
                <div className="flex flex-wrap gap-2">
                  {day.periodNumbers.map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => togglePeriod(n)}
                      className={`text-sm w-10 h-10 rounded-full border ${
                        form.periods.includes(n) ? 'bg-ink text-paper border-transparent' : 'border-ink/20 text-slate2 hover:bg-paper'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
              >
                Mark leave
              </button>
              <p className="text-xs text-slate2">Marking a teacher again for the same date updates their leave.</p>
            </form>
          </section>

          {/* 2. periods needing cover */}
          {day.absences.length > 0 && (
            <section className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="font-display text-lg text-ink">
                  Periods to arrange
                  {items.length > 0 && (
                    <span className="text-sm text-slate2 font-sans ml-2">
                      {arrangedCount} of {items.length} arranged
                    </span>
                  )}
                </h2>
                {items.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={autoArrange}
                      disabled={busy || arrangedCount === items.length}
                      className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
                    >
                      Auto-arrange
                    </button>
                    {arrangedCount > 0 && (
                      <button onClick={clearAll} disabled={busy} className="text-sm px-4 py-2 rounded-md border border-ink/20 text-absent hover:bg-white">
                        Clear all
                      </button>
                    )}
                    <button onClick={handlePrint} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
                      Print arrangement sheet
                    </button>
                  </div>
                )}
              </div>

              {notice && <p className="text-sm text-present mb-3">{notice}</p>}

              {items.length === 0 ? (
                <p className="text-sm text-slate2">The teacher(s) on leave have no classes in the selected periods on {weekdayName(date)}.</p>
              ) : (
                <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink/10 text-left">
                        <th className="px-3 py-2">Period</th>
                        <th className="px-3 py-2">Class</th>
                        <th className="px-3 py-2">Subject</th>
                        <th className="px-3 py-2">On leave</th>
                        <th className="px-3 py-2 min-w-[16rem]">Arranged with (free teachers)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const value = it.arrangement ? String(it.arrangement.substituteTeacherId) : '';
                        return (
                          <tr key={`${it.classId}-${it.section}-${it.periodNumber}`} className="border-b border-ink/5 last:border-0 align-top">
                            <td className="px-3 py-2 whitespace-nowrap">
                              <strong>{it.periodNumber}</strong>
                              <span className="block font-mono text-xs text-slate2">{fmtTime(it.startTime)}–{fmtTime(it.endTime)}</span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">{classSection(classById(it.classId), it.section)}</td>
                            <td className="px-3 py-2">{it.subject}</td>
                            <td className="px-3 py-2">{teacherShort(it.absentTeacherId)}</td>
                            <td className="px-3 py-2">
                              {it.options.length === 0 && !it.arrangement ? (
                                <span className="text-late">No free teacher in this period</span>
                              ) : (
                                <select
                                  value={value}
                                  disabled={busy}
                                  onChange={(e) => assign(it, e.target.value)}
                                  className={`w-full border rounded-md px-2 py-1.5 text-sm bg-white ${it.arrangement ? 'border-present' : 'border-ink/20'}`}
                                >
                                  <option value="">— choose a free teacher ({it.options.length} free) —</option>
                                  {it.options.map((o, idx) => (
                                    <option key={o.teacherId} value={o.teacherId}>
                                      {idx === 0 && !it.arrangement ? 'Suggested: ' : ''}
                                      {teacherName(o.teacherId)}
                                      {o.returningDue ? ' · back from leave' : ''}
                                      {o.sameSubject ? ' ★' : ''} · {o.monthCount} this month
                                      {o.dayCount ? ` · ${o.dayCount} today` : ''}
                                      {o.lastDate ? ` · last ${fmtDate(o.lastDate).slice(0, 5)}` : ' · never yet'}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="text-xs text-slate2 mt-3 space-y-1">
                <p>
                  Only teachers with no class at that time, not on leave, and not already covering another class
                  at that time are listed. The first one is the suggestion, chosen by these rules:
                </p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  <li>A teacher who was on leave the previous school day and is back today covers a period first.</li>
                  <li>Then whoever has covered the fewest periods this month, so totals stay level.</li>
                  <li>Ties go to whoever covered longest ago (rotation), then to the lighter teaching day. ★ = same subject.</li>
                </ol>
                <p>Auto-arrange follows the same rules. You can still change any row by hand afterwards.</p>
              </div>

              {day.monthCounts?.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-slate2 mb-2">
                    Periods covered this month so far (most {day.monthCounts[0].count}, least{' '}
                    {day.monthCounts[day.monthCounts.length - 1].count}):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {day.monthCounts.map((m) => (
                      <span key={m.teacherId} className="text-xs border border-ink/15 rounded-full px-2.5 py-1 bg-white">
                        {teacherShort(m.teacherId)} <strong>{m.count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* WhatsApp */}
          {arrangedCount > 0 && (
            <section className="bg-white border border-ink/10 rounded-lg p-4 sm:p-5 mb-6">
              <h2 className="font-display text-lg text-ink mb-1">Send on WhatsApp</h2>
              <p className="text-xs text-slate2 mb-4">
                Each button opens WhatsApp with the message already written. Press Send there. (Messages are not
                sent automatically.)
              </p>

              <div className="mb-5">
                <p className="text-sm font-medium mb-2">Whole schedule, to the staff group</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={openGroup} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light">
                    Share to WhatsApp (choose the group)
                  </button>
                  <button onClick={copyGroup} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
                    {copied ? 'Copied ✓' : 'Copy message'}
                  </button>
                </div>
                {arrangedCount < items.length && (
                  <p className="text-xs text-late mt-2">
                    {items.length - arrangedCount} period(s) are still not arranged; they show as "not arranged yet" in the message.
                  </p>
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-medium">Each teacher privately ({schedules.length})</p>
                  <button
                    onClick={() => nextToSend && openTeacher(nextToSend)}
                    disabled={!nextToSend}
                    className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-40"
                  >
                    {nextToSend ? `Send to next: ${teacherShort(nextToSend.teacherId)}` : 'All opened'}
                  </button>
                </div>
                <div className="border border-ink/10 rounded-md divide-y divide-ink/10">
                  {schedules.map((sch) => {
                    const phone = phoneOf(sch.teacherId);
                    return (
                      <div key={sch.teacherId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div>
                          <strong>{teacherName(sch.teacherId)}</strong>
                          <span className="text-slate2">
                            {' '}· period{sch.items.length > 1 ? 's' : ''} {sch.items.map((i) => i.periodNumber).join(', ')}
                          </span>
                          {contacts[sch.teacherId]?.source === 'staff' && (
                            <span className="block text-xs text-slate2">Number from Staff: {contacts[sch.teacherId].staffName}</span>
                          )}
                        </div>
                        {phone ? (
                          <button
                            onClick={() => openTeacher(sch)}
                            className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper"
                          >
                            {opened.has(sch.teacherId) ? 'Opened ✓ (open again)' : 'WhatsApp'}
                          </button>
                        ) : (
                          <span className="text-xs text-late">No number found in Staff (set it in the Teachers tab)</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate2 mt-2">
                  Tip: press "Send to next" repeatedly. After you send each message in WhatsApp, come back and press it again.
                </p>
              </div>
            </section>
          )}

          {/* printable sheet (hidden on screen; copied into the print window) */}
          <div ref={printRef} className="hidden">
            <p className="font-display text-lg text-ink uppercase">{SCHOOL_INFO.name}</p>
            <p className="font-display text-base text-ink">ARRANGEMENT SHEET {year}</p>
            <p className="text-sm mb-3">
              {weekdayName(date)}, {fmtDate(date)}
            </p>
            <p className="text-sm mb-3">
              <strong>Teachers on leave:</strong>{' '}
              {day.absences.map((a) => `${teacherName(a.teacherId)} (${periodLabel(a)})`).join('; ')}
            </p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {['Period', 'Time', 'Class', 'Subject', 'Teacher on leave', 'Arranged with', 'Signature'].map((h) => (
                    <th key={h} className="border border-ink/40 px-2 py-1.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.classId}-${it.section}-${it.periodNumber}`}>
                    <td className="border border-ink/40 px-2 py-2">{it.periodNumber}</td>
                    <td className="border border-ink/40 px-2 py-2 whitespace-nowrap">{fmtTime(it.startTime)}–{fmtTime(it.endTime)}</td>
                    <td className="border border-ink/40 px-2 py-2">{classSection(classById(it.classId), it.section)}</td>
                    <td className="border border-ink/40 px-2 py-2">{it.subject}</td>
                    <td className="border border-ink/40 px-2 py-2">{teacherName(it.absentTeacherId)}</td>
                    <td className="border border-ink/40 px-2 py-2 font-semibold">
                      {it.arrangement ? teacherName(it.arrangement.substituteTeacherId) : '— not arranged —'}
                    </td>
                    <td className="border border-ink/40 px-2 py-2 w-32" />
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm mt-10">Principal / Vice Principal: ______________________</p>
          </div>
        </>
      )}
    </div>
  );
}
