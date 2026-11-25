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

  if (loading) return <p className="text-slate2">Loading…</p>;

  const missing = teachers.filter((t) => !matches[t.id]?.phone).length;
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
              <th className="px-3 py-2">Short name</th>
              <th className="px-3 py-2 min-w-[13rem]">WhatsApp number</th>
              <th className="px-3 py-2 min-w-[11rem]">Source</th>
              <th className="px-3 py-2 min-w-[14rem]">Pick from Staff</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => {
              const info = matches[t.id] || {};
              const effective = info.phone ? `+${info.phone}` : '';
              const changed = (phones[t.id] || '') !== effective;
              return (
                <tr key={t.id} className="border-b border-ink/5 last:border-0 align-top">
                  <td className="px-3 py-2 font-medium">{t.fullName}</td>
                  <td className="px-3 py-2 text-slate2">{t.shortName}</td>
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
