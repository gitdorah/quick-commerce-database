// Rebuilds QuickCommerceDB from the SQL scripts in database/.
//
//   npm run db:setup
//
// WARNING: drops the existing QuickCommerceDB database first, because
// 01_create_db_insert_data.sql issues a plain CREATE DATABASE.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import {
  APP_DB_USER,
  DB_NAME,
  DATABASE_DIR,
  adminConnectionOptions,
  appConnectionOptions,
  describeTarget,
} from '../src/config.js';

const SQL_FILES = [
  '01_create_db_insert_data.sql',
  '03_advanced_database_programming.sql',
  '05_database_security.sql',
  '06_application_procedures.sql',
];

// The course files end with demonstration queries and test CALLs (for example
// Part D of 03_advanced_database_programming.sql places an order). Setup skips
// them so that rebuilding the database has no side effects.
const DEMO_STATEMENT = /^(SELECT|CALL|SHOW)\b/i;

// ER_NOT_VALID_PASSWORD, raised when the validate_password component is active.
const PASSWORD_POLICY_VIOLATION = 1819;

function stripLeadingComments(text) {
  const lines = text.split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].trim().startsWith('--'))) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

/**
 * Splits a MySQL script into statements, honouring the client-side
 * DELIMITER command used around stored procedures and triggers.
 */
export function splitStatements(source) {
  const statements = [];
  let delimiter = ';';
  let buffer = [];

  const flush = () => {
    const sql = stripLeadingComments(buffer.join('\n'));
    if (sql) statements.push(sql);
    buffer = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      flush();
      delimiter = directive[1];
      continue;
    }

    // Ignore "-- comment" text when looking for the delimiter at line end.
    const code = line.trimStart().startsWith('--') ? '' : line.replace(/\s+--\s.*$/, '').trimEnd();
    if (code.endsWith(delimiter)) {
      buffer.push(code.slice(0, -delimiter.length));
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return statements;
}

async function verifyAppLogin() {
  const connection = await mysql.createConnection(appConnectionOptions());
  try {
    const [[row]] = await connection.query('SELECT COUNT(*) AS products FROM Product');
    return row.products;
  } finally {
    await connection.end();
  }
}

export async function setupDatabase({ log = console.log } = {}) {
  const appPassword = process.env.DB_APP_PASSWORD;
  if (!appPassword) {
    throw new Error('DB_APP_PASSWORD is not set. Copy app/.env.example to app/.env and fill it in.');
  }

  const connection = await mysql.createConnection(adminConnectionOptions());
  try {
    log(`Rebuilding ${DB_NAME} on ${describeTarget()} (the existing database is dropped).`);
    await connection.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);

    for (const file of SQL_FILES) {
      const statements = splitStatements(fs.readFileSync(path.join(DATABASE_DIR, file), 'utf8'));
      let executed = 0;
      let skipped = 0;

      for (const sql of statements) {
        if (DEMO_STATEMENT.test(sql)) {
          skipped++;
          continue;
        }
        try {
          await connection.query(sql);
        } catch (err) {
          err.message = `${file}: ${err.message}\n--- statement ---\n${sql.slice(0, 400)}`;
          throw err;
        }
        executed++;
      }
      log(`  ${file}: ${executed} statements executed, ${skipped} demo/test statements skipped`);
    }

    // 05_database_security.sql ships with a placeholder password; apply the real one.
    try {
      await connection.query('ALTER USER ?@? IDENTIFIED BY ?', [APP_DB_USER, 'localhost', appPassword]);
    } catch (err) {
      if (err.errno === PASSWORD_POLICY_VIOLATION) {
        err.message =
          `DB_APP_PASSWORD in app/.env was rejected by MySQL's password policy (${err.message}).` +
          '\nUse at least 8 characters with an uppercase letter, a lowercase letter, a digit and a symbol.';
      }
      throw err;
    }
    log(`  Password set for '${APP_DB_USER}'@'localhost'.`);
  } finally {
    await connection.end();
  }

  try {
    const products = await verifyAppLogin();
    log(`  Verified: ${APP_DB_USER} can log in and sees ${products} products.`);
  } catch (err) {
    if (err.errno === 1045 && !process.env.DB_SOCKET) {
      err.message +=
        "\nHint: 'qc_app'@'localhost' may not match TCP connections when name resolution is off." +
        '\nSet DB_SOCKET (for example /tmp/mysql.sock) in app/.env and try again.';
    }
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupDatabase()
    .then(() => console.log('Database ready.'))
    .catch((err) => {
      console.error(`Database setup failed: ${err.message}`);
      process.exit(1);
    });
}
