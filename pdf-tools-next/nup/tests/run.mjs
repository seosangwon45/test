// node tests/run.mjs            — 전체 자동 테스트 (Chromium, Playwright)
// node tests/run.mjs --shots    — 테스트 + 1280/390 상태별 스크린샷(tests/shots/)
// 합성 PDF 를 실제 화면에 올려 결과 PDF 를 받고, pdf.js 로 다시 읽어 면 수·용지·쪽 순서·배율·위치를 검증한다.
// 기대값은 js/layout.js 를 쓰지 않고 이 파일에서 따로 계산한다(같은 실수를 두 번 하지 않도록).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from './serve.mjs';
import { buildFixtures, mm } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out'), SHOTS = path.join(here, 'shots');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const WANT_SHOTS = process.argv.includes('--shots');

const results = [];
function record(group, name, ok, detail) { results.push({ group, name, ok, detail }); console.log(`${ok ? '통과' : '실패'}  [${group}] ${name}${detail ? ' — ' + detail : ''}`); }
async function check(group, name, fn) {
  try { const detail = await fn(); record(group, name, true, detail || ''); }
  catch (error) { record(group, name, false, String(error && error.message || error).split('\n')[0].slice(0, 300)); }
}
function assert(cond, message) { if (!cond) throw new Error(message); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── 기대 배치(독립 계산) ──
const A4S = mm(210), A4Lg = mm(297), MARGIN = mm(5), GAP = { none: 0, narrow: mm(4), wide: mm(10) };
function grid(per, landscape) { return per === 2 ? (landscape ? [2, 1] : [1, 2]) : per === 4 ? [2, 2] : (landscape ? [4, 2] : [2, 4]); }
function cellBox(per, landscape, gap) {
  const W = landscape ? A4Lg : A4S, H = landscape ? A4S : A4Lg, [cols, rows] = grid(per, landscape);
  return { W, H, cols, rows, w: (W - 2 * MARGIN - (cols - 1) * gap) / cols, h: (H - 2 * MARGIN - (rows - 1) * gap) / rows, gap };
}
const fit = (p, c) => Math.min(c.w / p.w, c.h / p.h);
function expectLandscape(pages, per, gap, forced) {
  if (forced) return forced === 'landscape';
  const sp = pages.reduce((s, p) => s + fit(p, cellBox(per, false, gap)), 0), sl = pages.reduce((s, p) => s + fit(p, cellBox(per, true, gap)), 0);
  return Math.abs(sp - sl) < 1e-6 * sp ? per === 2 : sl > sp;
}
/** 시각 좌표(왼쪽 위 원점)로 칸 slot 에 놓인 쪽의 위치와 배율 */
function placed(p, c, slot, rtl) {
  let col = slot % c.cols; const row = Math.floor(slot / c.cols); if (rtl) col = c.cols - 1 - col;
  const scale = fit(p, c), w = p.w * scale, h = p.h * scale;
  return { scale, left: MARGIN + col * (c.w + c.gap) + (c.w - w) / 2, top: MARGIN + row * (c.h + c.gap) + (c.h - h) / 2, w, h };
}

const { server, base } = await listen(0);
const browser = await chromium.launch();
const fixtures = await buildFixtures();
const consoleProblems = [];

async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleProblems.push(m.text()); });
  page.on('pageerror', e => consoleProblems.push('pageerror: ' + e.message));
  return page;
}
const upload = (page, name, buffer) => page.setInputFiles('#file', { name, mimeType: 'application/pdf', buffer });
const stateIs = (page, s, timeout = 60000) => page.waitForFunction(v => document.body.dataset.state === v, s, { timeout });

/** 페이지 안에서 pdf.js 로 PDF 를 읽어 쪽 크기와 글자 위치(시각 좌표, 왼쪽 위 원점, pt)를 돌려준다. */
async function analyze(page, source) {
  return page.evaluate(async src => {
    const lib = await import('./vendor/pdfjs/pdf.min.js?v=20261117a');
    const data = src.url ? await (await fetch(src.url)).arrayBuffer() : Uint8Array.from(atob(src.b64), c => c.charCodeAt(0)).buffer;
    const size = data.byteLength;
    const doc = await lib.getDocument({ data, verbosity: 0, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/pdfjs/standard_fonts/' }).promise, pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n), vp = p.getViewport({ scale: 1 }), u = p.userUnit || 1, items = [];
      for (const it of (await p.getTextContent()).items) { if (!it.str || !it.str.trim()) continue; const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]); items.push({ s: it.str.trim(), x: x * u, y: y * u }); }
      pages.push({ w: vp.width * u, h: vp.height * u, items });
    }
    let png = null;
    if (src.png) { const p = await doc.getPage(1), b = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: 760 / Math.max(b.width, b.height) }), c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: g, viewport: vp }).promise; png = c.toDataURL('image/png').split(',')[1]; }
    await doc.loadingTask.destroy();
    return { pages, size, png };
  }, source);
}

/** 한 파일을 올려 만들고, 결과를 분석해 돌려준다. */
async function run(page, job, name, buffer, setup) {
  await page.goto(`${base}?job=${job}`);
  await upload(page, name, buffer);
  await stateIs(page, 'chosen');
  if (setup) await setup(page);
  const summary = await page.textContent('#sum'), note = await page.textContent('#pv-note');
  await page.click('#make');
  await stateIs(page, 'done');
  const link = await page.evaluate(() => ({ href: document.getElementById('dl').href, name: document.getElementById('dl').download, sub: document.getElementById('dn-sub').textContent,
    meta: document.getElementById('dn-meta').textContent, thumbs: document.querySelectorAll('#result canvas').length }));
  const out = await analyze(page, { url: link.href, png: true });
  const src = await analyze(page, { b64: buffer.toString('base64') });
  return { summary, note, link, out, src };
}

/** 결과 PDF 가 기대 배치와 일치하는지 검사하고 요약 문자열을 돌려준다. */
function verify(job, r, opts = {}) {
  const mode = job.startsWith('nup') ? 'nup' : 'repeat', per = Number(job.replace(/\D/g, '')), gap = GAP[opts.gap || 'none'];
  const pages = r.src.pages, n = pages.length, sheets = r.out.pages;
  const expectedSheets = mode === 'nup' ? Math.ceil(n / per) : n;
  assert(sheets.length === expectedSheets, `면 수 ${sheets.length} ≠ 기대 ${expectedSheets}`);
  let landscapeAll = mode === 'nup' ? expectLandscape(pages, per, gap, opts.sheet) : null, minScale = Infinity, maxScale = 0, checked = 0;
  sheets.forEach((sheet, s) => {
    const srcIdx = mode === 'nup' ? Array.from({ length: Math.min(per, n - s * per) }, (_, k) => s * per + k) : Array(per).fill(s);
    const landscape = mode === 'nup' ? landscapeAll : expectLandscape([pages[s]], per, gap, opts.sheet);
    const c = cellBox(per, landscape, gap);
    assert(near(sheet.w, c.W, 0.5) && near(sheet.h, c.H, 0.5), `${s + 1}면 용지 ${sheet.w.toFixed(1)}×${sheet.h.toFixed(1)} ≠ A4 ${landscape ? '가로' : '세로'}`);
    srcIdx.forEach((i, slot) => {
      const p = pages[i], e = placed(p, c, slot, mode === 'nup' && opts.order === 'rtl');
      minScale = Math.min(minScale, e.scale); maxScale = Math.max(maxScale, e.scale);
      for (const it of p.items) {
        const want = { x: e.left + it.x * e.scale, y: e.top + it.y * e.scale };
        const hit = sheet.items.some(o => o.s === it.s && Math.hypot(o.x - want.x, o.y - want.y) < 0.8);
        assert(hit, `${s + 1}면 칸${slot + 1}: 원본 ${i + 1}쪽 ‘${it.s}’ 가 기대 위치(${want.x.toFixed(1)}, ${want.y.toFixed(1)})에 없음`);
        checked++;
      }
    });
    const expectedItems = srcIdx.reduce((sum, i) => sum + pages[i].items.length, 0);
    assert(sheet.items.length === expectedItems, `${s + 1}면 글자 수 ${sheet.items.length} ≠ 기대 ${expectedItems} (쪽이 빠지거나 겹침)`);
  });
  const stem = opts.stem, wantName = `${stem}_${mode === 'nup' ? per + '쪽모아찍기' : per + '개반복배치'}.pdf`;
  assert(r.link.name === wantName, `파일명 ‘${r.link.name}’ ≠ ‘${wantName}’`);
  assert(r.summary.includes(`원본 ${n}쪽`) && r.summary.includes(`A4 ${expectedSheets}면`) && r.summary.includes(`종이 ${Math.ceil(expectedSheets / 2)}장`), `요약 문구 불일치: ${r.summary}`);
  assert(r.link.thumbs === Math.min(4, expectedSheets), `완료 화면 결과 그림 ${r.link.thumbs}개`);
  const dir = mode === 'nup' ? (landscapeAll ? 'A4 가로' : 'A4 세로') : `A4 ${sheets[0].w > sheets[0].h ? '가로' : '세로'}`;
  return { text: `${n}쪽 → ${dir} ${sheets.length}면 · 배율 ${Math.round(minScale * 1000) / 10}${maxScale - minScale > .001 ? '~' + Math.round(maxScale * 1000) / 10 : ''}% · 위치 ${checked}곳 일치`, landscapeAll, minScale, maxScale, sheets };
}

const JOBS = ['nup2', 'nup4', 'repeat2', 'repeat4'];
const CASES = [
  ['a4p8', 'A4 세로 8쪽', '수업자료 8쪽'], ['a4p5', 'A4 세로 5쪽(홀수)', '홀수 5쪽'], ['a4l3', 'A4 가로 3쪽', '슬라이드 3쪽'],
  ['mixed', '혼합 크기 5쪽', '혼합 크기'], ['rot90', '/Rotate 90·180·270 + CropBox 5쪽', '회전 원고'], ['one', '1쪽', '전단 1쪽'], ['p60', '60쪽', '긴 문서 60쪽']
];

// ───────── 1. 결과 PDF 검증: 7개 원고 × 4개 작업 ─────────
{
  const page = await newPage();
  for (const [key, label, stem] of CASES) for (const job of JOBS) {
    await check('결과 PDF', `${label} · ${job}`, async () => {
      const r = await run(page, job, `${stem}.pdf`, fixtures[key]);
      const v = verify(job, r, { stem });
      fs.writeFileSync(path.join(OUT, `${key}-${job}.png`), Buffer.from(r.out.png, 'base64'));
      // 소유자가 확정한 방향 규칙을 명시적으로 확인
      if (key === 'a4p8' && job === 'nup2') assert(v.landscapeAll === true && near(v.minScale, 0.673, 0.002), '세로 원고 2쪽은 A4 가로·67.3% 여야 함');
      if (key === 'a4p8' && job === 'nup4') assert(v.landscapeAll === false && near(v.minScale, 0.476, 0.002), '세로 원고 4쪽은 A4 세로·47.6% 여야 함');
      if (key === 'a4l3' && job === 'nup2') assert(v.landscapeAll === false && near(v.minScale, 0.673, 0.002), '가로 원고 2쪽은 A4 세로여야 함');
      if (key === 'a4l3' && job === 'nup4') assert(v.landscapeAll === true, '가로 원고 4쪽은 A4 가로여야 함');
      if (key === 'one' && job === 'repeat2') assert(v.sheets[0].w > v.sheets[0].h, '세로 1쪽 2개 반복은 A4 가로여야 함');
      return v.text;
    });
  }
  await check('결과 PDF', '특이 박스(원점 이동·UserUnit 2·빈 쪽·CropBox 초과) · nup2', async () => verify('nup2', await run(page, 'nup2', '특이.pdf', fixtures.odd), { stem: '특이' }).text);
  await check('결과 PDF', '특이 박스 · repeat4', async () => verify('repeat4', await run(page, 'repeat4', '특이.pdf', fixtures.odd), { stem: '특이' }).text);
  await check('결과 PDF', '같은 쪽 8개 반복(repeat8)', async () => verify('repeat8', await run(page, 'repeat8', '쿠폰.pdf', fixtures.one), { stem: '쿠폰' }).text);

  // ───────── 2. 옵션 ─────────
  const pick = (name, value) => p => p.check(`input[name=${name}][value=${value}]`, { force: true });
  await check('옵션', '읽는 순서 오른쪽→왼쪽 (nup2)', async () => verify('nup2', await run(page, 'nup2', '순서.pdf', fixtures.a4p5, pick('order', 'rtl')), { stem: '순서', order: 'rtl' }).text);
  await check('옵션', '읽는 순서 오른쪽→왼쪽 (nup4)', async () => verify('nup4', await run(page, 'nup4', '순서.pdf', fixtures.a4p8, pick('order', 'rtl')), { stem: '순서', order: 'rtl' }).text);
  await check('옵션', '위아래로 놓기 강제 (세로 원고 nup2 → A4 세로)', async () => {
    const v = verify('nup2', await run(page, 'nup2', '위아래.pdf', fixtures.a4p5, pick('sheet', 'portrait')), { stem: '위아래', sheet: 'portrait' });
    assert(v.landscapeAll === false, 'A4 세로가 아님'); return v.text; });
  await check('옵션', '좌우로 놓기 강제 (가로 원고 nup2 → A4 가로)', async () => verify('nup2', await run(page, 'nup2', '좌우.pdf', fixtures.a4l3, pick('sheet', 'landscape')), { stem: '좌우', sheet: 'landscape' }).text);
  await check('옵션', '간격 좁게 (nup4)', async () => verify('nup4', await run(page, 'nup4', '간격.pdf', fixtures.a4p8, pick('gap', 'narrow')), { stem: '간격', gap: 'narrow' }).text);
  await check('옵션', '간격 넓게 (repeat4)', async () => verify('repeat4', await run(page, 'repeat4', '간격.pdf', fixtures.one, pick('gap', 'wide')), { stem: '간격', gap: 'wide' }).text);
  await check('옵션', '테두리 선을 켜면 결과가 달라지고 배치는 그대로', async () => {
    const plain = await run(page, 'nup2', '테두리.pdf', fixtures.a4p5), bordered = await run(page, 'nup2', '테두리.pdf', fixtures.a4p5, p => p.check('#border', { force: true }));
    verify('nup2', bordered, { stem: '테두리' }); assert(bordered.out.size > plain.out.size, '테두리 선이 그려지지 않음');
    return `파일 ${plain.out.size}B → ${bordered.out.size}B`; });
  await check('옵션', '자르는 선을 끄면 결과가 달라지고 배치는 그대로', async () => {
    const on = await run(page, 'repeat4', '재단.pdf', fixtures.one), off = await run(page, 'repeat4', '재단.pdf', fixtures.one, p => p.uncheck('#guides', { force: true }));
    verify('repeat4', off, { stem: '재단' }); assert(on.out.size > off.out.size, '자르는 선 차이가 없음');
    fs.writeFileSync(path.join(OUT, 'one-repeat4-guides.png'), Buffer.from(on.out.png, 'base64'));
    return `선 있음 ${on.out.size}B / 없음 ${off.out.size}B`; });
  await check('옵션', '입력 양식에 적힌 값이 인쇄본에 남음(주석 평탄화)', async () => {
    const r = await run(page, 'nup2', '양식.pdf', fixtures.form);
    assert(r.out.pages[0].items.some(i => i.s.includes('FIELDVALUE')), '양식 값이 결과에 없음'); return 'FIELDVALUE 확인'; });
  await check('옵션', '결과에 원본 첨부 없음', async () => {
    const r = await run(page, 'nup2', '첨부.pdf', fixtures.a4p8);
    const text = await page.evaluate(async url => new TextDecoder('latin1').decode(await (await fetch(url)).arrayBuffer()), r.link.href);
    assert(!/EmbeddedFiles|\/Filespec|\/EF\b/.test(text), '결과에 첨부 구조가 있음'); return `결과 ${r.out.size}B, 첨부 구조 없음`; });
  await check('옵션', '화면에서 모드·개수 전환 시 주소와 제목이 따라감', async () => {
    await page.goto(base); await upload(page, 'a.pdf', fixtures.a4p8); await stateIs(page, 'chosen');
    await page.click('.mode[data-mode=repeat]'); await page.check('input[name=per][value="4"]', { force: true });
    const info = await page.evaluate(() => ({ url: location.search, title: document.getElementById('title').textContent, sum: document.getElementById('sum').textContent }));
    assert(info.url === '?job=repeat4' && info.title === '같은 쪽 반복 배치' && info.sum.includes('A4 8면'), JSON.stringify(info)); return info.url + ' · ' + info.sum; });
  await check('옵션', '미리보기가 옵션 변경 즉시 바뀜(용지 방향)', async () => {
    await page.goto(`${base}?job=nup2`); await upload(page, 'a.pdf', fixtures.a4p8); await stateIs(page, 'chosen');
    const dims = () => page.evaluate(() => { const c = document.querySelector('#after canvas'); return [c.width, c.height, document.getElementById('out-count').textContent]; });
    const a = await dims(); await page.check('input[name=sheet][value=portrait]', { force: true }); const b = await dims();
    assert(a[0] > a[1] && b[0] < b[1] && a[2].includes('가로') && b[2].includes('세로'), JSON.stringify([a, b])); return `${a[2]} → ${b[2]}`; });
  await check('옵션', '60쪽: 미리보기는 앞 4면만 + “외 N면”', async () => {
    await page.goto(`${base}?job=nup2`); await upload(page, 'a.pdf', fixtures.p60); await stateIs(page, 'chosen');
    const t = await page.evaluate(() => [document.querySelectorAll('#after canvas').length, document.getElementById('after-more').textContent, document.getElementById('before-more').textContent]);
    assert(t[0] === 4 && t[1] === '외 26면' && t[2] === '외 52쪽', JSON.stringify(t)); return t.join(' / '); });

  // ───────── 3. 오류 문구 ─────────
  const errorCase = (label, name, buffer, titleWant, detailWant) => check('오류', label, async () => {
    await page.goto(`${base}?job=nup2`); await upload(page, name, buffer); await stateIs(page, 'error', 20000);
    const t = await page.evaluate(() => [document.getElementById('err-title').textContent, document.getElementById('err-detail').textContent, document.getElementById('pick-label').textContent]);
    assert(t[0] === titleWant && t[1].includes(detailWant) && t[2] === '다른 파일 선택', JSON.stringify(t));
    assert(!/[A-Za-z]{4,}/.test((t[0] + t[1]).replace(name, '').replace(/PDF|GB|MB/g, '')), '영어 내부 메시지 노출: ' + t.join(' '));
    return t[0] + ' / ' + t[1]; });
  await errorCase('열기 암호 PDF', '계약서.pdf', fixtures.encUser, '암호가 걸린 PDF입니다', '암호를 풀고 다시 올려 주세요');
  await errorCase('편집 제한만 걸린 PDF(열기 암호 없음)', '성적표.pdf', fixtures.encOwner, '암호가 걸린 PDF입니다', '암호를 풀고 다시 올려 주세요');
  await errorCase('가짜 PDF(텍스트 파일)', '보고서.pdf', fixtures.fake, 'PDF 파일이 아니에요', 'PDF가 아닙니다');
  await errorCase('손상된 PDF', '깨진파일.pdf', fixtures.broken, '이 파일은 열 수 없어요', '다시 저장해 주세요');
  await errorCase('0바이트 파일', '빈파일.pdf', Buffer.alloc(0), '내용이 없는 파일이에요', '다른 PDF를 선택해 주세요');
  await check('오류', '파일 2개 동시 선택', async () => {
    await page.goto(base); await page.evaluate(() => document.getElementById('file').setAttribute('multiple', ''));
    await page.setInputFiles('#file', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: fixtures.one }, { name: 'b.pdf', mimeType: 'application/pdf', buffer: fixtures.one }]);
    await stateIs(page, 'error'); const t = await page.textContent('#err-title'); assert(t === 'PDF는 한 번에 1개만 올릴 수 있어요', t); return t; });
  await check('오류', '오류 뒤 정상 파일을 올리면 복구', async () => {
    await page.goto(base); await upload(page, 'x.pdf', fixtures.fake); await stateIs(page, 'error');
    await upload(page, 'ok.pdf', fixtures.a4p5); await stateIs(page, 'chosen'); return await page.textContent('#sum'); });

  // ───────── 4. 딥링크 ─────────
  for (const [job, title, mode, per, btn] of [['nup2', '2쪽 모아찍기', 'nup', '2', '모아찍기 PDF 만들기'], ['nup4', '4쪽 모아찍기', 'nup', '4', '모아찍기 PDF 만들기'],
    ['repeat2', '같은 쪽 반복 배치', 'repeat', '2', '반복 배치 PDF 만들기'], ['repeat4', '같은 쪽 반복 배치', 'repeat', '4', '반복 배치 PDF 만들기']]) {
    await check('딥링크', `?job=${job}`, async () => {
      await page.goto(`${base}?job=${job}`);
      const t = await page.evaluate(() => ({ title: document.getElementById('title').textContent, mode: document.body.dataset.mode, per: document.querySelector('input[name=per]:checked').value,
        btn: document.getElementById('make').textContent, doc: document.title, pressed: document.querySelector('.mode[aria-pressed=true]').dataset.mode, state: document.body.dataset.state }));
      assert(t.title === title && t.mode === mode && t.per === per && t.btn === btn && t.pressed === mode && t.doc.startsWith(title) && t.state === 'empty', JSON.stringify(t));
      return `${t.title} · ${t.per}${mode === 'nup' ? '쪽' : '개'} 선택됨`; });
  }
  await check('딥링크', '#nup4 (해시) · 잘못된 값은 기본(2쪽 모아찍기)', async () => {
    await page.goto(`${base}#nup4`); const a = await page.textContent('#title');
    await page.goto(`${base}?job=%3Cscript%3E`); const b = await page.textContent('#title');
    assert(a === '4쪽 모아찍기' && b === '2쪽 모아찍기', a + ' / ' + b); return a + ' / ' + b; });

  // ───────── 5. 완료 화면 동작 ─────────
  await check('완료 화면', '받기 링크가 35초 뒤에도 살아 있고 다시 받을 수 있음', async () => {
    const r = await run(page, 'nup2', '유지.pdf', fixtures.a4p5);
    await page.waitForTimeout(35000);
    const again = await page.evaluate(async () => { const a = document.getElementById('dl'); return [(await (await fetch(a.href)).arrayBuffer()).byteLength, a.download]; });
    assert(again[0] === r.out.size && again[1] === '유지_2쪽모아찍기.pdf', JSON.stringify(again));
    const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
    const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
    assert(d1.suggestedFilename() === '유지_2쪽모아찍기.pdf' && d2.suggestedFilename() === d1.suggestedFilename(), d1.suggestedFilename());
    const saved = path.join(OUT, 'download-check.pdf'); await d2.saveAs(saved); assert(fs.statSync(saved).size === r.out.size, '받은 파일 크기 불일치');
    return `35초 뒤 ${again[0]}B 그대로 · 두 번 받기 성공 (${d1.suggestedFilename()})`; });
  await check('완료 화면', '주문 링크·헤더 링크', async () => {
    const t = await page.evaluate(() => { const a = s => { const e = document.querySelector(s); return [e.getAttribute('href'), e.target, e.rel]; };
      return { print: a('#order-print'), book: a('#order-book'), tabs: [...document.querySelectorAll('.tabs a')].map(e => e.getAttribute('href')), logo: document.querySelector('.hd-logo').getAttribute('href'),
        order: document.querySelector('.hd .btn').getAttribute('href'), how: document.querySelector('.how').textContent, mock: !!document.querySelector('.mock-note') }; });
    assert(t.print[0] === 'https://moducopy.co.kr/shop/item.php?it_id=1441618748' && t.print[1] === '_blank' && t.book[0] === 'https://moducopy.co.kr/shop/item.php?it_id=1437511967' && t.book[1] === '_blank'
      && t.tabs.join() === '/pdf-tools/start/,/pdf-tools/basic/,/pdf-tools/converter/,/pdf-tools/print/' && t.logo === '/shop/' && t.order === '/shop/' && t.how.includes('①') && t.how.includes('②') && !t.mock, JSON.stringify(t));
    return '칼라·흑백 출력 / 책 만들기 새 탭, 탭 4개, 로고·주문 → /shop/'; });
  await check('완료 화면', '옵션 바꿔 다시 만들기 → 4쪽으로 재생성', async () => {
    await page.click('#again'); await stateIs(page, 'chosen');
    await page.check('input[name=per][value="4"]', { force: true }); await page.click('#make'); await stateIs(page, 'done');
    const t = await page.evaluate(() => [document.getElementById('dl').download, document.getElementById('dn-sub').textContent]);
    assert(t[0] === '유지_4쪽모아찍기.pdf' && t[1].includes('A4 2면'), JSON.stringify(t)); return t.join(' · '); });
  await check('완료 화면', '다른 파일로 시작 → 빈 화면, 이전 결과 링크 해제', async () => {
    const old = await page.getAttribute('#dl', 'href'); await page.click('#restart'); await stateIs(page, 'empty');
    const t = await page.evaluate(async url => { let alive = true; try { await fetch(url); } catch { alive = false; } return [alive, document.getElementById('dl').getAttribute('href')]; }, old);
    assert(t[0] === false && t[1] === '#', JSON.stringify(t)); return '이전 결과 해제됨'; });
  await check('완료 화면', '처리 중 취소 → 옵션 화면으로', async () => {
    await page.goto(`${base}?job=nup2`); await upload(page, 'a.pdf', fixtures.p60); await stateIs(page, 'chosen');
    await page.route('**/js/worker.js*', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
    await page.click('#make'); await stateIs(page, 'processing'); await page.click('#cancel'); await stateIs(page, 'chosen');
    await page.unroute('**/js/worker.js*'); await page.click('#make'); await stateIs(page, 'done'); return '취소 후 다시 만들기 성공'; });
  await page.context().close();
}

// ───────── 6. 화면: 390 가로 넘침·터치 영역, 스크린샷 ─────────
async function layoutAudit(page) {
  return page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll('button, a.btn, .opt, .chk, .mode, summary, .tabs a, .ft a, .cont a, .back, .info .body a, .hd-logo')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.height < 43.5) small.push(`${el.className || el.tagName}:${Math.round(r.height)}`);
    }
    const over = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1; }).slice(0, 3).map(e => e.className || e.tagName);
    return { scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth, small, over };
  });
}
for (const width of [1280, 390]) {
  const page = await newPage({ width, height: width === 390 ? 844 : 900 });
  const shot = async name => { if (WANT_SHOTS) { await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: true });
    if (width === 390) await page.screenshot({ path: path.join(SHOTS, `${name}-${width}-viewport.png`) }); } };
  const audit = (name) => check(`화면 ${width}`, name, async () => {
    const a = await layoutAudit(page);
    assert(a.scrollWidth <= a.width, `가로 넘침 ${a.scrollWidth} > ${a.width} (${a.over.join(',')})`);
    assert(a.small.length === 0, '44px 미만: ' + a.small.join(', '));
    return `가로 ${a.scrollWidth}px, 누르는 곳 모두 44px 이상`; });
  await page.goto(`${base}?job=nup2`); await page.waitForTimeout(300); await shot('empty'); await audit('빈 화면');
  await check(`화면 ${width}`, '파일 선택 버튼이 첫 화면 안에 있음', async () => {
    const r = await page.evaluate(() => { const b = document.getElementById('pick').getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), window.innerHeight, Math.round(b.height)]; });
    assert(r[1] <= r[2] && r[3] >= 56, JSON.stringify(r)); return `버튼 위치 ${r[0]}~${r[1]}px / 화면 높이 ${r[2]}px`; });
  await upload(page, '2학기_수업자료.pdf', fixtures.a4p8); await stateIs(page, 'chosen');
  await page.waitForFunction(() => document.querySelectorAll('#before canvas').length === 8); await page.waitForTimeout(1200);
  await shot('chosen'); await audit('파일 선택됨(2쪽 모아찍기)');
  if (width === 390) await check('화면 390', '만들기 버튼이 화면 아래 고정', async () => {
    const r = await page.evaluate(() => { const b = document.getElementById('make').getBoundingClientRect(); return [Math.round(b.bottom), window.innerHeight, getComputedStyle(document.querySelector('.act')).position, Math.round(b.height)]; });
    assert(r[2] === 'fixed' && r[0] <= r[1] && r[3] >= 56, JSON.stringify(r)); return `하단 ${r[0]}/${r[1]}px, 높이 ${r[3]}px`; });
  await page.route('**/js/worker.js*', async route => { await new Promise(r => setTimeout(r, 1200)); await route.continue(); });
  await page.click('#make'); await stateIs(page, 'processing'); await page.waitForTimeout(400); await shot('processing'); await audit('처리 중');
  await stateIs(page, 'done'); await page.unroute('**/js/worker.js*'); await page.waitForTimeout(300); await shot('done'); await audit('완료');
  if (width === 390) await check('화면 390', '완료: PDF 받기·주문 버튼이 첫 화면 안', async () => {
    const r = await page.evaluate(() => [document.getElementById('dl').getBoundingClientRect().bottom, document.getElementById('order-print').getBoundingClientRect().bottom, window.innerHeight].map(Math.round));
    assert(r[0] <= r[2], JSON.stringify(r)); return `받기 ${r[0]}px, 주문 ${r[1]}px / ${r[2]}px`; });
  await page.goto(`${base}?job=repeat4`); await upload(page, '할인쿠폰.pdf', fixtures.one); await stateIs(page, 'chosen'); await page.waitForTimeout(1000);
  await shot('chosen-repeat4'); await audit('파일 선택됨(반복 배치 4개)');
  await page.click('#make'); await stateIs(page, 'done'); await page.waitForTimeout(300); await shot('done-repeat4');
  await page.goto(`${base}?job=nup4`); await upload(page, '발표자료.pdf', fixtures.a4l3); await stateIs(page, 'chosen'); await page.waitForTimeout(1000); await shot('chosen-nup4-landscape');
  await page.goto(`${base}?job=nup2`); await upload(page, '계약서_최종.pdf', fixtures.encUser); await stateIs(page, 'error'); await shot('error'); await audit('오류');
  await page.context().close();
}

await check('공통', 'CSP 위반·콘솔 오류 없음(권장 CSP 헤더 적용 상태)', async () => { assert(consoleProblems.length === 0, consoleProblems.slice(0, 3).join(' | ')); return '콘솔 오류 0건'; });

await browser.close(); server.close();
const groups = {};
for (const r of results) { groups[r.group] = groups[r.group] || [0, 0]; groups[r.group][r.ok ? 0 : 1]++; }
console.log('\n── 요약 ──');
for (const [g, [ok, bad]] of Object.entries(groups)) console.log(`${g}: 통과 ${ok} / 실패 ${bad}`);
const failed = results.filter(r => !r.ok);
console.log(`합계: 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
