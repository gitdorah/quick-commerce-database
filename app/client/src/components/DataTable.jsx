function isNumeric(value) {
  return typeof value === 'number';
}

function formatCell(value) {
  if (value === null || value === undefined) return <span className="muted">NULL</span>;
  if (isNumeric(value)) return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return String(value);
}

/** Renders a query result: `columns` in order, `rows` as objects keyed by column. */
export default function DataTable({ columns, rows, caption }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={rows.length && isNumeric(rows[0][column]) ? 'num' : ''}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted empty">
                No rows returned.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} className={isNumeric(row[column]) ? 'num' : ''}>
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
