// Kiểm thử bảo mật tích hợp: spawn server thật trên cổng ngẫu nhiên, bắn request độc hại như một site ngoài/kẻ tấn công local.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');
const PORT = 4800 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const post = (url, body, headers = {}) => fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const put = (url, body, headers = {}) => fetch(BASE + url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

let server, serverLog = '';
const created = [];

beforeAll(async () => {
  server = spawn(process.execPath, [path.join(APP, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server không lên được:\n' + serverLog);
}, 30000);

afterAll(async () => {
  for (const id of created) {
    await fetch(BASE + '/api/sets/' + id, { method: 'DELETE' }).catch(() => {});
    fs.rmSync(path.join(APP, 'sets', id), { recursive: true, force: true });
  }
  server?.kill('SIGKILL');
});

const makeTempSet = async () => {
  const r = await post('/api/sets', { name: '__sectest__' });
  const j = await r.json();
  created.push(j.set.id);
  return j.set;
};

describe('Origin/Host guard (chống CSRF + DNS rebinding)', () => {
  it('POST với Origin lạ → 403', async () => {
    const r = await post('/api/ask', { q: 'nghiệm thu' }, { Origin: 'https://evil.example.com' });
    expect(r.status).toBe(403);
  });
  it('POST với Origin khớp → không bị chặn', async () => {
    const r = await post('/api/ask', { q: 'nghiệm thu chất lượng' }, { Origin: BASE });
    expect(r.status).toBe(200);
  });
  it('GET với Host lạ → 403 (DNS rebinding)', async () => {
    const status = await new Promise(resolve => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/health', headers: { Host: 'evil.example.com' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe('Path traversal', () => {
  it('/api/file với ../ bị chặn', async () => {
    const s = await makeTempSet();
    const r = await fetch(`${BASE}/api/file?set=${s.id}&rel=${encodeURIComponent('../../etc/passwd')}`);
    expect(r.status).toBe(400);
  });
  it('/api/file qua symlink trỏ ra ngoài → 400 (không đọc được /etc/passwd)', async () => {
    const s = await makeTempSet();
    const src = path.join(APP, 'sets', s.id, 'source');
    fs.symlinkSync('/etc/passwd', path.join(src, 'pwlink.txt'));
    const r = await fetch(`${BASE}/api/file?set=${s.id}&rel=pwlink.txt`);
    expect(r.status).toBe(400);
    const body = await r.text();
    expect(body).not.toContain('root:');
  });
  it('upload file với rel thoát thư mục bị chặn trước khi ghi', async () => {
    const s = await makeTempSet();
    for (const rel of ['../escape.txt', '/etc/escape.txt', 'a/../../escape.txt', '..\\escape.txt']) {
      const r = await post(`/api/sets/${s.id}/files`, { files: [{ rel, b64: Buffer.from('x').toString('base64') }] });
      expect(r.status, `rel=${rel}`).toBe(400);
    }
    expect(fs.existsSync(path.join(APP, 'sets', 'escape.txt'))).toBe(false);
  });
  it('set id không tồn tại → 404', async () => {
    const r = await fetch(`${BASE}/api/sets/khong-ton-tai-xyz/data`);
    expect(r.status).toBe(404);
  });
});

describe('/api/ask — input rác', () => {
  it('q rỗng → 400', async () => {
    expect((await post('/api/ask', { q: '' })).status).toBe(400);
    expect((await post('/api/ask', {})).status).toBe(400);
    expect((await post('/api/ask', { q: '   ' })).status).toBe(400);
  });
  it('q toàn ký hiệu → 200 với results rỗng, không crash', async () => {
    const r = await post('/api/ask', { q: '!!! ??? ***' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.results)).toBe(true);
  });
  it('q là XSS payload → 200, JSON không thực thi được', async () => {
    const r = await post('/api/ask', { q: '<script>alert(1)</script>' });
    expect(r.status).toBe(200);
  });
  it('q rất dài → server từ chối 400 (cap MAX_QUERY_LENGTH), không crash', async () => {
    const r = await post('/api/ask', { q: 'nghiệm thu '.repeat(500) });
    expect(r.status).toBe(400);
  });
});

describe('/api/sets/:id/fetch — allowlist', () => {
  it('host ngoài allowlist bị chặn trước khi kết nối mạng', async () => {
    const s = await makeTempSet();
    for (const url of [
      'https://evil.example.com/vanban.pdf',
      'https://vbpl.vn.evil.com/vanban.pdf',
      'file:///etc/passwd',
      'ftp://vbpl.vn/x',
      'javascript:alert(1)',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      const r = await post(`/api/sets/${s.id}/fetch`, { url });
      expect(r.status, url).toBe(400);
    }
  });
  it('URL không parse được → 400', async () => {
    const s = await makeTempSet();
    expect((await post(`/api/sets/${s.id}/fetch`, { url: '::::' })).status).toBe(400);
  });
});

describe('/api/sets/:id/data — PUT', () => {
  it('dữ liệu sai cấu trúc → 400, không ghi đè data.json', async () => {
    const s = await makeTempSet();
    const bad = [
      null,
      { docs: { x: { code: '', type: 'Luật' } }, groups: {} },
      { docs: { x: { code: 'A 1', type: 'Luật', bullets: 'khong-phai-mang' } }, groups: {} },
      { groups: {} },
      [1],
    ];
    for (const [i, body] of bad.entries()) {
      const r = await fetch(`${BASE}/api/sets/${s.id}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(r.status, 'case ' + i).toBe(400);
    }
  });
  it('JSON không hợp lệ → 400', async () => {
    const s = await makeTempSet();
    const r = await fetch(`${BASE}/api/sets/${s.id}/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
    expect(r.status).toBe(400);
  });
});

describe('Static & headers', () => {
  it('đường dẫn tĩnh chứa .. → 400', async () => {
    const r = await fetch(BASE + '/../server.mjs');
    expect([400, 404]).toContain(r.status);
  });
  it('API trả X-Content-Type-Options: nosniff', async () => {
    const r = await fetch(BASE + '/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
