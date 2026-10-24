import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

// app/ holds .env and the client build; the repository root holds the SQL files.
export const APP_ROOT = path.resolve(here, '../..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');

// Variables already set in the environment take precedence over .env.
dotenv.config({ path: path.join(APP_ROOT, '.env'), quiet: true });

export const DB_NAME = 'QuickCommerceDB';

// Created by database_security.sql; it holds only SELECT and EXECUTE privileges.
export const APP_DB_USER = 'qc_app';

export const PORT = Number(process.env.PORT || 4000);

function connectionOptions(user, password) {
  const target = process.env.DB_SOCKET
    ? { socketPath: process.env.DB_SOCKET }
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
      };
  return { ...target, user, password };
}

export function appConnectionOptions() {
  return {
    ...connectionOptions(APP_DB_USER, process.env.DB_APP_PASSWORD ?? ''),
    database: DB_NAME,
    // Return DECIMAL prices as numbers and DATETIME values as plain strings.
    decimalNumbers: true,
    dateStrings: true,
  };
}

export function adminConnectionOptions() {
  return connectionOptions(
    process.env.DB_ADMIN_USER || 'root',
    process.env.DB_ADMIN_PASSWORD ?? '',
  );
}

export function describeTarget() {
  return process.env.DB_SOCKET
    ? `socket ${process.env.DB_SOCKET}`
    : `${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}`;
}
