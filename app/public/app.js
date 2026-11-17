'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(url, opt) {
  const r = await fetch(url, opt);
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (url, body) => api(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = url => api(url, { method: 'DELETE' });

let SETS = [];
const refresh = async () => { SETS = await api('/api/sets'); };
let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = isErr ? 'err' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
}
const TYPES = ['Luật', 'Nghị định', 'Thông tư', 'Quyết định', 'Văn bản hợp nhất'];

function parseHash() {
  const h = location.hash.slice(2) || 'library';
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  return { screen: parts[0] || 'library', id: parts[1] || '', q: new URLSearchParams(qs || '').get('q') || '' };
}
function renderNav(r) {
  const s = SETS.find(x => x.id === r.id);
  $('#nav').innerHTML = (r.screen !== 'library' ? '<a class="btn" href="#/library">← Thư viện</a>' : '') +
    (s ? '<span>' + esc(s.name) + '</span>' : '') + (r.screen !== 'library' ? themeBtnHtml() : '');
}

/* Cùng bộ key "ln-color-scheme" với engine: một nút đổi nền cho cả app lẫn bản đồ trong iframe. */
function shownScheme() {
  const st = localStorage.getItem('ln-color-scheme');
  if (st === 'light' || st === 'dark') return st;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function themeBtnHtml() {
  const cur = shownScheme(), other = cur === 'dark' ? 'sáng' : 'tối';
  if (document.body.classList.contains('reel-on'))
    return '<button class="reel-pill" id="btn-theme" title="Đang là nền ' + (cur === 'dark' ? 'tối' : 'sáng') +
      ' — bấm để đổi">' + (cur === 'dark' ? '\u2600 Nền sáng' : '\u263e Nền tối') + '</button>';
  return '<button class="btn icon" id="btn-theme" title="Đang là nền ' + (cur === 'dark' ? 'tối' : 'sáng') +
    ' — bấm để đổi">' + (cur === 'dark' ? '\u2600' : '\u263e') +
    '<span class="sr">Chuyển sang nền ' + other + '</span></button>';
}
function applySchemeMeta() {
  const st = localStorage.getItem('ln-color-scheme');
  const m = document.querySelector('meta[name="color-scheme"]');
  if (m) m.content = st || 'light dark';
}
document.addEventListener('click', e => {
  const b = e.target.closest('#btn-theme');
  if (!b) return;
  const target = shownScheme() === 'dark' ? 'light' : 'dark';
  const sys = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { if (target === sys) localStorage.removeItem('ln-color-scheme'); else localStorage.setItem('ln-color-scheme', target); } catch (err) {}
  applySchemeMeta();
  b.outerHTML = themeBtnHtml();
});
addEventListener('storage', e => { if (e.key === 'ln-color-scheme') { applySchemeMeta(); const b = document.getElementById('btn-theme'); if (b) b.outerHTML = themeBtnHtml(); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { const b = document.getElementById('btn-theme'); if (b) b.outerHTML = themeBtnHtml(); });
async function route() {
  const r = parseHash();
  document.body.classList.toggle('reel-on', r.screen === 'library');
  if (r.screen !== 'library') Reel.unmount();
  try {
    if (r.screen === 'import') { renderNav(r); return importScreen(); }
    if (r.screen === 'edit' && r.id) { await refresh(); renderNav(r); return editor(r.id); }
    if (r.screen === 'view' && r.id) { await refresh(); renderNav(r); return viewer(r.id, r.q); }
    renderNav(r);
    return library();
  } catch (e) { toast(e.message, true); $('#main').innerHTML = '<p class="lead">Lỗi: ' + esc(e.message) + '</p>'; }
}
window.addEventListener('hashchange', route);

/* ---------- Thư viện ---------- */
const LEAF = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16Z" fill="currentColor" opacity=".9"/><path d="M5 19C10 13 15 8 19 5" stroke="var(--rm-paper)" stroke-width="1.5" stroke-linecap="round"/></svg>';
async function library() {
  await refresh();
  const docs = SETS.reduce((a, s) => a + s.docCount, 0);
  const tasks = SETS.reduce((a, s) => a + s.taskCount, 0);
  $('#main').innerHTML =
    '<div class="reel-bar"><div class="reel-top">' +
    '<a class="reel-logo" href="#/library">' + LEAF + 'LawNavi</a>' +
    '<nav class="reel-nav" aria-label="Trong trang"><a href="#reel" class="on">Bộ văn bản</a><a href="#ask">Hỏi vấn đề</a><a href="#sources">Nguồn chính thống</a></nav>' +
    '<span class="spacer"></span>' + themeBtnHtml() +
    '<a class="reel-pill solid" href="#/import">+ Nhập bộ</a>' +
    '</div></div>' +
    '<section class="reel" id="reel">' +
    '<div class="reel-badge">' + SETS.length + ' bộ · ' + docs + ' văn bản · ' + tasks + ' việc</div>' +
    '<h1 class="reel-h1"><span class="l1">Đọc đúng văn bản</span><span class="l2">cho đúng việc của bạn</span></h1>' +
    '<p class="reel-sub">Mỗi bộ là một luật gốc cùng nghị định, thông tư đi kèm — <br>dựng thành bản đồ quan hệ, lộ trình đọc và kịch bản vấn đề. <br>Kéo băng chuyền để chọn bộ, hoặc kể việc bạn đang vướng.</p>' +
    '<svg class="reel-doodle d0" viewBox="0 0 40 48" aria-hidden="true"></svg>' +
    '<div class="reel-note n1">Kéo ngang\nxem từng bộ</div>' +
    '<svg class="reel-doodle d1" viewBox="0 0 140 180" aria-hidden="true"></svg>' +
    '<div class="reel-band" aria-label="Băng chuyền bộ văn bản — kéo ngang để xem"></div>' +
    '<div class="reel-cta-name"></div>' +
    '<div class="reel-cta"><button type="button">Mở bản đồ</button></div>' +
    '<div class="reel-note n2">Mở miễn phí</div>' +
    '<svg class="reel-doodle d2" viewBox="0 0 56 36" aria-hidden="true"></svg>' +
    '</section>' +
    '<section class="shelf" aria-label="Công cụ thư viện">' +
    '<input type="search" id="shelfq" placeholder="Tìm theo tên bộ, số hiệu văn bản…" aria-label="Tìm bộ văn bản">' +
    '<select id="shelfsort" aria-label="Sắp xếp các bộ"><option value="mac-dinh">Thứ tự biên soạn</option><option value="ten">Tên A → Z</option><option value="docs">Nhiều văn bản nhất</option><option value="old">Nhiều bản hết hiệu lực</option></select>' +
    '<div class="chips" role="group" aria-label="Lọc trạng thái"><button data-f="all" class="on">Tất cả</button><button data-f="ok">Đã biên soạn</button><button data-f="draft">Nháp</button></div>' +
    '<span class="n"></span></section>' +
    '<section class="hero reel-sec" id="ask"><h1>Bạn đang vướng vấn đề gì?</h1>' +
    '<p class="lead">Kể bằng lời thường, như nhắn cho đồng nghiệp — không cần từ chuyên ngành. Hệ thống tự dịch sang khái niệm văn bản, đối chiếu từng bộ trong thư viện và xếp hạng bộ phù hợp nhất.</p>' +
    '<div class="askrow"><textarea id="heroq" rows="2" placeholder="Ví dụ: xây xong nhà không biết ai kiểm tra trước khi ở; hóa đơn tính sai tiền khách bắt sửa lại…"></textarea>' +
    '<button class="btn primary" id="herogo">Tìm bộ phù hợp</button></div><div id="herores"></div></section>' +
    '<section class="reel-sec" id="sources"><h2>Nguồn chính thống</h2>' +
    '<p class="lead">Toàn văn tải từ các cổng thông tin nhà nước đã kiểm chứng. Nhóm theo chủ đề để dễ tra cứu — trích dẫn chính thức vẫn phải đối chiếu bản gốc.</p>' +
    '<div class="srcgrid" id="srcgrid"></div></section>' +
    '<footer class="reel-foot">LawNavi — trợ lý đọc văn bản pháp luật. Dữ liệu biên soạn cục bộ trên máy bạn; gỡ bộ khỏi thư viện không xóa file trên đĩa.</footer>';
  $('#herogo').onclick = heroAsk;
  $('#heroq').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) heroAsk(); });
  Reel.mount($('#reel'));
  api('/api/sources').then(list => {
    const g = $('#srcgrid');
    if (g) g.innerHTML = (list || []).map(x =>
      '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><b>' + esc(x.name) + '</b><small>' + esc(x.owner) + ' — ' + esc(x.role) + '</small></a>').join('');
  }).catch(() => {});
}
async function heroAsk() {
  const q = $('#heroq').value.trim();
  if (!q) return toast('Hãy mô tả vấn đề trước đã.', true);
  const box = $('#herores'); box.innerHTML = '<p class="lead">Đang đối chiếu…</p>';
  try {
    const { results } = await post('/api/ask', { q });
    if (!results.length) { box.innerHTML = '<p class="lead">Chưa bộ nào khớp. Thử từ khóa chuyên ngành khác, hoặc nhập thêm thư mục văn bản.</p>'; return; }
    box.innerHTML = results.map((r, i) =>
      '<div class="rank"><div class="rhead"><span class="rnum">' + (i + 1) + '</span><b>' + esc(r.title) + '</b>' +
      (r.curated ? '<span class="badge ok">kịch bản đã kiểm duyệt</span>' : '') +
      '<span class="pct">' + r.pct + '%</span></div>' +
      '<div class="bar"><i style="width:' + r.pct + '%"></i></div>' +
      '<div class="tier">' + esc(r.tier) + ' · ' + r.covN + '/' + r.csN + ' khía cạnh khớp bộ văn bản</div>' +
      (r.says && r.says.length ? '<div class="says">' + r.says.map(x => '<span>' + esc(x) + '</span>').join('') + '</div>' : '') +
      (r.plan.length ? '<ol>' + r.plan.map(p => '<li><b>' + esc(p.code) + '</b> — ' + esc(p.why) + '</li>').join('') + '</ol>' : '') +
      '<a class="btn primary" href="#/view/' + r.id + '?q=' + encodeURIComponent(q) + '">Mở bản đồ với vấn đề này →</a></div>').join('');
  } catch (e) { box.innerHTML = ''; toast(e.message, true); }
}

/* ---------- Nhập thư mục ---------- */
function importScreen() {
  $('#main').innerHTML =
    '<section class="panel"><h2>Nhập thư mục văn bản</h2>' +
    '<p class="lead">App trích xuất tự động số hiệu, ngày, cặp thay thế từ file chữ (.txt/.md). File ảnh/PDF được liệt kê để bạn mở xem và bổ sung trong mục Biên soạn.</p>' +
    '<label>Tên bộ<input id="impname" placeholder="Ví dụ: Luật đấu thầu 2026"></label>' +
    '<div class="impgrid"><div class="impcol"><h3>Cách 1 — thư mục có sẵn trên máy</h3>' +
    '<p>Đọc tại chỗ, không copy. Dán đường dẫn tuyệt đối của thư mục.</p>' +
    '<input id="imppath" placeholder="/Users/ban/ten/thu-muc-luat"><br><br>' +
    '<button class="btn primary" id="impbtn1">Trích xuất ngay</button></div>' +
    '<div class="impcol"><h3>Cách 2 — kéo thả / chọn thư mục</h3>' +
    '<div id="drop" class="drop">Kéo thả file vào đây<br><small>.txt .md .pdf .jpg .png — tổng tối đa 64MB</small><br><br>' +
    '<button class="btn" id="pickbtn">Chọn thư mục…</button></div>' +
    '<input type="file" id="pick" webkitdirectory multiple hidden></div></div>' +
    '<div id="impres"></div></section>';
  $('#impbtn1').onclick = async () => {
    const name = $('#impname').value.trim() || 'Bộ văn bản mới';
    const sourceDir = $('#imppath').value.trim();
    if (!sourceDir) return toast('Dán đường dẫn thư mục trước đã.', true);
    try {
      const r = await post('/api/sets', { name, sourceDir });
      importResult(r.set, r.log);
    } catch (e) { toast(e.message, true); }
  };
  $('#pickbtn').onclick = () => $('#pick').click();
  $('#pick').onchange = e => uploadFiles(e.target.files);
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(e.dataTransfer.files); });
}
const readB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); });
async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const name = $('#impname').value.trim() || 'Bộ văn bản mới';
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > 60 * 1024 * 1024) return toast('Tổng dung lượng vượt 60MB — hãy dùng Cách 1 (đường dẫn) để đọc tại chỗ.', true);
  $('#impres').innerHTML = '<p class="lead">Đang tải ' + files.length + ' file…</p>';
  try {
    const payload = [];
    for (const f of files) payload.push({ rel: f.webkitRelativePath || f.name, b64: await readB64(f) });
    const { set } = await post('/api/sets', { name });
    const r = await post('/api/sets/' + set.id + '/files', { files: payload });
    importResult(set, r.log);
  } catch (e) { $('#impres').innerHTML = ''; toast(e.message, true); }
}
function importResult(set, log) {
  $('#impres').innerHTML = '<h3 style="margin-top:18px">Kết quả trích xuất</h3><pre class="log">' + esc(log) + '</pre>' +
    '<div class="actions" style="display:flex;gap:8px"><a class="btn primary" href="#/edit/' + set.id + '">Biên soạn ngay</a>' +
    '<a class="btn" href="#/view/' + set.id + '">Xem bản đồ nháp</a></div>';
  toast('Đã nhập bộ "' + set.name + '"');
}

/* ---------- Biên soạn ---------- */
let ED = null;
async function editor(id) {
  const [data, files, sources] = await Promise.all([api('/api/sets/' + id + '/data'), api('/api/sets/' + id + '/files'), api('/api/sources')]);
  const set = SETS.find(s => s.id === id) || { name: id, title: id };
  ED = { id, data, files, sources: sources || [], panel: 'docs', doc: Object.keys(data.docs)[0] || null, task: 0, prob: 0 };
  $('#main').innerHTML =
    '<div class="edtop"><b>' + esc(set.title) + '</b>' + (set.draft ? '<span class="badge draft">nháp</span>' : '') +
    '<span class="spacer"></span><button class="btn primary" id="edsave">Lưu</button>' +
    '<button class="btn" id="edrender">Render &amp; xem</button>' +
    '<a class="btn" href="/api/sets/' + id + '/map?download=1">Xuất HTML</a></div>' +
    '<div class="edbody"><aside class="ednav" id="ednav"></aside><div class="edmain" id="edmain"></div></div>';
  $('#edsave').onclick = save;
  $('#edrender').onclick = async () => { await save(); try { await post('/api/sets/' + id + '/render', {}); location.hash = '#/view/' + id; } catch (e) { toast(e.message, true); } };
  $('#edmain').addEventListener('input', onEditInput);
  $('#edmain').addEventListener('click', onEditClick);
  $('#ednav').addEventListener('click', onEditClick);
  drawNav(); drawPanel();
}
function drawNav() {
  const d = ED.data;
  const items = [
    ['docs', 'Văn bản (' + Object.keys(d.docs).length + ')'],
    ['tasks', 'Việc (' + (d.tasks || []).length + ')'],
    ['problems', 'Vấn đề mẫu (' + (d.problems || []).length + ')'],
    ['meta', 'Meta'],
    ['raw', 'Nhóm & khác'],
    ['files', 'Nguồn (' + ED.files.length + ')']
  ];
  $('#ednav').innerHTML = items.map(([k, l]) => '<button data-panel="' + k + '" class="' + (ED.panel === k ? 'on' : '') + '">' + l + '</button>').join('');
}
function drawPanel() {
  drawNav();
  const m = $('#edmain');
  if (ED.panel === 'docs') m.innerHTML = docsPanel();
  else if (ED.panel === 'tasks') m.innerHTML = tasksPanel();
  else if (ED.panel === 'problems') m.innerHTML = problemsPanel();
  else if (ED.panel === 'meta') m.innerHTML = metaPanel();
  else if (ED.panel === 'raw') m.innerHTML = rawPanel();
  else m.innerHTML = filesPanel();
}
function groupOpts(sel) {
  return Object.keys(ED.data.groups).map(g => '<option value="' + g + '"' + (g === sel ? ' selected' : '') + '>' + esc(g + ' — ' + (ED.data.groups[g].label || '')) + '</option>').join('');
}
function docOpts(sel) {
  return '<option value="">— chọn văn bản —</option>' + Object.keys(ED.data.docs).map(id =>
    '<option value="' + id + '"' + (id === sel ? ' selected' : '') + '>' + esc(ED.data.docs[id].code) + '</option>').join('');
}
function docsPanel() {
  const d = ED.data;
  const rows = Object.keys(d.docs).map(id => {
    const x = d.docs[id];
    return '<button class="docrow' + (id === ED.doc ? ' on' : '') + '" data-docid="' + id + '"><b>' + esc(x.code) + '</b>' +
      esc(x.type) + (x.old ? ' · <span class="old">hết hiệu lực</span>' : '') + '</button>';
  }).join('');
  const x = ED.doc ? d.docs[ED.doc] : null;
  const form = x ?
    '<div class="grid2"><div><label>Code (số hiệu đầy đủ)</label><input data-f="code" value="' + esc(x.code) + '"></div>' +
    '<div><label>Loại</label><select data-f="type">' + TYPES.map(t => '<option' + (t === x.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
    '<div><label>Nhóm</label><select data-f="g">' + groupOpts(x.g) + '</select></div>' +
    '<div><label>Keywords (cách nhau dấu phẩy)</label><input data-f="kw" value="' + esc(x.kw || '') + '"></div>' +
    '<div><label>Ngày ban hành</label><input data-f="issued" value="' + esc(x.issued || '') + '"></div>' +
    '<div><label>Hiệu lực</label><input data-f="eff" value="' + esc(x.eff || '') + '"></div></div>' +
    '<label>Tóm tắt nội dung</label><textarea data-f="sum" rows="3">' + esc(x.sum || '') + '</textarea>' +
    '<label>Ý chính (mỗi dòng một ý)</label><textarea data-f="bullets" rows="3">' + esc((x.bullets || []).join('\n')) + '</textarea>' +
    '<div class="grid2"><div><label>Thay thế (id, cách nhau dấu phẩy)</label><input data-f="replaces" value="' + esc((x.replaces || []).join(', ')) + '"></div>' +
    '<div><label>Được thay bởi (id)</label><input data-f="replacedBy" value="' + esc((x.replacedBy || []).join(', ')) + '"></div></div>' +
    '<label>Mốc / chips (cách nhau dấu phẩy)</label><input data-f="chips" value="' + esc((x.chips || []).join(', ')) + '">' +
    '<label>Chương mục (JSON: [{"t","d","nd"}]) — chỉ cho luật gốc</label><textarea id="f_chapters" rows="2">' + esc(JSON.stringify(x.chapters || [])) + '</textarea>' +
    '<div class="checks"><label><input type="checkbox" data-f="old"' + (x.old ? ' checked' : '') + '> Hết hiệu lực</label>' +
    '<label><input type="checkbox" data-f="hl"' + (x.hl ? ' checked' : '') + '> Đánh dấu nổi bật</label>' +
    '<span class="spacer"></span><button class="btn danger" data-deldoc="' + ED.doc + '">Xóa văn bản</button></div>'
    : '<p class="lead">Chọn một văn bản bên trái, hoặc thêm mới.</p>';
  return '<div class="docsplit"><div class="doclist"><input id="docfilter" placeholder="Lọc theo code / tóm tắt…">' +
    '<div id="docrows">' + rows + '</div>' +
    '<div class="newdoc"><label>Thêm văn bản</label><input id="ndid" placeholder="id (vd: nd321)">' +
    '<input id="ndcode" placeholder="NĐ 321/2026/NĐ-CP" style="margin-top:6px">' +
    '<select id="ndtype" style="margin-top:6px">' + TYPES.map(t => '<option>' + t + '</option>').join('') + '</select>' +
    '<button class="btn" data-adddoc="1" style="margin-top:6px">+ Thêm</button></div></div>' +
    '<div class="docform">' + form + '</div></div>';
}
function planRows(list, kind) {
  return '<div class="rowlist">' + (list || []).map((p, i) =>
    '<div class="prow"><select data-' + kind + 'doc="' + i + '">' + docOpts(p[0]) + '</select>' +
    '<input data-' + kind + 'why="' + i + '" value="' + esc(p[1] || '') + '" placeholder="Vì sao mở văn bản này?">' +
    '<button data-' + kind + 'rm="' + i + '" title="Xóa bước">×</button></div>').join('') + '</div>';
}
function tasksPanel() {
  const ts = ED.data.tasks || [];
  const t = ts[ED.task];
  const list = '<div class="itemlist">' + ts.map((x, i) => '<button data-taski="' + i + '" class="' + (i === ED.task ? 'on' : '') + '">' + esc(x.label || x.id) + '</button>').join('') +
    '<button data-addtask="1">+ Thêm việc</button></div>';
  if (!t) return list + '<p class="lead">Chưa có việc nào. “Việc” là nghiệp vụ thật (nghiệm thu, dự toán, kê khai…) kèm thứ tự văn bản cần mở.</p>';
  return list +
    '<div class="grid2"><div><label>Id</label><input data-tf="id" value="' + esc(t.id) + '"></div>' +
    '<div><label>Tên việc</label><input data-tf="label" value="' + esc(t.label) + '"></div></div>' +
    '<label>Gợi ý ngắn</label><input data-tf="hint" value="' + esc(t.hint || '') + '">' +
    '<label>Thứ tự văn bản cần mở</label>' + planRows(t.docs, 't') +
    '<button class="btn" data-tadd="1">+ Thêm bước</button> ' +
    '<button class="btn danger" data-taskdel="' + ED.task + '">Xóa việc</button>';
}
function problemsPanel() {
  const ps = ED.data.problems || [];
  const p = ps[ED.prob];
  const list = '<div class="itemlist">' + ps.map((x, i) => '<button data-probi="' + i + '" class="' + (i === ED.prob ? 'on' : '') + '">' + esc((x.q || '').slice(0, 40)) + '…</button>').join('') +
    '<button data-addprob="1">+ Thêm vấn đề</button></div>';
  if (!p) return list + '<p class="lead">“Vấn đề mẫu” là kịch bản đã kiểm duyệt: câu hỏi điển hình + kế hoạch văn bản + % phủ. Khi người dùng hỏi khớp, kịch bản này được ưu tiên.</p>';
  return list +
    '<label>Câu hỏi điển hình</label><textarea data-pf="q" rows="2">' + esc(p.q || '') + '</textarea>' +
    '<div class="grid2"><div><label>% phủ (0–100)</label><input type="number" min="0" max="100" data-pf="cover" value="' + (p.cover || 0) + '"></div>' +
    '<div><label>Ghi chú biên soạn</label><input data-pf="note" value="' + esc(p.note || '') + '"></div></div>' +
    '<label>Kế hoạch văn bản</label>' + planRows(p.plan, 'p') +
    '<button class="btn" data-padd="1">+ Thêm bước</button> ' +
    '<button class="btn danger" data-probdel="' + ED.prob + '">Xóa vấn đề</button>';
}
function metaPanel() {
  const m = ED.data.meta || {};
  return '<label>Tiêu đề bản đồ</label><input data-m="title" value="' + esc(m.title || '') + '">' +
    '<label>Dòng phụ (hiện dưới tiêu đề)</label><textarea data-m="sub" rows="2">' + esc(m.sub || '') + '</textarea>' +
    '<label>Nguồn & khuyến nghị (cuối trang)</label><textarea data-m="src" rows="4">' + esc(m.src || '') + '</textarea>' +
    '<label>Câu trích dẫn (cuối lộ trình đọc)</label><textarea data-m="quote" rows="2">' + esc(ED.data.quote || '') + '</textarea>';
}
function rawPanel() {
  const { groups, pairs, timeline, readingPath } = ED.data;
  return '<p class="hint">Nhóm màu, cặp cũ→mới, mốc thời gian, lộ trình đọc — sửa JSON trực tiếp rồi bấm Lưu. Phần còn lại (văn bản, việc, vấn đề, meta) dùng form ở các mục khác.</p>' +
    '<textarea id="rawjson" rows="22" style="font-family:ui-monospace,monospace;font-size:12.5px">' +
    esc(JSON.stringify({ groups, pairs: pairs || [], timeline: timeline || [], readingPath: readingPath || [] }, null, 1)) + '</textarea>';
}
function filesPanel() {
  const rows = ED.files.map(f =>
    '<button class="filerow" data-file="' + esc(f.rel) + '" data-kind="' + f.kind + '"><span class="kind ' + f.kind + '">' + f.kind + '</span>' +
    '<span>' + esc(f.rel) + '</span><span class="spacer"></span><small>' + Math.round(f.size / 1024) + ' KB</small></button>').join('');
  return '<div class="srcbox"><p class="hint"><b>Tải toàn văn từ nguồn chính thống</b> — chỉ nhận 5 tên miền chính thống; HTML tự chuyển thành .txt, PDF giữ nguyên.</p>' +
    '<div class="srcrow"><input id="fetchurl" placeholder="Dán URL văn bản từ vbpl.vn, chinhphu.vn, quochoi.vn…"><button id="fetchgo" class="btn">Tải về</button></div>' +
    '<p id="fetchres" class="hint"></p>' +
    '<div class="srclist">' + (ED.sources || []).map(s => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.owner) + ' — ' + esc(s.role) + '">' + esc(s.name) + '</a>').join('') + '</div></div>' +
    '<p class="hint">File chữ đã được máy trích xuất. File ảnh/PDF máy chưa đọc được — bấm để mở xem, rồi bổ sung số hiệu/tóm tắt vào mục Văn bản. Đây là bước con người (hoặc agent) phải làm để bản đồ đáng tin.</p>' +
    (rows || '<p class="lead">Không có file nguồn.</p>') + '<div class="preview" id="filepreview" hidden></div>';
}
async function fetchOfficial() {
  const url = $('#fetchurl').value.trim(), out = $('#fetchres');
  if (!url) { out.textContent = 'Dán URL văn bản từ nguồn chính thống trước.'; return; }
  out.textContent = 'Đang tải…';
  try {
    const r = await post('/api/sets/' + ED.id + '/fetch', { url });
    ED.files = await api('/api/sets/' + ED.id + '/files');
    drawPanel();
    $('#fetchres').textContent = r.log || 'Đã tải.';
  } catch (e) { out.textContent = 'Lỗi: ' + e.message; }
}
function onEditInput(e) {
  const t = e.target, d = ED.data;
  if (t.id === 'docfilter') {
    const term = t.value.toLowerCase();
    $$('#docrows .docrow').forEach(r => {
      const x = d.docs[r.dataset.docid];
      r.style.display = ((x.code + ' ' + (x.sum || '')).toLowerCase().includes(term)) ? '' : 'none';
    });
    return;
  }
  if (t.dataset.f && ED.doc) {
    const f = t.dataset.f, x = d.docs[ED.doc];
    if (f === 'old' || f === 'hl') x[f] = t.checked;
    else if (f === 'replaces' || f === 'replacedBy' || f === 'chips') x[f] = t.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (f === 'bullets') x[f] = t.value.split('\n').map(s => s.trim()).filter(Boolean);
    else x[f] = t.value;
    return;
  }
  if (t.dataset.tf) { const x = (d.tasks || [])[ED.task]; if (x) x[t.dataset.tf] = t.value; return; }
  if (t.dataset.tdoc !== undefined) { const x = (d.tasks || [])[ED.task]; if (x) x.docs[+t.dataset.tdoc][0] = t.value; return; }
  if (t.dataset.twhy !== undefined) { const x = (d.tasks || [])[ED.task]; if (x) x.docs[+t.dataset.twhy][1] = t.value; return; }
  if (t.dataset.pf) { const x = (d.problems || [])[ED.prob]; if (x) x[t.dataset.pf] = t.dataset.pf === 'cover' ? Math.max(0, Math.min(100, +t.value || 0)) : t.value; return; }
  if (t.dataset.pdoc !== undefined) { const x = (d.problems || [])[ED.prob]; if (x) x.plan[+t.dataset.pdoc][0] = t.value; return; }
  if (t.dataset.pwhy !== undefined) { const x = (d.problems || [])[ED.prob]; if (x) x.plan[+t.dataset.pwhy][1] = t.value; return; }
  if (t.dataset.m) { d.meta = d.meta || {}; d.meta[t.dataset.m] = t.value; if (t.dataset.m === 'quote') d.quote = t.value; return; }
}
async function onEditClick(e) {
  if (e.target.closest('#fetchgo')) { fetchOfficial(); return; }
  const t = e.target.closest('[data-panel],[data-docid],[data-adddoc],[data-deldoc],[data-taski],[data-addtask],[data-tadd],[data-taskdel],[data-probi],[data-addprob],[data-padd],[data-probdel],[data-trm],[data-prm],[data-file]');
  if (!t) return;
  const d = ED.data;
  if (t.dataset.panel) { ED.panel = t.dataset.panel; drawPanel(); return; }
  if (t.dataset.docid) { ED.doc = t.dataset.docid; drawPanel(); return; }
  if (t.dataset.adddoc) {
    const id = $('#ndid').value.trim(), code = $('#ndcode').value.trim(), type = $('#ndtype').value;
    if (!id || !code) return toast('Nhập id và code trước đã.', true);
    if (d.docs[id]) return toast('Id đã tồn tại: ' + id, true);
    d.docs[id] = { code, type, g: 'lq', sum: '', kw: '' };
    ED.doc = id; drawPanel(); return;
  }
  if (t.dataset.deldoc) {
    if (!confirm('Xóa văn bản ' + d.docs[t.dataset.deldoc].code + '?')) return;
    delete d.docs[t.dataset.deldoc];
    ED.doc = Object.keys(d.docs)[0] || null; drawPanel(); return;
  }
  if (t.dataset.taski !== undefined) { ED.task = +t.dataset.taski; drawPanel(); return; }
  if (t.dataset.addtask) { d.tasks = d.tasks || []; d.tasks.push({ id: 'viec' + (d.tasks.length + 1), label: 'Việc mới', hint: '', docs: [] }); ED.task = d.tasks.length - 1; drawPanel(); return; }
  if (t.dataset.tadd) { const x = d.tasks[ED.task]; x.docs.push(['', '']); drawPanel(); return; }
  if (t.dataset.trm !== undefined) { d.tasks[ED.task].docs.splice(+t.dataset.trm, 1); drawPanel(); return; }
  if (t.dataset.taskdel !== undefined) { if (!confirm('Xóa việc này?')) return; d.tasks.splice(+t.dataset.taskdel, 1); ED.task = 0; drawPanel(); return; }
  if (t.dataset.probi !== undefined) { ED.prob = +t.dataset.probi; drawPanel(); return; }
  if (t.dataset.addprob) { d.problems = d.problems || []; d.problems.push({ q: '', cover: 70, plan: [], note: '' }); ED.prob = d.problems.length - 1; drawPanel(); return; }
  if (t.dataset.padd) { const x = d.problems[ED.prob]; x.plan.push(['', '']); drawPanel(); return; }
  if (t.dataset.prm !== undefined) { d.problems[ED.prob].plan.splice(+t.dataset.prm, 1); drawPanel(); return; }
  if (t.dataset.probdel !== undefined) { if (!confirm('Xóa vấn đề mẫu này?')) return; d.problems.splice(+t.dataset.probdel, 1); ED.prob = 0; drawPanel(); return; }
  if (t.dataset.file) { previewFile(t.dataset.file, t.dataset.kind); return; }
}
async function previewFile(rel, kind) {
  const box = $('#filepreview'); box.hidden = false;
  const url = '/api/file?set=' + ED.id + '&rel=' + encodeURIComponent(rel);
  if (kind === 'image') box.innerHTML = '<img src="' + url + '" alt="' + esc(rel) + '">';
  else if (kind === 'pdf') box.innerHTML = '<iframe src="' + url + '" title="' + esc(rel) + '"></iframe>';
  else if (kind === 'text') { const r = await fetch(url); box.innerHTML = '<pre>' + esc(await r.text()) + '</pre>'; }
  else box.innerHTML = '<p class="hint">Định dạng chưa xem trực tiếp được. <a href="' + url + '" download>Tải file</a>.</p>';
}
async function save() {
  try {
    if ($('#rawjson')) {
      const raw = JSON.parse($('#rawjson').value);
      if (!raw.groups || typeof raw.groups !== 'object') throw new Error('JSON nhóm không hợp lệ');
      ED.data.groups = raw.groups; ED.data.pairs = raw.pairs || [];
      ED.data.timeline = raw.timeline || []; ED.data.readingPath = raw.readingPath || [];
    }
    if ($('#f_chapters') && ED.doc) {
      const txt = $('#f_chapters').value.trim();
      ED.data.docs[ED.doc].chapters = txt ? JSON.parse(txt) : [];
    }
    await put('/api/sets/' + ED.id + '/data', ED.data);
    toast('Đã lưu bộ văn bản');
    await refresh();
  } catch (e) { toast('Chưa lưu được: ' + e.message, true); throw e; }
}

/* ---------- Xem bản đồ ---------- */
function viewer(id, q) {
  const s = SETS.find(x => x.id === id) || { title: id, name: id };
  // Safari không chuyển prefers-color-scheme vào iframe -> truyền tường minh scheme đang hiển thị.
  const scheme = localStorage.getItem('ln-color-scheme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const mapUrl = '/api/sets/' + id + '/map?' + (q ? 'q=' + encodeURIComponent(q) + '&' : '') + 'theme=' + scheme;
  $('#main').innerHTML =
    '<div class="vwtop"><b>' + esc(s.title) + '</b><span class="spacer"></span>' +
    '<a class="btn" href="#/edit/' + id + '">Biên soạn</a>' +
    '<a class="btn" href="/api/sets/' + id + '/map?download=1">Xuất HTML</a>' +
    '<a class="btn" target="_blank" rel="noopener" href="' + mapUrl + '">Mở tab mới</a></div>' +
    '<iframe id="mapframe" title="Bản đồ văn bản" src="' + mapUrl + '"></iframe>';
}

refresh().then(route).catch(e => { $('#main').innerHTML = '<p class="lead">Không kết nối được server: ' + esc(e.message) + '</p>'; });