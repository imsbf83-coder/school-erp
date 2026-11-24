import { useEffect, useState } from 'react';
import client from '../../api/client';

const DAYS = [
  { n: 1, short: 'Mon', full: 'Monday' },
  { n: 2, short: 'Tue', full: 'Tuesday' },
  { n: 3, short: 'Wed', full: 'Wednesday' },
  { n: 4, short: 'Thu', full: 'Thursday' },
  { n: 5, short: 'Fri', full: 'Friday' },
];

const KIND_LABELS = { PERIOD: 'Period', BREAK: 'Break', ACTIVITY: 'Activity' };
const KIND_STYLES = {
  PERIOD: 'bg-white',
  BREAK: 'bg-brass/10',
  ACTIVITY: 'bg-ink/5',
};

// "13:15" -> "1:15"  (12-hour clock without am/pm, like the printed timetable)
function fmt(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

function emptyDraft() {
  return {
    id: null,
    name: '',
    days: [1, 2, 3, 4],
    classIds: [],
    slots: [{ kind: 'PERIOD', label: 'Period 1', startTime: '', endTime: '', note: '' }],
  };
}

export default function PeriodSetup() {
  const [schedules, setSchedules] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // schedule being created/edited
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        client.get('/timetable/schedules'),
        client.get('/timetable/classes'),
      ]);
      setSchedules(s.data);
      setClasses(c.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the timetable setup.');
    } finally {
      setLoading(false);
    }
  }

  function startEdit(s) {
    setError('');
    setNotice('');
    setDraft({
      id: s.id,
      name: s.name,
      days: [...s.days],
      classIds: [...s.classIds],
      slots: s.slots.map((x) => ({
        kind: x.kind,
        label: x.label,
        startTime: x.startTime,
        endTime: x.endTime,
        note: x.note || '',
      })),
    });
  }

  function startNew() {
    setError('');
    setNotice('');
    setDraft(emptyDraft());
  }

  function toggle(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function updateSlot(i, patch) {
    setDraft((d) => ({ ...d, slots: d.slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }

  function moveSlot(i, dir) {
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.slots.length) return d;
      const slots = [...d.slots];
      [slots[i], slots[j]] = [slots[j], slots[i]];
      return { ...d, slots };
    });
  }

  function removeSlot(i) {
    setDraft((d) => ({ ...d, slots: d.slots.filter((_, idx) => idx !== i) }));
  }

  function addSlot(kind) {
    setDraft((d) => {
      const last = d.slots[d.slots.length - 1];
      const periodsSoFar = d.slots.filter((s) => s.kind === 'PERIOD').length;
      const label = kind === 'PERIOD' ? `Period ${periodsSoFar + 1}` : kind === 'BREAK' ? 'Break' : '';
      return {
        ...d,
        slots: [...d.slots, { kind, label, startTime: last?.endTime || '', endTime: '', note: '' }],
      };
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        days: draft.days,
        classIds: draft.classIds,
        slots: draft.slots,
      };
      if (draft.id) await client.put(`/timetable/schedules/${draft.id}`, payload);
      else await client.post('/timetable/schedules', payload);
      setDraft(null);
      setNotice('Schedule saved.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this schedule.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s) {
    if (!window.confirm(`Delete the schedule "${s.name}"?`)) return;
    setError('');
    try {
      await client.delete(`/timetable/schedules/${s.id}`);
      setNotice('Schedule deleted.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this schedule.');
    }
  }

  async function handleSeed() {
    setError('');
    setNotice('');
    try {
      const { data } = await client.post('/timetable/schedules/seed-defaults');
      const parts = [];
      if (data.created.length) parts.push(`Created: ${data.created.join('; ')}.`);
      if (data.skipped.length) {
        parts.push(`Skipped (no matching classes found): ${data.skipped.join('; ')}.`);
      }
      setNotice(parts.join(' '));
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the starter schedules.');
    }
  }

  const periodCount = (slots) => slots.filter((s) => s.kind === 'PERIOD').length;

  if (loading) return <p className="text-slate2">Loading…</p>;

  // ---------- Editor ----------
  if (draft) {
    let periodNo = 0;
    return (
      <form onSubmit={handleSave} className="bg-white border border-ink/10 rounded-lg p-4 sm:p-6 space-y-6">
        <h2 className="font-display text-xl text-ink">
          {draft.id ? 'Edit schedule' : 'New schedule'}
        </h2>

        {error && <p className="text-absent text-sm">{error}</p>}

        <div>
          <label className="block text-sm text-slate2 mb-1">Schedule name</label>
          <input
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Classes VI-VIII (Mon-Thu)"
            className="w-full sm:max-w-md border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
          />
        </div>

        <div>
          <p className="text-sm text-slate2 mb-2">Runs on</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <button
                type="button"
                key={d.n}
                onClick={() => setDraft({ ...draft, days: toggle(draft.days, d.n) })}
                className={`text-sm px-3 py-1.5 rounded-full border ${
                  draft.days.includes(d.n) ? 'bg-ink text-paper border-transparent' : 'border-ink/20 text-slate2 hover:bg-paper'
                }`}
              >
                {d.short}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm text-slate2 mb-2">Applies to classes</p>
          {classes.length === 0 ? (
            <p className="text-sm text-slate2">No classes found. Add classes first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setDraft({ ...draft, classIds: toggle(draft.classIds, c.id) })}
                  className={`text-sm px-3 py-1.5 rounded-full border ${
                    draft.classIds.includes(c.id) ? 'bg-ink text-paper border-transparent' : 'border-ink/20 text-slate2 hover:bg-paper'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm text-slate2 mb-2">Daily timings (in order)</p>
          <div className="space-y-2">
            {draft.slots.map((s, i) => {
              if (s.kind === 'PERIOD') periodNo += 1;
              return (
                <div
                  key={i}
                  className={`border border-ink/10 rounded-md p-3 ${KIND_STYLES[s.kind]}`}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-full sm:w-auto">
                      <label className="block text-xs text-slate2 mb-1">Type</label>
                      <select
                        value={s.kind}
                        onChange={(e) => updateSlot(i, { kind: e.target.value })}
                        className="w-full border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                      >
                        {Object.entries(KIND_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[10rem]">
                      <label className="block text-xs text-slate2 mb-1">
                        Name{s.kind === 'PERIOD' ? ` (period no. ${periodNo})` : ''}
                      </label>
                      <input
                        value={s.label}
                        onChange={(e) => updateSlot(i, { label: e.target.value })}
                        placeholder={s.kind === 'ACTIVITY' ? 'e.g. Assembly' : ''}
                        className="w-full border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate2 mb-1">Start</label>
                      <input
                        required
                        type="time"
                        value={s.startTime}
                        onChange={(e) => updateSlot(i, { startTime: e.target.value })}
                        className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate2 mb-1">End</label>
                      <input
                        required
                        type="time"
                        value={s.endTime}
                        onChange={(e) => updateSlot(i, { endTime: e.target.value })}
                        className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                      />
                    </div>
                    <div className="flex gap-1 ml-auto">
                      <button type="button" onClick={() => moveSlot(i, -1)} disabled={i === 0} aria-label="Move up"
                        className="px-2 py-1.5 text-sm border border-ink/20 rounded-md hover:bg-paper disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveSlot(i, 1)} disabled={i === draft.slots.length - 1} aria-label="Move down"
                        className="px-2 py-1.5 text-sm border border-ink/20 rounded-md hover:bg-paper disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => removeSlot(i)} aria-label="Remove row"
                        className="px-2 py-1.5 text-sm border border-ink/20 rounded-md text-absent hover:bg-paper">✕</button>
                    </div>
                  </div>
                  <input
                    value={s.note}
                    onChange={(e) => updateSlot(i, { note: e.target.value })}
                    placeholder="Optional note"
                    className="mt-2 w-full border border-ink/10 rounded-md px-2 py-1 bg-white text-xs"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={() => addSlot('PERIOD')} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper">+ Period</button>
            <button type="button" onClick={() => addSlot('BREAK')} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper">+ Break</button>
            <button type="button" onClick={() => addSlot('ACTIVITY')} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper">+ Assembly / activity</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="text-sm px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
          <button
            type="button"
            onClick={() => { setDraft(null); setError(''); }}
            className="text-sm px-5 py-2.5 rounded-md border border-ink/20 hover:bg-paper"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  // ---------- List ----------
  return (
    <div>
      <p className="text-sm text-slate2 mb-4 max-w-3xl">
        A schedule is one daily bell pattern: assembly, the periods, and the break. A class follows one
        schedule on each school day, so Friday (shorter day) gets its own schedule. Teaching entries
        for each class are added in the next step and use these period numbers.
      </p>

      {error && <p className="text-absent text-sm mb-4">{error}</p>}
      {notice && <p className="text-present text-sm mb-4">{notice}</p>}

      <div className="flex flex-wrap gap-3 mb-6">
        <button onClick={startNew} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light">
          + New schedule
        </button>
        {schedules.length === 0 && (
          <button onClick={handleSeed} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
            Create starter schedules from the 2026-27 draft
          </button>
        )}
      </div>

      {schedules.length === 0 ? (
        <p className="text-slate2 text-sm">No schedules yet.</p>
      ) : (
        <div className="space-y-6">
          {schedules.map((s) => (
            <div key={s.id} className="bg-white border border-ink/10 rounded-lg overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-ink/10 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg text-ink">{s.name}</h2>
                  <p className="text-sm text-slate2 mt-1">
                    {s.days.map((d) => DAYS.find((x) => x.n === d)?.short).join(', ')} ·{' '}
                    {periodCount(s.slots)} periods
                  </p>
                  <p className="text-sm text-slate2">
                    Classes: {s.classNames.length ? s.classNames.join(', ') : '—'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 hover:bg-paper">Edit</button>
                  <button onClick={() => handleDelete(s)} className="text-sm px-3 py-1.5 rounded-md border border-ink/20 text-absent hover:bg-paper">Delete</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="register-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-left">
                      <th className="px-3 sm:px-5 py-2">Slot</th>
                      <th className="px-3 sm:px-5 py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.slots.map((x) => (
                      <tr key={x.id} className={`border-b border-ink/5 last:border-0 ${KIND_STYLES[x.kind]}`}>
                        <td className="px-3 sm:px-5 py-2">
                          {x.label}
                          {x.note && <span className="block text-xs text-slate2">{x.note}</span>}
                        </td>
                        <td className="px-3 sm:px-5 py-2 font-mono text-xs whitespace-nowrap">
                          {fmt(x.startTime)} – {fmt(x.endTime)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
