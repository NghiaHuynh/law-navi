import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WebSocket = globalThis.WebSocket || (await import('ws')).default;

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
const SEEDED = ['xay-dung-2026', 'thue-2026', 'dat-dai-2024', 'lao-dong-2026', 'giao-thong-2026',
  'hon-nhan-gia-dinh-2026', 'nha-o-chung-cu-2026', 'dan-su-hop-dong-thua-ke-2026', 'kinh-doanh-giay-phep-2026'];
const missing = SEEDED.filter(id => !sets0.some(s => s.id === id));
ok(sets0.length >= SEEDED.length && !missing.length,
  'thư viện có đủ ' + SEEDED.length + ' bộ lĩnh vực' + (missing.length ? ' (thiếu: ' + missing + ')' : ' (got ' + sets0.length + ')'));
const ask = await (await fetch(BASE + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'hóa đơn điện tử lập sai thuế suất, khách yêu cầu hủy và lập lại' }) })).json();
ok(ask.results.length >= 1 && ask.results[0].id === 'thue-2026', 'cross-set ask xếp hạng bộ thuế đầu tiên (got: ' + (ask.results[0] || {}).id + ', ' + (ask.results[0] || {}).pct + '%)');

// layperson natural language (no jargon)
const LAY = [
  ['xây xong nhà không biết ai kiểm tra trước khi ở', 'xay-dung-2026', 'nd207'],
  ['nuôi con nhỏ không đi làm có được trừ tiền thuế không', 'thue-2026', 'nd253'],
  ['hóa đơn tính sai tiền khách bắt sửa lại', 'thue-2026', null],
  ['bị phạt vì xây nhà không có giấy phép', 'xay-dung-2026', null],
  ['mua đất giấy tay có làm được sổ đỏ không', 'dat-dai-2024', 'nd101'],
  ['xây nhà trên đất nông nghiệp bị phạt bao nhiêu', 'dat-dai-2024', 'nd123'],
  ['nộp hồ sơ sổ đỏ ở xã hay huyện', 'dat-dai-2024', 'nd151'],
  ['mở quán cà phê cần giấy tờ gì để bán hàng hợp pháp', 'kinh-doanh-giay-phep-2026', 'nd168'],
  ['bán rượu bia thì phải xin giấy phép con ở đâu', 'kinh-doanh-giay-phep-2026', 'luat143'],
  ['công ty không khai chủ sở hữu hưởng lợi có bị phạt không', 'kinh-doanh-giay-phep-2026', 'nd288']
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

// 5b) engine UX: onboarding, persona, tour, pathfinder, phím tắt
await nav(BASE + '/#/view/xay-dung-2026');
await sleep(1800);
const inMap = expr => ev(`(function(){var d=document.getElementById('mapframe').contentDocument,w=d.defaultView;return (${expr});})()`);
const clickMap = sel => inMap(`(function(){var el=d.querySelector('${sel}');if(el)el.click();return !!el;})()`);
await clickMap('[data-view="map"]');
await sleep(300);
ok(await inMap(`!!d.querySelector('.ln-hint')`), 'onboarding: gợi ý lần đầu hiện ở bản đồ');
await clickMap('[data-hintx]');
await sleep(200);
ok(await inMap(`!d.querySelector('.ln-hint')`), 'onboarding: ẩn gợi ý sau khi bấm ×');
await clickMap('[data-persona="nguoidan"]');
await sleep(300);
const tabsND = await inMap(`Array.from(d.querySelectorAll('#ln-tabs button')).map(b=>b.dataset.view).join(',')`);
ok(!tabsND.split(',').includes('old'), 'persona Người dân: ẩn tab văn bản cũ');
await clickMap('[data-persona="chuyensau"]');
await sleep(300);
const tabsCS = await inMap(`Array.from(d.querySelectorAll('#ln-tabs button')).map(b=>b.dataset.view).join(',')`);
ok(tabsCS.split(',').includes('old'), 'persona Chuyên sâu: hiện tab văn bản cũ');
await shot('app-persona.png');
ok(await clickMap('[data-view="path"]'), 'tour: mở tab Học từng bước');
await sleep(300);
ok(await inMap(`!!d.querySelector('[data-tourstart]')`), 'tour: overview có nút bắt đầu');
const nSteps = await inMap(`d.querySelectorAll('[data-tourgo]').length`);
ok(nSteps === 8, 'tour: liệt kê đủ 8 bước (got ' + nSteps + ')');
await shot('app-tour-overview.png');
await clickMap('[data-tourstart]');
await sleep(300);
const t1 = await inMap(`(d.querySelector('.tourcard')||{}).innerText||''`);
const chip1 = await inMap(`(d.querySelector('.tourhead .chip')||{}).innerText||''`);
ok(/Luật 135/.test(t1) && /Bước 1 \/ 8/.test(chip1), 'tour: bước 1 hiện Luật 135 + tiến độ 1/8');
await shot('app-tour-step1.png');
await clickMap('[data-tournext]');
await sleep(200);
ok(/Bước 2 \/ 8/.test(await inMap(`(d.querySelector('.tourhead .chip')||{}).innerText||''`)), 'tour: next sang bước 2');
await clickMap('[data-tourexit]');
await sleep(200);
ok(await inMap(`!!d.querySelector('[data-tourstart]')`), 'tour: thoát về overview');
await clickMap('#ln-pathbtn');
await sleep(200);
ok(await inMap(`!d.getElementById('ln-pathmodal').hidden`), 'pathfinder: mở modal Tìm đường liên hệ');
await inMap(`(function(){d.getElementById('ln-pfrom').value='luat135';d.getElementById('ln-pto').value='tt32';return 1;})()`);
await clickMap('#ln-pgo');
await sleep(200);
const chain = await inMap(`(d.getElementById('ln-pres')||{}).innerText||''`);
ok(/Luật 135/.test(chain) && /NĐ 207/.test(chain) && /TT 32/.test(chain), 'pathfinder: chuỗi Luật 135 → NĐ 207 → TT 32');
await shot('app-pathfinder.png');
await inMap(`(function(){d.querySelector('#ln-pathmodal [data-closemodal]').click();return 1;})()`);
await inMap(`(function(){d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'?',bubbles:true}));return 1;})()`);
await sleep(200);
ok(await inMap(`!d.getElementById('ln-helpmodal').hidden`), 'phím tắt: ? mở bảng trợ giúp');
await inMap(`(function(){d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1;})()`);
await sleep(200);
ok(await inMap(`d.getElementById('ln-helpmodal').hidden`), 'phím tắt: Esc đóng modal');

// 5c) cross-set hint: câu đất đai hỏi bên trong bộ xây dựng
await clickMap('[data-view="ask"]');
await sleep(300);
await inMap(`(function(){d.getElementById('ln-askq').value='làm sổ đất lần đầu thì phải đến đâu chuẩn bị gì?';d.getElementById('ln-askgo').click();return 1;})()`);
await sleep(900);
const routeTxt = await inMap(`(d.getElementById('ln-askroute')||{}).innerText||''`);
ok(/Đất đai 2024/.test(routeTxt), 'cross-set: câu đất đai hỏi trong bộ xây dựng → gợi ý bộ Đất đai 2024');
const routeHref = await inMap(`(function(){var a=d.querySelector('#ln-askroute a');return a?a.getAttribute('href'):'';})()`);
ok(/\/api\/sets\/dat-dai-2024\/map\?q=/.test(routeHref), 'cross-set: link mở đúng bộ kèm câu hỏi');
await inMap(`(function(){d.getElementById('ln-askroute').scrollIntoView({block:'center'});return 1;})()`);
await sleep(300);
await shot('app-crossset-hint.png');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
await inMap(`(function(){d.getElementById('ln-askroute').scrollIntoView({block:'center'});return 1;})()`);
await sleep(300);
ok(!(await inMap(`(function(){var de=d.documentElement;return de.scrollWidth>de.clientWidth+1;})()`)), 'cross-set: gợi ý không tràn ngang ở 390px');
await shot('app-crossset-hint-mobile.png');
await send('Emulation.clearDeviceMetricsOverride');
await sleep(300);

// 5d) fixcard: khối chưa phủ nổi bật + hướng giải quyết (bộ Đất đai, kịch bản giấy viết tay)
await ev(`(function(){document.getElementById('mapframe').src='/api/sets/dat-dai-2024/map?q='+encodeURIComponent('Mua đất bằng giấy viết tay, chưa sang tên, giờ muốn làm sổ đỏ');return 1;})()`);
await sleep(1200);
ok(await inMap(`!!d.getElementById('ln-fixcard')`), 'fixcard: khối chưa phủ hiện dạng thẻ nổi bật');
const fxTitle = await inMap(`(d.querySelector('#ln-fixcard .fxttl b')||{}).innerText||''`);
ok(/Phần chưa phủ \(13%\)/.test(fxTitle), 'fixcard: tiêu đề nêu đúng % chưa phủ (' + fxTitle + ')');
const nWords = await inMap(`d.querySelectorAll('#ln-fixcard .fxword').length`);
ok(nWords === 2, 'fixcard: 2 khái niệm chưa phủ kèm giải thích lời thường');
const fxTxt = await inMap(`(d.getElementById('ln-fixcard')||{}).innerText||''`);
ok(/giấy viết tay/.test(fxTxt) && /chưa công chứng/.test(fxTxt), 'fixcard: gloss giải thích «viết»/«chưa»');
ok(!/Phần này cần nguồn khác/.test(fxTxt), 'fixcard: bỏ câu chung chung «cần nguồn khác»');
const fxSteps = await inMap(`d.querySelectorAll('#ln-fixcard .fxsteps li').length`);
ok(fxSteps === 4, 'fixcard: 4 bước giải quyết kịch bản giấy viết tay');
ok(/01\/7\/2014/.test(fxTxt) && /Điều 138/.test(fxTxt), 'fixcard: bước dẫn mốc 01/7/2014 + Điều 138');
ok(/Ghi chú biên soạn/.test(fxTxt), 'fixcard: ghi chú biên soạn nằm trong khối');
const jumpHref = await inMap(`(function(){var a=d.querySelector('.missjump');return a?a.getAttribute('href'):'';})()`);
ok(jumpHref === '#ln-fixcard', 'fixcard: link % nhảy tới khối hướng giải quyết');
await inMap(`(function(){d.getElementById('ln-fixcard').scrollIntoView({block:'start'});return 1;})()`);
await sleep(300);
await shot('app-fixcard.png');
await inMap(`(function(){d.getElementById('ln-askq').value='kiện hàng xóm vì ranh giới thửa đất';d.getElementById('ln-askgo').click();return 1;})()`);
await sleep(600);
const fbSteps = await inMap(`d.querySelectorAll('#ln-fixcard .fxsteps li').length`);
const fbLinks = await inMap(`d.querySelectorAll('#ln-fixcard .fxlinks a').length`);
ok(fbSteps === 3 && fbLinks === 5, 'fixcard: fallback 3 bước + 5 nguồn chính thống khi không có kịch bản (' + fbSteps + '/' + fbLinks + ')');
await inMap(`(function(){d.getElementById('ln-fixcard').scrollIntoView({block:'start'});return 1;})()`);
await sleep(300);
await shot('app-fixcard-fallback.png');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
await inMap(`(function(){d.getElementById('ln-askq').value='Mua đất bằng giấy viết tay, chưa sang tên, giờ muốn làm sổ đỏ';d.getElementById('ln-askgo').click();return 1;})()`);
await sleep(600);
await inMap(`(function(){d.getElementById('ln-fixcard').scrollIntoView({block:'start'});return 1;})()`);
await sleep(300);
ok(!(await inMap(`(function(){var de=d.documentElement;return de.scrollWidth>de.clientWidth+1;})()`)), 'fixcard: không tràn ngang ở 390px');
await shot('app-fixcard-mobile.png');
await send('Emulation.clearDeviceMetricsOverride');
await sleep(300);

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

// cleanup: unregister test sets and remove their on-disk fixture folders
const SETS_DIR = path.join(__dirname, 'sets');
for (const s of [fid, uiSet && uiSet.id]) {
  if (!s) continue;
  await fetch(BASE + '/api/sets/' + s, { method: 'DELETE' });
  if (s.startsWith('fixture-')) fs.rmSync(path.join(SETS_DIR, s), { recursive: true, force: true });
}
fs.rmSync(fixture, { recursive: true, force: true });

ws.close(); chrome.kill(); server.kill();
console.log(failures.length ? '\nE2E FAIL: ' + failures.join(' | ') : '\nE2E ALL PASS');
process.exit(failures.length ? 2 : 0);