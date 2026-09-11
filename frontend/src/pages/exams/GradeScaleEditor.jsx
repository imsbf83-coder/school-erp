// The editable grading scale.
//
// A scale is a list of bands, each with an inclusive lower bound: the highest
// band whose `minPercent` a percentage reaches decides the grade. That's why
// one band must start at 0 — otherwise the lowest marks land nowhere.
//
// A scale either covers a range of class numbers ("9-10", matched against the
// number in the class name) or no range at all, which makes it the fallback
// used by every class no ranged scale claims. The narrowest match wins.
//
// Editing is ADMIN-only; everyone else sees the same tables read-only, since
// the broad sheet's grades only make sense next to the scale that produced
// them.

import { useEffect, useState } from 'react';
import client from '../../api/client';

const BLANK_BAND = { grade: '', minPercent: '', gradePoint: '', remarks: '' };

function rangeLabel(scale) {
  if (scale.minGrade === null || scale.minGrade === undefined) return 'Every class';
  if (scale.minGrade === scale.maxGrade) return `Class ${scale.minGrade}`;
  return `Classes ${scale.minGrade}-${scale.maxGrade}`;
}

// The form state for a scale: strings throughout, so a half-typed number
// doesn't get coerced to 0 while it's being edited.
function toDraft(scale) {
  return {
    id: scale?.id ?? null,
    name: scale?.name ?? '',
    minGrade: scale?.minGrade ?? '',
    maxGrade: scale?.maxGrade ?? '',
    bands: (scale?.bands || [{ ...BLANK_BAND }]).map((b) => ({
      grade: b.grade ?? '',
      minPercent: b.minPercent ?? '',
      gradePoint: b.gradePoint ?? '',
      remarks: b.remarks ?? '',
    })),
  };
}

export default function GradeScaleEditor({ canEdit }) {
  const [scales, setScales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // null = not editing
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/grade-scales');
      setScales(data);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setError('');
    setNotice('');
    setDraft(
      toDraft({
        name: '',
        bands: [
          { grade: 'A+', minPercent: 90, gradePoint: 6, remarks: 'Outstanding' },
          { grade: 'A', minPercent: 80, gradePoint: 5, remarks: 'Excellent' },
          { grade: 'B', minPercent: 70, gradePoint: 4, remarks: 'Very Good' },
          { grade: 'C', minPercent: 60, gradePoint: 3, remarks: 'Good' },
          { grade: 'D', minPercent: 50, gradePoint: 2, remarks: 'Fair' },
          { grade: 'E', minPercent: 40, gradePoint: 1, remarks: 'Satisfactory' },
          { grade: 'F', minPercent: 0, gradePoint: 0, remarks: 'Fail' },
        ],
      })
    );
  }

  function updateBand(idx, field, value) {
    setDraft((d) => {
      const bands = [...d.bands];
      bands[idx] = { ...bands[idx], [field]: value };
      return { ...d, bands };
    });
  }

  function addBand() {
    setDraft((d) => ({ ...d, bands: [...d.bands, { ...BLANK_BAND }] }));
  }

  function removeBand(idx) {
    setDraft((d) => ({ ...d, bands: d.bands.filter((_, i) => i !== idx) }));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    const payload = {
      name: draft.name,
      minGrade: draft.minGrade === '' ? null : Number(draft.minGrade),
      maxGrade: draft.maxGrade === '' ? null : Number(draft.maxGrade),
      bands: draft.bands.map((b) => ({
        grade: b.grade,
        minPercent: Number(b.minPercent),
        gradePoint: Number(b.gradePoint),
        remarks: b.remarks,
      })),
    };
    try {
      if (draft.id) await client.put(`/grade-scales/${draft.id}`, payload);
      else await client.post('/grade-scales', payload);
      setDraft(null);
      setNotice(draft.id ? 'Grading scale updated.' : 'Grading scale added.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this grading scale.');
    }
  }

  async function remove(scale) {
    if (!window.confirm(`Delete the "${scale.name}" grading scale?`)) return;
    setError('');
    setNotice('');
    try {
      await client.delete(`/grade-scales/${scale.id}`);
      if (draft?.id === scale.id) setDraft(null);
      setNotice('Grading scale deleted.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this grading scale.');
    }
  }

  return (
    <div>
      {!canEdit && (
        <p className="text-sm text-slate2 mb-4">
          These are the scales used to grade exam results. Only an administrator can change them.
        </p>
      )}
      {error && <p className="text-absent text-sm mb-4">{error}</p>}
      {notice && <p className="text-present text-sm mb-4">{notice}</p>}

      {canEdit && !draft && (
        <button onClick={startNew} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light mb-6">
          + New grading scale
        </button>
      )}

      {draft && (
        <form onSubmit={save} className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate2 mb-1">Scale name</label>
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full border border-ink/20 rounded-md px-3 py-2"
                placeholder="Classes 9-10"
              />
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Lowest class</label>
              <input
                type="number"
                value={draft.minGrade}
                onChange={(e) => setDraft({ ...draft, minGrade: e.target.value })}
                className="w-full border border-ink/20 rounded-md px-3 py-2"
                placeholder="9"
              />
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Highest class</label>
              <input
                type="number"
                value={draft.maxGrade}
                onChange={(e) => setDraft({ ...draft, maxGrade: e.target.value })}
                className="w-full border border-ink/20 rounded-md px-3 py-2"
                placeholder="10"
              />
            </div>
          </div>
          <p className="text-xs text-slate2 mb-4">
            Leave both class numbers blank to make this the scale for every class that no other scale covers. The
            narrowest matching range wins, so a 9-10 scale takes precedence over the all-classes one for Class 9.
          </p>

          <p className="text-sm font-medium text-ink mb-2">Bands</p>
          <div className="hidden sm:grid grid-cols-12 gap-3 text-xs text-slate2 mb-1">
            <span className="col-span-2">Grade</span>
            <span className="col-span-3">From % (inclusive)</span>
            <span className="col-span-2">Grade point</span>
            <span className="col-span-4">Remarks</span>
          </div>
          {draft.bands.map((b, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-2 items-center">
              <input
                required
                value={b.grade}
                onChange={(e) => updateBand(idx, 'grade', e.target.value)}
                className="sm:col-span-2 border border-ink/20 rounded-md px-3 py-2"
                placeholder="A+"
              />
              <input
                required
                type="number"
                step="0.01"
                value={b.minPercent}
                onChange={(e) => updateBand(idx, 'minPercent', e.target.value)}
                className="sm:col-span-3 border border-ink/20 rounded-md px-3 py-2"
                placeholder="90"
              />
              <input
                required
                type="number"
                step="0.1"
                value={b.gradePoint}
                onChange={(e) => updateBand(idx, 'gradePoint', e.target.value)}
                className="sm:col-span-2 border border-ink/20 rounded-md px-3 py-2"
                placeholder="6"
              />
              <input
                value={b.remarks}
                onChange={(e) => updateBand(idx, 'remarks', e.target.value)}
                className="sm:col-span-4 border border-ink/20 rounded-md px-3 py-2"
                placeholder="Outstanding"
              />
              <button
                type="button"
                onClick={() => removeBand(idx)}
                disabled={draft.bands.length === 1}
                className="sm:col-span-1 text-xs text-absent hover:underline disabled:opacity-30 disabled:no-underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addBand} className="text-sm text-brass-dark hover:underline mb-4">
            + Add band
          </button>
          <p className="text-xs text-slate2 mb-4">
            One band must start at 0% so every result lands in a grade. A band's remarks are what the broad sheet
            prints for a student whose overall grade is that band.
          </p>

          <div className="flex gap-3">
            <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">
              {draft.id ? 'Save changes' : 'Add scale'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-sm px-4 py-2 rounded-md border border-ink/20 text-slate2 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-slate2 text-sm">Loading grading scales…</p>}

      <div className="space-y-6">
        {scales.map((scale) => (
          <div key={scale.id} className="bg-white border border-ink/10 rounded-lg overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-ink/10">
              <div>
                <p className="font-display text-ink">{scale.name}</p>
                <p className="text-xs text-slate2">
                  {rangeLabel(scale)}
                  {scale.minGrade === null && ' — used wherever no class-specific scale applies'}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setError('');
                      setNotice('');
                      setDraft(toDraft(scale));
                    }}
                    className="text-sm text-brass-dark hover:underline"
                  >
                    Edit
                  </button>
                  <button onClick={() => remove(scale)} className="text-sm text-absent hover:underline">
                    Delete
                  </button>
                </div>
              )}
            </div>
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-slate2">
                  <th className="px-4 py-2 font-normal">Grade</th>
                  <th className="px-4 py-2 font-normal">From %</th>
                  <th className="px-4 py-2 font-normal">Grade point</th>
                  <th className="px-4 py-2 font-normal">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {scale.bands.map((b) => (
                  <tr key={b.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2 font-medium">{b.grade}</td>
                    <td className="px-4 py-2">{b.minPercent}% and above</td>
                    <td className="px-4 py-2">{b.gradePoint}</td>
                    <td className="px-4 py-2 text-slate2">{b.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!loading && scales.length === 0 && (
          <p className="text-slate2 text-sm">No grading scales yet — results can't be graded until one exists.</p>
        )}
      </div>
    </div>
  );
}
