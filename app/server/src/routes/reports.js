import { performance } from 'node:perf_hooks';
import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { loadReports } from '../reports.js';
import { positiveInt } from '../validate.js';

const router = Router();
const reports = loadReports();

router.get('/', (req, res) => {
  res.json(reports);
});

// Runs one of the predefined queries. There is deliberately no endpoint that
// accepts arbitrary SQL, and qc_app could not modify data even if there were.
router.get('/:id', async (req, res) => {
  const id = positiveInt(req.params.id, 'report id');
  const report = reports.find((candidate) => candidate.id === id);
  if (!report) throw new HttpError(404, 'Report not found');

  const started = performance.now();
  const [rows, fields] = await pool.query(report.sql);
  res.json({
    ...report,
    columns: fields.map((field) => field.name),
    rows,
    ms: Math.round((performance.now() - started) * 10) / 10,
  });
});

export default router;
