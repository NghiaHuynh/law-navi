// Shared domain types (JSDoc) + canonical JSON Schema for the LawMap dataset.
// Source of truth contract: doc/API_SPEC.md (Tech Lead) — sections 2 (schema), 3 (API).

/** @typedef {string} DocId */
/** @typedef {string} GroupId */
/** @typedef {string} HexColor */
/** @typedef {string} DateStr */

/** @typedef {Object} Chapter */
/** @typedef {Object} Doc */
/** @typedef {Object} Group */
/** @typedef {Array<string>} DocRef */
/** @typedef {Object} Task */
/** @typedef {Object} TimelineItem */
/** @typedef {Object} ReadingStep */
/** @typedef {Object} Problem */
/** @typedef {Object} LexiconEntry */
/** @typedef {Object} DatasetMeta */
/** @typedef {Object} LawMapDataset */

/** @typedef {Object} Source */
/** @typedef {Object} FileEntry */
/** @typedef {Object} PlanItem */
/** @typedef {Object} AskResult */
/** @typedef {Object} SetStats */

/** @typedef {Object} CreateSetInput */
/** @typedef {Object} AskQuery */

/** @type {string[]} */
export const DOC_TYPES = ['Luật', 'Nghị định', 'Thông tư', 'Quyết định', 'Văn bản hợp nhất'];

export const DOC_ID_RE = /^[a-z][a-z0-9_]*$/;
export const GROUP_ID_RE = /^[a-z][a-z0-9_]*$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/**
 * Ngày tháng theo contract (dd/mm/yyyy), dải ngày "15–19/6/2026" hoặc "08/9–25/9/2026".
 * @type {string}
 */
export const DATE_PATTERN = '^[0-9][0-9/\\u2013-]*$';
/**
 * Giá trị `issued`: ngày/tháng hoặc mã nguồn/bản ghi tham chiếu (vd "VBHN 54/VBHN-BXD").
 * @type {string}
 */
export const ISSUED_PATTERN = '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$';
export const SET_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const MAX_BODY_BYTES = 64 * 1024 * 1024;
export const MAX_FETCH_BYTES = 30 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 200;
export const MAX_WALK_FILES = 500;
export const MAX_QUERY_LENGTH = 1000;
export const MAX_SET_NAME_LENGTH = 80;
export const FETCH_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 30000;

/**
 * Canonical JSON Schema (draft-07 dialect, the AJV-supported profile used by this service)
 * for the LawMap dataset (`data.json`). Contract: doc/API_SPEC.md §2.
 * Deviations from the Tech Lead draft, documented:
 *  - `meta.title` is optional: draft skeletons created by the extractor do not seed it.
 *  - `doc.year` is an optional string (e.g. "2026") used by extracted datasets.
 */
export const DATASET_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://law-navi.local/schema/data.schema.json',
  title: 'LawMapDataset',
  type: 'object',
  required: ['meta', 'groups', 'docs'],
  additionalProperties: false,
  properties: {
    meta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1 },
        sub: { type: 'string' },
        src: { type: 'string' }
      }
    },
    groups: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['c', 'bg', 'label'],
        additionalProperties: false,
        properties: {
          c: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          bg: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          label: { type: 'string', minLength: 1 }
        }
      }
    },
    docs: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['code', 'type', 'g'],
        additionalProperties: false,
        properties: {
          code: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: DOC_TYPES },
          g: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          issued: { type: 'string', pattern: ISSUED_PATTERN },
          eff: { type: 'string', pattern: DATE_PATTERN },
          sum: { type: 'string' },
          kw: { type: 'string' },
          url: { type: 'string', pattern: '^https?://' },
          old: { type: 'boolean', default: false },
          replaces: { type: 'array', items: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, uniqueItems: true },
          replacedBy: { type: 'array', items: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, uniqueItems: true },
          bullets: { type: 'array', items: { type: 'string' } },
          chips: { type: 'array', items: { type: 'string' } },
          chapters: {
            type: 'array',
            items: {
              type: 'object',
              required: ['t', 'd'],
              additionalProperties: false,
              properties: { t: { type: 'string', minLength: 1 }, d: { type: 'string' }, nd: { type: 'string' } }
            }
          },
          hl: { type: 'boolean', default: false },
          year: { type: 'string' }
        }
      }
    },
    pairs: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['old', 'nw'],
        additionalProperties: false,
        properties: { old: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, nw: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, note: { type: 'string' } }
      }
    },
    tasks: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['id', 'label', 'docs'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          label: { type: 'string', minLength: 1 },
          hint: { type: 'string' },
          docs: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: [
                { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
                { type: 'string' }
              ]
            }
          }
        }
      }
    },
    timeline: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['d', 't'],
        additionalProperties: false,
        properties: { d: { type: 'string', pattern: DATE_PATTERN }, t: { type: 'string', minLength: 1 }, g: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' } }
      }
    },
    readingPath: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['doc', 'why'],
        additionalProperties: false,
        properties: { doc: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, why: { type: 'string', minLength: 1 } }
      }
    },
    problems: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['q', 'cover', 'plan'],
        additionalProperties: false,
        properties: {
          q: { type: 'string', minLength: 1 },
          cover: { type: 'integer', minimum: 0, maximum: 100 },
          plan: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: [
                { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
                { type: 'string' }
              ]
            }
          },
          note: { type: 'string' }
        }
      }
    },
    lexicon: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['p'],
        additionalProperties: false,
        properties: {
          p: { type: 'string', minLength: 1 },
          add: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9]+$' } },
          drop: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9]+$' } },
          say: { type: 'string' }
        }
      }
    },
    quote: { type: 'string' }
  }
};
