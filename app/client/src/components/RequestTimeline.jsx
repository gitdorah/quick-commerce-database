const OUTCOMES = {
  accepted: { icon: '✓', label: 'Accepted' },
  oversold: { icon: '⚠', label: 'Accepted · oversold' },
  rejected: { icon: '✕', label: 'Rejected' },
};

/**
 * Classifies each request. In naive mode, acceptances beyond what the stock
 * could cover (counted in completion order) are flagged as oversold.
 */
function classify(run) {
  const capacity = Math.floor(run.stockBefore / run.quantityEach);
  let acceptedSoFar = 0;
  return [...run.requests]
    .map((request) => ({ ...request, finishedAt: request.sentAtMs + request.durationMs }))
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((request) => {
      if (!request.ok) return { ...request, outcome: 'rejected' };
      acceptedSoFar += 1;
      return { ...request, outcome: acceptedSoFar > capacity ? 'oversold' : 'accepted' };
    });
}

function detail(request) {
  if (!request.ok) return request.error;
  if (request.result?.OrderID) return `Order #${request.result.OrderID}`;
  return `Saw ${request.result?.StockSeen} in stock`;
}

export default function RequestTimeline({ run }) {
  const rows = classify(run);
  const span = Math.max(1, ...rows.map((row) => row.finishedAt));
  const ticks = [0, span / 2, span];
  const present = new Set(rows.map((row) => row.outcome));

  return (
    <figure className="timeline">
      <figcaption className="timeline-head">
        <span>Requests by completion time</span>
        <span className="legend">
          {Object.entries(OUTCOMES)
            .filter(([key]) => present.has(key))
            .map(([key, outcome]) => (
              <span key={key} className="legend-item">
                <span className={`legend-swatch outcome-${key}`} aria-hidden="true" />
                {outcome.label}
              </span>
            ))}
        </span>
      </figcaption>

      <ol className="timeline-rows">
        {rows.map((row) => {
          const outcome = OUTCOMES[row.outcome];
          return (
            <li key={row.request} className="timeline-row" tabIndex={0}>
              <span className="timeline-label">#{row.request}</span>
              <span className="timeline-track">
                <span
                  className={`timeline-bar outcome-${row.outcome}`}
                  style={{
                    left: `${(row.sentAtMs / span) * 100}%`,
                    width: `max(3px, ${(row.durationMs / span) * 100}%)`,
                  }}
                />
                <span className="tip" role="tooltip">
                  <strong>{row.durationMs} ms</strong> · {outcome.label}
                  <br />
                  sent at +{row.sentAtMs} ms · {detail(row)}
                </span>
              </span>
              <span className="timeline-outcome">
                <span className={`outcome-icon outcome-${row.outcome}`} aria-hidden="true">
                  {outcome.icon}
                </span>
                {outcome.label}
              </span>
              <span className="timeline-detail muted small">{detail(row)}</span>
            </li>
          );
        })}
      </ol>

      <div className="timeline-axis" aria-hidden="true">
        <span className="timeline-label" />
        <span className="timeline-ticks">
          {ticks.map((tick, index) => (
            <span key={index} style={{ left: `${(tick / span) * 100}%` }}>
              {Math.round(tick)} ms
            </span>
          ))}
        </span>
      </div>
    </figure>
  );
}
