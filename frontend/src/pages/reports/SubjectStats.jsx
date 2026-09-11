// Subject-wise pass % and GPA — the analysis companion to the broad sheet.
//
// One row per subject for the same scope (one exam, one class, optionally one
// section), plus an overall row for the exam as a whole.
//
// `Total students` counts only the students who *sit* the subject, so an
// elective isn't penalised for the students who never take it. `Appeared`
// counts those with a mark recorded — an absent student is neither a pass nor
// a fail, and doesn't enter the GPA.

import { useEffect, useState } from 'react';
import client from '../../api/client';
import { exportRowsToCSV } from '../../utils/csv';
import { ReportToolbar, ReportTitle } from '../../components/reportKit';
import { useExamScope, ExamScopePicker, ScopeWarnings } from './examScope';

const APPLIES_LABEL = {
  ALL: 'Everyone',
  MUSLIM: 'Muslim students',
  NON_MUSLIM: 'Non-Muslim students',
  GROUP_COMPUTER: 'Computer group',
  GROUP_BIOLOGY: 'Biology group',
};

export default function SubjectStats() {
  const scope = useExamScope();
  const { exam, examId, classId, section, className } = scope;

  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!examId || !classId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setError('');
    client
      .get(`/exams/${examId}/subject-stats`, { params: { classId, ...(section ? { section } : {}) } })
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err.response?.data?.error || 'Could not load subject statistics.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [examId, classId, section]);

  const rows = data?.rows || [];
  const overall = data?.overall;

  function exportCSV() {
    const columns = [
      { key: 'subjectName', label: 'Subject' },
      { key: 'appliesTo', label: 'Sat by' },
      { key: 'maxMarks', label: 'Max Marks' },
      { key: 'totalStudents', label: 'Total Students' },
      { key: 'appeared', label: 'Appeared' },
      { key: 'passed', label: 'Passed' },
      { key: 'failed', label: 'Failed' },
      { key: 'passPercent', label: 'Pass %' },
      { key: 'gpa', label: 'GPA' },
    ];
    const flat = rows.map((r) => ({ ...r, appliesTo: APPLIES_LABEL[r.appliesTo] || r.appliesTo }));
    if (overall) {
      flat.push({
        subjectName: 'OVERALL',
        appliesTo: '',
        maxMarks: '',
        totalStudents: overall.totalStudents,
        appeared: overall.appeared,
        passed: overall.passed,
        failed: overall.failed,
        passPercent: overall.passPercent,
        gpa: overall.gpa,
      });
    }
    const label = `${className || 'class'}${section ? `-${section}` : ''}`;
    exportRowsToCSV(`subject-stats-${label}.csv`, columns, flat);
  }

  return (
    <div>
      <ExamScopePicker scope={scope} />

      {error && <p className="text-absent text-sm mb-4">{error}</p>}
      {!examId && <p className="text-slate2 text-sm">No exams yet. Create one on the Examinations page.</p>}

      {data && (
        <>
          <ScopeWarnings warnings={data.warnings} />
          <ReportTitle>
            Subject Pass % / GPA — {exam?.name} · Class {className}
            {section ? ` · Section ${section}` : ' · whole class'}
          </ReportTitle>
          <ReportToolbar onExportCSV={exportCSV} count={rows.length} noun="subject" />

          <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Sat by</th>
                  <th className="px-4 py-3">Total students</th>
                  <th className="px-4 py-3">Appeared</th>
                  <th className="px-4 py-3">Passed</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Pass %</th>
                  <th className="px-4 py-3">GPA</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate2" colSpan={8}>
                      This exam has no subjects.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.examSubjectId} className="border-b border-ink/5">
                    <td className="px-4 py-3 font-medium">
                      {r.subjectName}
                      <span className="text-slate2 font-normal"> /{r.maxMarks}</span>
                    </td>
                    <td className="px-4 py-3 text-slate2">{APPLIES_LABEL[r.appliesTo] || r.appliesTo}</td>
                    <td className="px-4 py-3">{r.totalStudents}</td>
                    <td className="px-4 py-3">
                      {r.appeared}
                      {r.absent > 0 && <span className="text-slate2 text-xs"> ({r.absent} absent)</span>}
                    </td>
                    <td className="px-4 py-3 text-present">{r.passed}</td>
                    <td className="px-4 py-3 text-absent">{r.failed}</td>
                    <td className="px-4 py-3">{r.passPercent}%</td>
                    <td className="px-4 py-3 font-medium">{r.gpa}</td>
                  </tr>
                ))}
                {overall && (
                  <tr className="bg-paper font-medium">
                    <td className="px-4 py-3">Overall</td>
                    <td className="px-4 py-3 text-slate2 font-normal">whole exam, per student</td>
                    <td className="px-4 py-3">{overall.totalStudents}</td>
                    <td className="px-4 py-3">
                      {overall.appeared}
                      {overall.absent > 0 && <span className="text-slate2 text-xs font-normal"> ({overall.absent} absent)</span>}
                    </td>
                    <td className="px-4 py-3 text-present">{overall.passed}</td>
                    <td className="px-4 py-3 text-absent">{overall.failed}</td>
                    <td className="px-4 py-3">{overall.passPercent}%</td>
                    <td className="px-4 py-3">{overall.gpa}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate2 mt-2">
            Pass mark is {data.exam.passPercent}% of each subject's maximum. GPA is the mean grade point of the students
            who appeared, with a fail counting as 0. On the Overall row a student passes only if they passed every
            subject they sat and their overall is at least {data.exam.passPercent}%.
          </p>
        </>
      )}
    </div>
  );
}
