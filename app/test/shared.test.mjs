import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inside, insideReal, htmlToText, hostAllowed, validateData, kindOf, slug, safeFilename, walkFiles } from '../lib/shared.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lawnavi-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('inside() — chặn path traversal (so sánh từ vựng)', () => {
  const base = path.join(tmp, 'base');
  it('đường dẫn hợp lệ nằm trong base', () => {
    expect(inside(base, 'a/b.txt')).toBe(true);
    expect(inside(base, '.')).toBe(true);
    expect(inside(base, 'sub/../ok.txt')).toBe(true);
  });
  it('thoát ra ngoài base bị chặn', () => {
    expect(inside(base, '../ngoai.txt')).toBe(false);
    expect(inside(base, '../../etc/passwd')).toBe(false);
    expect(inside(base, '/etc/passwd')).toBe(false);
  });
  it('prefix sibling không được nhầm là con (attack /a/b vs /a/ba)', () => {
    const b = path.join(tmp, 'b');
    expect(inside(b, '../ba/secret.txt')).toBe(false);
  });
  it('ký tự đặc biệt trong tên file không vượt được', () => {
    expect(inside(base, 'a/../../b')).toBe(false);
    expect(inside(base, 'a\0b.txt')).toBe(true); // NUL chỉ làm tên file không tồn tại, không thoát thư mục
  });
});

describe('insideReal() — chặn symlink trỏ ra ngoài', () => {
  const realBase = path.join(tmp, 'realbase');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(realBase, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET');
  fs.writeFileSync(path.join(realBase, 'ok.txt'), 'fine');
  fs.symlinkSync(outside, path.join(realBase, 'link-out'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(realBase, 'file-link'));

  it('file thường bên trong → cho phép', () => {
    expect(insideReal(realBase, 'ok.txt')).toBe(true);
  });
  it('symlink file trỏ ra ngoài base → chặn', () => {
    expect(insideReal(realBase, 'file-link')).toBe(false);
  });
  it('symlink thư mục trỏ ra ngoài base → chặn cả file con', () => {
    expect(insideReal(realBase, 'link-out/secret.txt')).toBe(false);
  });
  it('file chưa tồn tại nằm trong base (upload mới) → cho phép', () => {
    expect(insideReal(realBase, 'moi/duong-dan/moi.txt')).toBe(true);
  });
  it('file chưa tồn tại dưới symlink ra ngoài → chặn', () => {
    expect(insideReal(realBase, 'link-out/moi.txt')).toBe(false);
  });
});

describe('htmlToText() — bóc HTML độc hại', () => {
  it('xóa script/style kèm nội dung', () => {
    expect(htmlToText('<p>Xin chào</p><script>alert(document.cookie)</script>')).toBe('Xin chào');
    expect(htmlToText('<style>body{x:</style><b>Tra</b>')).toBe('Tra');
  });
  it('xóa toàn bộ tag, giữ chữ', () => {
    expect(htmlToText('<img src=x onerror=alert(1)>Nghị định 207')).toBe('Nghị định 207');
    expect(htmlToText('<a href="javascript:alert(1)">bấm</a>')).toBe('bấm');
  });
  it('giải mã entity phổ biến', () => {
    expect(htmlToText('A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39;')).toBe('A & B <tag> "q" \'s\'');
    expect(htmlToText('nhiều&nbsp;&nbsp;khoảng')).toBe('nhiều khoảng');
  });
  it('tag lồng nhau / không đóng / rỗng', () => {
    expect(htmlToText('<div><p>lồng <b>đậm</div> xong')).toBe('lồng đậm\n xong');
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<><<<>>>')).toBe('<> >>'); // không có cặp tag hợp lệ → giữ nguyên văn bản thô (an toàn vì output luôn được serve dạng .txt/text/plain)
  });
  it('đầu vào null/undefined/số không ném lỗi', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText(42)).toBe('42');
  });
});

describe('hostAllowed() — allowlist nguồn tải', () => {
  const HOSTS = ['vbpl.vn', 'chinhphu.vn'];
  it('khớp chính xác và subdomain', () => {
    expect(hostAllowed('vbpl.vn', HOSTS)).toBe(true);
    expect(hostAllowed('vbpl.vn.chinhphu.vn', HOSTS)).toBe(true);
  });
  it('tên miền giả mạo bị chặn', () => {
    expect(hostAllowed('evilvbpl.vn', HOSTS)).toBe(false);
    expect(hostAllowed('vbpl.vn.evil.com', HOSTS)).toBe(false);
    expect(hostAllowed('vbpl.vn@evil.com', HOSTS)).toBe(false);
    expect(hostAllowed('notvbpl.vn.', HOSTS)).toBe(false);
  });
  it('danh sách rỗng / undefined → chặn hết', () => {
    expect(hostAllowed('vbpl.vn', [])).toBe(false);
    expect(hostAllowed('vbpl.vn', undefined)).toBe(false);
  });
});

describe('validateData() — PUT /data', () => {
  const ok = {
    docs: { a: { code: 'NĐ 207/2026/NĐ-CP', type: 'Nghị định' } },
    groups: { g1: { label: 'Nhóm' } },
  };
  it('dữ liệu hợp lệ → chuỗi rỗng', () => {
    expect(validateData(ok)).toBe('');
    expect(validateData({ ...ok, tasks: [], problems: [] })).toBe('');
  });
  it('đầu vào không phải object / null / mảng', () => {
    expect(validateData(null)).toBeTruthy();
    expect(validateData(undefined)).toBeTruthy();
    expect(validateData('chuỗi')).toBeTruthy();
    expect(validateData([1, 2])).toBeTruthy();
    expect(validateData(42)).toBeTruthy();
  });
  it('thiếu docs / groups', () => {
    expect(validateData({ groups: {} })).toBeTruthy();
    expect(validateData({ docs: {} })).toBeTruthy();
    expect(validateData({ docs: null, groups: {} })).toBeTruthy();
    expect(validateData({ docs: [], groups: {} })).toBeTruthy();
  });
  it('doc thiếu code hoặc code toàn khoảng trắng', () => {
    expect(validateData({ ...ok, docs: { x: { code: '', type: 'Luật' } } })).toBeTruthy();
    expect(validateData({ ...ok, docs: { x: { code: '   ', type: 'Luật' } } })).toBeTruthy();
    expect(validateData({ ...ok, docs: { x: { type: 'Luật' } } })).toBeTruthy();
    expect(validateData({ ...ok, docs: { x: { code: 123, type: 'Luật' } } })).toBeTruthy();
  });
  it('doc null / không phải object', () => {
    expect(validateData({ ...ok, docs: { x: null } })).toBeTruthy();
    expect(validateData({ ...ok, docs: { x: 'abc' } })).toBeTruthy();
  });
  it('doc thiếu type không phải chuỗi', () => {
    expect(validateData({ ...ok, docs: { x: { code: 'A 1', type: 9 } } })).toBeTruthy();
  });
  it('bullets/chips/kw sai kiểu bị chặn', () => {
    expect(validateData({ ...ok, docs: { x: { code: 'A 1', type: 'Luật', bullets: 'không-phải-mảng' } } })).toBeTruthy();
    expect(validateData({ ...ok, docs: { x: { code: 'A 1', type: 'Luật', chips: 'không-phải-mảng' } } })).toBeTruthy();
    expect(validateData({ ...ok, docs: { x: { code: 'A 1', type: 'Luật', kw: 42 } } })).toBeTruthy();
  });
  it('tasks/problems sai cấu trúc bị chặn', () => {
    expect(validateData({ ...ok, tasks: 'không-phải-mảng' })).toBeTruthy();
    expect(validateData({ ...ok, tasks: [{ id: 't', docs: 'không-phải-mảng' }] })).toBeTruthy();
    expect(validateData({ ...ok, tasks: [null] })).toBeTruthy();
    expect(validateData({ ...ok, problems: [{ q: 'q', plan: 'không-phải-mảng' }] })).toBeTruthy();
    expect(validateData({ ...ok, problems: [null] })).toBeTruthy();
  });
  it('doc id là __proto__ / constructor không gây prototype pollution', () => {
    const d = JSON.parse('{"docs":{"__proto__":{"code":"X","type":"Luật"},"constructor":{"code":"Y","type":"Luật"}},"groups":{}}');
    expect(validateData(d)).toBe('');
    expect({}.polluted).toBeUndefined();
  });
});

describe('kindOf() / slug() / safeFilename() — biên', () => {
  it('kindOf phân loại đúng', () => {
    expect(kindOf('.txt')).toBe('text');
    expect(kindOf('.md')).toBe('text');
    expect(kindOf('.pdf')).toBe('pdf');
    expect(kindOf('.png')).toBe('image');
    expect(kindOf('.exe')).toBe('other');
    expect(kindOf('')).toBe('other');
    expect(kindOf('.PDF')).toBe('other'); // caller phải lowercase trước
  });
  it('slug bỏ dấu, bỏ ký tự lạ, giới hạn 40 ký tự', () => {
    expect(slug('Xây dựng 2026!')).toBe('xay-dung-2026');
    expect(slug('!!!')).toBe('bo');
    expect(slug('')).toBe('bo');
    expect(slug(null)).toBe('bo');
    expect(slug('a'.repeat(100)).length).toBe(40);
    expect(slug('NĐ 207/2026')).toBe('nd-207-2026');
  });
  it('safeFilename loại bỏ CRLF/quote/path separator', () => {
    expect(safeFilename('../../../etc/passwd')).toBe('..-..-..-etc-passwd');
    expect(safeFilename('a"\r\nb')).toBe('a---b');
    expect(safeFilename('')).toBe('file');
    expect(safeFilename(null)).toBe('file');
  });
});

describe('walkFiles()', () => {
  const root = path.join(tmp, 'walk');
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.mkdirSync(path.join(root, 'ok'));
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'x.js'), 'x');
  fs.writeFileSync(path.join(root, '.hidden', 'y.txt'), 'y');
  fs.writeFileSync(path.join(root, 'ok', 'z.txt'), 'z');
  fs.writeFileSync(path.join(root, 'script.mjs'), 's');
  fs.symlinkSync(path.join(root, 'ok'), path.join(root, 'link-dir'));

  it('bỏ qua thư mục node_modules/.hidden, liệt kê file thường', () => {
    const out = walkFiles(root).map(f => f.rel);
    expect(out).toContain('ok/z.txt');
    expect(out).toContain('script.mjs');
    expect(out.some(r => r.includes('node_modules'))).toBe(false);
    expect(out.some(r => r.includes('.hidden'))).toBe(false);
  });
  it('không đi theo symlink thư mục (tránh thoát cây nguồn)', () => {
    const out = walkFiles(root).map(f => f.rel);
    expect(out.some(r => r.startsWith('link-dir'))).toBe(false);
  });
  it('thư mục không tồn tại → mảng rỗng, không ném lỗi', () => {
    expect(walkFiles(path.join(tmp, 'khong-ton-tai'))).toEqual([]);
  });
});
