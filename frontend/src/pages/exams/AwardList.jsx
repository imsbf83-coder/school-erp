// Award List — a blank marks-collection sheet, one per Exam + Class +
// Section + Subject, matching the school's existing paper format exactly:
// header block (school name, Exam/Class, Subject/MarksTotal), then a table
// of S# / Admission # / Exam Roll # / Student Name / Father Name / Marks
// Obtd. (blank) / Remarks (blank), ending with hand-filled Total/Appeared/
// Pass/Fail lines.
//
// Reuses GET /exams/:id/results for the roster + subject list (already
// returns exam.classes and exam.subjects), then separately calls GET
// /students?classId=&section= to pull each student's Father Name
// (guardianName), since /results doesn't include it and this avoids any
// backend changes. "Exam Roll #" reuses the student's existing Roll Number
// field (Student.rollNumber) — typed in by hand here, same as elsewhere in
// the app, rather than a separate auto-generated number.

import { useEffect, useState } from 'react';
import client from '../../api/client';

const SCHOOL_NAME = 'ISLAMABAD MODEL SCHOOL FOR BOYS (VI-X), F-8/3';

function termLabel(term) {
  if (!term) return '';
  return term === 4 ? 'Final Term' : `Term ${term}`;
}

export default function AwardList() {
  const [exams, setExams] = useState([]);
  const [classesFull, setClassesFull] = useState([]); // /classes list, for the real per-class sections (A,B,C)
  const [selectedExamId, setSelectedExamId] = useState('');
  const [examDetail, setExamDetail] = useState(null); // full /results payload for the selected exam
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [fatherNames, setFatherNames] = useState({}); // studentId -> guardianName
  const [rollNumbers, setRollNumbers] = useState({}); // studentId -> local roll number being edited
  const [loading, setLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);

  useEffect(() => {
    client.get('/classes').then((res) => setClassesFull(res.data));
    client.get('/exams').then((res) => {
      setExams(res.data);
      if (res.data.length) setSelectedExamId(String(res.data[0].id));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedExamId) return;
    setExamDetail(null);
    setClassId('');
    setSection('');
    setSubjectId('');
    client.get(`/exams/${selectedExamId}/results`).then((res) => {
      setExamDetail(res.data);
      const firstClass = res.data.exam.classes[0];
      if (firstClass) setClassId(String(firstClass.classId));
      const firstSubject = res.data.exam.subjects[0];
      if (firstSubject) setSubjectId(String(firstSubject.id));
    });
  }, [selectedExamId]);

  // Once a class is picked, load Father Name (guardianName) for every
  // student in that class/section directly from Students — /results
  // doesn't carry this field, and this is the only extra data this page
  // needs beyond what /results already gives.
  useEffect(() => {
    if (!classId) return;
    setLoadingRoster(true);
    client
      .get('/students', { params: { classId, ...(section ? { section } : {}), pageSize: 200 } })
      .then((res) => {
        const map = {};
        const rolls = {};
        res.data.students.forEach((s) => {
          map[s.id] = s.guardianName;
          rolls[s.id] = s.rollNumber || '';
        });
        setFatherNames(map);
        setRollNumbers(rolls);
      })
      .finally(() => setLoadingRoster(false));
  }, [classId, section]);

  async function saveRollNumber(studentId, value) {
    setRollNumbers((prev) => ({ ...prev, [studentId]: value }));
    await client.put(`/students/${studentId}`, { rollNumber: value });
  }

  if (loading) return <p className="text-slate2 text-sm">Loading…</p>;
  if (exams.length === 0) return <p className="text-slate2 text-sm">No exams yet — create one on the Exams tab first.</p>;
  if (!examDetail) return <p className="text-slate2 text-sm">Loading exam…</p>;

  const selectedClass = examDetail.exam.classes.find((c) => String(c.classId) === classId);
  const fullClass = classesFull.find((c) => String(c.id) === classId);
  const sectionOptions = fullClass?.sections ? fullClass.sections.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const selectedSubject = examDetail.exam.subjects.find((s) => String(s.id) === subjectId);

  const className = selectedClass?.class?.name;
  const rows = examDetail.rows.filter((r) => {
    if (r.className !== className) return false;
    if (section && r.section !== section) return false;
    // A subject with appliesTo other than ALL (e.g. Islamiyat/Akhlaqiyat by
    // religion, or Computer Science/Biology by studentGroup) only applies
    // to some students — the backend already worked out exactly who, per
    // subject, in row.subjects[].applicable. Filtering on that here is what
    // makes picking "Islamiyat" print only Muslim students, "Akhlaqiyat"
    // print only non-Muslim students, and likewise for the 9th/10th
    // Computer vs Biology electives — no extra logic needed on this end.
    if (!selectedSubject) return true;
    const cell = r.subjects.find((c) => c.examSubjectId === selectedSubject.id);
    return cell?.applicable !== false;
  });

  // Print is capped at TWO pages per class: page 1 is ALWAYS exactly 30
  // students (never fewer, never redistributed), with anyone beyond that
  // continuing on page 2 (repeats the column header; the Total/Appeared/
  // Pass/Fail lines sit only at the bottom of the last page).
  const ROWS_PER_PAGE = 30;
  const pages =
    rows.length <= ROWS_PER_PAGE
      ? [rows]
      : [rows.slice(0, ROWS_PER_PAGE), rows.slice(ROWS_PER_PAGE)];

  return (
    <div>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body * { visibility: hidden; }
          .award-list-print, .award-list-print * { visibility: visible; }
          .award-list-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .roll-print-cell { display: table-cell !important; }
          .award-list-table { font-size: 11px; }
          .award-list-table th, .award-list-table td { border: 1px solid #333 !important; padding: 3px 5px !important; line-height: 1.25; }
          .award-list-table tr { break-inside: avoid; }
          .award-page { border: 0 !important; border-radius: 0 !important; }
          .award-page-break { break-after: page; page-break-after: always; }
        }
        .roll-print-cell { display: none; }
      `}</style>

      <div className="flex flex-wrap gap-4 mb-6 items-end no-print">
        <div>
          <label className="block text-sm text-slate2 mb-1">Exam</label>
          <select value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}{ex.term ? ` — ${termLabel(ex.term)}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-slate2 mb-1">Class</label>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSection(''); }} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
            {examDetail.exam.classes.map((c) => (
              <option key={c.classId} value={c.classId}>{c.class?.name}</option>
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

        <div>
          <label className="block text-sm text-slate2 mb-1">Subject</label>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
            {examDetail.exam.subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>{sub.subjectName}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
        >
          Print
        </button>
      </div>

      <div className="award-list-print">
        <div className="text-center mb-4">
          <p className="font-bold text-lg">{SCHOOL_NAME}</p>
          <p className="text-sm mt-2">
            Exam <span className="inline-block min-w-[160px] border-b border-ink px-1">{examDetail.exam.name}</span>
            {'   '}Class <span className="inline-block min-w-[100px] border-b border-ink px-1">{className}{section ? ` ${section}` : ''}</span>
          </p>
          <p className="text-sm mt-1">
            Subject <span className="inline-block min-w-[160px] border-b border-ink px-1">{selectedSubject?.subjectName}</span>
            {'   '}Marks Total <span className="inline-block min-w-[60px] border-b border-ink px-1">{selectedSubject?.maxMarks}</span>
          </p>
        </div>

        {loadingRoster ? (
          <p className="text-slate2 text-sm">Loading roster…</p>
        ) : rows.length === 0 ? (
          <p className="text-slate2 text-sm">No students in this class/section.</p>
        ) : (
          pages.map((pageRows, pageIdx) => {
            const isLast = pageIdx === pages.length - 1;
            const offset = pages.slice(0, pageIdx).reduce((n, p) => n + p.length, 0);
            return (
              <div key={pageIdx} className={isLast ? '' : 'award-page-break'}>
                <div className="award-page bg-white border border-ink/10 rounded-lg overflow-x-auto">
                  <table className="award-list-table register-table w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink/10 text-left">
                        <th className="px-3 py-2">S #</th>
                        <th className="px-3 py-2">Admn #</th>
                        <th className="px-3 py-2">Exam Roll #</th>
                        <th className="px-3 py-2">Student Name</th>
                        <th className="px-3 py-2">Father Name</th>
                        <th className="px-3 py-2 text-center">Marks Obtd.</th>
                        <th className="px-3 py-2">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, i) => (
                        <tr key={row.studentId} className="border-b border-ink/5 last:border-0">
                          <td className="px-3 py-2">{offset + i + 1}</td>
                          <td className="px-3 py-2 font-mono text-xs">{row.admissionNumber}</td>
                          <td className="px-2 py-1 no-print">
                            <RollInput studentId={row.studentId} value={rollNumbers[row.studentId] ?? ''} onSave={saveRollNumber} />
                          </td>
                          <td className="roll-print-cell px-3 py-2 font-mono text-xs">{rollNumbers[row.studentId] || ''}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.name}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{fatherNames[row.studentId] || ''}</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {isLast && (
                  <div className="mt-4 text-sm space-y-1">
                    <p>Students Total: <span className="inline-block min-w-[100px] border-b border-ink">&nbsp;</span></p>
                    <p>
                      Students Appeared: <span className="inline-block min-w-[80px] border-b border-ink">&nbsp;</span>
                      {'   '}Pass: <span className="inline-block min-w-[60px] border-b border-ink">&nbsp;</span>
                      {'   '}Fail: <span className="inline-block min-w-[60px] border-b border-ink">&nbsp;</span>
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Screen-only roll number input (hidden on print — the plain text cell
// takes over there), so a missing roll number can be typed in and saved
// right before printing.
function RollInput({ studentId, value, onSave }) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  async function commit() {
    if (local === value) return;
    await onSave(studentId, local);
  }

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-16 border border-ink/20 rounded-md px-2 py-1 text-xs font-mono"
      placeholder="Roll #"
    />
  );
}
