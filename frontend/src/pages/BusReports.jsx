// Bus Reports — seven views of the same rider list (GET /bus/report-riders):
//   1. Student / Class wise      4. Bus-only passenger wise
//   2. Student / Bus wise        5. Paid list
//   3. Students / School wise    6. Due list      7. Discounted list
//
// Every report is the one list of riders (enrolled students on a bus plus
// bus-only passengers) filtered and grouped differently, so changing the month
// or route re-slices the same data rather than hitting the server per report.
// Paid / Due / Discounted are about the chosen month; the other four list who
// rides, and still show that month's Paid/Due status alongside.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { exportRowsToCSV } from '../utils/csv';

const SCHOOL_NAME = 'ISLAMABAD MODEL SCHOOL FOR BOYS (VI-X), F-8/3';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const DISCOUNT_LABELS = {
  SIBLING: 'Sibling also rides',
  PREPAYMENT: 'Paid in advance',
  ORPHAN: 'Orphan',
  OTHER: 'Other',
};
const METHOD_LABELS = { CASH: 'Cash', BANK_TRANSFER: 'Bank Transfer', ONLINE: 'Online', CHEQUE: 'Cheque' };

const isStudent = (r) => r.riderType === 'STUDENT';
const classLabel = (r) => (isStudent(r) ? `${r.className}${r.section ? ` ${r.section}` : ''}` : 'Not enrolled');
const reasonLabel = (v) => (v ? DISCOUNT_LABELS[v] || v : '—');
const dateLabel = (d) => (d ? new Date(d).toLocaleDateString() : '—');

// Column building blocks, reused across reports so wording stays consistent.
const C = {
  admn: { label: 'Admn No', get: (r) => r.admissionNumber || '—' },
  name: { label: 'Name', get: (r) => r.name },
  type: { label: 'Type', get: (r) => (isStudent(r) ? 'Enrolled' : 'Bus only') },
  cls: { label: 'Class', get: classLabel },
  father: { label: 'Father / Guardian', get: (r) => r.guardianName || '—' },
  phone: { label: 'Phone', get: (r) => r.guardianPhone || '—' },
  route: { label: 'Route', get: (r) => r.routeName },
  bus: { label: 'Bus', get: (r) => r.vehicleNumber },
  pickup: { label: 'Pickup point', get: (r) => r.pickupPoint || '—' },
  fee: { label: 'Monthly fee', get: (r) => r.monthlyFee, right: true },
  standing: { label: 'Standing discount', get: (r) => r.standingDiscount || 0, right: true },
  standingReason: { label: 'Discount reason', get: (r) => (r.standingDiscount > 0 ? reasonLabel(r.standingDiscountReason) : '—') },
  netDue: { label: 'Net payable', get: (r) => r.netPayable, right: true },
  status: { label: 'Status', get: (r) => (r.paid ? 'Paid' : 'Due') },
  paidAmount: { label: 'Amount received', get: (r) => r.payment?.amount ?? 0, right: true },
  paidDiscount: { label: 'Discount given', get: (r) => r.payment?.discount || 0, right: true },
  paidDate: { label: 'Collection date', get: (r) => dateLabel(r.payment?.paymentDate) },
  paidMethod: { label: 'Method', get: (r) => METHOD_LABELS[r.payment?.paymentMethod] || r.payment?.paymentMethod || '—' },
  paidRemarks: { label: 'Remarks', get: (r) => r.payment?.remarks || '—' },
  note: { label: 'Note', get: (r) => r.note || '—' },
  monthDiscountReason: { label: 'Reason (this month)', get: (r) => (r.payment?.discount > 0 ? reasonLabel(r.payment.discountReason) : '—') },
};

const REPORTS = [
  {
    key: 'class',
    label: 'Student / Class wise',
    filter: isStudent,
    groupBy: (r) => classLabel(r),
    columns: [C.admn, C.name, C.father, C.phone, C.route, C.bus, C.pickup, C.fee, C.standing, C.status],
  },
  {
    key: 'bus',
    label: 'Student / Bus wise',
    filter: isStudent,
    groupBy: (r) => `${r.vehicleNumber} — ${r.routeName}`,
    columns: [C.admn, C.name, C.cls, C.father, C.phone, C.pickup, C.fee, C.standing, C.status],
  },
  {
    key: 'school',
    label: 'Students / School wise',
    filter: isStudent,
    groupBy: null,
    columns: [C.admn, C.name, C.cls, C.father, C.phone, C.route, C.bus, C.pickup, C.fee, C.standing, C.status],
  },
  {
    key: 'passenger',
    label: 'Bus-only passenger wise',
    noun: 'passenger',
    // Riders who are NOT enrolled students (e.g. a junior-section child too
    // young to be admitted, or a sibling who only uses the bus). They have no
    // admission number or class, so those columns are left out; the note says
    // who they are. Grouped by bus, like the student bus-wise report.
    filter: (r) => !isStudent(r),
    groupBy: (r) => `${r.vehicleNumber} — ${r.routeName}`,
    columns: [C.name, C.father, C.phone, C.route, C.bus, C.pickup, C.fee, C.standing, C.status, C.note],
  },
  {
    key: 'paid',
    label: 'Paid list',
    filter: (r) => r.paid,
    groupBy: null,
    columns: [C.admn, C.name, C.type, C.cls, C.route, C.bus, C.fee, C.paidDiscount, C.paidAmount, C.paidDate, C.paidMethod, C.paidRemarks],
    summary: (rows) => `Total collected: Rs. ${rows.reduce((s, r) => s + (r.payment?.amount || 0), 0)}`,
  },
  {
    key: 'due',
    label: 'Due list',
    filter: (r) => !r.paid,
    groupBy: null,
    columns: [C.admn, C.name, C.type, C.cls, C.father, C.phone, C.route, C.bus, C.fee, C.standing, C.netDue],
    summary: (rows) => `Total due: Rs. ${rows.reduce((s, r) => s + (r.netPayable || 0), 0)}`,
  },
  {
    key: 'discounted',
    label: 'Discounted list',
    // Anyone with a standing discount, or who was given one on this month's payment.
    filter: (r) => r.standingDiscount > 0 || r.payment?.discount > 0,
    groupBy: null,
    columns: [C.admn, C.name, C.type, C.cls, C.route, C.fee, C.standing, C.standingReason, C.paidDiscount, C.monthDiscountReason, C.status],
    summary: (rows) =>
      `Standing discounts: Rs. ${rows.reduce((s, r) => s + (r.standingDiscount || 0), 0)} per month · ` +
      `Given this month: Rs. ${rows.reduce((s, r) => s + (r.payment?.discount || 0), 0)}`,
  },
];

export default function BusReports() {
  const [reportKey, setReportKey] = useState('class');
  const [month, setMonth] = useState(currentMonth());
  const [routeId, setRouteId] = useState('');
  const [classId, setClassId] = useState('');
  const [search, setSearch] = useState('');
  const [routes, setRoutes] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/bus/routes').then((res) => setRoutes(res.data)).catch(() => setRoutes([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    client
      .get('/bus/report-riders', { params: { month } })
      .then((res) => setAllRows(res.data.rows))
      .catch((err) => setError(err.response?.data?.error || 'Could not load the bus report.'))
      .finally(() => setLoading(false));
  }, [month]);

  const report = REPORTS.find((r) => r.key === reportKey);
  // Bus-only passengers have no class, so the Class filter is meaningless there
  // (and would hide everyone) — it is hidden and ignored for that report.
  const classFilterApplies = report.key !== 'passenger';
  const noun = report.noun || 'rider';

  // Classes that actually have bus riders, for the class filter.
  const classOptions = useMemo(() => {
    const seen = new Map();
    allRows.forEach((r) => {
      if (r.classId && !seen.has(r.classId)) seen.set(r.classId, r.className);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [allRows]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (!report.filter(r)) return false;
      if (routeId && String(r.routeId) !== String(routeId)) return false;
      if (classFilterApplies && classId && String(r.classId) !== String(classId)) return false;
      if (needle) {
        const hay = `${r.name} ${r.admissionNumber} ${r.guardianName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [allRows, report, routeId, classId, classFilterApplies, search]);

  // Keep the server's ordering; just bucket rows under their group heading.
  const groups = useMemo(() => {
    if (!report.groupBy) return [{ heading: null, rows }];
    const map = new Map();
    rows.forEach((r) => {
      const key = report.groupBy(r);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return Array.from(map.entries()).map(([heading, groupRows]) => ({ heading, rows: groupRows }));
  }, [rows, report]);

  const monthlyReport = ['paid', 'due', 'discounted'].includes(reportKey);

  function handleExport() {
    const columns = [
      { key: '__no', label: 'S#' },
      ...(report.groupBy ? [{ key: '__group', label: 'Group' }] : []),
      ...report.columns.map((c) => ({ key: c.label, label: c.label })),
    ];
    let n = 0;
    const out = [];
    groups.forEach((g) =>
      g.rows.forEach((r) => {
        n += 1;
        const row = { __no: n, ...(report.groupBy ? { __group: g.heading } : {}) };
        report.columns.forEach((c) => {
          row[c.label] = c.get(r);
        });
        out.push(row);
      })
    );
    exportRowsToCSV(`bus-${report.key}-${month}.csv`, columns, out);
  }

  const colCount = report.columns.length + 1;

  return (
    <div>
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        @media print {
          body * { visibility: hidden; }
          .bus-report-print, .bus-report-print * { visibility: visible; }
          .bus-report-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .bus-report-table { font-size: 10px; }
          .bus-report-table th, .bus-report-table td { border: 1px solid #333 !important; padding: 3px 5px !important; }
          .bus-report-table tr { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print">
        <PageHeader
          eyebrow="Module 06"
          title="Bus Reports"
          action={
            <Link to="/bus-fees" className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
              Back to fee collection
            </Link>
          }
        />

        <div className="flex flex-wrap gap-2 mb-5">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => setReportKey(r.key)}
              className={`text-sm px-4 py-2 rounded-full border transition-colors ${
                reportKey === r.key ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-slate2 hover:bg-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 mb-5 items-end">
          <div>
            <label className="block text-sm text-slate2 mb-1">Month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Route</label>
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="">All routes</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {classFilterApplies && (
            <div>
              <label className="block text-sm text-slate2 mb-1">Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
                <option value="">All classes</option>
                {classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-slate2 mb-1">Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, admission no., father"
              className="border border-ink/20 rounded-md px-3 py-2 bg-white"
            />
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={handleExport} disabled={rows.length === 0} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white disabled:opacity-50">
              Export CSV
            </button>
            <button onClick={() => window.print()} disabled={rows.length === 0} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light disabled:opacity-50">
              Print
            </button>
          </div>
        </div>

        {error && <p className="text-absent text-sm mb-4">{error}</p>}
      </div>

      <div className="bus-report-print">
        <div className="mb-4">
          <p className="font-bold text-lg">{SCHOOL_NAME}</p>
          <p className="font-display text-xl">{report.label}</p>
          <p className="text-sm text-slate2">
            {monthlyReport ? `Month: ${month} · ` : ''}
            {rows.length} {rows.length === 1 ? noun : `${noun}s`}
            {routeId ? ` · ${routes.find((r) => String(r.id) === String(routeId))?.name || ''}` : ''}
            {report.summary && rows.length > 0 ? ` · ${report.summary(rows)}` : ''}
          </p>
          {!monthlyReport && (
            <p className="text-xs text-slate2">Status column shows payment status for {month}.</p>
          )}
        </div>

        <div className="bg-white border border-ink/10 rounded-lg overflow-x-auto">
          <table className="bus-report-table register-table w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left">
                <th className="px-3 py-3">S #</th>
                {report.columns.map((c) => (
                  <th key={c.label} className={`px-3 py-3 ${c.right ? 'text-right' : ''}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-6 text-slate2" colSpan={colCount}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate2" colSpan={colCount}>No {noun}s match this report.</td></tr>
              ) : (
                groups.map((g, gi) => (
                  <GroupRows
                    key={gi}
                    group={g}
                    columns={report.columns}
                    colCount={colCount}
                    offset={groups.slice(0, gi).reduce((n, prev) => n + prev.rows.length, 0)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupRows({ group, columns, colCount, offset }) {
  return (
    <>
      {group.heading && (
        <tr className="bg-paper">
          <td className="px-3 py-2 font-medium" colSpan={colCount}>
            {group.heading} <span className="text-slate2 font-normal">({group.rows.length})</span>
          </td>
        </tr>
      )}
      {group.rows.map((r, i) => {
        const n = offset + i + 1;
        return (
          <tr key={`${r.riderType}-${r.riderId}`} className="border-b border-ink/5 last:border-0">
            <td className="px-3 py-2 text-slate2">{n}</td>
            {columns.map((c) => {
              const value = c.get(r);
              const isStatus = c.label === 'Status';
              return (
                <td key={c.label} className={`px-3 py-2 ${c.right ? 'text-right' : ''} ${c.label === 'Name' ? 'whitespace-nowrap' : ''}`}>
                  {isStatus ? (
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${value === 'Paid' ? 'bg-present/10 text-present' : 'bg-absent/10 text-absent'}`}>
                      {value}
                    </span>
                  ) : (
                    value
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
