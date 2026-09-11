import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';

export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', sections: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/classes');
      setClasses(data);
    } finally {
      setLoading(false);
    }
  }

  // Detects classes whose names match once trimmed/case-folded (e.g. two
  // rows that both display as "9"), so the "Merge duplicates" tool only
  // shows up when it's actually needed.
  function findDuplicateNames(list) {
    const seen = new Map();
    const dupes = new Set();
    for (const c of list) {
      const key = c.name.trim().toLowerCase();
      if (seen.has(key)) {
        dupes.add(key);
      } else {
        seen.set(key, true);
      }
    }
    return dupes;
  }
  const duplicateNames = findDuplicateNames(classes);

  async function handleMergeDuplicates() {
    setMerging(true);
    setError('');
    setMessage('');
    try {
      const { data } = await client.post('/classes/merge-duplicates');
      if (data.mergedGroups > 0) {
        const names = data.merges.map((m) => `"${m.name}"`).join(', ');
        setMessage(`Merged ${data.mergedGroups} duplicate class name(s): ${names}.`);
      } else {
        setMessage('No duplicate class names found.');
      }
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not merge duplicate classes.');
    } finally {
      setMerging(false);
    }
  }

  function openAddForm() {
    setEditingId(null);
    setForm({ name: '', sections: '' });
    setError('');
    setMessage('');
    setShowForm(true);
  }

  function openEditForm(c) {
    setEditingId(c.id);
    setForm({ name: c.name, sections: c.sections || '' });
    setError('');
    setMessage('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ name: '', sections: '' });
    setError('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (editingId) {
        await client.put(`/classes/${editingId}`, form);
        closeForm();
      } else {
        // Submitting a name that already exists doesn't fail — the backend
        // merges the new section(s) into that class instead of erroring.
        // Status 201 = new class created, 200 = merged into an existing one.
        const res = await client.post('/classes', form);
        closeForm();
        if (res.status === 200) {
          setMessage(`"${res.data.name}" already existed — added the new section(s) to it (now: ${res.data.sections || '—'}).`);
        }
      }
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this class.');
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      await client.delete(`/classes/${id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this class.');
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Classes"
        action={
          <button onClick={() => (showForm ? closeForm() : openAddForm())} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light">
            {showForm ? 'Cancel' : '+ Add class'}
          </button>
        }
      />

      <p className="text-sm text-slate2 -mt-4 mb-6">
        Set up your school's classes here first — the exact names you use here are what
        the Students page and CSV import will match against (e.g. "9th", "Grade 9", "Class 9" —
        pick one style and use it consistently). To add a new section to a class that already
        exists, just submit the same class name again with the new section(s) — they'll be
        added to that class instead of creating a duplicate.
      </p>

      {message && <p className="text-present text-sm -mt-2 mb-4">{message}</p>}

      {duplicateNames.size > 0 && (
        <div className="bg-late/10 border border-late/30 rounded-lg p-4 mb-6 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink">
            Found {duplicateNames.size} class name{duplicateNames.size > 1 ? 's' : ''} with duplicate rows
            (e.g. two separate rows both named the same thing). This can happen with older data.
          </p>
          <button
            onClick={handleMergeDuplicates}
            disabled={merging}
            className="text-sm px-4 py-2 rounded-md bg-late text-white hover:opacity-90 disabled:opacity-50"
          >
            {merging ? 'Merging…' : 'Merge duplicate classes'}
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-ink/10 rounded-lg p-6 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {error && <p className="text-absent text-sm sm:col-span-2">{error}</p>}
          {editingId && (
            <p className="text-xs text-slate2 sm:col-span-2 -mb-2">
              Editing "{form.name}". Changing the sections list here replaces it entirely.
            </p>
          )}
          <div>
            <label className="block text-sm text-slate2 mb-1">Class name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="e.g. 9th, Grade 9, Class 9" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Sections (comma-separated, optional)</label>
            <input value={form.sections} onChange={(e) => setForm({ ...form, sections: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="A,B,C" />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">
              {editingId ? 'Save changes' : 'Save class'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Sections</th>
              <th className="px-4 py-3">Students</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={4}>Loading…</td></tr>
            ) : classes.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={4}>No classes yet. Add your school's classes above before importing students.</td></tr>
            ) : (
              classes.map((c) => (
                <tr key={c.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-slate2">{c.sections || '—'}</td>
                  <td className="px-4 py-3 text-slate2">{c._count.students}</td>
                  <td className="px-4 py-3 space-x-3">
                    <button onClick={() => openEditForm(c)} className="text-xs text-ink hover:underline">Edit</button>
                    {c._count.students === 0 && (
                      <button onClick={() => handleDelete(c.id)} className="text-xs text-absent hover:underline">Delete</button>
                    )}
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
