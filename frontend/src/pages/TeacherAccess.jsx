import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { sectionsFor } from '../utils/sections';

const emptyForm = { staffId: '', password: '', classId: '', section: '' };

export default function TeacherAccess() {
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  // All staff, fetched once. availableStaff/linkedStaff are derived from
  // this rather than fetched separately, so the "someone already has a
  // login" diagnostic below always matches what the dropdown is using.
  const [allStaff, setAllStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // { classId, section } currently selected in each row, keyed by userId —
  // seeded from each teacher's existing assignment, then edited locally
  // until "Save" is clicked for that row.
  const [rowSelection, setRowSelection] = useState({});
  const [savingRowId, setSavingRowId] = useState(null);
  const [unlinkingId, setUnlinkingId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  // { userId, name } while the reset-password mini form is open for a row.
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resettingId, setResettingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [usersRes, classesRes, staffRes] = await Promise.all([
        client.get('/auth/users'),
        client.get('/classes'),
        client.get('/staff'),
      ]);
      const teacherUsers = usersRes.data.filter((u) => u.role === 'TEACHER');
      setUsers(teacherUsers);
      setClasses(classesRes.data);
      setAllStaff(staffRes.data);
      setRowSelection((prev) => {
        const next = { ...prev };
        for (const t of teacherUsers) {
          if (next[t.id] === undefined) {
            const link = t.teacherClasses?.[0];
            next[t.id] = { classId: link?.classId ? String(link.classId) : '', section: link?.section || '' };
          }
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  const availableStaff = allStaff.filter((s) => !s.userId);
  // Staff whose record already points at a User, but that User either
  // isn't a TEACHER (so it never shows in the table below) or is
  // inactive — these are the ones silently blocking "Choose teacher"
  // without any visible explanation.
  const linkedStaff = allStaff.filter((s) => s.userId);

  const selectedStaff = availableStaff.find((s) => String(s.id) === String(form.staffId));

  async function handleCreateTeacher(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const { data: newUser } = await client.post('/auth/users', {
        role: 'TEACHER',
        staffId: Number(form.staffId),
        password: form.password,
      });
      // If a class was picked in the same form, assign it right away so the
      // account is immediately scoped instead of starting out unrestricted-to-nothing.
      if (form.classId) {
        await client.put(`/auth/users/${newUser.id}/classes`, { classId: Number(form.classId), section: form.section || null });
      }
      setForm(emptyForm);
      setShowForm(false);
      setMessage(`Created teacher account for ${newUser.name}.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not create this teacher account.');
    }
  }

  async function handleSaveAssignment(userId) {
    setError('');
    setMessage('');
    setSavingRowId(userId);
    try {
      const selected = rowSelection[userId] || { classId: '', section: '' };
      await client.put(`/auth/users/${userId}/classes`, {
        classId: selected.classId ? Number(selected.classId) : null,
        section: selected.section || null,
      });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this assignment.');
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleUnlink(staffId, staffName) {
    setError('');
    setMessage('');
    setUnlinkingId(staffId);
    try {
      await client.post(`/staff/${staffId}/unlink-login`);
      setMessage(`Unlinked ${staffName} — they can now be given a fresh teacher login below.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not unlink this staff member.');
    } finally {
      setUnlinkingId(null);
    }
  }

  async function handleDeleteUser(userId, name) {
    if (!window.confirm(`Delete the login account for ${name}? They will no longer be able to sign in. This does not delete their Staff record.`)) return;
    setError('');
    setMessage('');
    setDeletingUserId(userId);
    try {
      await client.delete(`/auth/users/${userId}`);
      setMessage(`Deleted the login account for ${name}.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this account.');
    } finally {
      setDeletingUserId(null);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (!resetTarget) return;
    setError('');
    setMessage('');
    setResettingId(resetTarget.userId);
    try {
      await client.post(`/auth/users/${resetTarget.userId}/reset-password`, { password: resetPassword });
      setMessage(`Password reset for ${resetTarget.name}.`);
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not reset this password.');
    } finally {
      setResettingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Teacher Access"
        action={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
          >
            {showForm ? 'Cancel' : '+ New teacher account'}
          </button>
        }
      />

      <p className="text-sm text-slate2 -mt-4 mb-6">
        Each teacher account sees only its assigned class — its students, attendance, and exam
        results. Everything else in the system stays hidden. Assign one class per teacher below;
        changing the dropdown and clicking "Save" replaces their current assignment.
      </p>

      {message && <p className="text-present text-sm -mt-2 mb-4">{message}</p>}
      {error && !showForm && <p className="text-absent text-sm -mt-2 mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreateTeacher} className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          {error && <p className="text-absent text-sm mb-4">{error}</p>}

          {availableStaff.length === 0 ? (
            allStaff.length === 0 ? (
              <p className="text-sm text-slate2">
                No staff on file yet. Add a teacher in Staff first, then come back here to create their login.
              </p>
            ) : (
              <div>
                <p className="text-sm text-slate2 mb-3">
                  Every staff member on file is already linked to a login account, so there's
                  no one new to choose from. If one of these looks wrong — e.g. it's not actually
                  a working teacher login — click "Unlink" to free that staff member up, then
                  create a fresh teacher login for them.
                </p>
                <div className="border border-ink/10 rounded-md divide-y divide-ink/5">
                  {linkedStaff.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{s.firstName} {s.lastName}</span>
                        <span className="text-slate2"> — {s.designation}</span>
                        {s.user && (
                          <span className="text-xs text-slate2 ml-2">
                            (login: {s.user.role}{s.user.isActive === false ? ', inactive' : ''})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnlink(s.id, `${s.firstName} ${s.lastName}`)}
                        disabled={unlinkingId === s.id}
                        className="text-xs text-absent hover:underline disabled:opacity-50"
                      >
                        {unlinkingId === s.id ? 'Unlinking…' : 'Unlink'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm text-slate2 mb-1">Choose teacher</label>
                <select
                  required
                  value={form.staffId}
                  onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="">— Select from Staff —</option>
                  {availableStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName} — {s.designation}
                    </option>
                  ))}
                </select>
              </div>

              {/* Name and mobile number are read straight from the selected
                  Staff record, not typed in — keeps the login account in
                  sync with Staff instead of drifting from it. */}
              <div>
                <label className="block text-sm text-slate2 mb-1">Name</label>
                <input
                  disabled
                  value={selectedStaff ? `${selectedStaff.firstName} ${selectedStaff.lastName}` : ''}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-ink/5 text-slate2"
                />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Mobile number</label>
                <input
                  disabled
                  value={selectedStaff?.phone || (form.staffId ? 'No mobile number on file for this staff member' : '')}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-ink/5 text-slate2"
                />
              </div>

              <div>
                <label className="block text-sm text-slate2 mb-1">Temporary password</label>
                <input
                  required
                  type="text"
                  minLength={6}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 6 characters"
                  className="w-full border border-ink/20 rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Class (optional here — can assign after)</label>
                <select
                  value={form.classId}
                  onChange={(e) => setForm({ ...form, classId: e.target.value, section: '' })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="">— No class yet —</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {form.classId && sectionsFor(classes, form.classId).length > 0 && (
                <div>
                  <label className="block text-sm text-slate2 mb-1">Section</label>
                  <select
                    value={form.section}
                    onChange={(e) => setForm({ ...form, section: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="">— Whole class —</option>
                    {sectionsFor(classes, form.classId).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={!selectedStaff?.phone}
                className="sm:col-span-2 mt-1 text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed w-fit"
              >
                Create teacher account
              </button>
            </div>
          )}
        </form>
      )}

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Mobile</th>
              <th className="px-4 py-3">Assigned class</th>
              <th className="px-4 py-3">Section</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={5}>Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={5}>No teacher accounts yet. Create one above.</td></tr>
            ) : (
              users.map((u) => {
                const link = u.teacherClasses?.[0];
                const current = { classId: link?.classId ? String(link.classId) : '', section: link?.section || '' };
                const selected = rowSelection[u.id] ?? { classId: '', section: '' };
                const dirty = selected.classId !== current.classId || selected.section !== current.section;
                const availableSections = sectionsFor(classes, selected.classId);
                return (
                  <tr key={u.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-slate2">{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={selected.classId}
                        onChange={(e) => setRowSelection({ ...rowSelection, [u.id]: { classId: e.target.value, section: '' } })}
                        className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm"
                      >
                        <option value="">— None (no access) —</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={selected.section}
                        disabled={!selected.classId || availableSections.length === 0}
                        onChange={(e) => setRowSelection({ ...rowSelection, [u.id]: { ...selected, section: e.target.value } })}
                        className="border border-ink/20 rounded-md px-2 py-1.5 bg-white text-sm disabled:opacity-40 disabled:bg-slate2/5"
                      >
                        <option value="">{selected.classId ? '— Whole class —' : '—'}</option>
                        {availableSections.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                      <button
                        onClick={() => handleSaveAssignment(u.id)}
                        disabled={!dirty || savingRowId === u.id}
                        className="text-xs px-3 py-1.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {savingRowId === u.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setResetTarget({ userId: u.id, name: u.name }); setResetPassword(''); setError(''); }}
                        className="text-xs text-ink hover:underline"
                      >
                        Reset password
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id, u.name)}
                        disabled={deletingUserId === u.id}
                        className="text-xs text-absent hover:underline disabled:opacity-50"
                      >
                        {deletingUserId === u.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleResetPassword}
            className="bg-white border border-ink/10 rounded-lg p-6 w-full max-w-sm"
          >
            <h3 className="text-sm font-medium text-ink mb-1">Reset password for {resetTarget.name}</h3>
            <p className="text-xs text-slate2 mb-4">They'll need to use this new password next time they sign in.</p>
            <input
              required
              type="text"
              minLength={6}
              autoFocus
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full border border-ink/20 rounded-md px-3 py-2 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resettingId === resetTarget.userId}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                Save new password
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
