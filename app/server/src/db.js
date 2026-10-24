import mysql from 'mysql2/promise';
import { appConnectionOptions } from './config.js';

export const pool = mysql.createPool({
  ...appConnectionOptions(),
  connectionLimit: 10,
});

const DEADLOCK = 1213;

/**
 * Calls a stored procedure and returns the rows of its first result set.
 * The procedures roll back on any error, so a deadlock victim is retried once.
 */
export async function callProcedure(name, args = [], connection = pool) {
  const placeholders = args.map(() => '?').join(', ');
  const sql = `CALL ${name}(${placeholders})`;

  for (let attempt = 1; ; attempt++) {
    try {
      const [results] = await connection.query(sql, args);
      return Array.isArray(results[0]) ? results[0] : [];
    } catch (err) {
      if (err.errno === DEADLOCK && attempt === 1) continue;
      throw err;
    }
  }
}
