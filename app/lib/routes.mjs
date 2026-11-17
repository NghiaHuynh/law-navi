// API route handlers for the LawNavi backend. Each handler receives (req, res, ctx) and
// communicates via the shared JSON helper or by throwing an AppError (mapped by the error middleware).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyze, norm } from './analyze.mjs';
import { insideReal } from './shared.mjs';
import { setsRepo, datasetsRepo, readData, setStats, skeleton, newId, slug, inside, walkFiles, kindOf, htmlToText, atomicWrite, loadSets, saveSets, findSet, SETS_DIR } from './db.mjs';
import { validateDatasetBody, requireQuery, requireSetId, requireString, requireObject, requireArray, requireBoolean, requireNumber, requireDateStr, requireColor, requireGroupId, requireDocId, requireQueryString, requireBase64 } from './validate.mjs';
import { badRequest, notFound, badGateway, internal } from './errors.mjs';
import { json } from './http.mjs';
import { runTool } from './runner.mjs';
import { DOC_ID_RE, GROUP_ID_RE, COLOR_RE, DATE_PATTERN, SET_ID_RE, MAX_BODY_BYTES, MAX_FETCH_BYTES, MAX_UPLOAD_FILES, MAX_WALK_FILES, MAX_QUERY_LENGTH, MAX_SET_NAME_LENGTH, FETCH_REDIRECTS, FETCH_TIMEOUT_MS } from './types.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const health = async (req, res, ctx) => json(res, 200, { ok: true, skill: ctx.skill, engine: fs.existsSync(ctx.engine), node: process.version });

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const listSources = async (req, res, ctx) => json(res, 200, ctx.sources || []);

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const listSets = async (req, res, ctx) => json(res, 200, setsRepo.list());

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const createSet = async (req, res, ctx) => {
  const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, MAX_SET_NAME_LENGTH) : 'Bộ văn bản mới';
  const sourceDir = typeof b.sourceDir === 'string' && b.sourceDir.trim() ? b.sourceDir.trim() : undefined;
  const set = setsRepo.create({ name, sourceDir });
  if (!set) throw badRequest('Đường dẫn không tồn tại hoặc không phải thư mục: ' + sourceDir);
  if (sourceDir) {
    const src = path.resolve(sourceDir);
    const r = await runTool(ctx.extract, [src, set.dataPath]);
    if (r.code !== 0) { setsRepo.remove(set.id); throw badRequest('Trích xuất lỗi: ' + (r.err || r.out)); }
    const fresh = setsRepo.get(set.id);
    return json(res, 200, { set: setStats(fresh), log: r.out });
  }
  const empty = setsRepo.get(set.id);
  return json(res, 200, { set: setStats(empty), log: 'Đã tạo bộ trống. Tải file (.txt/.md/pdf/ảnh) lên để trích xuất.' });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const getSetData = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  const d = datasetsRepo.read(set.id);
  if (!d) throw notFound('Chưa có data.json');
  return json(res, 200, d);
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const putSetData = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  const d = validateDatasetBody(req.body);
  if (!datasetsRepo.save(set.id, d)) throw notFound('Không tìm thấy bộ: ' + set.id);
  return json(res, 200, { ok: true });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const listSetFiles = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  const files = fs.existsSync(set.sourceDir) ? walkFiles(set.sourceDir) : [];
  return json(res, 200, files);
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const uploadSetFiles = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  if (!set.owned) throw badRequest('Bộ liên kết ngoài chỉ đọc tại chỗ — không nhận tải file. Sửa trực tiếp trong thư mục nguồn rồi trích xuất lại.');
  const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const files = requireArray(b.files, 'Thiếu files').slice(0, MAX_UPLOAD_FILES);
  let total = 0;
  for (const f of files) {
    const rel = String((f && f.rel) || '');
    if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || !insideReal(set.sourceDir, rel)) throw badRequest('Tên file không hợp lệ: ' + rel);
    const buf = Buffer.from(String((f && f.b64) || ''), 'base64');
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw badRequest('Tổng dung lượng vượt 64MB');
    const dest = path.resolve(set.sourceDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  let log = 'Đã lưu ' + files.length + ' file.';
  if (set.draft) {
    const r = await runTool(ctx.extract, [set.sourceDir, set.dataPath]);
    log += '\n' + (r.code === 0 ? r.out : 'Trích xuất lỗi: ' + (r.err || r.out));
  } else log += ' Bộ đã biên soạn — không trích xuất lại để tránh ghi đè. Muốn trích xuất lại, tạo bộ mới.';
  return json(res, 200, { ok: true, log });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const fetchOfficialSource = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const url = requireString(b.url, { max: 2000 });
  let uu;
  try { uu = new URL(url); } catch { throw badRequest('URL không hợp lệ'); }
  if (uu.protocol !== 'https:' && uu.protocol !== 'http:') throw badRequest('Chỉ nhận http/https');
  if (!ctx.fetchHosts.some(x => uu.hostname.toLowerCase() === x || uu.hostname.toLowerCase().endsWith('.' + x))) throw badRequest('Chỉ tải từ nguồn chính thống: ' + ctx.fetchHosts.join(', '));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html,application/pdf,*/*' };
  let resp, target = uu;
  try {
    for (let i = 0; i < FETCH_REDIRECTS; i++) {
      resp = await fetch(target, { signal: ctl.signal, redirect: 'manual', headers });
      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        const loc = resp.headers.get('location');
        if (!loc) break;
        target = new URL(loc, target);
        if (!ctx.fetchHosts.some(x => target.hostname.toLowerCase() === x || target.hostname.toLowerCase().endsWith('.' + x))) { clearTimeout(t); throw badRequest('Redirect ra ngoài nguồn chính thống: ' + target.hostname); }
        continue;
      }
      break;
    }
  } catch (e) { clearTimeout(t); throw badGateway('Không tải được: ' + (e && e.message ? e.message : e)); }
  clearTimeout(t);
  if (!resp || !resp.ok) throw badGateway('Nguồn trả HTTP ' + (resp && resp.status));
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) throw badRequest('File quá lớn (>30MB)');
  const ct = String(resp.headers.get('content-type') || '');
  const isPdf = ct.includes('pdf') || /\.pdf$/i.test(uu.pathname);
  const base = (decodeURIComponent(uu.pathname.split('/').filter(Boolean).pop() || 'nguon').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)) || 'nguon';
  const dir = path.join(set.sourceDir, 'sources'); fs.mkdirSync(dir, { recursive: true });
  let fname = base + (isPdf ? '.pdf' : '.txt');
  if (fs.existsSync(path.join(dir, fname))) fname = base + '-' + Date.now().toString(36) + (isPdf ? '.pdf' : '.txt');
  const body = isPdf ? null : htmlToText(buf.toString('utf8'));
  fs.writeFileSync(path.join(dir, fname), isPdf ? buf : body);
  let log = 'Đã tải ' + fname + ' (' + Math.round(buf.length / 1024) + ' KB) từ ' + target.hostname + '.';
  if (body && body.length > 20000 && !/Điều\s+\d|Chương\s+[IVX0-9]/.test(body)) log += ' CẢNH BÁO: nguồn trả về khung trang, toàn văn tải bằng JavaScript — dùng trình duyệt hoặc PDF bản gốc.';
  if (set.draft) { const r = await runTool(ctx.extract, [set.sourceDir, set.dataPath]); log += '\n' + (r.code === 0 ? r.out : r.err); }
  else log += ' Bộ đã biên soạn — file nằm ở sources/, đọc rồi bổ sung vào mục Văn bản (không trích xuất lại để tránh ghi đè).';
  return json(res, 200, { ok: true, rel: 'sources/' + fname, kind: isPdf ? 'pdf' : 'text', log });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const renderSet = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  const r = await runTool(ctx.render, [ctx.engine, set.dataPath, set.outPath]);
  if (r.code !== 0) throw internal('Render lỗi: ' + (r.err || r.out));
  return json(res, 200, { ok: true, log: r.out });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const getSetMap = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  const stale = !fs.existsSync(set.outPath) || (fs.existsSync(set.dataPath) && fs.statSync(set.dataPath).mtimeMs > fs.statSync(set.outPath).mtimeMs);
  if (stale) { const r = await runTool(ctx.render, [ctx.engine, set.dataPath, set.outPath]); if (r.code !== 0) throw internal('Render lỗi: ' + (r.err || r.out)); }
  const html = fs.readFileSync(set.outPath);
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  if (req.query.get('download') === '1') headers['Content-Disposition'] = 'attachment; filename="' + set.id + '.html"';
  res.writeHead(200, headers);
  return res.end(html);
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const deleteSet = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.params.id));
  if (!set) throw notFound('Không tìm thấy bộ: ' + req.params.id);
  if (!setsRepo.remove(set.id)) throw notFound('Không tìm thấy bộ: ' + set.id);
  setsRepo.trash(set);
  return json(res, 200, { ok: true, note: 'Đã gỡ khỏi thư viện. File trên đĩa vẫn giữ nguyên.' });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const restoreSet = async (req, res, ctx) => {
  const id = requireSetId(req.params.id);
  const rec = setsRepo.restore(id);
  if (!rec) throw notFound('Không có bộ đã gỡ nào khôi phục được: ' + id);
  return json(res, 200, { set: setStats(rec) });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const getFile = async (req, res, ctx) => {
  const set = setsRepo.get(requireSetId(req.query.get('set') || ''));
  const rel = String(req.query.get('rel') || '');
  if (!set || !rel || !insideReal(set.sourceDir, rel)) throw badRequest('Tham số không hợp lệ');
  const file = path.resolve(set.sourceDir, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw notFound('Không tìm thấy file');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const ask = async (req, res, ctx) => {
  const q = requireQuery(req.body ? req.body.q : undefined);
  const results = [];
  for (const s of loadSets()) {
    let d; try { d = readData(s); } catch { continue; }
    const r = analyze(d, q, (ctx.lexicon || []).concat(d.lexicon || []));
    if (!r) continue;
    results.push({
      id: s.id, name: s.name, title: (d.meta && d.meta.title) || s.name,
      pct: r.pct, tier: r.tier, covN: r.covN, csN: r.csN, curated: r.curated, exact: r.exact, says: r.says || [],
      plan: r.plan.slice(0, 3).map(x => ({ id: x[0], code: (d.docs[x[0]] || {}).code || x[0], why: x[1] }))
    });
  }
  // Xếp hạng giữa các bộ: cụm keys được biên soạn riêng cho bộ nào là tín hiệu mạnh nhất, vì pct chỉ so được
  // trong nội bộ một bộ (mẫu số khái niệm của mỗi bộ khác nhau do lexicon riêng).
  results.sort((a, b) => b.exact - a.exact || b.pct - a.pct || (b.curated ? 1 : 0) - (a.curated ? 1 : 0) || b.covN - a.covN);
  return json(res, 200, { q, results });
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const serveStatic = async (req, res, ctx) => {
  const p = req.url === '/' ? '/' : req.url.split('?')[0];
  const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
  if (rel.includes('..')) throw badRequest('bad path');
  const file = path.join(ctx.publicDir, rel);
  if (file.startsWith(ctx.publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  throw notFound('Không tìm thấy: ' + p);
};

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {Object} ctx */
export const dispatch = async (req, res, ctx) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  req.params = req.params || {};
  req.query = u.searchParams;

  if (p === '/api/health') { if (req.method === 'GET') return health(req, res, ctx); }
  if (p === '/api/sources') { if (req.method === 'GET') return listSources(req, res, ctx); }
  if (p === '/api/sets') {
    if (req.method === 'GET') return listSets(req, res, ctx);
    if (req.method === 'POST') { req.params = {}; return createSet(req, res, ctx); }
  }
  if (p === '/api/ask') { if (req.method === 'POST') { req.params = {}; return ask(req, res, ctx); } }
  if (p === '/api/file') { if (req.method === 'GET') { req.params = {}; return getFile(req, res, ctx); } }

  const m = p.match(/^\/api\/sets\/([^/]+)(\/.*)?$/);
  if (m) {
    const id = m[1];
    const sub = m[2] || '';
    const method = req.method;
    if (sub === '/data') {
      if (method === 'GET') { req.params.id = id; return getSetData(req, res, ctx); }
      if (method === 'PUT') { req.params.id = id; return putSetData(req, res, ctx); }
    }
    if (sub === '/files') {
      if (method === 'GET') { req.params.id = id; return listSetFiles(req, res, ctx); }
      if (method === 'POST') { req.params.id = id; return uploadSetFiles(req, res, ctx); }
    }
    if (sub === '/fetch') { if (method === 'POST') { req.params.id = id; return fetchOfficialSource(req, res, ctx); } }
    if (sub === '/render') { if (method === 'POST') { req.params.id = id; return renderSet(req, res, ctx); } }
    if (sub === '/restore') { if (method === 'POST') { req.params.id = id; return restoreSet(req, res, ctx); } }
    if (sub === '/map') { if (method === 'GET') { req.params.id = id; return getSetMap(req, res, ctx); } }
    if (sub === '' && method === 'DELETE') { req.params.id = id; return deleteSet(req, res, ctx); }
  }

  // unknown API shape → 404 JSON
  if (p.startsWith('/api/')) throw notFound('Không tìm thấy: ' + p);
  return serveStatic(req, res, ctx);
};
