export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// MySQL error numbers the API translates into client errors.
const FOREIGN_KEY_VIOLATION = 1452;
const CHECK_CONSTRAINT_VIOLATION = 3819;

export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  // SIGNAL SQLSTATE '45000' from a procedure or trigger: a business rule said no.
  if (err.sqlState === '45000') {
    return res.status(409).json({ error: err.sqlMessage });
  }

  if (err.errno === FOREIGN_KEY_VIOLATION) {
    return res
      .status(400)
      .json({ error: 'The referenced customer, store or product does not exist' });
  }

  if (err.errno === CHECK_CONSTRAINT_VIOLATION) {
    return res.status(400).json({ error: err.sqlMessage });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
