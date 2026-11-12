// Input validation layer: JSON Schema (AJV) for the dataset contract + small typed validators.

import Ajv from 'ajv';
import { DATASET_SCHEMA, MAX_QUERY_LENGTH, DATE_PATTERN } from './types.mjs';
import { badRequest } from './errors.mjs';

const ajv = new Ajv({ strict: true, allErrors: true });
const validateDataset = ajv.compile(DATASET_SCHEMA);
const DATE_RE = new RegExp(DATE_PATTERN);
/**
 * Validate a `LawMapDataset` payload against the canonical JSON Schema (doc/API_SPEC.md §2)
 * and cross-check that every `replaces` / task / problem / reading-path reference resolves.
 * @param {*} body
 * @returns {LawMapDataset}
 */
export const validateDatasetBody = (body) => {
  const ok = validateDataset(body);
  if (!ok) {
    const issues = (validateDataset.errors || []).map(e => (e.instancePath || '(root)') + ' ' + e.message);
    throw badRequest('Dữ liệu bộ văn bản không hợp lệ: ' + issues.join('; '), { issues });
  }
  const d = body;
  const ids = Object.keys(d.docs || {});
  const groupIds = Object.keys(d.groups || {});
  const dangling = [];
  for (const doc of Object.values(d.docs || {})) {
    for (const ref of [...(doc.replaces || []), ...(doc.replacedBy || [])]) {
      if (!ids.includes(ref)) dangling.push('văn bản "' + doc.code + '" tham chiếu không tồn tại: ' + ref);
    }
    if (doc.g && groupIds.length > 0 && !groupIds.includes(doc.g)) dangling.push('văn bản "' + doc.code + '" thuộc nhóm không tồn tại: ' + doc.g);
  }
  for (const t of d.tasks || []) for (const p of t.docs || []) if (p && p[0] && !ids.includes(p[0])) dangling.push('việc "' + t.label + '" tham chiếu không tồn tại: ' + p[0]);
  for (const p of d.problems || []) for (const x of p.plan || []) if (x && x[0] && !ids.includes(x[0])) dangling.push('kịch bản "' + p.q + '" tham chiếu không tồn tại: ' + x[0]);
  for (const r of d.readingPath || []) if (r && r.doc && !ids.includes(r.doc)) dangling.push('bước đọc tham chiếu không tồn tại: ' + r.doc);
  if (dangling.length > 0) throw badRequest('Tham chiếu không tồn tại trong bộ: ' + dangling.join('; '));
  return d;
};

/** @param {*} v @param {string} msg */
export const requireObject = (v, msg) => { if (v === null || typeof v !== 'object' || Array.isArray(v)) throw badRequest(msg); return v; };

/** @param {*} v @param {Object} opts */
export const requireString = (v, { max, minLength = 0 } = {}) => {
  if (typeof v !== 'string') throw badRequest('Phải là string');
  if (v.length < minLength) throw badRequest('String quá ngắn (tối thiểu ' + minLength + ' ký tự)');
  if (max !== undefined && v.length > max) throw badRequest('String quá dài (tối đa ' + max + ' ký tự)');
  return v;
};

/** @param {*} v @param {string} msg */
export const requireArray = (v, msg) => { if (!Array.isArray(v)) throw badRequest(msg); return v; };

/** @param {*} v @param {string} msg */
export const requireBoolean = (v, msg) => { if (typeof v !== 'boolean') throw badRequest(msg); return v; };

/** @param {*} v @param {Object} opts */
export const requireNumber = (v, { min, max } = {}) => { if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) throw badRequest('Phải là number'); if (min !== undefined && v < min) throw badRequest('Number nhỏ hơn quá trình cho phép'); if (max !== undefined && v > max) throw badRequest('Number lớn hơn quá trình cho phép'); return v; };

/** @param {*} v @param {string} msg */
export const requireDateStr = (v, msg) => { if (typeof v !== 'string' || !DATE_RE.test(v)) throw badRequest(msg || 'Ngày không đúng định dạng dd/mm/yyyy'); return v; };

/** @param {*} v @param {string} msg */
export const requireDocId = (v, msg) => { if (typeof v !== 'string' || !/^[a-z][a-z0-9_]*$/.test(v)) throw badRequest(msg || 'Định danh văn bản không hợp lệ'); return v; };

/** @param {*} v @param {string} msg */
export const requireGroupId = (v, msg) => { if (typeof v !== 'string' || !/^[a-z][a-z0-9_]*$/.test(v)) throw badRequest(msg || 'Định danh nhóm không hợp lệ'); return v; };

/** @param {*} v @param {string} msg */
export const requireColor = (v, msg) => { if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw badRequest(msg || 'Mã màu không hợp lệ (vd #1565c0)'); return v; };

/** @param {*} v @param {Object} opts */
export const requireQueryString = (v, { max = MAX_QUERY_LENGTH } = {}) => requireString(v, { max }).trim();

/** @param {*} v @param {string} msg */
export const requireSetId = (v, msg = 'ID bộ không hợp lệ') => { if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(v)) throw badRequest(msg); return v; };

/** @param {*} v @param {Object} opts */
export const requireQuery = (v, { max = MAX_QUERY_LENGTH } = {}) => {
  const q = requireString(v, { max });
  const t = q.trim();
  if (t.length === 0) throw badRequest('Chưa nhập vấn đề');
  if (t.length > max) throw badRequest('Vấn đề quá dài');
  return t;
};

/** @param {*} v @param {string} msg */
export const requireBase64 = (v, msg = 'Nội dung file phải là base64') => { if (typeof v !== 'string') throw badRequest(msg); if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) throw badRequest('Nội dung file không phải base64 hợp lệ'); return v; };
