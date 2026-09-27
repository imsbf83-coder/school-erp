// Award List — a blank marks-collection sheet for an exam: every student's
// name and roll number, with an empty box per subject for the class
// teacher to hand-write marks on after each paper, before those marks get
// typed into the system (via the marks grid or Import Marks). Reuses the
// same GET /exams/:id/results endpoint as the results table on the Exams
// tab, but deliberately ignores any marks already entered — this is a
// print template, not a report of what's been recorded so far.
//
// NOTE: roll-number editing here calls PUT /api/students/:id with
// { rollNumber }. If your students route doesn't expose that shape, tell
// Claude and it'll adjust this to match.

import { useEffect, useState } from 'react';
import client from '../../api/client';

function termLabel(term) {
  if (!term) return '';
  return term === 4 ? 'Final Term' : `Term ${term}`;
}

export default function AwardList() {
  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [section, setSection] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/exams').then((res) => {
      setExams(res.data);
      if (res.data.length) setSelectedExamId(String(res.data[0].id));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedExamId) return;
    client
      .get(`/exams/${selectedExamId}/results`, { params: section ? { section } : {} })
      .then((res) => setResults(res.data));
  }, [selectedExamId, section]);

  function changeExam(id) {
    setSelectedExamId(id);
    setSection('');
  }

  async function saveRollNumber(studentId, rollNumber) {
    await client.put(`/students/${studentId}`, { rollNumber });
    setResults((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => (r.studentId === studentId ? { ...r, rollNumber } : r)),
    }));
  }

  if (loading) return <p className="text-slate2 text-sm">Loading…</p>;
  if (exams.length === 0) return <p className="text-slate2 text-sm">No exams yet — create one on the Exams tab first.</p>;

  const sectionOptions = results
    ? [...new Set(results.rows.map((r) => r.section).filter(Boolean))].sort()
    : [];
  const showSectionColumn = !section && sectionOptions.length > 0;
  const showClassColumn = results && results.exam.classes.length > 1;

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .award-list-print, .award-list-print * { visibility: visible; }
          .award-list-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .roll-print-cell { display: table-cell !important; }
          .award-list-table th, .award-list-table td { border: 1px solid #333 !important; }
        }
        .roll-print-cell { display: none; }
      `}</style>

      <div className="flex flex-wrap gap-4 mb-6 items-end no-print">
        <div>
          <label className="block text-sm text-slate2 mb-1">Exam</label>
          <select value={selectedExamId} onChange={(e) => changeExam(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}{ex.term ? ` — ${termLabel(ex.term)}` : ''}
              </option>
            ))}
          </select>
        </div>
        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select value={section} onChange={(e) => setSection(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="">All sections</option>
              {sectionOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        {results && (
          <button
            type="button"
            onClick={() => window.print()}
            className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
          >
            Print
          </button>
        )}
      </div>

      {results && (
        <div className="award-list-print">
          <div className="mb-4">
            <p className="font-display text-xl">{results.exam.name}</p>
            <p className="text-sm text-slate2">
              {results.exam.term ? termLabel(results.exam.term) : ''} · {results.exam.academicYear}
              {section ? ` · Section ${section}` : ''}
            </p>
          </div>

          <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
            <table className="award-list-table register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-3 py-3">Roll No.</th>
                  <th className="px-3 py-3">Name</th>
                  {showClassColumn && <th className="px-3 py-3">Class</th>}
                  {showSectionColumn && <th className="px-3 py-3">Section</th>}
                  {results.exam.subjects.map((sub) => (
                    <th key={sub.id} className="px-3 py-3 text-center">
                      {sub.subjectName}
                      <span className="block font-normal text-slate2 text-xs">/{sub.maxMarks}</span>
                    </th>
                  ))}
                  <th className="px-3 py-3 border-l border-ink/10">Total</th>
                  <th className="px-3 py-3">%</th>
                  <th className="px-3 py-3">Grade</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate2" colSpan={20}>No students in this scope.</td>
                  </tr>
                ) : (
                  results.rows.map((row) => (
                    <tr key={row.studentId} className="border-b border-ink/5 last:border-0">
                      <td className="px-2 py-2 no-print">
                        <RollInput studentId={row.studentId} value={row.rollNumber} onSave={saveRollNumber} />
                      </td>
                      <td className="px-3 py-2 roll-print-cell font-mono text-xs">{row.rollNumber || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.name}</td>
                      {showClassColumn && <td className="px-3 py-2 text-slate2">{row.className}</td>}
                      {showSectionColumn && <td className="px-3 py-2 text-slate2">{row.section || '—'}</td>}
                      {results.exam.subjects.map((sub) => {
                        const cell = row.subjects.find((c) => c.examSubjectId === sub.id);
                        return (
                          <td key={sub.id} className="px-3 py-2 text-center">
                            {cell?.applicable ? '' : <span className="text-slate2">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 border-l border-ink/10"></td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2"></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// The Roll No. box shown only on-screen (hidden when printing — the plain
// text cell above takes over for print) so a missing roll number can be
// typed in and saved right before printing, without a separate edit mode.
function RollInput({ studentId, value, onSave }) {
  const [local, setLocal] = useState(value || '');

  useEffect(() => {
    setLocal(value || '');
  }, [value]);

  async function commit() {
    if (local === (value || '')) return;
    await onSave(studentId, local);
  }

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-20 border border-ink/20 rounded-md px-2 py-1 text-xs font-mono"
      placeholder="Roll #"
    />
  );
}
