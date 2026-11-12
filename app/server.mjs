// LawNavi API server — composition root.
// Middleware chain: security headers -> auth -> body parsing -> routes -> error handling.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dispatch } from './lib/routes.mjs';
import { errorHandler, badRequest, payloadTooLarge } from './lib/errors.mjs';
import { authMiddleware, authEnabled } from './lib/auth.mjs';
import { MAX_BODY_BYTES } from './lib/types.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = process.env.LAW_MAP_SKILL || path.join(os.homedir(), '.qoder', 'skills', 'law-map');
const ENGINE = path.join(SKILL, 'tools', 'engine.html');
const EXTRACT = path.join(SKILL, 'tools', 'extract.mjs');
const RENDER = path.join(SKILL, 'tools', 'render.mjs');
const SETS_FILE = process.env.LAW_NAV_SETS_FILE || path.join(__dirname, 'sets.json');
const SETS_DIR = process.env.LAW_NAV_SETS_DIR || path.join(__dirname, 'sets');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4780);
const BODY_CAP = MAX_BODY_BYTES;

let LEXICON = [];
try { ({ LEXICON } = await import(pathToFileURL(path.join(SKILL, 'tools', 'lexicon.mjs')).href)); } catch {}
let SOURCES = [], FETCH_HOSTS = [];
try { ({ SOURCES, FETCH_HOSTS } = await import(pathToFileURL(path.join(SKILL, 'tools', 'sources.mjs')).href)); } catch {}

const ctx = {
  skill: SKILL, engine: ENGINE, extract: EXTRACT, render: RENDER,
  sources: SOURCES, fetchHosts: FETCH_HOSTS, lexicon: LEXICON,
  setsFile: SETS_FILE, setsDir: SETS_DIR, publicDir: PUBLIC
};

const readBody = req => new Promise((resolve, reject) => {
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > BODY_CAP) { reject(payloadTooLarge()); return; }
  let n = 0;
  const chunks = [];
  req.on('data', (c) => {
    n += c.length;
    if (n > BODY_CAP) { reject(payloadTooLarge()); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { reject(badRequest('JSON không hợp lệ')); }
  });
  req.on('error', reject);
});

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'";

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    // Security headers (OWASP-inspired baseline for local-first service).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    if (u.pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    const run = async () => {
      if (req.method !== 'GET' || u.pathname !== '/api/health') {
        await new Promise((resolve, reject) => authMiddleware(req, res, (err) => (err ? reject(err) : resolve())));
      }
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') req.body = await readBody(req);
      await dispatch(req, res, ctx);
    };
    await run();
  } catch (e) {
    errorHandler(e, req, res, () => {});
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error('Cổng ' + PORT + ' đã bị chiếm. Đặt PORT khác, ví dụ: PORT=4781 node server.mjs'); process.exit(1); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('LawNavi app: http://127.0.0.1:' + PORT);
  console.log('Skill law-map: ' + SKILL + (fs.existsSync(ENGINE) ? ' (OK)' : ' (THIẾU engine.html!)'));
  if (authEnabled()) console.log('Auth API: bật (LAW_NAV_API_KEY đã đặt)');
  else console.log('Auth API: tắt (chưa đặt LAW_NAV_API_KEY) — môi trường local-first');
});
