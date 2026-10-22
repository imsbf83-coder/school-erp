// Report Card — one printable card per student, laid out to match the
// school's existing result card: crest + letterhead, a "RESULT CARD" bar,
// student details, the subject table, and an overall-result summary.

import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useExamScope, ExamScopePicker, ScopeWarnings } from './examScope';
import { SCHOOL_INFO } from '../../config/schoolInfo';

function dash(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

function ordinal(n) {
  if (n === null || n === undefined) return '';
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function classLabel(row) {
  const gradeNum = Number(row.className);
  const grade = Number.isFinite(gradeNum) ? ordinal(gradeNum).toUpperCase() : row.className || '';
  return [grade, row.section].filter(Boolean).join(' ');
}

// The exam name may already contain a short/long academic year (for example,
// "MID-TERM 2026-27"). Avoid appending the same year a second time.
function examTitle(exam) {
  if (!exam) return '';
  const name = exam.name || '';
  const academicYear = exam.academicYear || '';
  if (!academicYear) return name;
  const yearParts = academicYear.match(/\d{2,4}/g) || [];
  const yearAlreadyShown = yearParts.some((part) => name.includes(part)) || name.includes(academicYear);
  return yearAlreadyShown ? name : `${name}, ${academicYear}`;
}

const STATUS_LABEL = { PASS: 'Pass', PROMOTE: 'Promoted', FAIL: 'Fail' };

export default function ReportCard() {
  const scope = useExamScope();
  const { exam, examId, classId, section } = scope;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [studentId, setStudentId] = useState('');

  useEffect(() => {
    if (!examId || !classId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    client
      .get(`/exams/${examId}/broadsheet`, { params: { classId, ...(section ? { section } : {}) } })
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err.response?.data?.error || 'Could not load results for this class.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, classId, section]);

  useEffect(() => setStudentId(''), [examId, classId, section]);

  const rows = data?.rows || [];
  const rankedCount = rows.filter((r) => r.rankInSection !== null).length;
  const isFinal = data?.exam?.term === 4;
  const cards = studentId ? rows.filter((r) => String(r.studentId) === studentId) : rows;

  return (
    <div>
      <ExamScopePicker scope={scope} />
      <div className="flex flex-wrap gap-4 mb-4 items-end print:hidden">
        <div>
          <label className="block text-sm text-slate2 mb-1">Student</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={rows.length === 0} className="border border-ink/20 rounded-md px-3 py-2 bg-white min-w-[220px] disabled:opacity-50">
            <option value="">All students in view ({rows.length})</option>
            {rows.map((r) => <option key={r.studentId} value={r.studentId}>{r.admissionNumber} — {r.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-absent mb-4">{error}</p>}
      {loading && <p className="text-sm text-slate2">Loading…</p>}
      {!loading && examId && classId && <><ScopeWarnings warnings={data?.warnings} /><div className="flex items-center justify-between mb-4 print:hidden"><p className="text-sm text-slate2">{cards.length} card{cards.length === 1 ? '' : 's'}</p><button onClick={() => window.print()} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">Print</button></div></>}
      {cards.map((row, idx) => (
        <div key={row.studentId} className="bg-white border border-ink/10 mb-6 print:mb-0 print:border-0" style={idx < cards.length - 1 ? { breakAfter: 'page' } : undefined}>
          <div className="p-8 max-w-2xl mx-auto print:max-w-none">
            <div className="flex items-center justify-center gap-4 mb-2"><img src={SCHOOL_INFO.logo} alt="" className="w-16 h-16 object-contain shrink-0" /><h1 className="font-display text-xl leading-tight text-center uppercase">{SCHOOL_INFO.name}</h1></div>
            <p className="text-center font-semibold underline mb-4 uppercase">{examTitle(exam)}</p>
            <div className="bg-ink text-paper text-center font-display text-lg tracking-wide py-2 mb-4">RESULT CARD</div>
            <table className="w-full text-sm border border-ink/30 mb-4"><tbody><tr><td className="border border-ink/30 px-3 py-1.5 font-semibold w-1/4">Student's Name</td><td className="border border-ink/30 px-3 py-1.5 font-semibold underline" colSpan={5}>{row.name}</td></tr><tr><td className="border border-ink/30 px-3 py-1.5 font-semibold">Father's Name</td><td className="border border-ink/30 px-3 py-1.5 font-semibold underline" colSpan={5}>{row.guardianName}</td></tr><tr><td className="border border-ink/30 px-3 py-1.5 font-semibold">Class</td><td className="border border-ink/30 px-3 py-1.5">{classLabel(row)}</td><td className="border border-ink/30 px-3 py-1.5 font-semibold">Admn #</td><td className="border border-ink/30 px-3 py-1.5 underline">{row.admissionNumber}</td><td className="border border-ink/30 px-3 py-1.5 font-semibold">Exam No.</td><td className="border border-ink/30 px-3 py-1.5 underline">{dash(row.rollNumber)}</td></tr></tbody></table>
            <table className="w-full text-sm border border-ink/30 mb-4"><thead><tr className="bg-paper"><th className="border border-ink/30 px-3 py-1.5 text-left">Subject</th><th className="border border-ink/30 px-3 py-1.5">Marks Total</th><th className="border border-ink/30 px-3 py-1.5">Marks Obtained</th><th className="border border-ink/30 px-3 py-1.5">%</th><th className="border border-ink/30 px-3 py-1.5">Grade</th><th className="border border-ink/30 px-3 py-1.5">Remarks</th></tr></thead><tbody>{row.subjects.filter((s) => s.applicable).map((s) => <tr key={s.examSubjectId}><td className="border border-ink/30 px-3 py-1.5 font-semibold">{s.subjectName}</td><td className="border border-ink/30 px-3 py-1.5 text-center">{s.maxMarks}</td><td className="border border-ink/30 px-3 py-1.5 text-center">{s.appeared ? s.marks : 'Absent'}</td><td className="border border-ink/30 px-3 py-1.5 text-center">{s.appeared ? `${s.percent.toFixed(2)}%` : '—'}</td><td className="border border-ink/30 px-3 py-1.5 text-center">{dash(s.grade)}</td><td className="border border-ink/30 px-3 py-1.5 text-center">{dash(s.remarks)}</td></tr>)}</tbody></table>
            <table className="w-full text-sm border border-ink/30 mb-8"><tbody><tr><td className="border border-ink/30 px-3 py-1.5 font-semibold w-1/6">Marks Total</td><td className="border border-ink/30 px-3 py-1.5 text-center font-semibold w-1/6">{row.totalMarks}</td><td className="border border-ink/30 px-3 py-1.5 font-semibold w-1/6">Overall %</td><td className="border border-ink/30 px-3 py-1.5 text-center w-1/6">{row.anyMarks ? `${row.overallPercent.toFixed(2)}%` : '—'}</td><td className="border border-ink/30 px-3 py-1.5 font-semibold w-1/6">Status</td><td className="border border-ink/30 px-3 py-1.5 text-center w-1/6" rowSpan={2}>{isFinal && row.status ? STATUS_LABEL[row.status] : ''}</td></tr><tr><td className="border border-ink/30 px-3 py-1.5 font-semibold">Marks Obtained</td><td className="border border-ink/30 px-3 py-1.5 text-center font-semibold">{row.obtained}</td><td className="border border-ink/30 px-3 py-1.5 font-semibold">Overall Grade</td><td className="border border-ink/30 px-3 py-1.5 text-center">{dash(row.overallGrade)}</td></tr><tr><td className="border border-ink/30 px-3 py-1.5 font-semibold">Position</td><td className="border border-ink/30 px-3 py-1.5 text-center">{row.rankInSection ? `${ordinal(row.rankInSection)} of ${rankedCount}` : '—'}</td><td className="border border-ink/30 px-3 py-1.5 font-semibold">Remarks</td><td className="border border-ink/30 px-3 py-1.5 text-center" colSpan={3}>{dash(row.remarks)}</td></tr></tbody></table>
            <div className="flex justify-between items-end mt-16 px-4"><div className="text-center"><div className="border-t border-ink w-40 pt-1 text-sm">Class Incharge</div></div><div className="text-center flex flex-col items-center"><img src={SCHOOL_INFO.principalSignature} alt="Principal signature" className="h-20 w-40 object-contain mb-1" /><div className="border-t border-ink w-40 pt-1 text-sm">Principal</div></div></div>
          </div>
        </div>
      ))}
      {!loading && examId && classId && cards.length === 0 && <p className="text-sm text-slate2">No students to show for this scope.</p>}
    </div>
  );
}
