export default function StatTile({ label, value, note, tone }) {
  return (
    <div className={`card stat-tile${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
