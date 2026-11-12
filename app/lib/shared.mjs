// Pure helpers extracted from server.mjs so they can be unit-tested.
// Keep behavior identical to the original inline versions (with null-safety hardening noted in SECURITY-REVIEW.md).
import fs from 'node:fs';
import path from 'node:path';
import { norm } from './analyze.mjs';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml'
};

export const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.text']);
export const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
export const kindOf = ext => TEXT_EXT.has(ext) ? 'text' : IMG_EXT.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : 'other';

export const slug = name => (String(name == null ? '' : norm(name)).trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'bo');

// Realpath-based containment check. Falls back to lexical path.resolve when the target does not exist yet.
export function inside(dir, rel) {
  const base = path.resolve(dir);
  const p = path.resolve(base, rel);
  return p === base || p.startsWith(base + path.sep);
}
export function insideReal(dir, rel) {
  const base = path.resolve(dir);
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) return false;
  try {
    const realBase = fs.realpathSync(base);
    // Resolve the deepest existing ancestor, then check containment on the real path.
    let probe = p, rest = [];
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      rest.unshift(path.basename(probe));
      probe = parent;
    }
    const real = path.join(fs.realpathSync(probe), ...rest);
    return real === realBase || real.startsWith(realBase + path.sep);
  } catch { return false; }
}

export const htmlToText = h => String(h == null ? '' : h)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export const hostAllowed = (h, hosts) => (hosts || []).some(x => h === x || h.endsWith('.' + x));

export function validateData(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'Dữ liệu phải là object';
  if (!d.docs || typeof d.docs !== 'object' || Array.isArray(d.docs)) return 'Thiếu docs';
  if (!d.groups || typeof d.groups !== 'object' || Array.isArray(d.groups)) return 'Thiếu groups';
  for (const [id, doc] of Object.entries(d.docs)) {
    if (!doc || typeof doc !== 'object') return `Văn bản "${id}" không hợp lệ`;
    if (typeof doc.code !== 'string' || !doc.code.trim()) return `Văn bản "${id}" thiếu code`;
    if (typeof doc.type !== 'string') return `Văn bản "${id}" thiếu type`;
    if (doc.bullets !== undefined && !Array.isArray(doc.bullets)) return `Văn bản "${id}" bullets phải là mảng`;
    if (doc.chips !== undefined && !Array.isArray(doc.chips)) return `Văn bản "${id}" chips phải là mảng`;
    if (doc.kw !== undefined && typeof doc.kw !== 'string') return `Văn bản "${id}" kw phải là chuỗi`;
  }
  if (d.tasks !== undefined) {
    if (!Array.isArray(d.tasks)) return 'tasks phải là mảng';
    for (const [i, t] of d.tasks.entries()) {
      if (!t || typeof t !== 'object') return `Việc #${i} không hợp lệ`;
      if (t.docs !== undefined && !Array.isArray(t.docs)) return `Việc "${t.id || i}" docs phải là mảng`;
    }
  }
  if (d.problems !== undefined) {
    if (!Array.isArray(d.problems)) return 'problems phải là mảng';
    for (const [i, p] of d.problems.entries()) {
      if (!p || typeof p !== 'object') return `Vấn đề #${i} không hợp lệ`;
      if (p.plan !== undefined && !Array.isArray(p.plan)) return `Vấn đề #${i} plan phải là mảng`;
    }
  }
  return '';
}

const SKIP_WALK = new Set(['node_modules', '.git', 'shots', 'data', 'out', 'demo-auto', 'app', 'ban-do']);
export function walkFiles(dir, base = '', out = []) {
  if (out.length >= 500) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (out.length >= 500) return out;
    if (ent.name.startsWith('.') || SKIP_WALK.has(ent.name)) continue;
    const rel = base ? base + '/' + ent.name : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) continue; // do not follow symlinked directories
        out.push({ rel, kind: kindOf(path.extname(ent.name).toLowerCase()), size: st.size, symlink: true });
      } catch { /* dangling symlink — skip */ }
      continue;
    }
    if (ent.isDirectory()) { walkFiles(full, rel, out); continue; }
    try { out.push({ rel, kind: kindOf(path.extname(ent.name).toLowerCase()), size: fs.statSync(full).size }); } catch { /* unreadable — skip */ }
  }
  return out;
}

export const safeFilename = name => (String(name == null ? '' : name).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'file');

// Read a Response body with a hard byte cap; aborts the stream instead of buffering an unbounded body.
export async function readCapped(resp, capBytes) {
  const len = Number(resp.headers.get('content-length') || 0);
  if (len > capBytes) { try { await resp.body?.cancel(); } catch {} throw new Error('File quá lớn (>' + Math.round(capBytes / 1024 / 1024) + 'MB)'); }
  const reader = resp.body.getReader();
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > capBytes) { try { await reader.cancel(); } catch {} throw new Error('File quá lớn (>' + Math.round(capBytes / 1024 / 1024) + 'MB)'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}
