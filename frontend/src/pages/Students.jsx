import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import CSVImportPanel from '../components/CSVImportPanel';
import { sectionsFor, sectionsForMany } from '../utils/sections';

// These are the exact column headers the school's own records use.
// The mapping below translates them to the internal field names the API
// expects, and splits "Student Name" into first/last name since the app
// needs both for sorting and search even though the sheet has one column.
// No Gender column — every imported student is created as Male, matching
// the "Add student" form (which has no gender field either).
const STUDENT_TEMPLATE_HEADERS = [
  'Admission No.', 'Student Name', 'Father Name', 'Contact No.', 'Date of Birth', 'Class',
  'Section', 'B-Form No.', 'Father CNIC', 'Religion', 'Address', 'Group (9th/10th only)', 'Orphan Status',
];
const STUDENT_TEMPLATE_EXAMPLE = [
  'STU-0010', 'Bilal Ahmed', 'Riaz Ahmed', '0300-1234567', '2014-03-12', '9th',
  'A', '3520112345678', '35201-1234567-8', 'Islam', 'House 12, Street 4, Islamabad', 'Computer', 'None',
];

function splitStudentName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

function mapImportRow(row) {
  const { firstName, lastName } = splitStudentName(row['Student Name']);
  return {
    admissionNumber: row['Admission No.'],
    firstName,
    lastName,
    guardianName: row['Father Name'],
    guardianPhone: row['Contact No.'],
    dateOfBirth: row['Date of Birth'],
    className: row['Class'],
    section: row['Section'],
    bFormNumber: row['B-Form No.'],
    fatherCnic: row['Father CNIC'],
    religion: row['Religion'],
    address: row['Address'],
    studentGroup: row['Group (9th/10th only)'],
    orphanStatus: row['Orphan Status'],
  };
}

const emptyForm = {
  admissionNumber: '',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: 'MALE', // no field in the Add student form — always submitted as Male
  classId: '',
  section: '',
  rollNumber: '',
  guardianName: '',
  guardianPhone: '',
  fatherCnic: '',
  bFormNumber: '',
  religion: '',
  address: '',
  studentGroup: '',
  orphanStatus: 'NONE',
};

const STATUS_OPTIONS = [
  { value: 'REGULAR', label: 'Regular' },
  { value: 'STRUCK_OFF', label: 'Struck Off' },
  { value: 'SLC', label: 'SLC' },
  { value: 'PASSOUT', label: 'Passout' },
];

export default function Students() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [busRoutes, setBusRoutes] = useState([]);
  const [filters, setFilters] = useState({
    admissionNumber: '',
    name: '',
    guardianName: '',
    classId: '',
    section: '',
    studentGroup: '',
    orphanStatus: '',
    busRouteId: '',
    status: 'REGULAR',
  });
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  // Every field below is independently searchable and they combine with AND —
  // e.g. Class=Grade 6 + Status=SLC returns only Grade 6 students who left.
  async function loadStudents(f = filters) {
    setLoading(true);
    try {
      const params = { pageSize: 500 };
      Object.entries(f).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const { data } = await client.get('/students', { params });
      setStudents(data.students);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents();
    client.get('/classes').then((res) => setClasses(res.data));
    client.get('/bus/routes').then((res) => setBusRoutes(res.data));
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    loadStudents(filters);
  }

  // Text fields (Admission No., Name, Father Name) only apply on Search submit,
  // matching the search box's old behavior. Dropdowns apply immediately.
  function updateTextFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function updateDropdownFilter(key, value) {
    setFilters((f) => {
      const next = { ...f, [key]: value };
      loadStudents(next);
      return next;
    });
  }

  function clearFilters() {
    const cleared = {
      admissionNumber: '', name: '', guardianName: '',
      classId: '', section: '', studentGroup: '', orphanStatus: '', busRouteId: '', status: 'REGULAR',
    };
    setFilters(cleared);
    loadStudents(cleared);
  }

  // Sections shown in the filter dropdown come from each class's own
  // "sections" list (e.g. "A,B,C"). With no class selected, show every
  // section across all classes, de-duplicated; once a class is picked,
  // narrow to just that class's sections.
  const sectionOptions = sectionsForMany(classes, filters.classId ? [filters.classId] : []);

  // Changing the class can invalidate a previously-selected section
  // (e.g. switching from a class with sections A/B to one with only C),
  // so drop the section filter whenever the class changes.
  function updateClassFilter(classId) {
    setFilters((f) => {
      const next = { ...f, classId, section: '' };
      loadStudents(next);
      return next;
    });
  }

  const [withdrawalModal, setWithdrawalModal] = useState(null); // { studentId, studentName, status }
  const [withdrawalForm, setWithdrawalForm] = useState({ withdrawalDate: '', reason: '', transferCertIssued: false, remarks: '' });

  // --- Individual class/section edit (quick action) ---
  const [editModal, setEditModal] = useState(null); // { studentId, studentName }
  const [editForm, setEditForm] = useState({ classId: '', section: '', rollNumber: '' });

  // --- Full student edit (name, DOB, father details, etc.) ---
  const [fullEditModal, setFullEditModal] = useState(null); // { studentId }
  const [fullEditForm, setFullEditForm] = useState(null);

  function openFullEditModal(s) {
    setFullEditModal({ studentId: s.id });
    setFullEditForm({
      firstName: s.firstName || '',
      lastName: s.lastName || '',
      gender: s.gender || 'MALE',
      dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '',
      classId: s.classId || '',
      section: s.section || '',
      rollNumber: s.rollNumber || '',
      guardianName: s.guardianName || '',
      guardianPhone: s.guardianPhone || '',
      fatherCnic: s.fatherCnic || '',
      bFormNumber: s.bFormNumber || '',
      religion: s.religion || '',
      address: s.address || '',
      studentGroup: s.studentGroup || '',
      orphanStatus: s.orphanStatus || 'NONE',
    });
    setError('');
  }

  async function submitFullEdit(e) {
    e.preventDefault();
    if (!fullEditModal) return;
    setSavingId(fullEditModal.studentId);
    setError('');
    try {
      await client.put(`/students/${fullEditModal.studentId}`, fullEditForm);
      setFullEditModal(null);
      setFullEditForm(null);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this student.');
    } finally {
      setSavingId(null);
    }
  }

  // --- Re-admission: a student who left before, rejoining with a new
  // admission number, linked back to their old record for history ---
  const [readmitModal, setReadmitModal] = useState(null); // { studentId, studentName }
  const [readmitForm, setReadmitForm] = useState({ admissionNumber: '', classId: '', section: '', rollNumber: '' });

  function openReadmitModal(s) {
    setReadmitModal({ studentId: s.id, studentName: `${s.firstName} ${s.lastName}` });
    setReadmitForm({ admissionNumber: '', classId: s.classId || '', section: '', rollNumber: '' });
    setError('');
  }

  async function submitReadmit(e) {
    e.preventDefault();
    if (!readmitModal) return;
    setSavingId(readmitModal.studentId);
    setError('');
    try {
      await client.post(`/students/${readmitModal.studentId}/readmit`, readmitForm);
      setReadmitModal(null);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not re-admit this student.');
    } finally {
      setSavingId(null);
    }
  }

  function openEditModal(s) {
    setEditModal({ studentId: s.id, studentName: `${s.firstName} ${s.lastName}` });
    setEditForm({ classId: s.classId || '', section: s.section || '', rollNumber: s.rollNumber || '' });
    setError('');
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editModal) return;
    setSavingId(editModal.studentId);
    setError('');
    try {
      await client.put(`/students/${editModal.studentId}`, editForm);
      setEditModal(null);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this student.');
    } finally {
      setSavingId(null);
    }
  }

  // --- Bulk class/section move (e.g. promoting a whole class at year-end) ---
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMove, setBulkMove] = useState({ classId: '', section: '', clearSection: false });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size === students.length) return new Set();
      return new Set(students.map((s) => s.id));
    });
  }

  async function handleBulkMove(e) {
    e.preventDefault();
    if (selectedIds.size === 0 || !bulkMove.classId) return;
    setBulkSaving(true);
    setError('');
    setBulkMessage('');
    try {
      const payload = { studentIds: Array.from(selectedIds), classId: bulkMove.classId };
      // Only send `section` if the admin actually wants to set/clear it —
      // otherwise each student keeps whatever section they already had.
      if (bulkMove.section || bulkMove.clearSection) {
        payload.section = bulkMove.clearSection ? '' : bulkMove.section;
      }
      const { data } = await client.post('/students/bulk-move', payload);
      setBulkMessage(`Moved ${data.moved} student(s) to ${data.className}${data.section ? ' - ' + data.section : ''}.`);
      setSelectedIds(new Set());
      setBulkMove({ classId: '', section: '', clearSection: false });
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not move the selected students.');
    } finally {
      setBulkSaving(false);
    }
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function handleStatusChange(studentId, studentName, newStatus) {
    if (newStatus === 'REGULAR') {
      handleReactivate(studentId);
      return;
    }
    // Exit statuses (STRUCK_OFF/SLC/PASSOUT) need a date and reason recorded
    // as a proper Withdrawal record, not just a silent status flip.
    setWithdrawalForm({ withdrawalDate: todayISO(), reason: '', transferCertIssued: false, remarks: '' });
    setWithdrawalModal({ studentId, studentName, status: newStatus });
  }

  async function submitWithdrawal(e) {
    e.preventDefault();
    if (!withdrawalModal) return;
    setSavingId(withdrawalModal.studentId);
    setError('');
    try {
      await client.post('/admissions/withdrawals', {
        studentId: withdrawalModal.studentId,
        status: withdrawalModal.status,
        ...withdrawalForm,
      });
      setWithdrawalModal(null);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record this exit.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleReactivate(studentId) {
    if (!window.confirm('Move this student back to Regular status? This clears their recorded exit date/reason.')) return;
    setSavingId(studentId);
    setError('');
    try {
      await client.delete(`/admissions/withdrawals/${studentId}`);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reactivate this student.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleBusRouteChange(studentId, busRouteId) {
    setSavingId(studentId);
    setError('');
    try {
      await client.post('/bus/assign', { studentId, busRouteId: busRouteId || null });
      loadStudents(filters);
    } catch (err) {
      // The dropdown is driven by the saved value, so it snaps back on its own;
      // this just says why, instead of leaving the user guessing.
      setError(err.response?.data?.error || 'Could not change this student\'s bus route.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(studentId, studentName) {
    if (!window.confirm(`Permanently delete ${studentName}? This cannot be undone. If they have attendance, exam, or bus payment history, use "Struck Off" / "SLC" status instead of deleting.`)) {
      return;
    }
    setSavingId(studentId);
    setError('');
    try {
      await client.delete(`/students/${studentId}`);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this student — they likely have linked attendance, exam, or bus payment records. Use "Struck Off" or "SLC" status instead.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await client.post('/students', form);
      setForm(emptyForm);
      setShowForm(false);
      loadStudents(filters);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this student. Check the details and try again.');
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Module 01"
        title="Students"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => { setShowImport((v) => !v); setShowForm(false); }}
              className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
            >
              {showImport ? 'Cancel' : 'Import CSV'}
            </button>
            <button
              onClick={() => { setShowForm((v) => !v); setShowImport(false); }}
              className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
            >
              {showForm ? 'Cancel' : '+ Add student'}
            </button>
          </div>
        }
      />

      <p className="text-sm text-slate2 -mt-4 mb-6">
        Search or filter by any field below — admission number, name, father name, class, section, group, orphan status, bus route, and status all combine together.
      </p>

      {error && !showForm && <p className="text-absent text-sm mb-4">{error}</p>}

      {showImport && (
        <CSVImportPanel
          title="Import students from CSV"
          templateFilename="students_template.csv"
          templateHeaders={STUDENT_TEMPLATE_HEADERS}
          templateExample={STUDENT_TEMPLATE_EXAMPLE}
          onImport={async (rows) => {
            const mappedRows = rows.map(mapImportRow);
            const { data } = await client.post('/students/import', { rows: mappedRows });
            loadStudents(filters);
            return data;
          }}
        />
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          {error && <p className="text-absent text-sm mb-4">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Admission number" value={form.admissionNumber} onChange={(v) => setForm({ ...form, admissionNumber: v })} required />
            <Field label="First name" value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} required />
            <Field label="Last name" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} required />
            <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} required />
            <div>
              <label className="block text-sm text-slate2 mb-1">Class</label>
              <select
                value={form.classId}
                onChange={(e) => setForm({ ...form, classId: e.target.value })}
                required
                className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
              >
                <option value="">Select class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <Field label="Section" value={form.section} onChange={(v) => setForm({ ...form, section: v })} />
            <Field label="Roll number" value={form.rollNumber} onChange={(v) => setForm({ ...form, rollNumber: v })} />
            <Field label="Father name" value={form.guardianName} onChange={(v) => setForm({ ...form, guardianName: v })} required />
            <Field label="Contact No." value={form.guardianPhone} onChange={(v) => setForm({ ...form, guardianPhone: v })} placeholder="0300-1234567" />
            <Field label="Father CNIC" value={form.fatherCnic} onChange={(v) => setForm({ ...form, fatherCnic: v })} placeholder="35201-1234567-8" />
            <Field label="B-Form No." value={form.bFormNumber} onChange={(v) => setForm({ ...form, bFormNumber: v })} />
            <Field label="Religion" value={form.religion} onChange={(v) => setForm({ ...form, religion: v })} />
            <div>
              <label className="block text-sm text-slate2 mb-1">Group (9th/10th only)</label>
              <select
                value={form.studentGroup}
                onChange={(e) => setForm({ ...form, studentGroup: e.target.value })}
                className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
              >
                <option value="">Not applicable</option>
                <option value="COMPUTER">Computer Science</option>
                <option value="BIOLOGY">Biology</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Orphan status</label>
              <select
                value={form.orphanStatus}
                onChange={(e) => setForm({ ...form, orphanStatus: e.target.value })}
                className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
              >
                <option value="NONE">Not an orphan</option>
                <option value="SINGLE">Single orphan</option>
                <option value="DOUBLE">Double orphan</option>
              </select>
            </div>
            <Field label="Address" value={form.address || ''} onChange={(v) => setForm({ ...form, address: v })} />
          </div>
          <button type="submit" className="mt-5 text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">
            Save student
          </button>
        </form>
      )}

      <form onSubmit={handleSearch} className="mb-5 bg-white border border-ink/10 rounded-lg p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
          <div>
            <label className="block text-xs text-slate2 mb-1">Admission No.</label>
            <input
              value={filters.admissionNumber}
              onChange={(e) => updateTextFilter('admissionNumber', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Name</label>
            <input
              value={filters.name}
              onChange={(e) => updateTextFilter('name', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Father Name</label>
            <input
              value={filters.guardianName}
              onChange={(e) => updateTextFilter('guardianName', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Class</label>
            <select
              value={filters.classId}
              onChange={(e) => updateClassFilter(e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              <option value="">All</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Section</label>
            <select
              value={filters.section}
              onChange={(e) => updateDropdownFilter('section', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              <option value="">All</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Group</label>
            <select
              value={filters.studentGroup}
              onChange={(e) => updateDropdownFilter('studentGroup', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              <option value="">All</option>
              <option value="COMPUTER">Computer Science</option>
              <option value="BIOLOGY">Biology</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Orphan</label>
            <select
              value={filters.orphanStatus}
              onChange={(e) => updateDropdownFilter('orphanStatus', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              <option value="">All</option>
              <option value="NONE">Not an orphan</option>
              <option value="SINGLE">Single orphan</option>
              <option value="DOUBLE">Double orphan</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Bus Route</label>
            <select
              value={filters.busRouteId}
              onChange={(e) => updateDropdownFilter('busRouteId', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              <option value="">All</option>
              {busRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => updateDropdownFilter('status', e.target.value)}
              className="w-full border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="submit" className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
            Search
          </button>
          <button type="button" onClick={clearFilters} className="text-sm px-4 py-2 rounded-md text-slate2 hover:underline">
            Clear filters
          </button>
        </div>
      </form>

      {selectedIds.size > 0 && (
        <form onSubmit={handleBulkMove} className="mb-5 bg-brass/10 border border-brass/30 rounded-lg p-4 flex flex-wrap items-end gap-3">
          <p className="text-sm font-medium text-ink w-full sm:w-auto">
            {selectedIds.size} student{selectedIds.size > 1 ? 's' : ''} selected
          </p>
          <div>
            <label className="block text-xs text-slate2 mb-1">Move to class</label>
            <select
              required
              value={bulkMove.classId}
              onChange={(e) => setBulkMove({ ...bulkMove, classId: e.target.value })}
              className="border border-ink/20 rounded-md px-2 py-2 text-sm bg-white"
            >
              <option value="">Select class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate2 mb-1">Section</label>
            <input
              value={bulkMove.section}
              disabled={bulkMove.clearSection}
              onChange={(e) => setBulkMove({ ...bulkMove, section: e.target.value })}
              placeholder="Leave blank to keep as-is"
              className="border border-ink/20 rounded-md px-2 py-2 text-sm bg-white disabled:opacity-50 disabled:bg-slate2/10"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate2 pb-2">
            <input
              type="checkbox"
              checked={bulkMove.clearSection}
              onChange={(e) => setBulkMove({ ...bulkMove, clearSection: e.target.checked, section: '' })}
            />
            Clear section
          </label>
          <button type="submit" disabled={bulkSaving} className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50">
            {bulkSaving ? 'Moving…' : `Move ${selectedIds.size} student${selectedIds.size > 1 ? 's' : ''}`}
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm px-3 py-2 text-slate2 hover:underline">
            Clear selection
          </button>
        </form>
      )}
      {bulkMessage && <p className="text-present text-sm mb-4">{bulkMessage}</p>}

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm min-w-[1200px]">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={students.length > 0 && selectedIds.size === students.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="px-4 py-3">S.No.</th>
              <th className="px-4 py-3">Admission No.</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Father Name</th>
              <th className="px-4 py-3">Orphan</th>
              <th className="px-4 py-3">Bus Route</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Exit Date</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={12}>Loading…</td></tr>
            ) : students.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={12}>No students found.</td></tr>
            ) : (
              students.map((s, idx) => (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} />
                  </td>
                  <td className="px-4 py-3 text-slate2">{idx + 1}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {s.admissionNumber}
                    {s.previousStudent && (
                      <div className="text-slate2 font-sans normal-case mt-0.5">
                        Previously: {s.previousStudent.admissionNumber}
                      </div>
                    )}
                    {s.readmittedAs?.length > 0 && (
                      <div className="text-slate2 font-sans normal-case mt-0.5">
                        Re-admitted as: {s.readmittedAs.map((r) => r.admissionNumber).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{s.firstName} {s.lastName}</td>
                  <td className="px-4 py-3 text-slate2">{s.class?.name} {s.section}</td>
                  <td className="px-4 py-3 text-slate2">
                    {s.studentGroup === 'COMPUTER' ? 'Computer Science' : s.studentGroup === 'BIOLOGY' ? 'Biology' : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate2">{s.guardianName}</td>
                  <td className="px-4 py-3">
                    {s.orphanStatus === 'DOUBLE' ? (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-absent/10 text-absent">Double</span>
                    ) : s.orphanStatus === 'SINGLE' ? (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-late/10 text-late">Single</span>
                    ) : (
                      <span className="text-slate2">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={s.busRouteId || ''}
                      disabled={savingId === s.id}
                      onChange={(e) => handleBusRouteChange(s.id, e.target.value)}
                      className="text-xs border border-ink/20 rounded-md px-2 py-1 bg-white disabled:opacity-50"
                    >
                      <option value="">Not on bus</option>
                      {busRoutes.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={s.status}
                      disabled={savingId === s.id}
                      onChange={(e) => handleStatusChange(s.id, `${s.firstName} ${s.lastName}`, e.target.value)}
                      className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer disabled:opacity-50 ${statusPillClasses(s.status)}`}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate2 text-xs">
                    {s.status !== 'REGULAR' && s.withdrawal?.withdrawalDate
                      ? new Date(s.withdrawal.withdrawalDate).toLocaleDateString()
                      : s.status !== 'REGULAR' ? '—' : ''}
                  </td>
                  <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                    <button
                      onClick={() => openFullEditModal(s)}
                      disabled={savingId === s.id}
                      className="text-xs text-ink hover:underline disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => openEditModal(s)}
                      disabled={savingId === s.id}
                      className="text-xs text-ink hover:underline disabled:opacity-50"
                    >
                      Edit class
                    </button>
                    {s.status !== 'REGULAR' && (
                      <button
                        onClick={() => openReadmitModal(s)}
                        disabled={savingId === s.id}
                        className="text-xs text-present hover:underline disabled:opacity-50"
                      >
                        Re-admit
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(s.id, `${s.firstName} ${s.lastName}`)}
                      disabled={savingId === s.id}
                      className="text-xs text-absent hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {withdrawalModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={submitWithdrawal}
            className="bg-white border border-ink/10 rounded-lg p-6 w-full max-w-md"
          >
            <h3 className="text-sm font-medium text-ink mb-1">
              Mark {withdrawalModal.studentName} as {STATUS_OPTIONS.find((o) => o.value === withdrawalModal.status)?.label}
            </h3>
            <p className="text-xs text-slate2 mb-4">This records an exit date and reason for the student's file.</p>

            <div className="grid grid-cols-1 gap-3 mb-4">
              <Field
                label="Date"
                type="date"
                value={withdrawalForm.withdrawalDate}
                onChange={(v) => setWithdrawalForm({ ...withdrawalForm, withdrawalDate: v })}
                required
              />
              <Field
                label="Reason"
                value={withdrawalForm.reason}
                onChange={(v) => setWithdrawalForm({ ...withdrawalForm, reason: v })}
                required
                placeholder="e.g. Family relocated, Completed matriculation…"
              />
              <label className="flex items-center gap-2 text-sm text-slate2">
                <input
                  type="checkbox"
                  checked={withdrawalForm.transferCertIssued}
                  onChange={(e) => setWithdrawalForm({ ...withdrawalForm, transferCertIssued: e.target.checked })}
                />
                Transfer certificate issued
              </label>
              <Field
                label="Remarks (optional)"
                value={withdrawalForm.remarks}
                onChange={(v) => setWithdrawalForm({ ...withdrawalForm, remarks: v })}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setWithdrawalModal(null)}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingId === withdrawalModal.studentId}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {editModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={submitEdit}
            className="bg-white border border-ink/10 rounded-lg p-6 w-full max-w-md"
          >
            <h3 className="text-sm font-medium text-ink mb-1">
              Change class/section for {editModal.studentName}
            </h3>
            <p className="text-xs text-slate2 mb-4">Updates this student's class, section, and roll number only.</p>

            <div className="grid grid-cols-1 gap-3 mb-4">
              <div>
                <label className="block text-sm text-slate2 mb-1">Class</label>
                <select
                  required
                  value={editForm.classId}
                  onChange={(e) => setEditForm({ ...editForm, classId: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="">Select class</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Field
                label="Section"
                value={editForm.section}
                onChange={(v) => setEditForm({ ...editForm, section: v })}
              />
              <Field
                label="Roll number"
                value={editForm.rollNumber}
                onChange={(v) => setEditForm({ ...editForm, rollNumber: v })}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingId === editModal.studentId}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {fullEditModal && fullEditForm && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <form
            onSubmit={submitFullEdit}
            className="bg-white border border-ink/10 rounded-lg p-6 w-full max-w-2xl my-8"
          >
            <h3 className="text-sm font-medium text-ink mb-4">Edit student details</h3>
            {error && <p className="text-absent text-sm mb-4">{error}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name" value={fullEditForm.firstName} onChange={(v) => setFullEditForm({ ...fullEditForm, firstName: v })} required />
              <Field label="Last name" value={fullEditForm.lastName} onChange={(v) => setFullEditForm({ ...fullEditForm, lastName: v })} required />

              <div>
                <label className="block text-sm text-slate2 mb-1">Gender</label>
                <select
                  value={fullEditForm.gender}
                  onChange={(e) => setFullEditForm({ ...fullEditForm, gender: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <Field label="Date of birth" type="date" value={fullEditForm.dateOfBirth} onChange={(v) => setFullEditForm({ ...fullEditForm, dateOfBirth: v })} />

              <div>
                <label className="block text-sm text-slate2 mb-1">Class</label>
                <select
                  required
                  value={fullEditForm.classId}
                  onChange={(e) => setFullEditForm({ ...fullEditForm, classId: e.target.value, section: '' })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="">Select class</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {sectionsFor(classes, fullEditForm.classId).length > 0 ? (
                <div>
                  <label className="block text-sm text-slate2 mb-1">Section</label>
                  <select
                    value={fullEditForm.section}
                    onChange={(e) => setFullEditForm({ ...fullEditForm, section: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="">— None —</option>
                    {sectionsFor(classes, fullEditForm.classId).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ) : (
                <Field label="Section" value={fullEditForm.section} onChange={(v) => setFullEditForm({ ...fullEditForm, section: v })} />
              )}
              <Field label="Roll number" value={fullEditForm.rollNumber} onChange={(v) => setFullEditForm({ ...fullEditForm, rollNumber: v })} />

              <Field label="Father name" value={fullEditForm.guardianName} onChange={(v) => setFullEditForm({ ...fullEditForm, guardianName: v })} required />
              <Field label="Father phone" value={fullEditForm.guardianPhone} onChange={(v) => setFullEditForm({ ...fullEditForm, guardianPhone: v })} />
              <Field label="Father CNIC" value={fullEditForm.fatherCnic} onChange={(v) => setFullEditForm({ ...fullEditForm, fatherCnic: v })} />
              <Field label="B-Form number" value={fullEditForm.bFormNumber} onChange={(v) => setFullEditForm({ ...fullEditForm, bFormNumber: v })} />
              <Field label="Religion" value={fullEditForm.religion} onChange={(v) => setFullEditForm({ ...fullEditForm, religion: v })} />

              <div>
                <label className="block text-sm text-slate2 mb-1">Group (9th/10th only)</label>
                <select
                  value={fullEditForm.studentGroup}
                  onChange={(e) => setFullEditForm({ ...fullEditForm, studentGroup: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="">— Not applicable —</option>
                  <option value="COMPUTER">Computer Science</option>
                  <option value="BIOLOGY">Biology</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate2 mb-1">Orphan status</label>
                <select
                  value={fullEditForm.orphanStatus}
                  onChange={(e) => setFullEditForm({ ...fullEditForm, orphanStatus: e.target.value })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="NONE">None</option>
                  <option value="SINGLE">Single (one parent deceased)</option>
                  <option value="DOUBLE">Double (both parents deceased)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <Field label="Address" value={fullEditForm.address} onChange={(v) => setFullEditForm({ ...fullEditForm, address: v })} />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button
                type="button"
                onClick={() => { setFullEditModal(null); setFullEditForm(null); }}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingId === fullEditModal.studentId}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingId === fullEditModal.studentId ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {readmitModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={submitReadmit}
            className="bg-white border border-ink/10 rounded-lg p-6 w-full max-w-md"
          >
            <h3 className="text-sm font-medium text-ink mb-1">Re-admit {readmitModal.studentName}</h3>
            <p className="text-xs text-slate2 mb-4">
              Creates a new student record with a new admission number, linked back to this student's
              old record so their previous history stays intact and traceable.
            </p>
            {error && <p className="text-absent text-sm mb-4">{error}</p>}

            <div className="grid grid-cols-1 gap-3 mb-4">
              <Field
                label="New admission number"
                value={readmitForm.admissionNumber}
                onChange={(v) => setReadmitForm({ ...readmitForm, admissionNumber: v })}
                required
              />
              <div>
                <label className="block text-sm text-slate2 mb-1">Class</label>
                <select
                  required
                  value={readmitForm.classId}
                  onChange={(e) => setReadmitForm({ ...readmitForm, classId: e.target.value, section: '' })}
                  className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                >
                  <option value="">Select class</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {sectionsFor(classes, readmitForm.classId).length > 0 ? (
                <div>
                  <label className="block text-sm text-slate2 mb-1">Section</label>
                  <select
                    value={readmitForm.section}
                    onChange={(e) => setReadmitForm({ ...readmitForm, section: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="">— None —</option>
                    {sectionsFor(classes, readmitForm.classId).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ) : (
                <Field label="Section" value={readmitForm.section} onChange={(v) => setReadmitForm({ ...readmitForm, section: v })} />
              )}
              <Field label="Roll number" value={readmitForm.rollNumber} onChange={(v) => setReadmitForm({ ...readmitForm, rollNumber: v })} />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setReadmitModal(null)}
                className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingId === readmitModal.studentId}
                className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingId === readmitModal.studentId ? 'Saving…' : 'Re-admit'}
              </button>
            </div>
          </form>
        </div>
      )}
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

function statusPillClasses(status) {
  const colors = {
    REGULAR: 'bg-present/10 text-present',
    STRUCK_OFF: 'bg-absent/10 text-absent',
    SLC: 'bg-ink/10 text-ink',
    PASSOUT: 'bg-brass/10 text-brass-dark',
  };
  return colors[status] || '';
}
