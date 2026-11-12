// Data access layer: typed repository-style queries over the local JSON persistence
// (sets registry + per-set dataset files). The "ORM" here maps entity collections to
// atomic file writes; queries return typed domain shapes (see lib/types.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { norm } from './analyze.mjs';
import { MAX_WALK_FILES } from './types.mjs';

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SETS_FILE = process.env.LAW_NAV_SETS_FILE || path.join(APP_DIR, 'sets.json');
const SETS_DIR = process.env.LAW_NAV_SETS_DIR || path.join(APP_DIR, 'sets');

export { SETS_FILE, SETS_DIR };

/** @returns {Array} */
export const loadSets = () => JSON.parse(fs.readFileSync(SETS_FILE, 'utf8'));
/** @param {Array} s */
export const saveSets = (s) => fs.writeFileSync(SETS_FILE, JSON.stringify(s, null, 1) + '\n');

/** @param {string} id @returns {SetStats|undefined} */
export const findSet = (id) => loadSets().find(s => s.id === id);

/** @param {string} name */
export const slug = (name) => (norm(name).trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'bo');

/** @param {string} name */
export const newId = (name) => {
  const sets = loadSets();
  let id;
  do { id = slug(name) + '-' + Date.now().toString(36).slice(-4) + Math.floor(Math.random() * 36).toString(36); } while (sets.some(s => s.id === id));
  return id;
};

/** @param {string} file @param {string} text */
export const atomicWrite = (file, text) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

/** @param {string} s @returns {LawMapDataset|null} */
export const readData = (s) => { const d = JSON.parse(fs.readFileSync(s.dataPath, 'utf8')); return d; };

/** @param {string} name */
export const skeleton = (name) => ({
  meta: { title: name, sub: 'Bản nháp — chưa trích xuất', src: '' },
  groups: { lq: { c: '#546e7a', bg: '#eceff1', label: 'Văn bản liên quan' } },
  docs: {}, pairs: [], tasks: [], timeline: [], readingPath: [], problems: [], quote: ''
});

/** @param {SetStats} s */
export const setStats = (s) => {
  let d = null; try { d = readData(s); } catch { /* draft chưa có data.json */ }
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
};

/** @typedef {Object} SetRecord */
/** @typedef {Object} DatasetQueryResult */

/** @namespace SetsRepository */
export const setsRepo = {
  /** @returns {SetStats[]} */
  list: () => loadSets().map(setStats),
  /** @param {string} id @returns {SetStats|undefined} */
  find: (id) => { const s = loadSets().find(x => x.id === id); return s ? setStats(s) : undefined; },
  /** @param {string} id @returns {SetRecord|undefined} */
  get: (id) => loadSets().find(s => s.id === id),
  /** @param {{id?:string,name?:string,owned?:boolean,draft?:boolean,sourceDir?:string,dataPath?:string,outPath?:string,createdAt?:string}} input @returns {SetRecord|undefined} */
  create: (input) => {
    const id = newId(input.name || 'Bộ văn bản mới');
    const dir = path.join(SETS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const s = { id, name: input.name || 'Bộ văn bản mới', owned: true, draft: true, createdAt: new Date().toISOString(), dataPath: path.join(dir, 'data.json'), outPath: path.join(dir, 'index.html'), sourceDir: input.sourceDir || path.join(dir, 'source') };
    if (input.sourceDir) {
      const src = path.resolve(input.sourceDir);
      if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) { fs.rmSync(dir, { recursive: true, force: true }); return undefined; }
      s.sourceDir = src;
    } else {
      fs.mkdirSync(s.sourceDir, { recursive: true });
      atomicWrite(s.dataPath, JSON.stringify(skeleton(input.name || 'Bộ văn bản mới'), null, 1) + '\n');
    }
    const sets = loadSets(); sets.push(s); saveSets(sets);
    return s;
  },
  /** @param {string} id @returns {boolean} */
  remove: (id) => { const sets = loadSets(); const before = sets.length; const next = sets.filter(x => x.id !== id); if (before === next.length) return false; saveSets(next); return true; }
};

/** @namespace DatasetsRepository */
export const datasetsRepo = {
  /** @param {string} setId @returns {LawMapDataset|null} */
  find: (setId) => { const s = loadSets().find(x => x.id === setId); if (!s) return null; try { return readData(s); } catch { return null; } },
  /** @param {string} setId @returns {LawMapDataset|null} */
  read: (setId) => { const s = loadSets().find(x => x.id === setId); if (!s) return null; try { return readData(s); } catch { return null; } },
  /** @param {string} setId @param {LawMapDataset} data @returns {boolean} */
  save: (setId, data) => { const sets = loadSets(); const s = sets.find(x => x.id === setId); if (!s) return false; atomicWrite(s.dataPath, JSON.stringify(data, null, 1) + '\n'); const e = sets.find(x => x.id === setId); e.draft = false; saveSets(sets); return true; }
};

export const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.text']);
export const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
/** @param {string} ext @returns {'text'|'image'|'pdf'|'other'} */
export const kindOf = (ext) => TEXT_EXT.has(ext) ? 'text' : IMG_EXT.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : 'other';
/** @param {string} dir @param {string} rel @returns {boolean} */
export const inside = (dir, rel) => { const p = path.resolve(dir, rel); return p === dir || p.startsWith(dir + path.sep); };
/** @param {string} h @returns {string} */
export const htmlToText = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
/** @param {string} dir @returns {Array<{rel:string,kind:string,size:number}>} */
export const walkFiles = (dir, base = '', out = []) => {
  if (out.length >= MAX_WALK_FILES) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ['node_modules', '.git', 'shots', 'data', 'out', 'demo-auto', 'app', 'ban-do'].includes(ent.name)) continue;
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walkFiles(path.join(dir, ent.name), rel, out);
    else out.push({ rel, kind: kindOf(path.extname(ent.name).toLowerCase()), size: fs.statSync(path.join(dir, ent.name)).size });
  }
  return out;
};
