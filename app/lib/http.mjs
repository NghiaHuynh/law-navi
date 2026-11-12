// Small HTTP response helpers shared by routes and the error-handling layer.

/** @param {import('node:http').ServerResponse} res @param {number} status @param {*} obj */
export const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
};

/** @param {import('node:http').ServerResponse} res @param {number} status @param {string} message */
export const sendError = (res, status, message) => json(res, status, { error: message });
