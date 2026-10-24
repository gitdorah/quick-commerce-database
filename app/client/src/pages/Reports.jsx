import { useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import { plural } from '../format.js';
import { useResource } from '../hooks.js';

export default function Reports() {
  const list = useResource(() => api('/reports'), []);
  const [selectedId, setSelectedId] = useState(1);
  const result = useResource(() => api(`/reports/${selectedId}`), [selectedId]);

  const reports = list.data ?? [];
  const sections = [...new Set(reports.map((report) => report.section))];
  const current = result.data?.id === selectedId ? result.data : null;
  const meta = reports.find((report) => report.id === selectedId);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            The analytical queries from sql_queries.sql, run read-only as qc_app.
          </p>
        </div>
      </div>

      <div className="reports-layout">
        <nav className="card report-nav" aria-label="Queries">
          {sections.map((section) => (
            <div key={section} className="report-section">
              <div className="eyebrow">{section}</div>
              {reports
                .filter((report) => report.section === section)
                .map((report) => (
                  <button
                    key={report.id}
                    className={report.id === selectedId ? 'active' : ''}
                    aria-current={report.id === selectedId}
                    onClick={() => setSelectedId(report.id)}
                  >
                    <span className="report-number">{report.id}</span>
                    {report.title}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <article className="report-main">
          {meta && (
            <section className="card report-meta">
              <div className="eyebrow">Query {meta.id}</div>
              <h2>{meta.title}</h2>
              <div className="chips">
                {meta.concepts.split(',').map((concept) => (
                  <span key={concept} className="chip">
                    {concept.trim()}
                  </span>
                ))}
              </div>
              <p className="report-description">{meta.description}</p>
              <details>
                <summary>SQL</summary>
                <pre className="code">
                  <code>{meta.sql}</code>
                </pre>
              </details>
            </section>
          )}

          {result.error && <div className="notice notice-critical">{result.error.message}</div>}

          {current && (
            <section className={`card report-result${result.loading ? ' refreshing' : ''}`}>
              <div className="report-result-head">
                <strong>{plural(current.rows.length, 'row')}</strong>
                <span className="muted small">{current.ms} ms</span>
                <button className="button button-ghost button-small" onClick={result.reload}>
                  Re-run
                </button>
              </div>
              <DataTable columns={current.columns} rows={current.rows} />
            </section>
          )}
        </article>
      </div>
    </div>
  );
}
