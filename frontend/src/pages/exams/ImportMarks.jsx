// Import marks — a whole class's marks in one click.
//
// Three sheets are offered: a blank sample for 6-8, a blank sample for 9-10
// (the subject sets differ, so one sheet can't serve both), and — the one
// worth using — this exam's own sheet with the students already listed and
// any marks already entered. Fill in the subject columns in Excel, save as
// CSV, and drop it back here.
//
// The upload is checked before anything is written: the server re-validates
// every cell and refuses the whole sheet if any row is wrong, so a typo can't
// leave a class half-imported. That check is what the preview below shows.

import { useEffect, useState } from 'react';
import client from '../../api/client';
import { parseCSV, exportRowsToCSV } from '../../utils/csv';

// The four identity columns, and the header spellings accepted for each.
const ID_COLUMNS = {
  admissionNo: ['admission no', 'admission no.', 'admission number', 'admissionno', 'admission#', 'adm no'],
  rollNumber: ['roll no', 'roll no.', 'roll number', 'rollno', 'roll #', 'exam roll #', 'exam roll no', 'exam roll no.'],
  className: ['class', 'class name', 'classname', 'grade'],
  name: ['name', 'student name', 'student'],
  section: ['section', 'sec'],
};

// Class and Section are both optional and only used to tell two students
// with the same name apart — they never override which class/section a
// student is actually in. Admission No, when present, is matched exactly
// and skips name matching altogether.
function identityKeyFor(header) {
  const h = String(header || '').trim().toLowerCase();
  for (const [key, spellings] of Object.entries(ID_COLUMNS)) {
    if (spellings.includes(h)) return key;
  }
  return null;
}

function sheetColumns(subjectNames) {
  return [
    { key: 'admissionNo', label: 'Admission No' },
    { key: 'rollNumber', label: 'Roll No' },
    { key: 'className', label: 'Class' },
    { key: 'name', label: 'Name' },
    { key: 'section', label: 'Section' },
    ...subjectNames.map((s) => ({ key: s, label: s })),
  ];
}

export default function ImportMarks({ exam, rows, section, onImported }) {
  const [catalogues, setCatalogues] = useState([]);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null); // { rows, subjectColumns }
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client
      .get('/exams/subject-catalogues')
      .then((res) => setCatalogues(res.data))
      .catch(() => setCatalogues([]));
  }, []);

  const subjectNames = exam?.subjects?.map((s) => s.subjectName) || [];

  // A blank sample sheet for one grade range, with the subject columns that
  // range actually examines and two illustrative rows.
  function downloadSample(catalogue) {
    const columns = sheetColumns(catalogue.subjects.map((s) => s.subjectName));
    const example = (name, className, sectionName) => {
      const row = { admissionNo: '', rollNumber: '', className, name, section: sectionName };
      catalogue.subjects.forEach((s, idx) => {
        row[s.subjectName] = idx === 0 ? '58' : '';
      });
      return row;
    };
    exportRowsToCSV(
      `marks-sample-${catalogue.label.replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
      columns,
      [
        example('Student Full Name', String(catalogue.minGrade), 'A'),
        example('Another Student', String(catalogue.minGrade), 'A'),
      ]
    );
  }

  // This exam's sheet, students and existing marks included, so it round-trips.
  function downloadFilled() {
    const columns = sheetColumns(subjectNames);
    const flat = rows.map((r) => {
      const out = { admissionNo: r.admissionNumber || '', rollNumber: r.rollNumber || '', className: r.className || '', name: r.name, section: r.section || '' };
      r.subjects.forEach((cell) => {
        // A subject the student doesn't sit is dashed out, so nobody fills it
        // in by mistake; an absent student's cell says ABS and stays that way.
        out[cell.subjectName] = !cell.applicable ? '-' : cell.appeared ? cell.marks : '';
      });
      return out;
    });
    const label = `${exam.name.replace(/[^\w]+/g, '-').toLowerCase()}${section ? `-section-${section}` : ''}`;
    exportRowsToCSV(`marks-${label}.csv`, columns, flat);
  }

  function reset() {
    setParsed(null);
    setPreview(null);
    setReport(null);
    setError('');
  }

  // Turns the parsed CSV into the shape the API takes: identity fields lifted
  // out, everything else treated as a subject column.
  function toApiRows(csvRows) {
    const headers = Object.keys(csvRows[0] || {});
    const subjectColumns = headers.filter((h) => !identityKeyFor(h) && h.trim() !== '');
    const apiRows = csvRows.map((row, idx) => {
      const out = { rowNumber: idx + 2, marks: {} };
      headers.forEach((h) => {
        const key = identityKeyFor(h);
        if (key) out[key] = row[h];
        else if (h.trim() !== '') out.marks[h] = row[h];
      });
      return out;
    });
    return { apiRows, subjectColumns };
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const text = await file.text();
      const csvRows = parseCSV(text);
      if (!csvRows.length) {
        setError('This file has no data rows.');
        return;
      }
      const { apiRows, subjectColumns } = toApiRows(csvRows);
      if (!subjectColumns.length) {
        setError('No subject columns found. The header row needs one column per subject, e.g. ENG, MATHS.');
        return;
      }
      setParsed({ rows: apiRows, subjectColumns });
      const { data } = await client.post(`/exams/${exam.id}/import-marks`, {
        section: section || undefined,
        dryRun: true,
        rows: apiRows,
      });
      setPreview(data);
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors || data?.unmatched) setPreview(data);
      setError(data?.error || 'Could not read this file. Save it as CSV and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post(`/exams/${exam.id}/import-marks`, {
        section: section || undefined,
        rows: parsed.rows,
      });
      setReport(data);
      setParsed(null);
      setPreview(null);
      onImported?.();
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors) setPreview(data);
      setError(data?.error || 'Could not import this sheet.');
    } finally {
      setBusy(false);
    }
  }

  const blocked = preview?.errors?.length > 0;

  return (
    <div className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-lg text-ink">Import marks</h3>
          <p className="text-sm text-slate2">
            {exam.name}
            {section ? ` · section ${section}` : ' · every section in this exam'} — {rows.length} student
            {rows.length === 1 ? '' : 's'} in scope.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <button type="button" onClick={downloadFilled} className="text-brass-dark hover:underline">
            Download this exam's sheet
          </button>
          {catalogues.map((c) => (
            <button key={c.key} type="button" onClick={() => downloadSample(c)} className="text-brass-dark hover:underline">
              Sample sheet — {c.label}
            </button>
          ))}
        </div>
      </div>

      <input type="file" accept=".csv,text/csv" onChange={handleFile} className="text-sm mb-3 block" />

      <p className="text-xs text-slate2 mb-3">
        One row per student, one column per subject. Students are matched on Admission No, then Roll No
        (the same Exam Roll # filled in on the Award List), then Name — Class and
        Section only need filling in to tell two same-named or same-roll-numbered students apart, and are otherwise ignored. A blank
        cell leaves the stored mark alone, and <span className="font-medium">ABS</span> (or a dash) marks the student
        absent for that subject. For Classes 9-10, whichever of C.SCI or BIO a student has a real mark in is taken
        as their elective choice and set on their record automatically — no need to set it on the Students page
        first. Nothing is written until you press Import, and a sheet with any bad cell imports nothing.
      </p>

      {error && <p className="text-absent text-sm mb-3">{error}</p>}

      {preview && (
        <div className="border border-ink/10 rounded-md p-4 mb-3 bg-paper/60">
          <p className="text-sm mb-2">
            <span className="font-medium text-ink">{fileName}</span> — {preview.rows} row
            {preview.rows === 1 ? '' : 's'}, {preview.matched} matched to a student.
          </p>
          <p className="text-sm mb-2">
            {preview.toWrite} mark{preview.toWrite === 1 ? '' : 's'} to import
            {preview.toClear > 0 && `, ${preview.toClear} to clear as absent`}
            {preview.subjects?.length > 0 && ` · ${preview.subjects.join(', ')}`}
          </p>

          {preview.groupChanges?.length > 0 && (
            <details className="mb-2" open>
              <summary className="text-xs text-brass-dark cursor-pointer">
                {preview.groupChanges.length} student{preview.groupChanges.length === 1 ? '' : 's'} will have their
                elective group set from this sheet
              </summary>
              <div className="mt-1 max-h-32 overflow-y-auto">
                {preview.groupChanges.map((g, idx) => (
                  <p key={idx} className="text-xs text-slate2">
                    {g.name} → {g.group === 'COMPUTER' ? 'Computer Science' : 'Biology'}
                  </p>
                ))}
              </div>
            </details>
          )}

          {preview.unknownColumns?.length > 0 && (
            <p className="text-xs text-brass-dark mb-2">
              Ignored column{preview.unknownColumns.length === 1 ? '' : 's'} that aren't subjects in this exam:{' '}
              {preview.unknownColumns.join(', ')}
            </p>
          )}

          {preview.unmatched?.length > 0 && (
            <details className="mb-2">
              <summary className="text-xs text-brass-dark cursor-pointer">
                {preview.unmatched.length} row{preview.unmatched.length === 1 ? '' : 's'} matched no student in this
                scope and will be skipped
              </summary>
              <div className="mt-1 max-h-40 overflow-y-auto">
                {preview.unmatched.map((u, idx) => (
                  <p key={idx} className="text-xs text-slate2">
                    Row {u.rowNumber}: {u.message}
                  </p>
                ))}
              </div>
            </details>
          )}

          {blocked && (
            <div className="bg-absent/5 border border-absent/20 rounded-md p-3 mb-2 max-h-48 overflow-y-auto">
              {preview.errors.map((e, idx) => (
                <p key={idx} className="text-xs text-absent">
                  Row {e.rowNumber}
                  {e.subject ? ` · ${e.subject}` : ''}: {e.message}
                </p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={runImport}
            disabled={busy || blocked || !parsed || preview.toWrite + preview.toClear === 0}
            className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Importing…' : `Import ${preview.toWrite + preview.toClear} mark${preview.toWrite + preview.toClear === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {report && (
        <p className="text-sm text-present">
          Imported {report.imported} mark{report.imported === 1 ? '' : 's'}
          {report.cleared > 0 && `, cleared ${report.cleared} as absent`}
          {report.groupsSet > 0 && `, set elective group for ${report.groupsSet} student${report.groupsSet === 1 ? '' : 's'}`}
          {report.unmatched?.length > 0 && ` · skipped ${report.unmatched.length} unmatched row${report.unmatched.length === 1 ? '' : 's'}`}
          . The sheet below is up to date.
        </p>
      )}
    </div>
  );
}
