import { describe, it, expect } from 'vitest';
import { norm, concepts, analyze } from '../lib/analyze.mjs';

/* ---------- fixtures ---------- */
const DATA = {
  meta: { title: 'Test 2026', sub: '', src: '' },
  groups: { nghidinh: { c: '#000', bg: '#fff', label: 'Nghị định' } },
  docs: {
    a: { code: 'NĐ 207/2026/NĐ-CP', type: 'Nghị định', g: 'nghidinh', sum: 'chất lượng công trình nghiệm thu', kw: 'chat luong nghiem thu', bullets: ['nghiệm thu', 'bảo trì'], chips: ['2026'] },
    b: { code: 'Luật 135/2025/QH15', type: 'Luật', g: 'nghidinh', sum: 'khung chung hoạt động xây dựng', kw: '', bullets: [], chips: [] },
    cold: { code: 'NĐ 06/2021/NĐ-CP', type: 'Nghị định', g: 'nghidinh', old: true, sum: 'văn bản cũ về chất lượng' },
  },
  pairs: [],
  tasks: [
    { id: 't1', label: 'Nghiệm thu công trình', hint: 'kiểm tra trước khi ở', docs: [['a', 'Mở NĐ 207 trước'], ['b', 'Khung pháp lý']] },
    { id: 'tempty', label: 'Việc chưa có danh sách văn bản', hint: '' },                    // thiếu docs — không được sập
    { id: 'badsteps', label: 'Việc có bước lỗi', hint: '', docs: [null, 'khong-phai-mang', ['a', 'Bước hợp lệ']] }, // phần tử hỏng — lọc bỏ
  ],
  problems: [
    { q: 'xây xong nhà không biết ai nghiệm thu', cover: 90, plan: [['a', 'Văn bản dùng hằng ngày']], note: 'Kịch bản kiểm duyệt' },
    { q: 'vấn đề lỗi id', cover: 50, plan: [['khong-ton-tai', 'id sai']] },                                // plan toàn id ma → loại, giữ fallback
  ],
  timeline: [], readingPath: [], quote: ''
};

describe('norm()', () => {
  it('trần xử lý đầu vào null/undefined/số', () => {
    expect(norm(null)).toBe('');
    expect(norm(undefined)).toBe('');
    expect(norm(123)).toBe('123');
    expect(norm(0)).toBe('0');
    expect(norm('')).toBe('');
  });
  it('bỏ dấu tiếng Việt, đổi đ→d, lowercase', () => {
    expect(norm('Luật Xây Dựng')).toBe('luat xay dung');
    expect(norm('Nghị định 207/2026')).toBe('nghi dinh 207 2026');
    expect(norm('ĐÀ NẴNG')).toBe('da nang');
  });
  it('ký tự đặc biệt/emoji/injection bị coi là khoảng trắng', () => {
    expect(norm('<script>alert(1)</script>')).toBe('script alert 1 script');
    expect(norm('a"b\'c`d')).toBe('a b c d');
    expect(norm('   nhiều   khoảng trắng   ')).toBe('nhieu khoang trang');
  });
  it('chuỗi rất dài không treo', () => {
    const big = 'luật '.repeat(20000);
    expect(norm(big).length).toBeGreaterThan(0);
  });
});

describe('concepts()', () => {
  it('lọc từ ngắn (<4 ký tự), stopwords, và trùng lặp', () => {
      // 'luat' là stopword (nhóm từ "văn bản pháp luật"), 'xây'/'tôi'/'cần' bị lọc vì <4 ký tự hoặc stopword
      expect(concepts('tôi cần luật xây dựng')).toEqual(['dung']);
      expect(concepts('tôi biết nghị định')).toEqual(['nghi', 'dinh']);
      expect(concepts('tôi biết luật xây dựng')).not.toContain('biet'); // 'biet' trong STOP
  });
  it('đầu vào rỗng/toàn ký hiệu → mảng rỗng', () => {
    expect(concepts('')).toEqual([]);
    expect(concepts(null)).toEqual([]);
    expect(concepts('!!! ??? ...')).toEqual([]);
    expect(concepts('tôi là bị được cho với')).toEqual([]); // toàn stopwords
  });
  it('không trùng lặp khái niệm', () => {
    const c = concepts('nghiệm thu công trình nghiệm thu');
    expect(new Set(c).size).toBe(c.length);
  });
});

describe('analyze() — đầu vào ranh giới & độc hại', () => {
  it('câu hỏi rỗng hoặc toàn ký hiệu → null (không crash)', () => {
    expect(analyze(DATA, '', [])).toBeNull();
    expect(analyze(DATA, '!!!', [])).toBeNull();
    expect(analyze(DATA, 'tôi cần', [])).toBeNull(); // toàn stopwords/từ ngắn
    expect(analyze(null, 'nghiệm thu', [])).toBeNull();
    expect(analyze({ docs: null }, 'nghiệm thu', [])).toBeNull();
  });
  it('ký tự regex trong câu hỏi không tạo lỗi', () => {
    expect(() => analyze(DATA, '((( [a-z]+ $ ^ \\b', [])).not.toThrow();
    expect(() => analyze(DATA, 'a{2,3}? b(?<!x)c |.*', [])).not.toThrow();
  });
  it('XSS payload trong câu hỏi không sinh HTML thực thi', () => {
    const r = analyze(DATA, '<img src=x onerror=alert(1)> nghiệm thu', []);
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain('<img');
  });
  it('query khớp hoàn toàn → pct 100, tier Bám sát trọn vẹn', () => {
    const r = analyze(DATA, 'nghiem chat luong', []);
    expect(r.pct).toBe(100);
    expect(r.tier).toBe('Bám sát trọn vẹn');
    expect(r.covN).toBe(r.csN);
  });
  it('query không khớp gì → pct 0, tier Chưa khớp', () => {
    const r = analyze(DATA, 'qwertyui asdfghjk', []);
    expect(r.pct).toBe(0);
    expect(r.tier).toBe('Chưa khớp');
    expect(r.miss.length).toBeGreaterThan(0);
  });
  it('văn bản hết hiệu lực (old) không xuất hiện trong plan', () => {
    const r = analyze(DATA, 'chất lượng văn bản cũ công trình', []);
    const ids = r.plan.map(p => p[0]);
    expect(ids).not.toContain('cold');
  });
  it('task thiếu docs không làm sập; task có bước hỏng được lọc', () => {
    const r = analyze(DATA, 'nghiệm thu công trình', []);
    expect(r).not.toBeNull();
    for (const p of r.plan) expect(Array.isArray(p)).toBe(true);
  });
  it('lexicon có regex lỗi bị bỏ qua thay vì ném exception', () => {
    expect(() => analyze(DATA, 'nghiệm thu', [{ p: '([invalid', say: 'x' }])).not.toThrow();
    const r = analyze(DATA, 'nghiệm thu', [{ p: '([invalid', say: 'x' }, { p: 'nghiem', say: 'Đã hiểu', add: ['congtrinx'], drop: [] }]);
    expect(r.says).toContain('Đã hiểu');
  });
  it('kịch bản vấn đề với id văn bản ma bị loại khỏi plan', () => {
    const r = analyze(DATA, 'vấn đề lỗi id chất lượng', []);
    for (const p of r.plan) expect(DATA.docs[p[0]]).toBeTruthy();
  });
  it('docs null/không phải object trong data.json không làm sập', () => {
    const broken = { ...DATA, docs: { a: DATA.docs.a, hong: null, chuoi: 'khong-phai-object' } };
    expect(() => analyze(broken, 'nghiệm thu chất lượng', [])).not.toThrow();
  });
  it('groups thiếu hoặc doc trỏ nhóm không tồn tại', () => {
    const noGroups = { ...DATA, groups: {} };
    expect(() => analyze(noGroups, 'nghiệm thu chất lượng', [])).not.toThrow();
    const withBadGroup = { ...DATA, docs: { x: { code: 'X 1/2026', type: 'Luật', g: 'khong-ton-tai', sum: 'nghiệm thu' } } };
    expect(() => analyze(withBadGroup, 'nghiệm thu', [])).not.toThrow();
  });
  it('docs thiếu các trường optional (sum/kw/bullets/chips) vẫn chạy', () => {
    const sparse = { ...DATA, docs: { x: { code: 'TT 99/2026/TT-BXD', type: 'Thông tư', g: 'nghidinh' } } };
    const r = analyze(sparse, 'thông tư hướng dẫn', []);
    expect(r === null || typeof r.pct === 'number').toBe(true);
  });
  it('bullets không phải mảng (bị sửa tay) không làm sập', () => {
    const bad = { ...DATA, docs: { x: { code: 'TT 99/2026/TT-BXD', type: 'Thông tư', g: 'nghidinh', sum: 'nghiệm thu', bullets: 'không-phải-mảng', chips: 42 } } };
    expect(() => analyze(bad, 'nghiệm thu', [])).not.toThrow();
  });
  it('tiers theo ngưỡng pct: 100/70/40/>0', () => {
    // dựng DATA để chỉ một phần khái niệm được phủ
    const partial = { ...DATA, docs: { a: DATA.docs.a }, tasks: [], problems: [] };
    const r = analyze(partial, 'nghiem khongkhopkeyword', []);
    expect(r.pct).toBeGreaterThan(0);
    expect(['Gợi điểm khởi đầu', 'Định hướng phần lớn', 'Bám sát', 'Bám sát trọn vẹn']).toContain(r.tier);
  });
  it('query cực dài (10k ký tự) hoàn thành nhanh', () => {
    const r = analyze(DATA, 'nghiệm thu '.repeat(1000), []);
    expect(r).not.toBeNull();
  });
});
