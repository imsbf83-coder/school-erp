import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import CSVImportPanel from '../components/CSVImportPanel';

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

const CATEGORY_PREFIX = { TEACHING: 'TCH', NON_TEACHING: 'STF' };

export default function Staff() {
  const [staff, setStaff] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [useCustomId, setUseCustomId] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    load();
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

  // Client-side preview only — a best guess at what the server will assign,
  // based on the highest existing ID with that category's prefix among the
  // currently loaded staff. The real ID is always generated server-side at
  // save time, so this can't cause a collision even if it's briefly stale.
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
    setUseCustomId(false);
    setError('');
    setShowForm(true);
    setShowImport(false);
  }

  function openEditForm(s) {
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
    setUseCustomId(true); // editing always shows the real, editable ID
    setError('');
    setShowForm(true);
    setShowImport(false);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setUseCustomId(false);
    setError('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await client.put(`/staff/${editingId}`, form);
      } else {
        const payload = { ...form };
        if (!useCustomId) delete payload.employeeId;
        await client.post('/staff', payload);
      }
      closeForm();
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this staff record.');
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
      setError(err.response?.data?.error || 'Could not delete this staff record — they may have a linked login account. Unlink it first from Teacher Access.');
    } finally {
      setDeletingId(null);
    }
  }

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
        <form onSubmit={handleAdd} className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
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
            <Field label="Designation" value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} required placeholder="e.g. Mathematics Teacher" />
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
          <button type="submit" className="mt-5 text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">
            {editingId ? 'Save changes' : 'Save staff record'}
          </button>
        </form>
      )}

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Department</th>
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
                  <td className="px-4 py-3 text-slate2">{s.department || '—'}</td>
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
