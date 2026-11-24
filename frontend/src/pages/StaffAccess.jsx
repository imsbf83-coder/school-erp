import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';

// Friendlier labels for each module key than the raw constant — purely
// cosmetic, doesn't need to match backend/src/utils/permissions.js exactly
// as long as the KEY sent back on save does.
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
};

export default function StaffAccess() {
  const [staffList, setStaffList] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [presets, setPresets] = useState({});
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedModules, setSelectedModules] = useState([]);
  const [currentInfo, setCurrentInfo] = useState(null); // { id, name, role }
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/staff').then((res) => setStaffList(res.data));
    client.get('/staff-access/modules').then((res) => {
      setAllModules(res.data.modules);
      setPresets(res.data.presets || {});
    });
  }, []);

  // Only staff who already have a login account can be granted module
  // access here — a staff record with no linked User has nothing for a
  // permission to attach to (see Teacher Access for creating that login
  // first). ADMIN accounts are excluded too since they already have full
  // access unconditionally and the backend rejects assigning modules to
  // them anyway.
  const assignable = staffList.filter((s) => s.user && s.user.role !== 'ADMIN');

  function selectStaff(staffId) {
    setSelectedStaffId(staffId);
    setSavedMsg('');
    setError('');
    setCurrentInfo(null);
    setSelectedModules([]);

    const staff = assignable.find((s) => String(s.id) === String(staffId));
    if (!staff) return;

    setLoading(true);
    client
      .get(`/staff-access/${staff.user.id}`)
      .then((res) => {
        setCurrentInfo({ userId: res.data.id, name: res.data.name, role: res.data.role });
        setSelectedModules(res.data.modules);
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load this account\'s access.'))
      .finally(() => setLoading(false));
  }

  function toggleModule(moduleKey) {
    setSelectedModules((prev) =>
      prev.includes(moduleKey) ? prev.filter((m) => m !== moduleKey) : [...prev, moduleKey]
    );
  }

  function applyPreset(presetKey) {
    setSelectedModules(presets[presetKey] || []);
  }

  async function handleSave() {
    if (!currentInfo) return;
    setSaving(true);
    setSavedMsg('');
    setError('');
    try {
      await client.put(`/staff-access/${currentInfo.userId}`, { modules: selectedModules });
      setSavedMsg('Saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Staff Access"
        action={null}
      />

      <p className="text-sm text-slate2 mb-6 max-w-2xl">
        Grant a staff member (or a teacher with extra duties) access to specific modules —
        e.g. an Exam Incharge who should see Examinations, or an Admission Incharge who
        should see Admission / Withdrawal, without giving them access to everything else.
        This is separate from Teacher Access, which controls which classes a teacher can
        mark attendance and enter results for.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <label className="block text-sm text-slate2 mb-1">Staff member</label>
          <select
            value={selectedStaffId}
            onChange={(e) => selectStaff(e.target.value)}
            className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white"
          >
            <option value="">Select…</option>
            {assignable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName} — {s.designation} ({s.user.role})
              </option>
            ))}
          </select>
          {assignable.length === 0 && (
            <p className="text-xs text-slate2 mt-2">
              No staff with a login account yet — create one via Teacher Access or by linking
              a User account to a staff record first.
            </p>
          )}
        </div>

        <div className="bg-white border border-ink/10 rounded-lg p-6">
          {!selectedStaffId ? (
            <p className="text-slate2 text-sm">Pick a staff member on the left to view or edit their access.</p>
          ) : loading ? (
            <p className="text-slate2 text-sm">Loading…</p>
          ) : (
            <>
              {currentInfo && (
                <div className="mb-4">
                  <p className="font-medium text-ink">{currentInfo.name}</p>
                  <p className="text-xs text-slate2 font-mono">{currentInfo.role}</p>
                </div>
              )}

              {error && <p className="text-absent text-sm mb-4">{error}</p>}

              {Object.keys(presets).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {Object.keys(presets).map((presetKey) => (
                    <button
                      key={presetKey}
                      onClick={() => applyPreset(presetKey)}
                      className="text-xs px-3 py-1.5 rounded-full border border-ink/20 hover:bg-paper"
                    >
                      Preset: {presetKey.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 mb-6">
                {allModules.map((moduleKey) => (
                  <label key={moduleKey} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedModules.includes(moduleKey)}
                      onChange={() => toggleModule(moduleKey)}
                    />
                    {MODULE_LABELS[moduleKey] || moduleKey}
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-sm px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save access'}
                </button>
                {savedMsg && <p className="text-present text-sm">{savedMsg}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
