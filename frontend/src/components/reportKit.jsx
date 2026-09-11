// Shared pieces of the Reports pages. Extracted from Reports.jsx unchanged
// so the exam reports, which live in their own files, use exactly the same
// toolbar, print title and class picker as the six original reports.

// Shared toolbar with Print + CSV export, used by every report.
export function ReportToolbar({ onExportCSV, count, noun = 'record' }) {
  return (
    <div className="flex items-center justify-between mb-4 print:hidden">
      <p className="text-sm text-slate2">{count} {noun}{count === 1 ? '' : 's'}</p>
      <div className="flex gap-2">
        <button onClick={onExportCSV} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          Export CSV
        </button>
        <button onClick={() => window.print()} className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
          Print
        </button>
      </div>
    </div>
  );
}

export function ReportTitle({ children }) {
  return <h2 className="font-display text-xl text-ink mb-1 hidden print:block">{children}</h2>;
}

// Multi-class picker — same checkbox pattern used on the Exams page.
// Lets a report combine several class/section rows (e.g. 9A + 9B + 9C)
// into one "whole class" view, since each section is its own Class row.
export function ClassPicker({ classes, classIds, onToggle, label = 'Classes' }) {
  return (
    <div>
      <label className="block text-sm text-slate2 mb-1">{label}</label>
      <div className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white max-h-32 overflow-y-auto space-y-1 min-w-[180px]">
        {classes.length === 0 ? (
          <p className="text-sm text-slate2">No classes yet.</p>
        ) : (
          classes.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={classIds.includes(String(c.id))} onChange={() => onToggle(String(c.id))} />
              {c.name}
            </label>
          ))
        )}
      </div>
      <p className="text-xs text-slate2 mt-1">Tick several (e.g. 9A, 9B, 9C) to see them together as one class report.</p>
    </div>
  );
}
