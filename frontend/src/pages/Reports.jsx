import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { ReportToolbar, ReportTitle, ClassPicker } from '../components/reportKit';
import ExamBroadSheet from './reports/ExamBroadSheet';
import ReportCard from './reports/ReportCard';
import SubjectStats from './reports/SubjectStats';
import { exportRowsToCSV } from '../utils/csv';
import { sectionsForMany, sectionsFor } from '../utils/sections';

const REPORT_TABS = [
  { key: 'section', label: 'Class / Section List' },
  { key: 'summary', label: 'Classwise Summary' },
  { key: 'combined', label: 'Combined Report' },
  { key: 'group', label: 'Bio / Computer Group' },
  { key: 'orphan', label: 'Orphan Children' },
  { key: 'exit', label: 'Struck Off / SLC / Passout' },
  { key: 'attendance', label: 'Attendance %' },
  { key: 'attendanceSummary', label: 'Daily / Monthly Attendance Summary' },
  { key: 'broadsheet', label: 'Exam Broad Sheet' },
  { key: 'reportCard', label: 'Report Cards' },
  { key: 'subjectStats', label: 'Subject Pass % / GPA' },
];

export default function Reports() {
  const [tab, setTab] = useState('section');
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    client.get('/classes').then((res) => setClasses(res.data));
  }, []);

  return (
    <div>
      <PageHeader eyebrow="Reports" title="Reports" />

      {/* Printing (or "Export CSV"'s neighbour, the Print button on each
          report) should show only the report table itself — not the
          sidebar, page header, or tab bar around it. The tab bar and each
          report's own filter controls already carry print:hidden; this
          rule hides everything else on the page and reveals only what's
          inside .print-area. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; inset: 0; width: 100%; }
          /* The report tables scroll horizontally on screen; printing
             should lay the whole table out flat instead of showing (or
             worse, printing) that scrollbar. */
          .print-area .overflow-x-auto {
            overflow: visible !important;
          }
          .print-area .overflow-x-auto::-webkit-scrollbar {
            display: none;
          }
        }
      `}</style>

      <div className="flex flex-wrap gap-2 mb-6 print:hidden">
        {REPORT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors ${
              tab === t.key ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-slate2 hover:bg-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="print-area">
        {tab === 'section' && <SectionListReport classes={classes} />}
        {tab === 'summary' && <SummaryReport />}
        {tab === 'combined' && <CombinedReport classes={classes} />}
        {tab === 'group' && <GroupReport classes={classes} />}
        {tab === 'orphan' && <OrphanReport classes={classes} />}
        {tab === 'exit' && <ExitStatusReport />}
        {tab === 'attendance' && <AttendanceReport classes={classes} />}
        {tab === 'attendanceSummary' && <AttendanceSummaryReport />}
        {tab === 'broadsheet' && <ExamBroadSheet classes={classes} />}
        {tab === 'reportCard' && <ReportCard />}
        {tab === 'subjectStats' && <SubjectStats classes={classes} />}
      </div>
    </div>
  );
}

// Shared toolbar with Print + CSV export, used by every report below.
// Moved to components/reportKit.jsx so the exam reports can use them too.
// ---- 1. Class / Section List — a printable roll for one or more classes ----
function SectionListReport({ classes }) {
  const [classIds, setClassIds] = useState([]);
  const [section, setSection] = useState('');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (classes.length && classIds.length === 0) setClassIds([String(classes[0].id)]);
  }, [classes]);

  const sectionOptions = sectionsForMany(classes, classIds);

  // Un-ticking a class can leave a section selected that no longer exists in
  // any of the remaining ones, which would silently report zero students.
  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [classIds]);

  useEffect(() => {
    if (classIds.length) load();
    else setStudents([]);
  }, [classIds, section]);

  function toggleClass(id) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/students', {
        params: { classId: classIds.join(','), status: 'REGULAR', ...(section ? { section } : {}), pageSize: 1000 },
      });
      setStudents(data.students);
    } finally {
      setLoading(false);
    }
  }

  const selectedClasses = classes.filter((c) => classIds.includes(String(c.id)));
  const title = selectedClasses.map((c) => c.name).join(', ') || 'Class';

  function handleExport() {
    exportRowsToCSV(
      `class-list-${title.replace(/[,\s]+/g, '-') || 'class'}${section ? `-${section}` : ''}.csv`,
      [
        { key: 'rollNumber', label: 'Roll No.' },
        { key: 'admissionNumber', label: 'Admission No.' },
        { key: 'name', label: 'Name' },
        { key: 'fatherName', label: 'Father Name' },
        { key: 'contactNo', label: 'Contact No.' },
        { key: 'className', label: 'Class' },
        { key: 'section', label: 'Section' },
      ],
      students.map((s) => ({
        rollNumber: s.rollNumber || '',
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        fatherName: s.guardianName,
        contactNo: s.guardianPhone || '',
        className: s.class?.name || '',
        section: s.section || '',
      }))
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4 print:hidden items-start">
        <ClassPicker classes={classes} classIds={classIds} onToggle={toggleClass} />

        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="">Whole class</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      <ReportTitle>Class List — {title}{section ? ` (Section ${section})` : ''}</ReportTitle>
      <ReportToolbar onExportCSV={handleExport} count={students.length} noun="student" />

      <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Roll No.</th>
              <th className="px-4 py-3">Admission No.</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Father Name</th>
              <th className="px-4 py-3">Contact No.</th>
              {selectedClasses.length > 1 && <th className="px-4 py-3">Class</th>}
              {!section && sectionOptions.length > 0 && <th className="px-4 py-3">Section</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={7}>Loading…</td></tr>
            ) : students.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={7}>No students in the selected class(es).</td></tr>
            ) : (
              students.map((s) => (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{s.rollNumber || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.admissionNumber}</td>
                  <td className="px-4 py-3">{s.firstName} {s.lastName}</td>
                  <td className="px-4 py-3 text-slate2">{s.guardianName}</td>
                  <td className="px-4 py-3 text-slate2">{s.guardianPhone || '—'}</td>
                  {selectedClasses.length > 1 && <td className="px-4 py-3 text-slate2">{s.class?.name || '—'}</td>}
                  {!section && sectionOptions.length > 0 && <td className="px-4 py-3 text-slate2">{s.section || '—'}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- 2. Classwise Summary — orphan / struck off / SLC counts per class ----
function SummaryReport() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/students/reports/summary').then((res) => {
      setRows(res.data);
      setLoading(false);
    });
  }, []);

  function handleExport() {
    exportRowsToCSV(
      'classwise-summary.csv',
      [
        { key: 'className', label: 'Class' },
        { key: 'regular', label: 'Regular Students' },
        { key: 'singleOrphan', label: 'Single Orphan' },
        { key: 'doubleOrphan', label: 'Double Orphan' },
        { key: 'struckOff', label: 'Struck Off' },
        { key: 'slc', label: 'SLC' },
        { key: 'passout', label: 'Passout' },
        { key: 'computerGroup', label: 'Computer Group' },
        { key: 'biologyGroup', label: 'Biology Group' },
      ],
      rows
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      regular: acc.regular + r.regular,
      singleOrphan: acc.singleOrphan + r.singleOrphan,
      doubleOrphan: acc.doubleOrphan + r.doubleOrphan,
      struckOff: acc.struckOff + r.struckOff,
      slc: acc.slc + r.slc,
      passout: acc.passout + r.passout,
    }),
    { regular: 0, singleOrphan: 0, doubleOrphan: 0, struckOff: 0, slc: 0, passout: 0 }
  );

  return (
    <div>
      <ReportTitle>Classwise Summary</ReportTitle>
      <ReportToolbar onExportCSV={handleExport} count={rows.length} noun="class" />

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-3 py-3">Class</th>
              <th className="px-3 py-3">Regular</th>
              <th className="px-3 py-3">Single Orphan</th>
              <th className="px-3 py-3">Double Orphan</th>
              <th className="px-3 py-3">Struck Off</th>
              <th className="px-3 py-3">SLC</th>
              <th className="px-3 py-3">Passout</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-6 text-slate2" colSpan={7}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-3 py-6 text-slate2" colSpan={7}>No classes yet.</td></tr>
            ) : (
              <>
                {rows.map((r) => (
                  <tr key={r.classId} className="border-b border-ink/5 last:border-0">
                    <td className="px-3 py-3 font-medium">{r.className}</td>
                    <td className="px-3 py-3">{r.regular}</td>
                    <td className="px-3 py-3">{r.singleOrphan}</td>
                    <td className="px-3 py-3">{r.doubleOrphan}</td>
                    <td className="px-3 py-3">{r.struckOff}</td>
                    <td className="px-3 py-3">{r.slc}</td>
                    <td className="px-3 py-3">{r.passout}</td>
                  </tr>
                ))}
                <tr className="bg-paper font-medium">
                  <td className="px-3 py-3">Total</td>
                  <td className="px-3 py-3">{totals.regular}</td>
                  <td className="px-3 py-3">{totals.singleOrphan}</td>
                  <td className="px-3 py-3">{totals.doubleOrphan}</td>
                  <td className="px-3 py-3">{totals.struckOff}</td>
                  <td className="px-3 py-3">{totals.slc}</td>
                  <td className="px-3 py-3">{totals.passout}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- 2b. Combined Report — one wide ledger-style sheet: a column per
// class+section, grouped into Secondary (grade 9-10) / Middle (grade 6-8)
// / Other with running sub-totals, then a grand total. Rows: student
// count, age distribution (as of a chosen date), religion, orphan status,
// and Bio/Computer group — mirroring the school's existing paper report.
// The row label is repeated in the last column too, since the sheet is
// meant to be read across a wide printed page.
function CombinedReport({ classes }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [classIds, setClassIds] = useState([]);
  const [asOf, setAsOf] = useState(todayISO);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);

  // Default to every class the first time the class list loads — this
  // report is normally run for the whole school at once.
  useEffect(() => {
    if (classes.length && classIds.length === 0) setClassIds(classes.map((c) => String(c.id)));
  }, [classes]);

  function toggleClass(id) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  useEffect(() => {
    if (classIds.length) load();
    else setStudents([]);
  }, [classIds]);

  async function load() {
    setLoading(true);
    try {
      // The API caps pageSize at 200 server-side (see students.js), so a
      // single request silently truncates once the combined class
      // selection has more students than that — whichever section sorts
      // last (classId, then section) quietly disappears. Page through
      // until every matching student has been fetched.
      let all = [];
      let page = 1;
      const pageSize = 200;
      while (true) {
        const { data } = await client.get('/students', {
          params: { classId: classIds.join(','), status: 'REGULAR', page, pageSize },
        });
        all = all.concat(data.students);
        if (data.students.length === 0 || all.length >= data.total) break;
        page += 1;
      }
      setStudents(all);
    } finally {
      setLoading(false);
    }
  }

  const selectedClasses = classes.filter((c) => classIds.includes(String(c.id)));

  // Grade number parsed out of the class name ("9th" -> 9, "Grade 10" -> 10),
  // same convention used for GradeScale matching. Classes 9-10 are treated
  // as "Secondary" (where the Bio/Computer split applies), 6-8 as "Middle" —
  // anything else falls into "Other" so the report still covers it.
  function gradeOf(cls) {
    const m = String(cls.name).match(/\d+/);
    return m ? Number(m[0]) : null;
  }
  function groupOf(cls) {
    const g = gradeOf(cls);
    if (g === null) return 'Other';
    if (g >= 9) return 'Secondary';
    if (g >= 6) return 'Middle';
    return 'Other';
  }

  const groups = ['Secondary', 'Middle', 'Other']
    .map((name) => ({
      name,
      classes: selectedClasses.filter((c) => groupOf(c) === name).sort((a, b) => (gradeOf(b) ?? -1) - (gradeOf(a) ?? -1)),
    }))
    .filter((g) => g.classes.length > 0);

  function columnLabel(cls, section) {
    const grade = gradeOf(cls);
    if (section) return `${grade ?? cls.name}${section}`.trim();
    return grade !== null ? String(grade) : cls.name;
  }

  // ---- Flat column list: section columns, a "Total" column for any class
  // with more than one section, a group-total column when there's more
  // than one group to distinguish, and a grand total at the very end. ----
  const columns = [];
  groups.forEach((g) => {
    g.classes.forEach((cls) => {
      const secs = sectionsFor(classes, cls.id);
      const sectionCols = secs.length ? secs : [null];
      sectionCols.forEach((sec) => {
        columns.push({ kind: 'section', classId: cls.id, section: sec, label: columnLabel(cls, sec) });
      });
      if (secs.length > 1) {
        columns.push({ kind: 'classTotal', classId: cls.id, label: 'Total' });
      }
    });
    if (groups.length > 1) {
      columns.push({ kind: 'groupTotal', group: g.name, label: `${g.name.toUpperCase()} TOTAL` });
    }
  });
  columns.push({ kind: 'grandTotal', label: 'G. Total' });

  function matches(col, s) {
    if (col.kind === 'grandTotal') return true;
    if (col.kind === 'groupTotal') return groupOf(classes.find((c) => String(c.id) === String(s.classId)) || {}) === col.group;
    if (col.kind === 'classTotal') return String(s.classId) === String(col.classId);
    if (String(s.classId) !== String(col.classId)) return false;
    if (col.section === null) return true; // class has no sections defined — the whole class is one column
    return (s.section || '').trim().toLowerCase() === col.section.trim().toLowerCase();
  }

  function count(col, predicate) {
    return students.filter((s) => matches(col, s) && predicate(s)).length;
  }

  // ---- Age, as of the chosen date (defaults to today) ----
  function ageOf(s) {
    if (!s.dateOfBirth) return null;
    const dob = new Date(s.dateOfBirth);
    const ref = new Date(asOf);
    let age = ref.getFullYear() - dob.getFullYear();
    const hadBirthday = ref.getMonth() > dob.getMonth() || (ref.getMonth() === dob.getMonth() && ref.getDate() >= dob.getDate());
    if (!hadBirthday) age -= 1;
    return age;
  }
  const ages = students.map(ageOf).filter((a) => a !== null);
  const ageRange = [];
  if (ages.length) {
    for (let a = Math.max(...ages); a >= Math.min(...ages); a--) ageRange.push(a);
  }

  // religion is freeform text — bucket anything starting "Muslim" (or
  // exactly "Islam") as Muslim, everything else (including blank) as
  // Non-Muslim, same two buckets as the paper report.
  function isMuslim(s) {
    const r = (s.religion || '').trim().toLowerCase();
    return r === 'islam' || r.startsWith('muslim');
  }
  const isOrphan = (s) => s.orphanStatus === 'SINGLE' || s.orphanStatus === 'DOUBLE';

  function handleExport() {
    const colDefs = [{ key: 'row', label: '' }, ...columns.map((c, i) => ({ key: `c${i}`, label: c.label }))];
    const addRow = (label, predicate) => {
      const row = { row: label };
      columns.forEach((c, i) => { row[`c${i}`] = count(c, predicate); });
      return row;
    };
    const rows = [
      addRow('Total', () => true),
      ...ageRange.map((a) => addRow(String(a), (s) => ageOf(s) === a)),
      addRow('Muslim', isMuslim),
      addRow('Non-Muslim', (s) => !isMuslim(s)),
      addRow('Orphan', isOrphan),
      addRow('Bio', (s) => s.studentGroup === 'BIOLOGY'),
      addRow('Comp.', (s) => s.studentGroup === 'COMPUTER'),
    ];
    exportRowsToCSV(`combined-report-${asOf}.csv`, colDefs, rows);
  }

  const emphasize = (col) => col.kind !== 'section'; // Total / group-total / grand-total columns

  function DataRow({ label, predicate }) {
    return (
      <tr className="border-b border-ink/5">
        <td className="px-2 py-1.5 font-medium sticky left-0 bg-white">{label}</td>
        {columns.map((c, i) => (
          <td key={i} className={`px-2 py-1.5 ${emphasize(c) ? 'bg-paper font-medium' : ''}`}>
            {count(c, predicate)}
          </td>
        ))}
        <td className="px-2 py-1.5 font-medium sticky right-0 bg-white">{label}</td>
      </tr>
    );
  }

  return (
    <div>
      <ReportTitle>Combined Report — as of {asOf}</ReportTitle>

      <div className="flex flex-wrap gap-4 mb-4 print:hidden items-start">
        <ClassPicker classes={classes} classIds={classIds} onToggle={toggleClass} label="Classes to combine" />
        <div>
          <label className="block text-sm text-slate2 mb-1">Age as of</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
          />
        </div>
      </div>

      <ReportToolbar onExportCSV={handleExport} count={students.length} noun="student" />

      {loading ? (
        <p className="text-slate2 text-sm">Loading…</p>
      ) : columns.length <= 1 ? (
        <p className="text-slate2 text-sm">Pick at least one class to build the report.</p>
      ) : (
        <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
          <table className="register-table w-full text-xs text-center border-collapse">
            <thead>
              <tr className="border-b border-ink/10">
                <th className="px-2 py-2 sticky left-0 bg-ink/5">Age</th>
                {columns.map((c, i) => (
                  <th key={i} className={`px-2 py-2 whitespace-nowrap ${emphasize(c) ? 'bg-paper' : 'bg-ink/5'}`}>
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2 sticky right-0 bg-ink/5">Age</th>
              </tr>
            </thead>
            <tbody>
              <DataRow label="Total" predicate={() => true} />
              <tr><td colSpan={columns.length + 2} className="py-1"></td></tr>
              {ageRange.map((a) => (
                <DataRow key={a} label={a} predicate={(s) => ageOf(s) === a} />
              ))}
              <tr><td colSpan={columns.length + 2} className="py-1"></td></tr>
              <DataRow label="Muslim" predicate={isMuslim} />
              <DataRow label="Non-Muslim" predicate={(s) => !isMuslim(s)} />
              <tr><td colSpan={columns.length + 2} className="py-1"></td></tr>
              <DataRow label="Orphan" predicate={isOrphan} />
              <tr><td colSpan={columns.length + 2} className="py-1"></td></tr>
              <DataRow label="Bio" predicate={(s) => s.studentGroup === 'BIOLOGY'} />
              <DataRow label="Comp." predicate={(s) => s.studentGroup === 'COMPUTER'} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- 3. Bio / Computer group report — classwise breakdown + drill-down list ----
function GroupReport({ classes }) {
  const [summary, setSummary] = useState([]);
  const [classIds, setClassIds] = useState([]);
  const [section, setSection] = useState('');
  const [group, setGroup] = useState('COMPUTER');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/students/reports/summary').then((res) => {
      setSummary(res.data);
      setLoading(false);
    });
  }, []);

  const sectionOptions = sectionsForMany(classes, classIds);

  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [classIds]);

  useEffect(() => {
    if (classIds.length) loadStudents();
    else setStudents([]);
  }, [classIds, section, group]);

  function toggleClass(id) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function loadStudents() {
    const { data } = await client.get('/students', {
      params: { classId: classIds.join(','), status: 'REGULAR', studentGroup: group, ...(section ? { section } : {}), pageSize: 1000 },
    });
    setStudents(data.students);
  }

  function handleExport() {
    exportRowsToCSV(
      `${group.toLowerCase()}-group.csv`,
      [
        { key: 'admissionNumber', label: 'Admission No.' },
        { key: 'name', label: 'Name' },
        { key: 'className', label: 'Class' },
        { key: 'section', label: 'Section' },
      ],
      students.map((s) => ({
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        className: s.class?.name,
        section: s.section || '',
      }))
    );
  }

  return (
    <div>
      <ReportTitle>Bio / Computer Group Report</ReportTitle>

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto mb-6 print:hidden">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-3 py-3">Class</th>
              <th className="px-3 py-3">Computer Science</th>
              <th className="px-3 py-3">Biology</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4 text-slate2" colSpan={3}>Loading…</td></tr>
            ) : (
              summary
                .filter((r) => r.computerGroup > 0 || r.biologyGroup > 0)
                .map((r) => (
                  <tr key={r.classId} className="border-b border-ink/5 last:border-0">
                    <td className="px-3 py-3 font-medium">{r.className}</td>
                    <td className="px-3 py-3">{r.computerGroup}</td>
                    <td className="px-3 py-3">{r.biologyGroup}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 print:hidden items-start">
        <ClassPicker classes={classes} classIds={classIds} onToggle={toggleClass} label="Classes (pick several to combine, e.g. 9A, 9B, 9C)" />
        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="">Whole class</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm text-slate2 mb-1">Group</label>
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
            <option value="COMPUTER">Computer Science</option>
            <option value="BIOLOGY">Biology</option>
          </select>
        </div>
      </div>

      {classIds.length > 0 && (
        <>
          <ReportToolbar onExportCSV={handleExport} count={students.length} noun="student" />
          <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Admission No.</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">Section</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={4}>No students in this group for the selected class(es).</td></tr>
                ) : (
                  students.map((s) => (
                    <tr key={s.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{s.admissionNumber}</td>
                      <td className="px-4 py-3">{s.firstName} {s.lastName}</td>
                      <td className="px-4 py-3 text-slate2">{s.class?.name}</td>
                      <td className="px-4 py-3 text-slate2">{s.section || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- 4. Orphan children report — classwise, with drill-down list ----
function OrphanReport({ classes }) {
  const [summary, setSummary] = useState([]);
  const [classIds, setClassIds] = useState([]);
  const [section, setSection] = useState('');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/students/reports/summary').then((res) => {
      setSummary(res.data);
      setLoading(false);
    });
  }, []);

  const sectionOptions = sectionsForMany(classes, classIds);

  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [classIds]);

  useEffect(() => {
    if (classIds.length) loadStudents();
    else setStudents([]);
  }, [classIds, section]);

  function toggleClass(id) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function loadStudents() {
    const classId = classIds.join(',');
    const sectionParam = section ? { section } : {};
    const [single, double] = await Promise.all([
      client.get('/students', { params: { classId, status: 'REGULAR', orphanStatus: 'SINGLE', ...sectionParam, pageSize: 1000 } }),
      client.get('/students', { params: { classId, status: 'REGULAR', orphanStatus: 'DOUBLE', ...sectionParam, pageSize: 1000 } }),
    ]);
    setStudents([...single.data.students, ...double.data.students]);
  }

  function handleExport() {
    exportRowsToCSV(
      'orphan-children.csv',
      [
        { key: 'admissionNumber', label: 'Admission No.' },
        { key: 'name', label: 'Name' },
        { key: 'className', label: 'Class' },
        { key: 'section', label: 'Section' },
        { key: 'orphanStatus', label: 'Orphan Status' },
        { key: 'contactNo', label: 'Contact No.' },
      ],
      students.map((s) => ({
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        className: s.class?.name,
        section: s.section || '',
        orphanStatus: s.orphanStatus === 'DOUBLE' ? 'Double Orphan' : 'Single Orphan',
        contactNo: s.guardianPhone || '',
      }))
    );
  }

  return (
    <div>
      <ReportTitle>Orphan Children Report</ReportTitle>

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto mb-6 print:hidden">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-3 py-3">Class</th>
              <th className="px-3 py-3">Single Orphan</th>
              <th className="px-3 py-3">Double Orphan</th>
              <th className="px-3 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-4 text-slate2" colSpan={4}>Loading…</td></tr>
            ) : (
              summary
                .filter((r) => r.totalOrphan > 0)
                .map((r) => (
                  <tr key={r.classId} className="border-b border-ink/5 last:border-0">
                    <td className="px-3 py-3 font-medium">{r.className}</td>
                    <td className="px-3 py-3">{r.singleOrphan}</td>
                    <td className="px-3 py-3">{r.doubleOrphan}</td>
                    <td className="px-3 py-3 font-medium">{r.totalOrphan}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 print:hidden items-start">
        <ClassPicker classes={classes} classIds={classIds} onToggle={toggleClass} label="Classes (pick several to combine, e.g. 9A, 9B, 9C)" />
        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="">Whole class</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      {classIds.length > 0 && (
        <>
          <ReportToolbar onExportCSV={handleExport} count={students.length} noun="student" />
          <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Admission No.</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Class</th>
                  {!section && sectionOptions.length > 0 && <th className="px-4 py-3">Section</th>}
                  <th className="px-4 py-3">Orphan Status</th>
                  <th className="px-4 py-3">Contact No.</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={6}>No orphan children in the selected class(es).</td></tr>
                ) : (
                  students.map((s) => (
                    <tr key={s.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{s.admissionNumber}</td>
                      <td className="px-4 py-3">{s.firstName} {s.lastName}</td>
                      <td className="px-4 py-3 text-slate2">{s.class?.name || '—'}</td>
                      {!section && sectionOptions.length > 0 && <td className="px-4 py-3 text-slate2">{s.section || '—'}</td>}
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.orphanStatus === 'DOUBLE' ? 'bg-absent/10 text-absent' : 'bg-late/10 text-late'}`}>
                          {s.orphanStatus === 'DOUBLE' ? 'Double' : 'Single'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate2">{s.guardianPhone || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- 5. Struck Off / SLC / Passout — kept from before ----
function ExitStatusReport() {
  const [status, setStatus] = useState('STRUCK_OFF');
  const [students, setStudents] = useState([]);
  const [suspensions, setSuspensions] = useState([]);
  const [history, setHistory] = useState(false); // suspended tab: include finished suspensions
  const [loading, setLoading] = useState(true);

  const STATUS_TABS = [
    { key: 'STRUCK_OFF', label: 'Struck Off' },
    { key: 'SLC', label: 'SLC' },
    { key: 'SUSPENDED', label: 'Suspended' },
    { key: 'PASSOUT', label: 'Passout' },
  ];

  useEffect(() => {
    load(status);
  }, [status, history]);

  const fmtDay = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
  const stateLabel = { ACTIVE: 'Suspended now', UPCOMING: 'Starts later', COMPLETED: 'Finished', CANCELLED: 'Ended early' };

  async function load(s) {
    setLoading(true);
    try {
      if (s === 'SUSPENDED') {
        const { data } = await client.get('/students/suspensions', { params: { when: history ? 'history' : 'current' } });
        setSuspensions(data);
        return;
      }
      const { data } = await client.get('/students', { params: { status: s, pageSize: 500 } });
      setStudents(data.students);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (status === 'SUSPENDED') {
      exportRowsToCSV(
        'suspended-students.csv',
        [
          { key: 'admissionNumber', label: 'Admission No.' },
          { key: 'name', label: 'Name' },
          { key: 'className', label: 'Class' },
          { key: 'from', label: 'Suspended From' },
          { key: 'till', label: 'Suspended Till' },
          { key: 'reason', label: 'Reason' },
          { key: 'state', label: 'Status' },
        ],
        suspensions.map((x) => ({
          admissionNumber: x.admissionNumber,
          name: x.name,
          className: `${x.className} ${x.section}`.trim(),
          from: fmtDay(x.startDate),
          till: fmtDay(x.endDate),
          reason: x.reason,
          state: stateLabel[x.state],
        }))
      );
      return;
    }
    exportRowsToCSV(
      `${status.toLowerCase()}-students.csv`,
      [
        { key: 'admissionNumber', label: 'Admission No.' },
        { key: 'name', label: 'Name' },
        { key: 'className', label: 'Class' },
        { key: 'fatherName', label: 'Father Name' },
        { key: 'contactNo', label: 'Contact No.' },
      ],
      students.map((s) => ({
        admissionNumber: s.admissionNumber,
        name: `${s.firstName} ${s.lastName}`,
        className: s.class?.name,
        fatherName: s.guardianName,
        contactNo: s.guardianPhone || '',
      }))
    );
  }

  return (
    <div>
      <ReportTitle>{STATUS_TABS.find((t) => t.key === status)?.label} Students</ReportTitle>

      <div className="flex gap-2 mb-4 print:hidden">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              status === t.key ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-slate2 hover:bg-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {status === 'SUSPENDED' ? (
        <>
          <label className="flex items-center gap-2 text-sm text-slate2 mb-3 print:hidden">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            Include finished and earlier suspensions
          </label>
          <ReportToolbar onExportCSV={handleExport} count={suspensions.length} noun="suspension" />
          <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Admission No.</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">Suspended from</th>
                  <th className="px-4 py-3">Suspended till</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={7}>Loading…</td></tr>
                ) : suspensions.length === 0 ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={7}>No suspended students.</td></tr>
                ) : (
                  suspensions.map((x) => (
                    <tr key={x.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{x.admissionNumber}</td>
                      <td className="px-4 py-3">{x.name}</td>
                      <td className="px-4 py-3 text-slate2">{x.className} {x.section}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDay(x.startDate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDay(x.endDate)}</td>
                      <td className="px-4 py-3 text-slate2">{x.reason || '—'}</td>
                      <td className="px-4 py-3 text-slate2">{stateLabel[x.state]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
      <ReportToolbar onExportCSV={handleExport} count={students.length} noun="student" />

      <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Admission No.</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Father Name</th>
              <th className="px-4 py-3">Contact No.</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={5}>Loading…</td></tr>
            ) : students.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={5}>No students with this status.</td></tr>
            ) : (
              students.map((s) => (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{s.admissionNumber}</td>
                  <td className="px-4 py-3">{s.firstName} {s.lastName}</td>
                  <td className="px-4 py-3 text-slate2">{s.class?.name} {s.section}</td>
                  <td className="px-4 py-3 text-slate2">{s.guardianName}</td>
                  <td className="px-4 py-3 text-slate2">{s.guardianPhone || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
}

// ---- 6. Attendance % — monthly or yearly, Sat/Sun + declared holidays excluded ----
function AttendanceReport({ classes }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [classIds, setClassIds] = useState([]);
  const [section, setSection] = useState('');
  const [mode, setMode] = useState('month'); // 'month' | 'year'
  const [month, setMonth] = useState(todayISO.slice(0, 7)); // "YYYY-MM"
  const [year, setYear] = useState(Number(todayISO.slice(0, 4)));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (classes.length && classIds.length === 0) setClassIds([String(classes[0].id)]);
  }, [classes]);

  // Sections offered are the union across whichever classes are ticked.
  const sectionOptions = sectionsForMany(classes, classIds);

  // Un-ticking a class can leave a section selected that no longer exists in
  // any of the remaining ones, which would silently report zero students.
  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [classIds]);

  function toggleClass(id) {
    setClassIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function rangeForMode() {
    if (mode === 'month') {
      const [y, m] = month.split('-').map(Number);
      const from = `${month}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const to = `${month}-${String(lastDay).padStart(2, '0')}`;
      return { from, to };
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }

  useEffect(() => {
    if (classIds.length) load();
    else setReport(null);
  }, [classIds, section, mode, month, year]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { from, to } = rangeForMode();
      const { data } = await client.get('/attendance/report', {
        params: { classId: classIds.join(','), from, to, ...(section ? { section } : {}) },
      });
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the attendance report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!report) return;
    const multi = report.rows.some((r, i, arr) => r.className !== arr[0].className);
    exportRowsToCSV(
      `attendance-${mode === 'month' ? month : year}${section ? `-${section}` : ''}.csv`,
      [
        { key: 'rollNumber', label: 'Roll No.' },
        { key: 'admissionNumber', label: 'Admission No.' },
        { key: 'name', label: 'Name' },
        ...(multi ? [{ key: 'className', label: 'Class' }] : []),
        { key: 'section', label: 'Section' },
        { key: 'present', label: 'Present' },
        { key: 'late', label: 'Late' },
        { key: 'leave', label: 'Leave' },
        { key: 'absent', label: 'Absent' },
        { key: 'totalWorkingDays', label: 'Working Days' },
        { key: 'percentage', label: 'Attendance %' },
      ],
      report.rows
    );
  }

  const selectedClasses = classes.filter((c) => classIds.includes(String(c.id)));
  const multiClass = selectedClasses.length > 1;

  return (
    <div>
      <ReportTitle>
        Attendance % — {selectedClasses.map((c) => c.name).join(', ')}
        {section ? ` (Section ${section})` : ''} — {mode === 'month' ? month : year}
      </ReportTitle>

      <div className="flex flex-wrap gap-4 mb-4 print:hidden items-start">
        <ClassPicker classes={classes} classIds={classIds} onToggle={toggleClass} label="Classes (pick several to combine)" />

        {sectionOptions.length > 0 && (
          <div>
            <label className="block text-sm text-slate2 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="">Whole class</option>
              {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="text-xs text-slate2 mt-1">Working days are unaffected by this.</p>
          </div>
        )}

        <div>
          <label className="block text-sm text-slate2 mb-1">Period</label>
          <div className="flex gap-1.5 mb-2">
            {[
              { key: 'month', label: 'Monthly' },
              { key: 'year', label: 'Yearly' },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  mode === m.key ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-slate2 hover:bg-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'month' ? (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            />
          ) : (
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white text-sm"
            >
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && <p className="text-absent text-sm mb-4">{error}</p>}

      {report && (
        <p className="text-sm text-slate2 mb-4">
          {report.totalWorkingDays} working day{report.totalWorkingDays === 1 ? '' : 's'} in this period
          (weekends and {report.holidays.length} declared holiday{report.holidays.length === 1 ? '' : 's'} excluded).
          A working day with no record marked for a student counts as absent.
        </p>
      )}

      <ReportToolbar onExportCSV={handleExport} count={report?.rows.length || 0} noun="student" />

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Roll</th>
              <th className="px-4 py-3">Admission No.</th>
              <th className="px-4 py-3">Name</th>
              {multiClass && <th className="px-4 py-3">Class</th>}
              <th className="px-4 py-3">Section</th>
              <th className="px-4 py-3">Present</th>
              <th className="px-4 py-3">Late</th>
              <th className="px-4 py-3">Leave</th>
              <th className="px-4 py-3">Absent</th>
              <th className="px-4 py-3">Working Days</th>
              <th className="px-4 py-3">Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={11}>Loading…</td></tr>
            ) : !report || report.rows.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={11}>No students to report on.</td></tr>
            ) : (
              report.rows.map((r) => (
                <tr key={r.studentId} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{r.rollNumber || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.admissionNumber}</td>
                  <td className="px-4 py-3">{r.name}</td>
                  {multiClass && <td className="px-4 py-3 text-slate2">{r.className}</td>}
                  <td className="px-4 py-3 text-slate2">{r.section || '—'}</td>
                  <td className="px-4 py-3">{r.present}</td>
                  <td className="px-4 py-3">{r.late}</td>
                  <td className="px-4 py-3">{r.leave}</td>
                  <td className="px-4 py-3">{r.absent}</td>
                  <td className="px-4 py-3 text-slate2">{r.totalWorkingDays}</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${r.percentage < 75 ? 'text-absent' : 'text-present'}`}>
                      {r.percentage}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Daily / Monthly Attendance Summary — one row per class+section:
// Total Students, Present, On Leave, Absent. Daily is a single day's
// snapshot; Monthly sums the same counts across every working day in that
// month (so the Present/Leave/Absent figures can add up to more than Total
// Students — they're counts of markings across the month, not a headcount).
function AttendanceSummaryReport() {
  const [mode, setMode] = useState('daily'); // 'daily' | 'monthly'
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date, month]);

  async function load() {
    setLoading(true);
    try {
      const params = mode === 'daily' ? { date } : { month };
      const { data } = await client.get('/attendance/classwise-summary', { params });
      setRows(data.rows);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    exportRowsToCSV(
      `attendance-summary-${mode === 'daily' ? date : month}.csv`,
      [
        { key: 'className', label: 'Class' },
        { key: 'section', label: 'Section' },
        { key: 'totalStudents', label: 'Total Students' },
        { key: 'present', label: 'Present' },
        { key: 'leave', label: 'On Leave' },
        { key: 'absent', label: 'Absent' },
      ],
      rows.map((r) => ({ ...r, section: r.section || '—' }))
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      totalStudents: acc.totalStudents + r.totalStudents,
      present: acc.present + r.present,
      leave: acc.leave + r.leave,
      absent: acc.absent + r.absent,
    }),
    { totalStudents: 0, present: 0, leave: 0, absent: 0 }
  );

  return (
    <div>
      <ReportTitle>Daily / Monthly Attendance Summary</ReportTitle>

      <div className="flex flex-wrap gap-4 mb-4 items-end print:hidden">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('daily')}
            className={`text-sm px-4 py-2 rounded-md border ${mode === 'daily' ? 'bg-ink text-paper border-ink' : 'border-ink/20 hover:bg-white'}`}
          >
            Daily
          </button>
          <button
            onClick={() => setMode('monthly')}
            className={`text-sm px-4 py-2 rounded-md border ${mode === 'monthly' ? 'bg-ink text-paper border-ink' : 'border-ink/20 hover:bg-white'}`}
          >
            Monthly
          </button>
        </div>
        {mode === 'daily' ? (
          <div>
            <label className="block text-sm text-slate2 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm text-slate2 mb-1">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border border-ink/20 rounded-md px-3 py-2 bg-white"
            />
          </div>
        )}
      </div>

      <ReportToolbar onExportCSV={handleExport} count={rows.length} noun="class/section" />

      <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
        <table className="register-table w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left">
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Section</th>
              <th className="px-4 py-3">Total Students</th>
              <th className="px-4 py-3">Present</th>
              <th className="px-4 py-3">On Leave</th>
              <th className="px-4 py-3">Absent</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate2" colSpan={6}>No data for this {mode === 'daily' ? 'date' : 'month'}.</td></tr>
            ) : (
              <>
                {rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 font-medium">{r.className}</td>
                    <td className="px-4 py-3 text-slate2">{r.section || '—'}</td>
                    <td className="px-4 py-3">{r.totalStudents}</td>
                    <td className="px-4 py-3">{r.present}</td>
                    <td className="px-4 py-3">{r.leave}</td>
                    <td className="px-4 py-3">{r.absent}</td>
                  </tr>
                ))}
                <tr className="bg-paper font-medium">
                  <td className="px-4 py-3" colSpan={2}>Total</td>
                  <td className="px-4 py-3">{totals.totalStudents}</td>
                  <td className="px-4 py-3">{totals.present}</td>
                  <td className="px-4 py-3">{totals.leave}</td>
                  <td className="px-4 py-3">{totals.absent}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
