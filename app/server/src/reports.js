import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './config.js';

const SOURCE = path.join(REPO_ROOT, 'sql_queries.sql');

/**
 * Reads the analytical queries from sql_queries.sql so the Reports page always
 * runs exactly the SQL that is in the assignment file. Each query is preceded
 * by a "-- QUERY n: Title" header, a CONCEPTS line and free-text notes.
 */
export function loadReports(file = SOURCE) {
  const reports = [];
  let section = '';
  let current = null;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const sectionHeader = line.match(/^-- ([A-Z])\. (.+)$/);
    if (sectionHeader) {
      section = `${sectionHeader[1]}. ${sectionHeader[2].trim()}`;
      continue;
    }

    const queryHeader = line.match(/^-- QUERY (\d+): (.+)$/);
    if (queryHeader) {
      current = {
        id: Number(queryHeader[1]),
        title: queryHeader[2].trim(),
        section,
        concepts: '',
        notes: [],
        sqlLines: [],
        complete: false,
      };
      reports.push(current);
      continue;
    }

    if (!current || current.complete) continue;

    if (line.startsWith('--')) {
      if (current.sqlLines.length) continue;
      const text = line.replace(/^--\s?/, '');
      const concepts = text.match(/^CONCEPTS:\s*(.+)$/);
      if (concepts) current.concepts = concepts[1].trim();
      else if (!/^-+$/.test(text.trim()) && text.trim() !== 'PURPOSE:') current.notes.push(text);
      continue;
    }

    if (line.trim() || current.sqlLines.length) current.sqlLines.push(line);
    if (line.trimEnd().endsWith(';')) current.complete = true;
  }

  return reports.map(({ sqlLines, notes, complete, ...report }) => ({
    ...report,
    description: notes.join('\n').trim(),
    sql: sqlLines.join('\n').trim(),
  }));
}
