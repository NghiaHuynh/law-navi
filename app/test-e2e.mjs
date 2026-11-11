import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 4790 + Math.floor(Math.random() * 40);
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const failures = [];
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label); if (!cond) failures.push(label); };

// fixture folder
const fixture = '/tmp/lawnavi-fixture-' + Date.now();
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, 'ghi-chu.txt'),
  '▪ NĐ 321/2026/NĐ-CP (15/9/2026, hiệu lực từ 01/10/2026): quy định chi tiết về quản lý chất lượng công trình; thay NĐ 06/2021/NĐ-CP.\n' +
  'NĐ 321/2026 → TT 45/2026/TT-BXD (hướng dẫn biểu mẫu nghiệm thu).\n' +
  'Luật Xây dựng 135/2025/QH15: khung chung về hoạt động xây dựng.\n' +
  'Văn bản cũ: NĐ 06/2021/NĐ-CP, NĐ 15/2021/NĐ-CP.\n');
fs.writeFileSync(path.join(fixture, 'anh-hien-trang.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

// server
const server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; }); server.stderr.on('data', d => { serverLog += d; });
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return await r.json(); } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('server not up:\n' + serverLog);
}
const health = await waitUp();
ok(health.ok && health.engine, 'server health + engine skill hiện diện');

// API: seeded sets + cross-set ask
const srcs = await (await fetch(BASE + '/api/sources')).json();
ok(Array.isArray(srcs) && srcs.length === 5, 'api/sources đủ 5 nguồn chính thống');
const badFetch = await fetch(BASE + '/api/sets/xay-dung-2026/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://evil.example.com/a.pdf' }) });
ok(badFetch.status === 400, 'fetch chặn host ngoài allowlist');
const sets0 = await (await fetch(BASE + '/api/sets')).json();
ok(sets0.length === 2, 'thư viện seed 2 bộ (xây dựng, thuế)');
const ask = await (await fetch(BASE + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'hóa đơn điện tử lập sai thuế suất, khách yêu cầu hủy và lập lại' }) })).json();
ok(ask.results.length >= 1 && ask.results[0].id === 'thue-2026', 'cross-set ask xếp hạng bộ thuế đầu tiên (got: ' + (ask.results[0] || {}).id + ', ' + (ask.results[0] || {}).pct + '%)');

// layperson natural language (no jargon)
const LAY = [
  ['xây xong nhà không biết ai kiểm tra trước khi ở', 'xay-dung-2026', 'nd207'],
  ['nuôi con nhỏ không đi làm có được trừ tiền thuế không', 'thue-2026', 'nd253'],
  ['hóa đơn tính sai tiền khách bắt sửa lại', 'thue-2026', null],
  ['bị phạt vì xây nhà không có giấy phép', 'xay-dung-2026', null]
];
for (const [q, wantSet, wantDoc] of LAY) {
  const r = await (await fetch(BASE + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) })).json();
  const top = r.results[0] || {};
  ok(top.id === wantSet && (!wantDoc || top.plan.some(p => p.id === wantDoc)) && (top.says || []).length > 0,
    'ngôn ngữ thường "' + q.slice(0, 30) + '…" → ' + top.id + ' ' + top.pct + '% (hiểu: ' + (top.says || []).join('; ') + ')');
}

// API: import fixture by path
const imp = await (await fetch(BASE + '/api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fixture chất lượng', sourceDir: fixture }) })).json();
ok(imp.set && imp.set.docCount >= 4, 'import đường dẫn trích xuất >=4 văn bản (got ' + (imp.set || {}).docCount + ')');
ok(/CẦN AGENT ĐỌC THÊM/.test(imp.log || ''), 'extract cảnh báo file nhị nghĩa');
const fid = imp.set.id;

// chrome
const CPORT = 9600 + Math.floor(Math.random() * 40);
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CPORT, '--user-data-dir=/tmp/lawnavi-e2e-' + CPORT,
  '--no-first-run', '--disable-sync', '--window-size=1500,1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
async function waitCdp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + CPORT + '/json/version'); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 300)); }
  throw new Error('chrome cdp down');
}
await waitCdp();
const targets = await (await fetch('http://127.0.0.1:' + CPORT + '/json/list')).json();
for (const t of targets.filter(t => t.type === 'page')) await fetch('http://127.0.0.1:' + CPORT + '/json/close/' + t.id);
const target = await (await fetch('http://127.0.0.1:' + CPORT + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1; const pending = new Map(); const errors = [];
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map(a => a.value || a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise(res => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) errors.push('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
};
const nav = async url => { await send('Page.navigate', { url }); await sleep(1200); };
await send('Page.enable'); await send('Runtime.enable');

// 1) library
await nav(BASE + '/');
ok(await ev(`document.querySelectorAll('.card').length`) >= 2, 'UI thư viện hiện các thẻ bộ');
await shot('app-library.png');

// 2) hero ask ranking
await ev(`(function(){var t=document.getElementById('heroq');t.value='hóa đơn điện tử lập sai thuế suất, khách yêu cầu hủy và lập lại';document.getElementById('herogo').click();})()`);
await sleep(700);
const rankTxt = await ev(`(document.getElementById('herores')||{}).innerText||''`);
ok(/thuế/i.test(rankTxt) && /%/.test(rankTxt), 'UI xếp hạng cross-set hiện bộ thuế + %');
await shot('app-ask-rank.png');

// 2b) layperson query through UI + says chips in map
await ev(`(function(){var t=document.getElementById('heroq');t.value='xây xong nhà không biết ai kiểm tra trước khi ở';document.getElementById('herogo').click();})()`);
await sleep(700);
const layRank = await ev(`(document.getElementById('herores')||{}).innerText||''`);
ok(/nghiệm thu/i.test(layRank), 'UI hiện bản dịch nghĩa "nghiệm thu" cho câu đời thường');
await shot('app-lay-rank.png');
await ev(`document.querySelector('#herores .rank a.btn.primary').click()`);
await sleep(1800);
const layMap = await ev(`(function(){var d=document.getElementById('mapframe').contentDocument;var r=d.getElementById('ln-askres');return r?r.innerText:'';})()`);
ok(/Hệ thống hiểu câu của bạn là/.test(layMap) && /nghiệm thu/i.test(layMap), 'bản đồ hiện khối dịch nghĩa cho câu đời thường');
await shot('app-lay-map.png');

// 3) import via UI (path mode)
await nav(BASE + '/#/import');
await ev(`(function(){document.getElementById('impname').value='Fixture UI';document.getElementById('imppath').value=${JSON.stringify(fixture)};document.getElementById('impbtn1').click();})()`);
await sleep(1500);
const impLog = await ev(`(document.querySelector('#impres pre.log')||{}).innerText||''`);
ok(/văn bản/.test(impLog), 'UI import hiện log trích xuất');
await shot('app-import.png');
const sets1 = await (await fetch(BASE + '/api/sets')).json();
const uiSet = sets1.find(s => s.name === 'Fixture UI');
ok(!!uiSet, 'bộ Fixture UI đã vào thư viện');

// 4) editor: load, edit sum, save
await nav(BASE + '/#/edit/' + fid);
await sleep(600);
const rowCount = await ev(`document.querySelectorAll('#docrows .docrow').length`);
ok(rowCount >= 4, 'editor liệt kê văn bản (' + rowCount + ')');
await ev(`(function(){var r=document.querySelector('#docrows .docrow');r&&r.click();})()`);
await sleep(300);
await ev(`(function(){var t=document.querySelector('[data-f="sum"]');if(t){t.value='Tóm tắt đã biên soạn lại trong app.';t.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
await ev(`document.getElementById('edsave').click()`);
await sleep(700);
const saved = await (await fetch(BASE + '/api/sets/' + fid + '/data')).json();
ok(Object.values(saved.docs).some(d => d.sum === 'Tóm tắt đã biên soạn lại trong app.'), 'lưu biên soạn ghi xuống data.json');
ok((await (await fetch(BASE + '/api/sets')).json()).find(s => s.id === fid).draft === false, 'bộ hết nhãn nháp sau lưu');
await shot('app-editor.png');
await ev(`document.querySelector('[data-panel="files"]').click()`);
const srcTxt = await ev(`document.getElementById('edmain').innerText`);
ok(/Tải toàn văn từ nguồn chính thống/.test(srcTxt) && /CSDL quốc gia/.test(srcTxt), 'editor Nguồn hiện dải nguồn chính thống + ô tải');
await shot('app-sources.png');

// 5) viewer iframe renders map with tabs
await nav(BASE + '/#/view/' + fid);
await sleep(1800);
const iframeTabs = await ev(`(function(){var f=document.getElementById('mapframe');var d=f&&f.contentDocument;return d?d.querySelectorAll('#ln-tabs button').length:0;})()`);
ok(iframeTabs >= 3, 'iframe bản đồ render đủ tab (' + iframeTabs + ')');
await shot('app-viewer.png');

// 6) deep-link ?q= opens ask pre-run
await nav(BASE + '/api/sets/thue-2026/map?q=' + encodeURIComponent('hóa đơn điện tử lập sai thuế suất phải xử lý'));
await sleep(1200);
const pct = await ev(`(document.querySelector('.pct')||{}).textContent||''`);
ok(/%/.test(pct), 'deep-link ?q= chạy sẵn phân tích (' + pct + ')');
await shot('app-deeplink.png');

// 7) source file preview guard: traversal must fail
const guard = await fetch(BASE + '/api/file?set=' + fid + '&rel=../../etc/passwd');
ok(guard.status === 400, 'chặn path traversal ở /api/file');

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
if (errors.length) failures.push('console errors');

// cleanup: unregister test sets (files remain on disk)
for (const s of [fid, uiSet && uiSet.id]) if (s) await fetch(BASE + '/api/sets/' + s, { method: 'DELETE' });

ws.close(); chrome.kill(); server.kill();
console.log(failures.length ? '\nE2E FAIL: ' + failures.join(' | ') : '\nE2E ALL PASS');
process.exit(failures.length ? 2 : 0);