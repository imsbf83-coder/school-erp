// Import Attendance — supports two CSV formats:
//
// 1. MONTHLY MATRIX (one column per date):
//    Admission No, Name, Section, 03/08/2026, 04/08/2026, …
//    Each date column: P / A / L / E (or full word). Blank = skip.
//    Supports DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY headers.
//
// 2. SINGLE-DAY (backward compatible, no date headers):
//    Admission No, Name, Section, Status, Remarks
//    Uses the currently selected date.
//
// Existing attendance records are never overwritten.

import { useState } from 'react';
import client from '../../api/client';
import { parseCSV, exportRowsToCSV } from '../../utils/csv';

const STATUS_ALIASES = {
  P: 'PRESENT', PRESENT: 'PRESENT',
  A: 'ABSENT', ABSENT: 'ABSENT',
  L: 'LATE', LATE: 'LATE',
  E: 'EXCUSED', EXCUSED: 'EXCUSED',
};

const ID_COLUMNS = {
  admissionNo: ['admission no', 'admission no.', 'admission number', 'admissionno', 'admission#', 'adm no'],
  name: ['name', 'student name', 'student'],
  section: ['section', 'sec'],
};

/* ── Helpers ─────────────────────────────────────────────────────── */

function identityKeyFor(header) {
  const h = String(header || '').trim().toLowerCase();
  for (const [key, spellings] of Object.entries(ID_COLUMNS)) {
    if (spellings.includes(h)) return key;
  }
  if (h === 'status') return 'status';
  if (h === 'remarks' || h === 'remark') return 'remarks';
  return null;
}

function normaliseName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateHeader(header) {
  const raw = String(header || '').trim();

  // YYYY-MM-DD (ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) return raw;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const m1 = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m1) {
    const day = Number(m1[1]), month = Number(m1[2]), year = Number(m1[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const check = new Date(Date.UTC(year, month - 1, day));
      if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) {
        return `${year}-${pad2(month)}-${pad2(day)}`;
      }
    }
  }

  return null;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isWeekday(year, month, day) {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function monthName(m) {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] || '';
}

// Compare admission numbers safely (handles number vs string)
function matchAdmission(csvVal, rosterStudent) {
  return String(rosterStudent.admissionNumber) === String(csvVal).trim();
}

function matchStudent(row, roster) {
  const admissionNo = String(row.admissionNo || '').trim();
  if (admissionNo) {
    const hit = roster.find((s) => matchAdmission(admissionNo, s));
    return hit
      ? { student: hit }
      : { message: `No student with admission no. ${admissionNo} in this list.` };
  }
  const name = normaliseName(row.name);
  if (!name) return { message: 'This row has no admission no. or name.' };
  let hits = roster.filter((s) => normaliseName(s.name) === name);
  const section = String(row.section || '').trim().toUpperCase();
  if (hits.length > 1 && section) hits = hits.filter((s) => String(s.section || '').toUpperCase() === section);
  if (hits.length === 1) return { student: hits[0] };
  if (hits.length > 1) return { message: `"${row.name}" matches ${hits.length} students — add an Admission No or Section column.` };
  return { message: `No student called "${row.name}" in this list.` };
}

/* ── Component ───────────────────────────────────────────────────── */

export default function ImportAttendance({ roster, date, year, month, classLabel, onImported, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  // Derive year/month from props or from the date string
  function resolveYearMonth() {
    if (year && month) return { year: Number(year), month: Number(month) };
    const m = String(date || '').match(/^(\d{4})-(\d{1,2})/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  const { year: YM, month: MM } = resolveYearMonth();
  const monthLabel = `${monthName(MM)} ${YM}`;
  const skipExisting = true; // never overwrite existing records

  // ── Download monthly sample sheet ────────────────────────────────
  function downloadSample() {
    // Collect all weekdays in this month
    const lastDay = daysInMonth(YM, MM);
    const dateCols = [];
    for (let d = 1; d <= lastDay; d++) {
      if (isWeekday(YM, MM, d)) dateCols.push(`${YM}-${pad2(MM)}-${pad2(d)}`);
    }

    const columns = [
      { key: 'admissionNo', label: 'Admission No' },
      { key: 'name', label: 'Name' },
      { key: 'section', label: 'Section' },
      ...dateCols.map((d) => ({ key: `date_${d}`, label: d })),
    ];

    const rows = roster.map((s) => {
      const row = {
        admissionNo: s.admissionNumber,
        name: s.name,
        section: s.section || '',
      };
      dateCols.forEach((d) => { row[`date_${d}`] = ''; });
      return row;
    });

    const suffix = classLabel ? `-${classLabel}` : '';
    exportRowsToCSV(`attendance-${YM}-${pad2(MM)}${suffix}.csv`, columns, rows);
  }

  // ── Parse uploaded file ──────────────────────────────────────────
  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseCSV(text);
      if (!parsed.length) {
        setPreview({ matched: 0, unmatched: [], errors: [{ message: 'This file has no data rows.' }], records: [] });
        return;
      }

      // Classify headers: identity, date, or unknown
      const headerMap = {};
      const dateHeaders = []; // { csvKey, isoDate }
      Object.keys(parsed[0]).forEach((h) => {
        const key = identityKeyFor(h);
        if (key) {
          headerMap[h] = key;
        } else {
          const isoDate = parseDateHeader(h);
          if (isoDate) {
            headerMap[h] = `date:${isoDate}`;
            dateHeaders.push({ csvKey: h, isoDate });
          }
        }
      });

      const isMonthly = dateHeaders.length > 0;
      const unmatched = [];
      const errors = [];
      const records = [];
      const seen = new Map(); // studentId → first row number

      parsed.forEach((raw, idx) => {
        const rowNumber = idx + 2;
        const row = {};
        Object.entries(raw).forEach(([h, v]) => {
          const key = headerMap[h];
          if (key) row[key] = v;
        });

        const { student, message } = matchStudent(row, roster);
        if (!student) {
          unmatched.push({ rowNumber, name: row.name || '', message });
          return;
        }

        if (isMonthly) {
          // ── Monthly matrix mode ──
          // Check for duplicate student+date in this CSV
          dateHeaders.forEach(({ csvKey, isoDate }) => {
            const statusRaw = String(row[`date:${isoDate}`] || '').trim().toUpperCase();
            if (statusRaw === '') return; // blank cell = skip

            const status = STATUS_ALIASES[statusRaw];
            if (!status) {
              errors.push({
                rowNumber,
                name: student.name,
                message: `"${row[`date:${isoDate}`]}" on ${isoDate} isn't a status. Use P/A/L/E.`,
              });
              return;
            }

            const compositeKey = `${student.studentId}|${isoDate}`;
            if (seen.has(compositeKey)) {
              errors.push({
                rowNumber,
                name: student.name,
                message: `${student.name} on ${isoDate} appears twice (also row ${seen.get(compositeKey)}).`,
              });
              return;
            }
            seen.set(compositeKey, rowNumber);

            records.push({
              studentId: student.studentId,
              name: student.name,
              date: isoDate,
              status,
              remarks: null,
            });
          });
        } else {
          // ── Single-day mode (backward compatible) ──
          if (seen.has(student.studentId)) {
            errors.push({
              rowNumber,
              message: `${student.name} appears twice in this sheet (also row ${seen.get(student.studentId)}).`,
            });
            return;
          }
          seen.set(student.studentId, rowNumber);

          const statusRaw = String(row.status || '').trim().toUpperCase();
          if (statusRaw === '') return;
          const status = STATUS_ALIASES[statusRaw];
          if (!status) {
            errors.push({
              rowNumber,
              name: student.name,
              message: `"${row.status}" isn't a status. Use Present, Absent, Late or Excused (or P/A/L/E).`,
            });
            return;
          }
          records.push({
            studentId: student.studentId,
            name: student.name,
            date: date,
            status,
            remarks: (row.remarks || '').trim() || null,
          });
        }
      });

      setPreview({ matched: records.length, unmatched, errors, records, isMonthly });
    };
    reader.readAsText(f);
  }

  const blocked = preview?.errors?.length > 0;

  // ── Import records ───────────────────────────────────────────────
  async function handleImport() {
    if (!preview || blocked || preview.records.length === 0) return;
    setImporting(true);
    try {
      const { data } = await client.post('/attendance/bulk', {
        records: preview.records.map((r) => ({
          studentId: r.studentId,
          date: r.date,
          status: r.status,
          remarks: r.remarks,
        })),
        skipExisting,
      });
      setResult({
        updated: data.updated,
        skipped: data.skipped || 0,
        attempted: data.attempted || preview.records.length,
      });
      setFile(null);
      setPreview(null);
      onImported?.();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="bg-white border border-ink/10 rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg text-ink">
          Import attendance — {monthLabel}{classLabel ? ` · ${classLabel}` : ''}
        </h3>
        <button onClick={onClose} className="text-sm text-slate2 hover:underline">Close</button>
      </div>

      <p className="text-xs text-slate2 mb-3">
        Students are matched on <span className="font-medium">Admission No</span>, then <span className="font-medium">Name</span>.
        Date columns can be in <code>DD/MM/YYYY</code>, <code>YYYY-MM-DD</code>, or <code>DD-MM-YYYY</code> format.
        Fill cells with <span className="font-medium">P</span>/<span className="font-medium">A</span>/
        <span className="font-medium">L</span>/<span className="font-medium">E</span> (or full words).
        <span className="font-medium"> Blank cells are skipped</span> — existing data is never changed.
        A sheet with any invalid cell imports nothing.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={downloadSample} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper">
          Download {monthLabel} sheet
        </button>
        <label className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-paper cursor-pointer">
          {file ? file.name : 'Choose CSV file…'}
          <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
        </label>
      </div>

      {result && (
        <p className="text-sm text-present mb-4">
          Imported {result.updated} record{result.updated === 1 ? '' : 's'}
          {result.skipped > 0 && `, ${result.skipped} already existed`}
          {` (${result.attempted} total)`}
        </p>
      )}

      {preview && (
        <div className="border border-ink/10 rounded-md p-4 mb-4">
          <p className="text-sm mb-2">
            {preview.records.length} record{preview.records.length === 1 ? '' : 's'} to import
            {preview.unmatched.length > 0 && `, ${preview.unmatched.length} unmatched`}
            {preview.errors.length > 0 && `, ${preview.errors.length} error${preview.errors.length === 1 ? '' : 's'}`}
            {preview.isMonthly && <span className="text-xs text-slate2 ml-2">(monthly matrix detected)</span>}
          </p>

          {preview.errors.length > 0 && (
            <div className="mb-2 max-h-40 overflow-y-auto">
              {preview.errors.map((e, idx) => (
                <p key={idx} className="text-xs text-absent">Row {e.rowNumber}{e.name ? ` · ${e.name}` : ''}: {e.message}</p>
              ))}
            </div>
          )}

          {preview.unmatched.length > 0 && (
            <details className="mb-2">
              <summary className="text-xs text-slate2 cursor-pointer">{preview.unmatched.length} unmatched row(s)</summary>
              <div className="mt-1 max-h-32 overflow-y-auto">
                {preview.unmatched.map((u, idx) => (
                  <p key={idx} className="text-xs text-slate2">Row {u.rowNumber}: {u.message}</p>
                ))}
              </div>
            </details>
          )}

          {blocked ? (
            <p className="text-xs text-absent">Fix the row(s) above and re-upload — nothing was imported.</p>
          ) : (
            <button
              onClick={handleImport}
              disabled={importing || preview.records.length === 0}
              className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
            >
              {importing ? 'Importing…' : `Import ${preview.records.length} record${preview.records.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
