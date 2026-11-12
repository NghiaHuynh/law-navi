// Error handling: domain errors + central error-handling middleware for the HTTP layer.
// Contract: doc/API_SPEC.md §3.1 — Error response body is always { "error": "string" }.

import { json } from './http.mjs';

/** @class DomainError */
export class AppError extends Error {
  /** @param {number} statusCode @param {string} code @param {string} message @param {Object} [details] */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** @param {string} message @param {Object} [details */
export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
/** @param {string} message */
export const unauthorized = (message = 'Thiếu hoặc sai token xác thực') => new AppError(401, 'UNAUTHORIZED', message);
/** @param {string} message */
export const forbidden = (message = 'Không có quyền truy cập') => new AppError(403, 'FORBIDDEN', message);
/** @param {string} message */
export const notFound = (message = 'Không tìm thấy') => new AppError(404, 'NOT_FOUND', message);
/** @param {string} message @param {Object} [details */
export const payloadTooLarge = (message = 'Body quá lớn') => new AppError(413, 'PAYLOAD_TOO_LARGE', message);
/** @param {string} message @param {Object} [details */
export const unprocessable = (message, details) => new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);
/** @param {string} message */
export const badGateway = (message = 'Lỗi kết nối đến nguồn') => new AppError(502, 'BAD_GATEWAY', message);
/** @param {string} message */
export const internal = (message = 'Lỗi nội bộ của máy chủ') => new AppError(500, 'INTERNAL', message);

/**
 * Central error-handling middleware (shape of `node:express`-style 4-arg handler).
 * @param {Error} err
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('node:next').NextFunction} next
 */
export const errorHandler = (err, req, res, next) => {
  if (res && res.headersSent) { next(err); return; }
  let status = 500;
  let code = 'INTERNAL';
  let message = internal().message;
  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
  } else {
    // Unexpected error: log full context server-side, leak only a generic message to the client.
    console.error('[error] unhandled:', err);
    if (process.env.NODE_ENV !== 'production') message = (err && err.message) || 'Lỗi không xác định';
  }
  json(res, status, { error: message });
};

/**
 * 404 handler for unmatched routes.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export const notFoundHandler = (req, res) => json(res, 404, { error: 'Không tìm thấy: ' + (req.url || '/') });
