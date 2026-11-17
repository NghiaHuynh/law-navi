'use strict';
/* Băng chuyền cong kiểu Reelmark cho thư viện bộ văn bản.
   Một vòng rAF duy nhất đọc đồng hồ WAAPI chạy dài; hình học mỗi thẻ
   (clip-path tứ giác bo góc) tính lại theo vị trí ngang như mặt trong
   hình trụ. Kéo 1:1, thả có quán tính, rồi auto-scroll chở lại. */
(function () {
  const PITCH = 196, AUTO = 50, DECAY = 0.05;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let S = null;

  function geom() {
    const phone = innerWidth <= 820;
    const u = phone ? innerWidth / 640 : Math.min(innerWidth / 1440, innerHeight / 1080);
    const band = S.band;
    return {
      phone, u,
      cx: phone ? 320 : 720,
      span: phone ? 353 : 706,
      cy: phone ? band.clientHeight / 2 / u : 192,
      frameW: phone ? 640 : 1440
    };
  }

  function quadPath(w, hL, hR, r) {
    const H = Math.max(hL, hR);
    const yL0 = (H - hL) / 2, yL1 = (H + hL) / 2, yR0 = (H - hR) / 2, yR1 = (H + hR) / 2;
    r = Math.min(r, w / 2, hL / 2, hR / 2);
    const f = n => n.toFixed(2);
    return 'path("M ' + f(r) + ' ' + f(yL0) +
      ' L ' + f(w - r) + ' ' + f(yR0) + ' Q ' + f(w) + ' ' + f(yR0) + ' ' + f(w) + ' ' + f(yR0 + r) +
      ' L ' + f(w) + ' ' + f(yR1 - r) + ' Q ' + f(w) + ' ' + f(yR1) + ' ' + f(w - r) + ' ' + f(yR1) +
      ' L ' + f(r) + ' ' + f(yL1) + ' Q 0 ' + f(yL1) + ' 0 ' + f(yL1 - r) +
      ' L 0 ' + f(yL0 + r) + ' Q 0 ' + f(yL0) + ' ' + f(r) + ' ' + f(yL0) + ' Z")';
  }

  function layout() {
    const g = geom(), loop = S.list.length * PITCH;
    for (const c of S.cards) {
      const t = mod(c.i * PITCH - S.s, loop) - loop / 2;
      const x = g.cx + t * (1 + 0.083 * Math.pow(t / g.span, 2));
      const d = Math.abs(x - g.cx) / g.span;
      const w = 170 + 48 * d * d;
      if (x + w / 2 < -40 || x - w / 2 > g.frameW + 40) { c.el.style.display = 'none'; continue; }
      c.el.style.display = '';
      const qL = Math.abs(x - w / 2 - g.cx) / g.span, qR = Math.abs(x + w / 2 - g.cx) / g.span;
      const hL = 280 + 92 * Math.pow(qL, 2.6), hR = 280 + 92 * Math.pow(qR, 2.6);
      const H = Math.max(hL, hR);
      c.el.style.left = ((x - w / 2) * g.u) + 'px';
      c.el.style.top = ((g.cy - H / 2) * g.u) + 'px';
      c.el.style.width = (w * g.u) + 'px';
      c.el.style.height = (H * g.u) + 'px';
      if (S.pathOK) c.el.style.clipPath = quadPath(w * g.u, hL * g.u, hR * g.u, 15 * g.u);
      else c.el.style.borderRadius = (15 * g.u) + 'px';
      /* Đệm nội dung lùi khỏi mép xiên của tứ giác để chữ không bị cắt cụt. */
      const inset = (H - Math.min(hL, hR)) / 2 + 12 * g.u;
      c.in.style.paddingTop = inset + 'px';
      c.in.style.paddingBottom = inset + 'px';
      c.x = x;
    }
    const mid = S.cards.reduce((a, c) => (Math.abs(c.x - g.cx) < Math.abs(a.x - g.cx) ? c : a), S.cards[0]);
    if (mid && S.ctaName && S.ctaName.dataset.id !== mid.set.id) {
      S.ctaName.dataset.id = mid.set.id;
      S.ctaName.innerHTML = 'Đang giữa khung: <b>' + esc(mid.set.title) + '</b>';
      S.ctaBtn.dataset.id = mid.set.id;
    }
  }

  function tick(now) {
    S.raf = requestAnimationFrame(tick);
    const t = S.clock.currentTime || 0;
    const dt = clamp((t - S.last) / 1000, 0, 0.05);
    S.last = t;
    if (!S.drag) {
      S.s += ((reduced() ? 0 : AUTO) + S.v) * dt;
      S.v *= Math.pow(DECAY, dt);
      if (Math.abs(S.v) < 0.5) S.v = 0;
    }
    layout();
  }

  /* ---------- dựng thẻ ---------- */
  function spineRows(set, data, max) {
    const docs = Object.entries(data.docs || {});
    const root = docs.find(([, x]) => x.type === 'Luật' && x.hl) || docs.find(([, x]) => x.type === 'Luật') || docs[0];
    const ordered = root ? [root, ...docs.filter(d => d !== root)] : docs;
    return { root, rows: ordered.slice(0, max) };
  }
  function cardHtml(set, data, i) {
    const { root, rows } = spineRows(set, data, 7);
    const gc = id => (data.groups && data.groups[id] && data.groups[id].c) || '#546e7a';
    const head = root
      ? '<div class="rc-head" style="background:' + gc(root[1].g) + '"><span>' + esc(root[1].code) + '</span><span class="rc-type">' + esc(root[1].type) + '</span></div>'
      : '<div class="rc-head" style="background:#546e7a"><span>Bộ nháp</span></div>';
    const body = rows.map(([id, x]) =>
      '<div class="rc-row' + (x.old ? ' old' : '') + '"><i style="background:' + gc(x.g) + '"></i><span>' + esc(x.code) + '</span><em>' + esc(x.type) + '</em></div>').join('');
    return '<article class="card" data-id="' + esc(set.id) + '" tabindex="0" role="button" aria-label="Mở chi tiết bộ ' + esc(set.title) + '">' +
      '<div class="rc-in">' + head +
      '<div class="rc-spine">' + body + '<div class="rc-scan" style="animation-delay:' + (-i * 0.7).toFixed(1) + 's"></div></div>' +
      '<div class="rc-foot"><div class="rc-name">' + esc(set.title) + '</div>' +
      '<div class="rc-count">' + set.docCount + ' văn bản · ' + set.taskCount + ' việc · ' + set.problemCount + ' kịch bản</div></div>' +
      '<button class="rc-play" tabindex="-1" aria-hidden="true">→</button></div></article>';
  }

  function buildCards() {
    S.band.innerHTML = S.list.length
      ? S.list.map((s, i) => cardHtml(s, S.data[s.id] || { docs: {}, groups: {} }, i)).join('')
      : '<p class="reel-empty">Không có bộ nào khớp — đổi từ khóa hoặc nhập thư mục mới.</p>';
    S.cards = Array.from(S.band.querySelectorAll('.card')).map((el, i) => ({ el, in: el.querySelector('.rc-in'), i, set: S.list[i], x: 0 }));
    layout();
  }

  function applyShelf() {
    const q = (S.q.value || '').trim().toLowerCase();
    const f = S.filter;
    let list = SETS.filter(s => (f === 'all' || (f === 'ok' ? !s.draft : s.draft)));
    if (q) list = list.filter(s => (s.title + ' ' + s.name + ' ' + Object.values((S.data[s.id] || {}).docs || {}).map(x => x.code).join(' ')).toLowerCase().includes(q));
    const sort = S.sort.value;
    if (sort === 'ten') list = list.slice().sort((a, b) => a.title.localeCompare(b.title, 'vi'));
    else if (sort === 'docs') list = list.slice().sort((a, b) => b.docCount - a.docCount);
    else if (sort === 'old') list = list.slice().sort((a, b) => b.oldCount - a.oldCount);
    S.list = list;
    S.count.textContent = list.length + ' bộ · ' + list.reduce((a, s) => a + s.docCount, 0) + ' văn bản';
    S.ctaBtn.disabled = !list.length;
    buildCards();
  }

  /* ---------- kéo + quán tính ---------- */
  function bindDrag() {
    const band = S.band;
    let px = 0, s0 = 0, moved = 0, vt = 0, vs = 0, v = 0;
    band.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      S.drag = true; moved = 0; px = e.clientX; s0 = S.s; vt = performance.now(); vs = S.s; v = 0;
      band.classList.add('grabbing');
      band.setPointerCapture(e.pointerId);
    });
    band.addEventListener('pointermove', e => {
      if (!S.drag) return;
      const g = geom();
      const dx = e.clientX - px;
      moved = Math.max(moved, Math.abs(dx));
      S.s = s0 - dx / g.u;
      const now = performance.now(), dt = (now - vt) / 1000;
      if (dt > 0.016) { v = (S.s - vs) / dt; vt = now; vs = S.s; }
    });
    const up = e => {
      if (!S.drag) return;
      S.drag = false; band.classList.remove('grabbing');
      if (moved < 6) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const card = el && el.closest ? el.closest('.reel-band .card') : null;
        if (card) openDrawer(card.dataset.id);
        S.v = 0;
      } else S.v = clamp(v, -2600, 2600);
    };
    band.addEventListener('pointerup', up);
    band.addEventListener('pointercancel', () => { S.drag = false; band.classList.remove('grabbing'); });
    band.addEventListener('keydown', e => {
      const card = e.target.closest('.card');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(card.dataset.id); }
    });
  }

  /* ---------- drawer ---------- */
  function openDrawer(id) {
    const set = SETS.find(s => s.id === id);
    if (!set) return;
    const data = S.data[id] || { docs: {}, groups: {} };
    const gc = g => (data.groups && data.groups[g] && data.groups[g].c) || '#546e7a';
    S.drawer.querySelector('.rd-top h3').textContent = set.title;
    S.drawer.querySelector('.rd-top .sub').innerHTML = esc(set.name) + ' · ' + (set.owned ? 'bộ do app quản lý' : 'liên kết thư mục ngoài') +
      (set.draft ? ' · <b>nháp</b>' : ' · đã biên soạn');
    S.drawer.querySelector('.rd-stats').innerHTML =
      '<div><b>' + set.docCount + '</b><span>văn bản</span></div><div><b>' + set.oldCount + '</b><span>hết hiệu lực</span></div>' +
      '<div><b>' + set.taskCount + '</b><span>việc</span></div><div><b>' + set.problemCount + '</b><span>kịch bản</span></div>';
    S.drawer.querySelector('.rd-list').innerHTML = Object.entries(data.docs || {}).map(([did, x]) =>
      '<div class="rc-row' + (x.old ? ' old' : '') + '"><i style="background:' + gc(x.g) + '"></i><span>' + esc(x.code) + '</span><em>' + esc(x.type) + (x.eff ? ' · HL ' + esc(x.eff) : '') + '</em></div>').join('') ||
      '<p class="lead">Bộ nháp chưa có văn bản — mở Biên soạn để trích xuất.</p>';
    S.drawer.querySelector('.rd-actions').innerHTML =
      '<a class="btn primary" href="#/view/' + esc(id) + '">Mở bản đồ</a>' +
      '<a class="btn" href="#/edit/' + esc(id) + '">Biên soạn</a>' +
      '<a class="btn" href="/api/sets/' + esc(id) + '/map?download=1">Xuất HTML</a>' +
      '<button class="btn danger" data-rddel="' + esc(id) + '">Gỡ khỏi thư viện</button>';
    S.drawer.classList.add('on'); S.scrim.classList.add('on');
    S.drawer.querySelector('.rd-x').focus();
  }
  function closeDrawer() { S.drawer.classList.remove('on'); S.scrim.classList.remove('on'); }

  async function removeSet(id) {
    const set = SETS.find(s => s.id === id);
    if (!set) return;
    const backup = SETS.slice();
    SETS = SETS.filter(s => s.id !== id);
    applyShelf(); closeDrawer();
    try {
      await del('/api/sets/' + id);
      reelToast('Đã gỡ "' + set.title + '" — file trên đĩa vẫn giữ.', 'Hoàn tác', async () => {
        try {
          await post('/api/sets/' + id + '/restore', {});
          await refresh(); S.data = await loadData(); applyShelf();
          reelToast('Đã đưa bộ trở lại thư viện.');
        } catch (e) { SETS = backup; applyShelf(); toast(e.message, true); }
      });
    } catch (e) { SETS = backup; applyShelf(); toast(e.message, true); }
  }
  function reelToast(msg, label, fn) {
    const t = document.getElementById('toast');
    t.innerHTML = ''; t.append(document.createTextNode(msg));
    if (label) {
      const b = document.createElement('button'); b.textContent = label;
      b.onclick = () => { t.hidden = true; fn(); };
      t.append(b);
    }
    t.className = ''; t.hidden = false;
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => { t.hidden = true; }, 6500);
  }

  /* ---------- nét vẽ tay ---------- */
  const DOODLES = {
    d0: ['M6 40 L20 6', 'M20 42 L34 8'],
    d1: ['M96 6 C 120 40, 132 78, 108 112 C 88 140, 48 150, 22 168', 'M22 168 l14 -12 M22 168 l18 2'],
    d2: ['M6 30 C 20 26, 34 20, 48 10', 'M48 10 l-12 2 M48 10 l-2 12']
  };
  function drawDoodles(animate) {
    for (const key of Object.keys(DOODLES)) {
      const svg = S.root.querySelector('.reel-doodle.' + key);
      if (!svg) continue;
      svg.innerHTML = DOODLES[key].map(d => '<path d="' + d + '"/>').join('');
      svg.querySelectorAll('path').forEach((p, i) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = len;
        if (animate) {
          p.style.strokeDashoffset = len;
          S.anims.push(p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
            { duration: 700, delay: 850 + i * 160 + (key === 'd2' ? 250 : 0), fill: 'both', easing: 'ease-out' }));
        } else p.style.strokeDashoffset = 0;
      });
    }
  }

  function entrance() {
    const u = geom().u;
    const A = (sel, kf, opt) => { const el = document.querySelector(sel); if (el) S.anims.push(el.animate(kf, opt)); };
    A('.reel-top', [{ transform: 'translateY(' + (-14 * u) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' });
    A('.reel-badge', [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, delay: 120, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' });
    A('.reel-h1 .l1', [{ transform: 'translateY(' + (26 * u) + 'px)', filter: 'blur(10px)', opacity: 0 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], { duration: 620, delay: 220, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' });
    A('.reel-h1 .l2', [{ transform: 'translateY(' + (26 * u) + 'px)', filter: 'blur(10px)', opacity: 0 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], { duration: 620, delay: 330, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' });
    A('.reel-sub', [{ transform: 'translateY(' + (12 * u) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: 480, fill: 'both' });
    A('.reel-band', [{ transform: 'translateY(' + (46 * u) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 560, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' });
    A('.reel-cta', [{ transform: 'scale(.9)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, delay: 760, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' });
    A('.reel-note.n1', [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 1000, fill: 'both' });
    A('.reel-note.n2', [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 1100, fill: 'both' });
  }

  async function loadData() {
    const out = {};
    await Promise.all(SETS.map(async s => {
      try { out[s.id] = await api('/api/sets/' + s.id + '/data'); } catch { out[s.id] = { docs: {}, groups: {} }; }
    }));
    return out;
  }

  function bindChrome() {
    S.onScroll = () => S.bar.classList.toggle('stuck', scrollY > 8);
    addEventListener('scroll', S.onScroll, { passive: true });
    S.onScroll();
    S.onKey = e => { if (e.key === 'Escape') closeDrawer(); };
    addEventListener('keydown', S.onKey);
    S.onResize = () => layout();
    addEventListener('resize', S.onResize);
    S.io = new IntersectionObserver(es => {
      es.forEach(en => {
        if (!en.isIntersecting) return;
        document.querySelectorAll('.reel-nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    ['reel', 'ask', 'sources'].forEach(id => { const el = document.getElementById(id); if (el) S.io.observe(el); });
    S.scrim.addEventListener('click', closeDrawer);
    S.drawer.querySelector('.rd-x').addEventListener('click', closeDrawer);
    document.querySelectorAll('.reel-nav a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }));
    S.drawer.addEventListener('click', e => {
      const b = e.target.closest('[data-rddel]');
      if (b) removeSet(b.dataset.rddel);
      if (e.target.closest('a')) closeDrawer();
    });
    S.q.addEventListener('input', applyShelf);
    S.sort.addEventListener('change', applyShelf);
    document.querySelectorAll('.shelf .chips button').forEach(b => b.addEventListener('click', () => {
      S.filter = b.dataset.f;
      document.querySelectorAll('.shelf .chips button').forEach(x => x.classList.toggle('on', x === b));
      applyShelf();
    }));
    S.ctaBtn.addEventListener('click', () => { location.hash = '#/view/' + S.ctaBtn.dataset.id; });
  }

  window.Reel = {
    async mount(root) {
      Reel.unmount();
      S = {
        root, band: root.querySelector('.reel-band'), bar: document.querySelector('.reel-bar'),
        ctaName: root.querySelector('.reel-cta-name'), ctaBtn: root.querySelector('.reel-cta button'),
        q: document.querySelector('#shelfq'), sort: document.querySelector('#shelfsort'),
        count: document.querySelector('.shelf .n'), filter: 'all',
        list: SETS.slice(), cards: [], s: 0, v: 0, drag: false, last: 0, anims: [], data: {},
        pathOK: CSS.supports('clip-path', 'path("M0 0 L1 0 L1 1 Z")')
      };
      S.data = await loadData();
      S.scrim = document.createElement('div'); S.scrim.className = 'reel-scrim';
      S.drawer = document.createElement('aside'); S.drawer.className = 'reel-drawer';
      S.drawer.setAttribute('role', 'dialog'); S.drawer.setAttribute('aria-label', 'Chi tiết bộ văn bản');
      S.drawer.innerHTML = '<div class="rd-top"><div><h3></h3><div class="sub"></div></div><button class="rd-x" aria-label="Đóng">×</button></div>' +
        '<div class="rd-stats"></div><div class="rd-list"></div><div class="rd-actions"></div>';
      document.body.append(S.scrim, S.drawer);
      applyShelf();
      layout();
      bindDrag(); bindChrome();
      drawDoodles(!reduced());
      if (!reduced()) entrance();
      S.clock = document.documentElement.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1e9 });
      S.last = S.clock.currentTime || 0;
      S.raf = requestAnimationFrame(tick);
    },
    unmount() {
      if (!S) return;
      cancelAnimationFrame(S.raf);
      if (S.clock) S.clock.cancel();
      S.anims.forEach(a => a.cancel());
      removeEventListener('scroll', S.onScroll); removeEventListener('keydown', S.onKey); removeEventListener('resize', S.onResize);
      if (S.io) S.io.disconnect();
      if (S.scrim) S.scrim.remove();
      if (S.drawer) S.drawer.remove();
      clearTimeout(S.toastTimer);
      const t = document.getElementById('toast');
      if (t) { t.hidden = true; t.textContent = ''; }
      S = null;
    }
  };
})();
