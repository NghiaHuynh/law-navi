// Mirror of the ask-view scoring in law-map engine.html — keep the two in sync.
// App có thêm trường `exact` (số từ của cụm keys khớp nhất) để server xếp hạng giữa các bộ; engine một bộ không cần.
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
export function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(MARKS, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const STOP = new Set(('va cua thi la bi duoc cho voi khi nao gi khong co phai lam the toi minh can muon nen ma van dang da se de tren trong tai ve ra sao nhu the bao nhieu phan tram hoac cung den tu o dau bat dau giup xem biet lien quan he thong van ban phap luat').split(' '));
export function concepts(q) {
  const seen = {}, out = [];
  norm(q).split(/\s+/).forEach(w => {
    if (w.length < 4 || STOP.has(w) || seen[w]) return;
    seen[w] = 1; out.push(w);
  });
  return out;
}
const asText = v => Array.isArray(v) ? v.join(' ') : String(v == null ? '' : v);
function docHay(DATA, id) {
  const d = DATA.docs[id];
  if (!d || typeof d !== 'object') return '';
  const group = (DATA.groups && DATA.groups[d.g]) || {};
  return norm([d.code, d.sum, asText(d.bullets), d.kw, asText(d.chips), group.label].join(' '));
}
function wset(s) { const o = {}; norm(s).split(/\s+/).forEach(w => { if (w) o[w] = 1; }); return o; }
export function analyze(DATA, q, lex) {
  const D = id => DATA.docs[id];
  let cs = concepts(q);
  const says = [];
  const nq = norm(q);
  const drop = {};
  const gloss = {};
  (lex || []).forEach(e => {
    if (!e || typeof e.p !== 'string') return;
    if (e.dom && e.dom !== (DATA.meta && DATA.meta.dom)) return;
    let re;
    try { re = new RegExp(e.p); } catch { return; } // bỏ qua mẫu lỗi thay vì sập toàn bộ phân tích
    if (!re.test(nq)) return;
    if (says.indexOf(e.say) < 0) says.push(e.say);
    (Array.isArray(e.add) ? e.add : []).forEach(w => { if (cs.indexOf(w) < 0) cs.push(w); });
    (Array.isArray(e.drop) ? e.drop : []).forEach(w => { drop[w] = 1; });
    if (e.gloss && typeof e.gloss === 'object') Object.assign(gloss, e.gloss);
  });
  cs = cs.filter(w => !drop[w]);
  if (!cs.length || !DATA || typeof DATA !== 'object' || !DATA.docs || typeof DATA.docs !== 'object') return null;
  const hay = {};
  Object.keys(DATA.docs).forEach(id => {
    const d = DATA.docs[id];
    if (!d || typeof d !== 'object') return;
    hay[id] = wset(docHay(DATA, id));
  });
  const df = {};
  cs.forEach(w => { df[w] = 0; Object.keys(hay).forEach(id => { if (hay[id][w]) df[w]++; }); });
  const total = Object.keys(hay).length;
  function wOf(w) {
    const d = df[w];
    if (!d) return 0;
    if (d <= 2) return 2.2;
    if (d <= 5) return 1.6;
    if (d <= Math.max(6, Math.round(total * 0.18))) return 1;
    return 0.4;
  }
  const ds = {};
  Object.keys(hay).forEach(id => {
    let s = 0; const cov = []; const kww = wset(D(id).kw || '');
    cs.forEach(w => {
      if (hay[id][w]) {
        const ww = wOf(w);
        s += ww * (kww[w] ? 1.4 : 1);
        cov.push(w);
      }
    });
    ds[id] = { s, cov };
  });
  const covered = {};
  Object.keys(ds).forEach(id => ds[id].cov.forEach(w => { covered[w] = 1; }));
  const miss = cs.filter(w => !covered[w]);
  let pct = Math.round((cs.length - miss.length) / cs.length * 100);
  const tScore = (Array.isArray(DATA.tasks) ? DATA.tasks : []).map(t => {
    const tdocs = (t && Array.isArray(t.docs)) ? t.docs : [];
    const th = wset(String((t && t.label) || '') + ' ' + String((t && t.hint) || '') + ' ' + tdocs.map(p => (Array.isArray(p) ? p[1] : '')).join(' '));
    let s = 0;
    cs.forEach(w => { if (th[w]) s += wOf(w) * 1.2; });
    tdocs.forEach(p => { if (Array.isArray(p) && ds[p[0]]) s += ds[p[0]].s * 0.5; });
    return { t: { ...t, docs: tdocs }, s };
  }).sort((a, b) => b.s - a.s);
  const top = tScore.length && tScore[0].s > 0 ? tScore[0].t : null;
  let plan = top ? top.docs.filter(p => Array.isArray(p) && D(p[0])) :
    Object.keys(ds).filter(id => ds[id].s > 0 && !D(id).old)
      .sort((a, b) => ds[b].s - ds[a].s).slice(0, 4)
      .map(id => [id, 'Khớp khái niệm trong mô tả vấn đề của bạn']);
  let note = '', curated = false, resolve = null;
  let bestP = null, bestPScore = 0, exact = 0;
  const keyScore = p => {
    let best = 0;
    (Array.isArray(p.keys) ? p.keys : []).forEach(k => {
      const nk = norm(k).trim();
      if (nk && nq.indexOf(nk) >= 0) best = Math.max(best, nk.split(/\s+/).length);
    });
    return best;
  };
  (Array.isArray(DATA.problems) ? DATA.problems : []).forEach(p => {
    if (!p || typeof p !== 'object') return;
    const ks = keyScore(p);
    let score = 0;
    if (ks) score = 100 + ks;
    else {
      const pc = concepts(p.q);
      if (!pc.length) return;
      const hit = pc.filter(w => cs.indexOf(w) >= 0).length;
      const qCov = hit / Math.max(1, cs.length);
      const pCov = hit / Math.max(1, pc.length);
      if (hit >= 2 && qCov >= 0.5) score = qCov * 2 + pCov + Math.min(hit, 6) * 0.05;
    }
    if (score > bestPScore) { bestPScore = score; bestP = p; exact = ks; }
  });
  if (bestP) {
    const pl = (Array.isArray(bestP.plan) ? bestP.plan : []).filter(x => Array.isArray(x) && D(x[0]));
    if (pl.length) {
      plan = pl; curated = true;
      const cover = Number(bestP.cover);
      if (Number.isFinite(cover)) pct = Math.max(pct, Math.min(100, Math.max(0, cover)));
    }
    if (bestP.note) note = bestP.note;
    if (Array.isArray(bestP.resolve) && bestP.resolve.length) resolve = bestP.resolve;
  }

  const inPlan = {}; plan.forEach(p => { inPlan[p[0]] = 1; });
  let best = 0;
  plan.forEach(p => { if (ds[p[0]] && ds[p[0]].s > best) best = ds[p[0]].s; });
  const planCov = {};
  plan.forEach(p => { if (ds[p[0]]) ds[p[0]].cov.forEach(w => { if (wOf(w) >= 1) planCov[w] = 1; }); });
  const rel = Object.keys(ds).filter(id => {
    if (!(ds[id].s > 0) || inPlan[id] || D(id).old || ds[id].s < Math.max(1.5, best * 0.45)) return false;
    return ds[id].cov.some(w => planCov[w]);
  }).sort((a, b) => ds[b].s - ds[a].s).slice(0, 4);
  const tier = pct >= 100 ? 'Bám sát trọn vẹn' : pct >= 70 ? 'Bám sát' : pct >= 40 ? 'Định hướng phần lớn' : pct > 0 ? 'Gợi điểm khởi đầu' : 'Chưa khớp';
  // exact = số từ của cụm keys khớp dài nhất trong problem thắng (>0 khi bộ này có kịch bản nói đúng cụm người dùng gõ).
  return { pct, tier, exact, covN: cs.length - miss.length, csN: cs.length, plan, rel, miss: miss.slice(0, 4), note, curated, best, says, gloss, resolve };
}