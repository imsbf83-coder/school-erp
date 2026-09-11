// Exam Broad Sheet — the printable per-student result sheet.
//
// One row per student: every subject's marks, % and grade, then the totals,
// overall %, overall grade, rank and remarks. In the final term it also
// carries the promotion status. Printable for a whole class or one section.
//
// Layout: all data is centered; only names are left-aligned. Rank and Remarks
// columns can be switched off from the toolbar to give the sheet more room.
//
// Printing: the sheet is rendered at its natural width (nothing is squeezed or
// truncated) and then scaled down to fit an A4 landscape page (0.25in margins)
// with the school heading on line 1 and class/section on line 2.

import { useEffect, useState, Fragment, useRef } from 'react';
import client from '../../api/client';
import { exportRowsToCSV } from '../../utils/csv';
import { ReportToolbar, ReportTitle } from '../../components/reportKit';
import { useExamScope, ExamScopePicker, ScopeWarnings } from './examScope';

const STATUS_LABEL = { PASS: 'Pass', PROMOTE: 'Promoted', FAIL: 'Fail' };
const SCHOOL_HEADING = 'Islamabad Model School (VI-X), F-8/3';
// A4 landscape printable width at 96dpi: 297mm - 2 × 0.25in margins ≈ 1074px.
const PRINT_WIDTH_PX = 1074;

function dash(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

// "Term 1" … "Term 4" (final term), or "" when the exam has no term set.
function termLabel(term) {
  if (!term) return '';
  const names = { 1: 'Term 1', 2: 'Term 2', 3: 'Term 3', 4: 'Final Term' };
  return names[term] || `Term ${term}`;
}

// "2026-08-10" -> "10 Aug 2026"
function fmtDate(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Print styling. Column fitting is done by zoom (scale) in JS, not by
// squeezing columns here — so names and figures are never clipped.
const printStyles = `
  .print-only { display: none; }
  .print-scale { width: max-content; }
  .print-table { width: max-content !important; white-space: nowrap; }

  @page { size: A4 landscape; margin: 0.25in; }

  @media print {
    body * { visibility: hidden; }
    .print-area, .print-area * { visibility: visible; }
    .print-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
    .no-print { display: none !important; }

    .print-only { display: block !important; text-align: center; }
    .print-only h1 { font-size: 16pt; margin: 0 0 2px; font-weight: 700; }
    .print-only h2 { font-size: 13pt; margin: 0 0 2px; font-weight: 600; }
    .print-only .meta { font-size: 9.5pt; margin: 0 0 4px; }

    .print-fit { overflow: hidden !important; position: relative !important; margin: 0 auto; }
    .print-scale { transform-origin: 0 0; }

    .print-area .card-sheet {
      border: none !important;
      border-radius: 0 !important;
      background: #fff !important;
      overflow: visible !important;
    }
    .print-area table.print-table {
      border-collapse: collapse;
    }
    .print-area table.print-table th,
    .print-area table.print-table td {
      border: 0.5pt solid #000 !important;
      padding: 1px 3px !important;
    }
    .print-area table.print-table thead { display: table-header-group; }
  }
`;


export default function ExamBroadSheet() {
  const scope = useExamScope();
  const { exam, examId, classId, section, className } = scope;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRank, setShowRank] = useState(true);
  const [showRemarks, setShowRemarks] = useState(true);

  const fitRef = useRef(null);
  const scaleRef = useRef(null);
  const fitToPageRef = useRef(null);


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
          setError(err.response?.data?.error || 'Could not load the broad sheet.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, classId, section]);

    // Zoom-to-fit: measure the table's NATURAL width, then scale the whole
  // sheet down so every column fits the A4-landscape page. Runs on any
  // print trigger (button or Ctrl+P); idempotent because it resets the
  // transform before measuring.
  useEffect(() => {
    function fitToPage() {
      const fit = fitRef.current;
      const scaled = scaleRef.current;
      const table = scaled?.querySelector('table.print-table');
      if (!fit || !scaled || !table) return;

      // Measure the natural, unsqueezed size first.
      scaled.style.transform = 'none';
      table.style.width = 'max-content';
      table.style.whiteSpace = 'nowrap';

      const naturalW = scaled.getBoundingClientRect().width;
      const naturalH = scaled.getBoundingClientRect().height;
      const s = naturalW > PRINT_WIDTH_PX ? PRINT_WIDTH_PX / naturalW : 1;

      fit.style.width = `${Math.round(naturalW * s)}px`;
      fit.style.height = `${Math.round(naturalH * s)}px`;
      fit.style.overflow = 'hidden';
      scaled.style.transform = `scale(${s})`;
      scaled.style.transformOrigin = '0 0';
    }

    function resetFit() {
      const fit = fitRef.current;
      const scaled = scaleRef.current;
      const table = scaled?.querySelector('table.print-table');
      if (fit) {
        fit.style.width = '';
        fit.style.height = '';
        fit.style.overflow = '';
      }
      if (scaled) scaled.style.transform = '';
      if (table) {
        table.style.width = '';
        table.style.whiteSpace = '';
      }
    }

    fitToPageRef.current = fitToPage;
    window.addEventListener('beforeprint', fitToPage);
    window.addEventListener('afterprint', resetFit);
    return () => {
      window.removeEventListener('beforeprint', fitToPage);
      window.removeEventListener('afterprint', resetFit);
    };
  }, [showRank, showRemarks, data]);

  // The button applies the scale explicitly before printing, so it also
  // works even in browsers where `beforeprint` timing is unreliable.
  function handlePrint() {
    fitToPageRef.current?.();
    setTimeout(() => window.print(), 60);
  }


  const subjects = data?.subjects || [];
  const rows = data?.rows || [];
  const examData = data?.exam;
  const isFinal = examData?.term === 4;
  const hasStatus = isFinal && rows.some((r) => r.status);
  // Rank in class only adds something when the sheet spans several sections.
  const showClassRank = !section && new Set(rows.map((r) => r.section || '')).size > 1;

  function exportCSV() {
    const columns = [
      { key: 'admissionNumber', label: 'Admission No' },
      { key: 'rollNumber', label: 'Roll' },
      { key: 'name', label: 'Name' },
    ];
    subjects.forEach((sub) => {
      columns.push({ key: `m_${sub.id}`, label: `${sub.subjectName} Marks` });
      columns.push({ key: `p_${sub.id}`, label: `${sub.subjectName} %` });
      columns.push({ key: `g_${sub.id}`, label: `${sub.subjectName} Grade` });
    });
    columns.push(
      { key: 'totalMarks', label: 'Total Marks' },
      { key: 'obtained', label: 'Marks Obtained' },
      { key: 'overallPercent', label: 'Overall %' },
      { key: 'overallGrade', label: 'Overall Grade' },
      { key: 'rankInSection', label: 'Rank in Section' }
    );
    if (showClassRank) columns.push({ key: 'rankInClass', label: 'Rank in Class' });
    columns.push({ key: 'remarks', label: 'Remarks' });
    if (hasStatus) columns.push({ key: 'status', label: 'Status' });

    const flat = rows.map((r) => {
      const out = {
        admissionNumber: r.admissionNumber || '',
        rollNumber: r.rollNumber || '',
        name: r.name,
        totalMarks: r.totalMarks,
        obtained: r.obtained,
        overallPercent: r.overallPercent ?? '',
        overallGrade: r.overallGrade || '',
        rankInSection: r.rankInSection ?? '',
        rankInClass: r.rankInClass ?? '',
        remarks: r.remarks || '',
        status: r.status ? STATUS_LABEL[r.status] : '',
      };
      r.subjects.forEach((cell) => {
        out[`m_${cell.examSubjectId}`] = cell.applicable ? (cell.appeared ? cell.marks : 'ABS') : '';
        out[`p_${cell.examSubjectId}`] = cell.percent ?? '';
        out[`g_${cell.examSubjectId}`] = cell.grade || '';
      });
      return out;
    });

    const label = `${className || 'class'}${section ? `-${section}` : ''}`;
    exportRowsToCSV(`broadsheet-${label}.csv`, columns, flat);
  }

  // Trailing columns: Total, Obt, %, Grade + optional Rank (+ class rank),
  // optional Remarks, optional Status.
  const trailingCount =
    4 +
    (showRank ? 1 : 0) +
    (showRank && showClassRank ? 1 : 0) +
    (showRemarks ? 1 : 0) +
    (hasStatus ? 1 : 0);
  const colSpan = 3 + subjects.length * 3 + trailingCount;

  return (
    <div>
      <style>{printStyles}</style>

      <div className="no-print">
        <ExamScopePicker scope={scope} />
      </div>

      {error && <p className="no-print text-absent text-sm mb-4">{error}</p>}
      {!examId && (
        <p className="no-print text-slate2 text-sm">
          No exams yet. Create one on the Examinations page.
        </p>
      )}

      {data && (
        <>
          <div className="no-print">
            <ScopeWarnings warnings={data.warnings} />
          </div>

          <div className="no-print flex flex-wrap items-start justify-between gap-2 mb-2">
            <ReportTitle>
              Broad Sheet — {exam?.name} · Class {className}
              {section ? ` · Section ${section}` : ' · whole class'}
            </ReportTitle>
            <button
              onClick={handlePrint}
              className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:opacity-90"
            >
              Print / Save as PDF
            </button>
          </div>

          <div className="no-print">
            <ReportToolbar onExportCSV={exportCSV} count={rows.length} noun="student" />
          </div>

          {/* Choose which optional columns appear in the sheet. */}
          <div className="no-print flex flex-wrap items-center gap-4 mb-3 text-sm">
            <span className="text-slate2">Include in sheet:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showRank}
                onChange={(e) => setShowRank(e.target.checked)}
              />
              Rank column
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showRemarks}
                onChange={(e) => setShowRemarks(e.target.checked)}
              />
              Remarks column
            </label>
          </div>

          {/* ---------- printed / on-screen sheet ---------- */}
          <div className="print-area">
            {/* Print-only headings: school (h1), class/section (h2), term. */}
            <div className="print-only">
              <h1>{SCHOOL_HEADING}</h1>
              <h2>
                {className}
                {section ? ` - Section ${section}` : ''}
              </h2>
              <p className="meta">
                {examData?.name}
                {examData?.academicYear ? ` · ${examData.academicYear}` : ''}
              </p>
              <p className="meta">
                {fmtDate(examData?.startDate) && fmtDate(examData?.endDate)
                  ? `Exam Dates: ${fmtDate(examData.startDate)} – ${fmtDate(examData.endDate)}`
                  : ''}
              </p>
            </div>

            {/* Zoom-to-fit wrapper: natural width, scaled to the page on print. */}
            <div ref={fitRef} className="print-fit">
              <div ref={scaleRef} className="print-scale">
                <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto card-sheet">
                  <table className="register-table text-xs text-center print-table">
                    <thead>
                      <tr className="border-b border-ink/10">
                        <th className="px-2 py-2">Admission No</th>
                        <th className="px-2 py-2">Roll</th>
                        <th className="px-2 py-2 text-left">Name</th>
                        {subjects.map((sub) => (
                          <th
                            key={sub.id}
                            className="px-2 py-2 border-l border-ink/10"
                            colSpan={3}
                          >
                            {sub.subjectName}
                            <span className="block font-normal text-slate2">/{sub.maxMarks}</span>
                          </th>
                        ))}
                        <th className="px-2 py-2 border-l border-ink/10">Total</th>
                        <th className="px-2 py-2">Obt.</th>
                        <th className="px-2 py-2">%</th>
                        <th className="px-2 py-2">Grade</th>
                        {showRank && (
                          <th className="px-2 py-2">Rank{showClassRank ? ' (sec)' : ''}</th>
                        )}
                        {showRank && showClassRank && <th className="px-2 py-2">Rank (class)</th>}
                        {showRemarks && <th className="px-2 py-2">Remarks</th>}
                        {hasStatus && <th className="px-2 py-2">Status</th>}
                      </tr>
                      <tr className="border-b border-ink/10 text-slate2">
                        <th className="px-2 pb-2" />
                        <th className="px-2 pb-2" />
                        <th className="px-2 pb-2" />
                        {subjects.map((sub) => (
                          <Fragment key={sub.id}>
                            <th className="px-2 pb-2 font-normal border-l border-ink/10">Marks</th>
                            <th className="px-2 pb-2 font-normal">%</th>
                            <th className="px-2 pb-2 font-normal">Gr.</th>
                          </Fragment>
                        ))}
                        <th className="px-2 pb-2 border-l border-ink/10" colSpan={trailingCount} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && !loading && (
                        <tr>
                          <td className="px-4 py-6 text-slate2" colSpan={colSpan}>
                            No students in this scope.
                          </td>
                        </tr>
                      )}
                      {rows.map((r) => (
                        <tr
                          key={r.studentId}
                          className={`border-b border-ink/5 last:border-0 ${
                            r.isFail ? 'text-absent' : ''
                          }`}
                        >
                          <td className="px-2 py-2 font-mono">{dash(r.admissionNumber)}</td>
                          <td className="px-2 py-2 font-mono">{dash(r.rollNumber)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-left">{r.name}</td>
                          {r.subjects.map((cell) => (
                            <Fragment key={cell.examSubjectId}>
                              <td className="px-2 py-2 border-l border-ink/10">
                                {!cell.applicable ? (
                                  <span className="text-slate2">—</span>
                                ) : cell.appeared ? (
                                  cell.marks
                                ) : (
                                  <span className="text-slate2">ABS</span>
                                )}
                              </td>
                              <td className="px-2 py-2">{cell.percent === null ? '' : cell.percent}</td>
                              <td className="px-2 py-2">{cell.grade || ''}</td>
                            </Fragment>
                          ))}
                          <td className="px-2 py-2 border-l border-ink/10">{r.totalMarks}</td>
                          <td className="px-2 py-2 font-medium">{r.obtained}</td>
                          <td className="px-2 py-2">
                            {r.overallPercent === null ? '—' : `${r.overallPercent}%`}
                          </td>
                          <td className="px-2 py-2 font-medium">{dash(r.overallGrade)}</td>
                          {showRank && <td className="px-2 py-2">{dash(r.rankInSection)}</td>}
                          {showRank && showClassRank && (
                            <td className="px-2 py-2">{dash(r.rankInClass)}</td>
                          )}
                          {showRemarks && (
                            <td className="px-2 py-2 whitespace-nowrap">{dash(r.remarks)}</td>
                          )}
                          {hasStatus && (
                            <td className="px-2 py-2 font-medium">
                              {r.status ? STATUS_LABEL[r.status] : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <p className="no-print text-xs text-slate2 mt-2">
            A student who fails any subject, or whose overall is below {examData?.passPercent}%, is
            excluded from ranking and shows a dash. <span className="font-medium">ABS</span> means
            no marks recorded; a dash in a subject column means the student does not sit that
            subject.
            {!isFinal && ' Status is only calculated for the final term.'}
          </p>
        </>
      )}
    </div>
  );
}
