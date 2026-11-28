import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import CSVImportPanel from '../components/CSVImportPanel';
import { sectionsFor } from '../utils/sections';

const STAFF_TEMPLATE_HEADERS = [
  'employeeId', 'firstName', 'lastName', 'designation', 'department', 'category',
  'employmentType', 'dateOfBirth', 'gender', 'phone', 'email', 'qualifications', 'salary',
];
const STAFF_TEMPLATE_EXAMPLE = [
  '', 'Ahmed', 'Raza', 'Science Teacher', 'Science', 'TEACHING',
  'FULL_TIME', '1988-04-01', 'MALE', '555-0500', '', 'M.Sc. Physics', '',
];

const emptyForm = {
  employeeId: '',
  firstName: '',
  lastName: '',
  designation: '',
  department: '',
  category: 'TEACHING',
  employmentType: 'FULL_TIME',
  phone: '',
  email: '',
  qualifications: '',
};

// Access-related fields, kept separate from the staff-record form above so
// resetting one doesn't disturb the other. `loginRole: ''` means "no login
// account" — nothing else in this block applies until a role is picked.
const emptyAccess = {
  loginRole: '',
  password: '',
  classId: '',
  section: '',
  modules: [],
};

const CATEGORY_PREFIX = { TEACHING: 'TCH', NON_TEACHING: 'STF' };

const MODULE_LABELS = {
  STUDENTS: 'Students',
  ATTENDANCE: 'Attendance',
  EXAMS: 'Examinations',
  ADMISSIONS: 'Admission / Withdrawal',
  BUS: 'Bus (Fee Collection & Transport Expenses)',
  STAFF: 'Staff',
  CLASSES: 'Classes',
  GRADE_SCALES: 'Grading Scale',
  HOLIDAYS: 'Holidays',
  TIMETABLE: 'Timetable',
  INSTITUTE_DATA: 'Institute Data',
};

export default function Staff() {
  const [staff, setStaff] = useState([]);
  const [classes, setClasses] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [presets, setPresets] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [access, setAccess] = useState(emptyAccess);
  // The linked login, if any, for whichever staff member is being edited —
  // null while adding a new staff member, or editing one with no login yet.
  const [existingUser, setExistingUser] = useState(null);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [useCustomId, setUseCustomId] = useState(false);
  const [error, setError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [accessMsg, setAccessMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [removingLogin, setRemovingLogin] = useState(false);

  useEffect(() => {
    load();
    client.get('/classes').then((res) => setClasses(res.data));
    client.get('/staff-access/modules').then((res) => {
      setAllModules(res.data.modules);
      setPresets(res.data.presets || {});
    });
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/staff');
      setStaff(data);
    } finally {
      setLoading(false);
    }
  }

  function previewEmployeeId(category) {
    const prefix = CATEGORY_PREFIX[category] || CATEGORY_PREFIX.NON_TEACHING;
    let max = 0;
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    for (const s of staff) {
      const match = s.employeeId?.match(pattern);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm);
    setAccess(emptyAccess);
    setExistingUser(null);
    setShowResetPassword(false);
    setUseCustomId(false);
    setError('');
    setAccessError('');
    setAccessMsg('');
    setShowForm(true);
    setShowImport(false);
  }

  async function openEditForm(s) {
    setEditingId(s.id);
    setForm({
      employeeId: s.employeeId || '',
      firstName: s.firstName || '',
      lastName: s.lastName || '',
      designation: s.designation || '',
      department: s.department || '',
      category: s.category || 'NON_TEACHING',
      employmentType: s.employmentType || 'FULL_TIME',
      phone: s.phone || '',
      email: s.email || '',
      qualifications: s.qualifications || '',
      status: s.status || 'ACTIVE',
    });
    setUseCustomId(true);
    setError('');
    setAccessError('');
    setAccessMsg('');
    setShowResetPassword(false);
    setShowForm(true);
    setShowImport(false);

    if (!s.user) {
      // No login yet — show the same "grant access" fields as the Add form.
      setExistingUser(null);
      setAccess(emptyAccess);
      return;
    }

    // Has a login already — pull its current class/section and module
    // access so the form opens pre-filled with what's actually there.
    setExistingUser({ id: s.user.id, role: s.user.role, email: s.user.email, phone: s.user.phone });
    setAccess({ ...emptyAccess, loginRole: s.user.role });

    try {
      if (s.user.role === 'TEACHER') {
        const { data: users } = await client.get('/auth/users');
        const match = users.find((u) => u.id === s.user.id);
        const link = match?.teacherClasses?.[0];
        setAccess((prev) => ({
          ...prev,
          classId: link?.classId ? String(link.classId) : '',
          section: link?.section || '',
        }));
      }
      if (s.user.role !== 'ADMIN') {
        const { data: accessData } = await client.get(`/staff-access/${s.user.id}`);
        setAccess((prev) => ({ ...prev, modules: accessData.modules }));
      }
    } catch {
      // Non-fatal — form still works, just won't show pre-filled access.
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setAccess(emptyAccess);
    setExistingUser(null);
    setUseCustomId(false);
    setError('');
    setAccessError('');
    setAccessMsg('');
  }

  function toggleModule(moduleKey) {
    setAccess((prev) => ({
      ...prev,
      modules: prev.modules.includes(moduleKey)
        ? prev.modules.filter((m) => m !== moduleKey)
        : [...prev.modules, moduleKey],
    }));
  }

  function applyPreset(presetKey) {
    setAccess((prev) => ({ ...prev, modules: presets[presetKey] || [] }));
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      let staffId = editingId;
      if (editingId) {
        await client.put(`/staff/${editingId}`, form);
      } else {
        const payload = { ...form };
        if (!useCustomId) delete payload.employeeId;
        const { data: created } = await client.post('/staff', payload);
        staffId = created.id;
      }

      // Grant a new login only if one doesn't already exist for this staff
      // member and a role was actually picked.
      if (!existingUser && access.loginRole) {
        await createLoginForStaff(staffId);
      }

      closeForm();
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this staff record.');
    } finally {
      setSaving(false);
    }
  }

  async function createLoginForStaff(staffId) {
    const { data: newUser } = await client.post('/auth/users', {
      role: access.loginRole,
      staffId,
      password: access.password,
      ...(access.loginRole !== 'TEACHER' ? { email: form.email || undefined } : {}),
    });

    if (access.loginRole === 'TEACHER' && access.classId) {
      await client.put(`/auth/users/${newUser.id}/classes`, {
        classId: Number(access.classId),
        section: access.section || null,
      });
    }

    if (access.loginRole !== 'ADMIN' && access.modules.length) {
      await client.put(`/staff-access/${newUser.id}`, { modules: access.modules });
    }
  }

  // Saves class/section and module changes for a staff member who ALREADY
  // has a login — separate from handleAdd, since these use different
  // endpoints (no staff-record fields involved) and shouldn't require
  // re-submitting the whole staff form.
  async function handleSaveAccess() {
    if (!existingUser) return;
    setSavingAccess(true);
    setAccessError('');
    setAccessMsg('');
    try {
      if (existingUser.role === 'TEACHER') {
        await client.put(`/auth/users/${existingUser.id}/classes`, {
          classId: access.classId ? Number(access.classId) : null,
          section: access.section || null,
        });
      }
      if (existingUser.role !== 'ADMIN') {
        await client.put(`/staff-access/${existingUser.id}`, { modules: access.modules });
      }
      setAccessMsg('Access updated.');
    } catch (err) {
      setAccessError(err.response?.data?.error || 'Could not update access.');
    } finally {
      setSavingAccess(false);
    }
  }

  async function handleResetPassword() {
    if (!existingUser || resetPasswordValue.length < 6) return;
    setSavingAccess(true);
    setAccessError('');
    setAccessMsg('');
    try {
      await client.post(`/auth/users/${existingUser.id}/reset-password`, { password: resetPasswordValue });
      setAccessMsg('Password reset.');
      setShowResetPassword(false);
      setResetPasswordValue('');
    } catch (err) {
      setAccessError(err.response?.data?.error || 'Could not reset password.');
    } finally {
      setSavingAccess(false);
    }
  }

  async function handleRemoveLogin() {
    if (!existingUser) return;
    if (!window.confirm('Remove this login? They will no longer be able to sign in. The staff record itself is kept.')) return;
    setRemovingLogin(true);
    setAccessError('');
    try {
      await client.delete(`/auth/users/${existingUser.id}`);
      setExistingUser(null);
      setAccess(emptyAccess);
      load();
    } catch (err) {
      setAccessError(err.response?.data?.error || 'Could not remove this login.');
    } finally {
      setRemovingLogin(false);
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    setDeletingId(id);
    setError('');
    try {
      await client.delete(`/staff/${id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this staff record — they may have a linked login account. Remove it first.');
    } finally {
      setDeletingId(null);
    }
  }

  const sectionOptions = sectionsFor(classes, access.classId);
  // Whether to show the module checkboxes at all for the currently chosen
  // (or existing) role — ADMIN is always unrestricted, so there's nothing
  // to grant; NONE means there's no login to attach permissions to.
  const roleForModules = existingUser?.role || access.loginRole;
  const showModules = roleForModules && roleForModules !== 'ADMIN';
  const showClassPicker = roleForModules === 'TEACHER';

  return (
    <div>
      <PageHeader
        eyebrow="Module 05"
        title="Staff"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => { setShowImport((v) => !v); setShowForm(false); }}
              className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
            >
              {showImport ? 'Cancel' : 'Import CSV'}
            </button>
            <button
              onClick={() => (showForm ? closeForm() : openAddForm())}
              className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
            >
              {showForm ? 'Cancel' : '+ Add staff member'}
            </button>
          </div>
        }
      />

      {showImport && (
        <CSVImportPanel
          title="Import staff from CSV"
          templateFilename="staff_template.csv"
          templateHeaders={STAFF_TEMPLATE_HEADERS}
          templateExample={STAFF_TEMPLATE_EXAMPLE}
          onImport={async (rows) => {
            const { data } = await client.post('/staff/import', { rows });
            load();
            return data;
          }}
        />
      )}

      {showForm && (
        <div className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          <form onSubmit={handleAdd}>
            {error && <p className="text-absent text-sm mb-4">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-slate2 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="TEACHING">Teaching staff</option>
                  <option value="NON_TEACHING">Non-teaching staff</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Employee ID</label>
                {useCustomId ? (
                  <input
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                    placeholder="e.g. EMP-010"
                  />
                ) : (
                  <input
                    disabled
                    value={previewEmployeeId(form.category)}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-ink/5 text-slate2"
                  />
                )}
                {!editingId && (
                  <button
                    type="button"
                    onClick={() => setUseCustomId((v) => !v)}
                    className="text-xs text-slate2 hover:underline mt-1"
                  >
                    {useCustomId ? 'Auto-generate instead' : 'Enter a specific ID instead'}
                  </button>
                )}
              </div>
              <Field label="First name" value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} required />
              <Field label="Last name" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} required />
              <Field label="Designation" value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} required placeholder="e.g. Mathematics Teacher, Exam Incharge" />
              <Field label="Department" value={form.department} onChange={(v) => setForm({ ...form, department: v })} />
              <div>
                <label className="block text-sm text-slate2 mb-1">Employment type</label>
                <select
                  value={form.employmentType}
                  onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                </select>
              </div>
              {editingId && (
                <div>
                  <label className="block text-sm text-slate2 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
              )}
              <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
              <Field label="Qualifications" value={form.qualifications} onChange={(v) => setForm({ ...form, qualifications: v })} />
            </div>

            {/* ---------- Login / role / class incharge / modules ---------- */}
            <div className="mt-6 pt-6 border-t border-ink/10">
              <p className="text-sm font-medium text-ink mb-1">System access</p>

              {existingUser ? (
                <p className="text-xs text-slate2 mb-4">
                  Login role: <span className="font-mono">{existingUser.role}</span>
                  {' — '}
                  {existingUser.email || existingUser.phone}
                </p>
              ) : (
                <p className="text-xs text-slate2 mb-4">
                  Optionally give this person a login and decide what they can access.
                  Leave "No login" if they don't need to sign in.
                </p>
              )}

              {accessError && <p className="text-absent text-sm mb-3">{accessError}</p>}
              {accessMsg && <p className="text-present text-sm mb-3">{accessMsg}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-slate2 mb-1">Role</label>
                  <select
                    value={access.loginRole}
                    disabled={!!existingUser}
                    onChange={(e) => setAccess({ ...access, loginRole: e.target.value, modules: [] })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white disabled:bg-ink/5 disabled:text-slate2"
                  >
                    <option value="">No login</option>
                    <option value="TEACHER">Teacher</option>
                    <option value="ACCOUNTANT">Accountant</option>
                    <option value="STAFF">Staff (Coordinator / Incharge)</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>

                {!existingUser && access.loginRole && (
                  <div>
                    <label className="block text-sm text-slate2 mb-1">Temporary password</label>
                    <input
                      required
                      type="text"
                      minLength={6}
                      value={access.password}
                      onChange={(e) => setAccess({ ...access, password: e.target.value })}
                      placeholder="At least 6 characters"
                      className="w-full border border-ink/20 rounded-md px-3 py-2"
                    />
                  </div>
                )}

                {!existingUser && access.loginRole === 'TEACHER' && !form.phone && (
                  <p className="text-xs text-absent self-end pb-2">
                    Add a phone number above — teacher logins use it to sign in.
                  </p>
                )}
                {!existingUser && access.loginRole && access.loginRole !== 'TEACHER' && !form.email && (
                  <p className="text-xs text-absent self-end pb-2">
                    Add an email above — this role signs in with email.
                  </p>
                )}

                {showClassPicker && (
                  <>
                    <div>
                      <label className="block text-sm text-slate2 mb-1">Class incharge of</label>
                      <select
                        value={access.classId}
                        onChange={(e) => setAccess({ ...access, classId: e.target.value, section: '' })}
                        className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                      >
                        <option value="">— None —</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    {access.classId && sectionOptions.length > 0 && (
                      <div>
                        <label className="block text-sm text-slate2 mb-1">Section</label>
                        <select
                          value={access.section}
                          onChange={(e) => setAccess({ ...access, section: e.target.value })}
                          className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                        >
                          <option value="">— Whole class —</option>
                          {sectionOptions.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>

              {showModules && (
                <div className="mt-4">
                  <label className="block text-sm text-slate2 mb-2">Module access</label>
                  {Object.keys(presets).length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {Object.keys(presets).map((presetKey) => (
                        <button
                          key={presetKey}
                          type="button"
                          onClick={() => applyPreset(presetKey)}
                          className="text-xs px-3 py-1.5 rounded-full border border-ink/20 hover:bg-paper"
                        >
                          Preset: {presetKey.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                    {allModules.map((moduleKey) => (
                      <label key={moduleKey} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={access.modules.includes(moduleKey)}
                          onChange={() => toggleModule(moduleKey)}
                        />
                        {MODULE_LABELS[moduleKey] || moduleKey}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {existingUser && (
                <div className="flex flex-wrap items-center gap-3 mt-5">
                  <button
                    type="button"
                    onClick={handleSaveAccess}
                    disabled={savingAccess}
                    className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
                  >
                    {savingAccess ? 'Saving…' : 'Save access changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((v) => !v)}
                    className="text-sm text-ink hover:underline"
                  >
                    {showResetPassword ? 'Cancel reset' : 'Reset password'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLogin}
                    disabled={removingLogin}
                    className="text-sm text-absent hover:underline disabled:opacity-50"
                  >
                    {removingLogin ? 'Removing…' : 'Remove login'}
                  </button>
                </div>
              )}

              {showResetPassword && (
                <div className="flex items-end gap-3 mt-3">
                  <div>
                    <label className="block text-sm text-slate2 mb-1">New password</label>
                    <input
                      type="text"
                      minLength={6}
                      value={resetPasswordValue}
                      onChange={(e) => setResetPasswordValue(e.target.value)}
                      placeholder="At least 6 characters"
                      className="border border-ink/20 rounded-md px-3 py-2"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={savingAccess || resetPasswordValue.length < 6}
                    className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Save new password
                  </button>
                </div>
              )}
            </div>

            <button type="submit" disabled={saving} className="mt-6 text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save staff record'}
            </button>
          </form>
        </div>
      )}

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Login</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={7}>Loading…</td></tr>
            ) : staff.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={7}>No staff records yet.</td></tr>
            ) : (
              staff.map((s) => (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{s.employeeId}</td>
                  <td className="px-4 py-3">{s.firstName} {s.lastName}</td>
                  <td className="px-4 py-3 text-slate2">{s.designation}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.category === 'TEACHING' ? 'bg-brass/10 text-brass-dark' : 'bg-slate2/10 text-slate2'}`}>
                      {s.category === 'TEACHING' ? 'Teaching' : 'Non-teaching'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate2 font-mono text-xs">
                    {s.user ? s.user.role : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.status === 'ACTIVE' ? 'bg-present/10 text-present' : 'bg-slate2/10 text-slate2'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                    <button onClick={() => openEditForm(s)} className="text-xs text-ink hover:underline">Edit</button>
                    <button
                      onClick={() => handleDelete(s.id, `${s.firstName} ${s.lastName}`)}
                      disabled={deletingId === s.id}
                      className="text-xs text-absent hover:underline disabled:opacity-50"
                    >
                      {deletingId === s.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div>
      <label className="block text-sm text-slate2 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
      />
    </div>
  );
}
