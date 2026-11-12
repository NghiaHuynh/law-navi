import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyze, norm } from './lib/analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = process.env.LAW_MAP_SKILL || path.join(os.homedir(), '.qoder', 'skills', 'law-map');
const ENGINE = path.join(SKILL, 'tools', 'engine.html');
const EXTRACT = path.join(SKILL, 'tools', 'extract.mjs');
const RENDER = path.join(SKILL, 'tools', 'render.mjs');
let LEXICON = [];
try { ({ LEXICON } = await import(pathToFileURL(path.join(SKILL, 'tools', 'lexicon.mjs')).href)); } catch {}
let SOURCES = [], FETCH_HOSTS = [];
try { ({ SOURCES, FETCH_HOSTS } = await import(pathToFileURL(path.join(SKILL, 'tools', 'sources.mjs')).href)); } catch {}
const SETS_FILE = path.join(__dirname, 'sets.json');
const SETS_DIR = path.join(__dirname, 'sets');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4780);
const BODY_CAP = 64 * 1024 * 1024;

fs.mkdirSync(SETS_DIR, { recursive: true });
if (!fs.existsSync(SETS_FILE)) fs.writeFileSync(SETS_FILE, '[]');
const loadSets = () => JSON.parse(fs.readFileSync(SETS_FILE, 'utf8'));
const saveSets = s => fs.writeFileSync(SETS_FILE, JSON.stringify(s, null, 1) + '\n');
const findSet = id => loadSets().find(s => s.id === id);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml'
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > BODY_CAP) { reject(new Error('Body quá lớn (>64MB)')); req.destroy(); return; } chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON không hợp lệ')); } });
  req.on('error', reject);
});
const runTool = (script, args) => new Promise(resolve => {
  const p = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  const t = setTimeout(() => p.kill('SIGKILL'), 60000);
  p.on('close', code => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
});
const atomicWrite = (file, text) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };
const readData = s => JSON.parse(fs.readFileSync(s.dataPath, 'utf8'));
const slug = name => (norm(name).trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'bo');
function newId(name) {
  const sets = loadSets(); let id;
  do { id = slug(name) + '-' + Date.now().toString(36).slice(-4) + Math.floor(Math.random() * 36).toString(36); } while (sets.some(s => s.id === id));
  return id;
}
const inside = (dir, rel) => { const p = path.resolve(dir, rel); return p === dir || p.startsWith(dir + path.sep); };
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.text']);
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const kindOf = ext => TEXT_EXT.has(ext) ? 'text' : IMG_EXT.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : 'other';
const htmlToText = h => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const hostAllowed = h => FETCH_HOSTS.some(x => h === x || h.endsWith('.' + x));
const SKIP_WALK = new Set(['node_modules', '.git', 'shots', 'data', 'out', 'demo-auto', 'app', 'ban-do']);
function walkFiles(dir, base = '', out = []) {
  if (out.length >= 500) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || SKIP_WALK.has(ent.name)) continue;
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walkFiles(path.join(dir, ent.name), rel, out);
    else out.push({ rel, kind: kindOf(path.extname(ent.name).toLowerCase()), size: fs.statSync(path.join(dir, ent.name)).size });
  }
  return out;
}
const skeleton = name => ({
  meta: { title: name, sub: 'Bản nháp — chưa trích xuất', src: '' },
  groups: { lq: { c: '#546e7a', bg: '#eceff1', label: 'Văn bản liên quan' } },
  docs: {}, pairs: [], tasks: [], timeline: [], readingPath: [], problems: [], quote: ''
});
function validateData(d) {
  if (!d || typeof d !== 'object') return 'Dữ liệu phải là object';
  if (!d.docs || typeof d.docs !== 'object') return 'Thiếu docs';
  if (!d.groups || typeof d.groups !== 'object') return 'Thiếu groups';
  for (const [id, doc] of Object.entries(d.docs)) {
    if (!doc || typeof doc.code !== 'string' || !doc.code.trim()) return `Văn bản "${id}" thiếu code`;
    if (typeof doc.type !== 'string') return `Văn bản "${id}" thiếu type`;
  }
  return '';
}
async function renderSet(s) {
  const r = await runTool(RENDER, [ENGINE, s.dataPath, s.outPath]);
  if (r.code !== 0) throw new Error('Render lỗi: ' + (r.err || r.out));
  return r.out;
}
function setStats(s) {
  let d = null; try { d = readData(s); } catch {}
  return {
    id: s.id, name: s.name, owned: !!s.owned, draft: !!s.draft, sourceDir: s.sourceDir,
    title: (d && d.meta && d.meta.title) || s.name,
    docCount: d ? Object.keys(d.docs).length : 0,
    oldCount: d ? Object.values(d.docs).filter(x => x.old).length : 0,
    taskCount: d ? (d.tasks || []).length : 0,
    problemCount: d ? (d.problems || []).length : 0,
    hasOut: fs.existsSync(s.outPath),
    dataMtime: fs.existsSync(s.dataPath) ? fs.statSync(s.dataPath).mtimeMs : 0
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, skill: SKILL, engine: fs.existsSync(ENGINE), node: process.version });

    if (p === '/api/sources' && req.method === 'GET') return json(res, 200, SOURCES);

    if (p === '/api/sets' && req.method === 'GET') return json(res, 200, loadSets().map(setStats));

    if (p === '/api/sets' && req.method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name || 'Bộ văn bản mới').trim().slice(0, 80);
      const id = newId(name);
      const dir = path.join(SETS_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      const s = { id, name, owned: true, draft: true, createdAt: new Date().toISOString(), dataPath: path.join(dir, 'data.json'), outPath: path.join(dir, 'index.html'), sourceDir: dir };
      let log = '';
      if (b.sourceDir) {
        const src = path.resolve(String(b.sourceDir));
        if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) { fs.rmSync(dir, { recursive: true, force: true }); return json(res, 400, { error: 'Đường dẫn không tồn tại hoặc không phải thư mục: ' + src }); }
        s.sourceDir = src;
        const r = await runTool(EXTRACT, [src, s.dataPath]);
        if (r.code !== 0) { fs.rmSync(dir, { recursive: true, force: true }); return json(res, 400, { error: 'Trích xuất lỗi: ' + (r.err || r.out) }); }
        log = r.out;
      } else {
        s.sourceDir = path.join(dir, 'source');
        fs.mkdirSync(s.sourceDir, { recursive: true });
        atomicWrite(s.dataPath, JSON.stringify(skeleton(name), null, 1) + '\n');
        log = 'Đã tạo bộ trống. Tải file (.txt/.md/pdf/ảnh) lên để trích xuất.';
      }
      const sets = loadSets(); sets.push(s); saveSets(sets);
      return json(res, 200, { set: setStats(s), log });
    }

    const m = p.match(/^\/api\/sets\/([^/]+)(\/.*)?$/);
    if (m) {
      const s = findSet(m[1]);
      if (!s) return json(res, 404, { error: 'Không tìm thấy bộ: ' + m[1] });
      const sub = m[2] || '';

      if (sub === '/data' && req.method === 'GET') {
        try { return json(res, 200, readData(s)); } catch { return json(res, 404, { error: 'Chưa có data.json' }); }
      }
      if (sub === '/data' && req.method === 'PUT') {
        const d = await readBody(req);
        const err = validateData(d);
        if (err) return json(res, 400, { error: err });
        atomicWrite(s.dataPath, JSON.stringify(d, null, 1) + '\n');
        const sets = loadSets(); const e = sets.find(x => x.id === s.id); e.draft = false; saveSets(sets);
        return json(res, 200, { ok: true });
      }
      if (sub === '/files' && req.method === 'POST') {
        if (!s.owned) return json(res, 400, { error: 'Bộ liên kết ngoài chỉ đọc tại chỗ — không nhận tải file. Sửa trực tiếp trong thư mục nguồn rồi trích xuất lại.' });
        const b = await readBody(req);
        const files = Array.isArray(b.files) ? b.files.slice(0, 200) : [];
        let total = 0;
        for (const f of files) {
          const rel = String(f.rel || '');
          if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || !inside(s.sourceDir, rel)) return json(res, 400, { error: 'Tên file không hợp lệ: ' + rel });
          const buf = Buffer.from(String(f.b64 || ''), 'base64');
          total += buf.length;
          if (total > BODY_CAP) return json(res, 400, { error: 'Tổng dung lượng vượt 64MB' });
          const dest = path.resolve(s.sourceDir, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buf);
        }
        let log = 'Đã lưu ' + files.length + ' file.';
        if (s.draft) {
          const r = await runTool(EXTRACT, [s.sourceDir, s.dataPath]);
          log += '\n' + (r.code === 0 ? r.out : 'Trích xuất lỗi: ' + (r.err || r.out));
        } else log += ' Bộ đã biên soạn — không trích xuất lại để tránh ghi đè. Muốn trích xuất lại, tạo bộ mới.';
        return json(res, 200, { ok: true, log });
      }
      if (sub === '/files' && req.method === 'GET') {
        if (!fs.existsSync(s.sourceDir)) return json(res, 200, []);
        return json(res, 200, walkFiles(s.sourceDir));
      }
      if (sub === '/fetch' && req.method === 'POST') {
        const b = await readBody(req);
        let uu; try { uu = new URL(String(b.url || '')); } catch { return json(res, 400, { error: 'URL không hợp lệ' }); }
        if (uu.protocol !== 'https:' && uu.protocol !== 'http:') return json(res, 400, { error: 'Chỉ nhận http/https' });
        if (!hostAllowed(uu.hostname.toLowerCase())) return json(res, 400, { error: 'Chỉ tải từ nguồn chính thống: ' + FETCH_HOSTS.join(', ') });
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
        const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html,application/pdf,*/*' };
        let resp, target = uu;
        try {
          for (let i = 0; i < 5; i++) {
            resp = await fetch(target, { signal: ctl.signal, redirect: 'manual', headers });
            if ([301, 302, 303, 307, 308].includes(resp.status)) {
              const loc = resp.headers.get('location'); if (!loc) break;
              target = new URL(loc, target);
              if (!hostAllowed(target.hostname.toLowerCase())) { clearTimeout(t); return json(res, 400, { error: 'Redirect ra ngoài nguồn chính thống: ' + target.hostname }); }
              continue;
            }
            break;
          }
        } catch (e) { clearTimeout(t); return json(res, 502, { error: 'Không tải được: ' + e.message }); }
        clearTimeout(t);
        if (!resp || !resp.ok) return json(res, 502, { error: 'Nguồn trả HTTP ' + (resp && resp.status) });
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > 30 * 1024 * 1024) return json(res, 400, { error: 'File quá lớn (>30MB)' });
        const ct = String(resp.headers.get('content-type') || '');
        const isPdf = ct.includes('pdf') || /\.pdf$/i.test(uu.pathname);
        const base = (decodeURIComponent(uu.pathname.split('/').filter(Boolean).pop() || 'nguon').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)) || 'nguon';
        const dir = path.join(s.sourceDir, 'sources'); fs.mkdirSync(dir, { recursive: true });
        let fname = base + (isPdf ? '.pdf' : '.txt');
        if (fs.existsSync(path.join(dir, fname))) fname = base + '-' + Date.now().toString(36) + (isPdf ? '.pdf' : '.txt');
        const body = isPdf ? null : htmlToText(buf.toString('utf8'));
        fs.writeFileSync(path.join(dir, fname), isPdf ? buf : body);
        let log = 'Đã tải ' + fname + ' (' + Math.round(buf.length / 1024) + ' KB) từ ' + target.hostname + '.';
        if (body && body.length > 20000 && !/Điều\s+\d|Chương\s+[IVX0-9]/.test(body)) log += ' CẢNH BÁO: nguồn trả về khung trang, toàn văn tải bằng JavaScript — dùng trình duyệt hoặc PDF bản gốc.';
        if (s.draft) { const r = await runTool(EXTRACT, [s.sourceDir, s.dataPath]); log += '\n' + (r.code === 0 ? r.out : r.err); }
        else log += ' Bộ đã biên soạn — file nằm ở sources/, đọc rồi bổ sung vào mục Văn bản (không trích xuất lại để tránh ghi đè).';
        return json(res, 200, { ok: true, rel: 'sources/' + fname, kind: isPdf ? 'pdf' : 'text', log });
      }
      if (sub === '/render' && req.method === 'POST') {
        const log = await renderSet(s);
        return json(res, 200, { ok: true, log });
      }
      if (sub === '/map' && req.method === 'GET') {
        const stale = !fs.existsSync(s.outPath) || (fs.existsSync(s.dataPath) && fs.statSync(s.dataPath).mtimeMs > fs.statSync(s.outPath).mtimeMs);
        if (stale) await renderSet(s);
        const html = fs.readFileSync(s.outPath);
        const headers = { 'Content-Type': 'text/html; charset=utf-8' };
        if (u.searchParams.get('download') === '1') headers['Content-Disposition'] = 'attachment; filename="' + s.id + '.html"';
        res.writeHead(200, headers); return res.end(html);
      }
      if (sub === '' && req.method === 'DELETE') {
        saveSets(loadSets().filter(x => x.id !== s.id));
        return json(res, 200, { ok: true, note: 'Đã gỡ khỏi thư viện. File trên đĩa vẫn giữ nguyên.' });
      }
    }

    if (p === '/api/file' && req.method === 'GET') {
      const s = findSet(u.searchParams.get('set') || '');
      const rel = u.searchParams.get('rel') || '';
      if (!s || !rel || !inside(s.sourceDir, rel)) return json(res, 400, { error: 'Tham số không hợp lệ' });
      const file = path.resolve(s.sourceDir, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Không tìm thấy file' });
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p === '/api/ask' && req.method === 'POST') {
      const b = await readBody(req);
      const q = String(b.q || '').trim();
      if (!q) return json(res, 400, { error: 'Chưa nhập vấn đề' });
      const results = [];
      for (const s of loadSets()) {
        let d; try { d = readData(s); } catch { continue; }
        const r = analyze(d, q, LEXICON.concat(d.lexicon || []));
        if (!r) continue;
        results.push({
          id: s.id, name: s.name, title: (d.meta && d.meta.title) || s.name,
          pct: r.pct, tier: r.tier, covN: r.covN, csN: r.csN, curated: r.curated, says: r.says || [],
          plan: r.plan.slice(0, 3).map(x => ({ id: x[0], code: (d.docs[x[0]] || {}).code || x[0], why: x[1] }))
        });
      }
      results.sort((a, b) => b.pct - a.pct || (b.curated ? 1 : 0) - (a.curated ? 1 : 0) || b.covN - a.covN);
      return json(res, 200, { q, results });
    }

    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      if (rel.includes('..')) return json(res, 400, { error: 'bad path' });
      const file = path.join(PUBLIC, rel);
      if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
    }
    return json(res, 404, { error: 'Không tìm thấy: ' + p });
  } catch (e) {
    return json(res, 500, { error: String(e && e.message || e) });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error('Cổng ' + PORT + ' đã bị chiếm. Đặt PORT khác, ví dụ: PORT=4781 node server.mjs'); process.exit(1); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('LawNavi app: http://127.0.0.1:' + PORT);
  console.log('Skill law-map: ' + SKILL + (fs.existsSync(ENGINE) ? ' (OK)' : ' (THIẾU engine.html!)'));
});