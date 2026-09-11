export default function PageHeader({ eyebrow, title, action }) {
  return (
    <div className="ledger-heading flex items-end justify-between mb-8">
      <div>
        {eyebrow && (
          <p className="font-mono text-xs uppercase tracking-widest text-brass-dark mb-1">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}
