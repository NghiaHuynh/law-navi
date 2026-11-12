// Secure authentication for the API layer.
// - Token source: LAW_NAV_API_KEY (or LAW_NAV_TOKEN) env var.
// - Accepted credentials: `Authorization: Bearer <token>` or `x-api-key: <token>`.
// - Comparison is timing-safe (SHA-256 digests compared with timingSafeEqual).
// - Failures are forwarded to the central error handler (401).
// - Exempt: GET /api/health (liveness probe must not require credentials).
// - When no token is configured the service runs in local-first dev mode (bind is 127.0.0.1 only).

import { createHash, timingSafeEqual } from 'node:crypto';
import { unauthorized } from './errors.mjs';

const TOKEN = (process.env.LAW_NAV_API_KEY || process.env.LAW_NAV_TOKEN || '').trim();

/** @returns {boolean} */
export const authEnabled = () => TOKEN.length > 0;

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('node:next').NextFunction} next
 */
export const authMiddleware = (req, res, next) => {
  if (TOKEN.length === 0) return next();
  const header = req.headers['authorization'] || req.headers['x-api-key'];
  const raw = Array.isArray(header) ? String(header[0] || '') : String(header || '');
  const token = raw.trim().replace(/^Bearer\s+/i, '');
  const digest = (t) => createHash('sha256').update(t).digest();
  const a = digest(token);
  const b = digest(TOKEN);
  const ok = token.length > 0 && timingSafeEqual(a, b);
  if (!ok) return next(unauthorized());
  next();
};
