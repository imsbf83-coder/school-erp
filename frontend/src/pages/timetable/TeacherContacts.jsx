import { useEffect, useState } from 'react';
import client from '../../api/client';

// WhatsApp numbers for the timetable teachers. They are used to send each
// teacher their own arrangement. Numbers can be typed, or picked from a Staff
// record whose name looks similar.
export default function TeacherContacts() {
  const [teachers, setTeachers] = useState([]);
  const [matches, setMatches] = useState({});
  const [phones, setPhones] = useState({});
  const [saving, setSaving] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reassignTo, setReassignTo] = useState({}); // retired teacher id -> chosen replacement id

  useEffect(() => {
    (async () => {
      try {
        const [t, m] = await Promise.all([client.get('/timetable/teachers'), client.get('/timetable/teachers/contacts')]);
        setTeachers(t.data);
        setMatches(m.data);
        // show the number in use: the saved one, or the one found in Staff
        setPhones(Object.fromEntries(t.data.map((x) => [x.id, m.data[x.id]?.phone ? `+${m.data[x.id].phone}` : ''])));
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load teachers.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(t) {
    setSaving(t.id);
    setError('');
    setNotice('');
    try {
      const { data } = await client.put(`/timetable/teachers/${t.id}`, { phone: phones[t.id] });
      setTeachers((list) => list.map((x) => (x.id === t.id ? data : x)));
      setPhones((p) => ({ ...p, [t.id]: data.phone ? `+${data.phone}` : '' }));
      const fresh = await client.get('/timetable/teachers/contacts');
      setMatches(fresh.data);
      setNotice(`Saved ${t.fullName}.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this number.');
    } finally {
      setSaving(null);
    }
  }

  async function reload() {
    const [t, m] = await Promise.all([client.get('/timetable/teachers'), client.get('/timetable/teachers/contacts')]);
    setTeachers(t.data);
    setMatches(m.data);
  }

  async function setActive(t, active) {
    if (!active && !window.confirm(`Mark ${t.fullName} as retired? He will no longer be offered for arrangements or counted in the monthly balance.`)) return;
    setError('');
    setNotice('');
    try {
      await client.put(`/timetable/teachers/${t.id}`, { active });
      await reload();
      setNotice(active ? `${t.fullName} is active again.` : `${t.fullName} is marked as retired.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change the status.');
    }
  }

  async function reassign(t) {
    const toId = reassignTo[t.id];
    if (!toId) return;
    const to = teachers.find((x) => String(x.id) === String(toId));
    if (!window.confirm(`Move all ${matches[t.id]?.periods || 0} timetable entries of ${t.fullName} to ${to?.fullName}?`)) return;
    setError('');
    setNotice('');
    try {
      const { data } = await client.post(`/timetable/teachers/${t.id}/reassign`, { toTeacherId: Number(toId) });
      await reload();
      setNotice(`Moved ${data.moved} timetable entries from ${t.fullName} to ${to?.fullName}.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not move these periods.');
    }
  }

  if (loading) return <p className="text-slate2">Loading…</p>;

  const activeTeachers = teachers.filter((t) => t.active);
  const missing = activeTeachers.filter((t) => !matches[t.id]?.phone).length;
  const fromStaff = teachers.filter((t) => matches[t.id]?.source === 'staff').length;

  return (
    <div>
      <p className="text-sm text-slate2 mb-4 max-w-3xl">
        WhatsApp numbers used to send each teacher their own arrangement. They are taken from the Staff module
        automatically when a Staff record clearly matches the teacher&apos;s name ({fromStaff} of {teachers.length} found
        that way). Check the &quot;Source&quot; column. Where nothing matched, pick a staff member from the list or type a
        number like 0300 1234567; a saved number always overrides Staff.
        {missing > 0 ? ` ${missing} teacher(s) still have no number.` : ' Every teacher has a number.'}
      </p>
      {error && <p className="text-absent text-sm mb-3">{error}</p>}
      {notice && <p className="text-present text-sm mb-3">{notice}</p>}

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-3 py-2">Teacher</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 min-w-[13rem]">WhatsApp number</th>
              <th className="px-3 py-2 min-w-[11rem]">Source</th>
              <th className="px-3 py-2 min-w-[14rem]">Pick from Staff</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {[...teachers].sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName)).map((t) => {
              const info = matches[t.id] || {};
              const effective = info.phone ? `+${info.phone}` : '';
              const changed = (phones[t.id] || '') !== effective;
              return (
                <tr key={t.id} className="border-b border-ink/5 last:border-0 align-top">
                  <td className={`px-3 py-2 font-medium ${t.active ? '' : 'text-slate2'}`}>
                    {t.fullName}
                    <span className="block text-xs font-normal text-slate2">{t.shortName}</span>
                  </td>
                  <td className="px-3 py-2 text-xs min-w-[11rem]">
                    {t.active ? (
                      <button onClick={() => setActive(t, false)} className="px-2 py-1 rounded-md border border-ink/20 hover:bg-paper">
                        Active · mark retired
                      </button>
                    ) : (
                      <div className="space-y-1.5">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-ink/10">Retired</span>
                        <button onClick={() => setActive(t, true)} className="block text-slate2 underline">
                          make active again
                        </button>
                        {(info.periods || 0) > 0 && (
                          <div className="text-late space-y-1">
                            <p>Still has {info.periods} timetable entries.</p>
                            <select
                              value={reassignTo[t.id] || ''}
                              onChange={(e) => setReassignTo((r) => ({ ...r, [t.id]: e.target.value }))}
                              className="w-full border border-ink/20 rounded-md px-1.5 py-1 bg-white text-xs text-ink"
                            >
                              <option value="">Move his periods to…</option>
                              {activeTeachers.map((x) => (
                                <option key={x.id} value={x.id}>{x.fullName}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => reassign(t)}
                              disabled={!reassignTo[t.id]}
                              className="px-2 py-1 rounded-md bg-ink text-paper disabled:opacity-30"
                            >
                              Move periods
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={phones[t.id] || ''}
                      onChange={(e) => setPhones((p) => ({ ...p, [t.id]: e.target.value }))}
                      placeholder="0300 1234567"
                      inputMode="tel"
                      className="w-full border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {info.source === 'saved' && <span className="text-present">Saved here</span>}
                    {info.source === 'staff' && <span>From Staff: <strong>{info.staffName}</strong></span>}
                    {!info.source && <span className="text-late">Not found in Staff</span>}
                  </td>
                  <td className="px-3 py-2">
                    {(info.candidates || []).length > 0 ? (
                      <select
                        value=""
                        onChange={(e) => e.target.value && setPhones((p) => ({ ...p, [t.id]: e.target.value }))}
                        className="w-full border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                      >
                        <option value="">Choose…</option>
                        {info.candidates.map((c) => (
                          <option key={c.staffId} value={c.phone}>{c.name} · +{c.phone}{c.covers === 'full' ? '' : ' (partial name match)'}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate2">No similar staff name with a phone</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => save(t)}
                      disabled={!changed || saving === t.id}
                      className="text-sm px-3 py-1.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-30"
                    >
                      {saving === t.id ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
