/*
 * 모아찍기 화면 (ES 모듈). 파일은 이 브라우저 안에서만 처리한다.
 *  - 미리보기: pdf.js 로 원본 쪽을 그린 뒤, ModuNup.plan() 결과대로 A4 면에 배치해 보여 준다.
 *  - 만들기: js/worker.js (pdf-lib) 가 실제 PDF 를 만든다. 화면과 같은 plan() 을 쓴다.
 */
const Nup = window.ModuNup;
const $ = id => document.getElementById(id);
const body = document.body;

const WARN_BYTES = 150 * 1024 * 1024;        // 이보다 크면 경고
const MAX_BYTES = 1024 * 1024 * 1024;        // 이보다 크면 받지 않음
const MAX_VIEW_PAGES = 600;                  // 용지 방향 판단에 크기를 읽는 최대 쪽 수
const SRC_THUMBS = 8, OUT_SHEETS = 4;        // 미리보기에 보여 주는 원본 쪽·결과 면 수
const THUMB_PX = 420;                        // 원본 쪽 그림의 긴 변(px)
const VERSION = '20261117a';

const JOBS = { nup2: ['nup', 2], nup4: ['nup', 4], repeat2: ['repeat', 2], repeat4: ['repeat', 4], repeat8: ['repeat', 8] };

const state = {
  mode: 'nup', per: 2, sheet: 'auto', order: 'ltr', gap: 'none', border: false, guides: true,
  file: null, doc: null, numPages: 0, views: [], viewsPartial: false, thumbs: new Map(),
  token: 0, worker: null, result: null, lastPlan: null
};

// ───────── 문구 ─────────
const ERRORS = {
  ENCRYPTED: ['암호가 걸린 PDF입니다', name => `‘${name}’ 파일에 암호(열기 또는 편집 제한)가 걸려 있어요. 암호를 풀고 다시 올려 주세요.`],
  NOT_PDF: ['PDF 파일이 아니에요', name => `‘${name}’ 파일은 PDF가 아닙니다. 한글·워드·사진 파일은 먼저 PDF로 바꾼 뒤 올려 주세요.`],
  INVALID: ['이 파일은 열 수 없어요', name => `‘${name}’ 파일이 손상되었거나 PDF 형식이 올바르지 않습니다. 원본 프로그램에서 PDF로 다시 저장해 주세요.`],
  EMPTY: ['내용이 없는 파일이에요', name => `‘${name}’ 파일에 쪽이 없습니다. 다른 PDF를 선택해 주세요.`],
  TOO_BIG: ['파일이 너무 커요', name => `‘${name}’ 파일은 1GB를 넘어 이 브라우저에서 처리할 수 없습니다. 파일을 나누거나 용량을 줄여 주세요.`],
  MULTI: ['PDF는 한 번에 1개만 올릴 수 있어요', () => '여러 파일을 합치려면 먼저 ‘편집 → PDF 합치기’를 이용해 주세요.'],
  LOAD: ['미리보기를 준비하지 못했어요', () => '인터넷 연결을 확인하고 새로고침한 뒤 다시 시도해 주세요.']
};
const BUILD_ERRORS = {
  ENCRYPTED: '암호가 걸린 PDF입니다. 암호를 풀고 다시 올려 주세요.',
  INVALID: '이 PDF의 구조를 읽지 못했습니다. 원본 프로그램에서 PDF로 다시 저장한 뒤 올려 주세요.',
  EMPTY: '쪽이 없는 PDF입니다. 다른 파일을 선택해 주세요.',
  GEOMETRY: '쪽 크기를 읽을 수 없는 PDF입니다. 원본 프로그램에서 PDF로 다시 저장해 주세요.',
  MEMORY: '파일이 너무 커서 이 기기의 메모리로는 만들 수 없습니다. 다른 창을 닫거나 PC에서 다시 시도해 주세요.',
  FAILED: 'PDF를 만들지 못했습니다. 파일이 너무 크거나 복잡할 수 있어요. 잠시 뒤 다시 시도해 주세요.'
};

function jobName() { return state.mode === 'nup' ? `nup${state.per}` : `repeat${state.per}`; }
function titleText() { return state.mode === 'nup' ? `${state.per}쪽 모아찍기` : '같은 쪽 여러 개 찍기'; }
function leadText() {
  if (state.mode === 'repeat') return `한 쪽을 A4 한 장에 ${state.per}개씩 똑같이 넣습니다. 전단·쿠폰·안내문을 잘라 쓰기 좋아요.`;
  return state.per === 2 ? 'A4 한 장에 2쪽씩 나란히 넣습니다. 종이가 절반으로 줄어요.' : 'A4 한 장에 4쪽씩 넣습니다. 종이가 4분의 1로 줄어요.';
}
function suffix() { return state.mode === 'nup' ? `${state.per}쪽모아찍기` : `${state.per}개반복배치`; }
function formatBytes(n) { return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`; }
function papers(sheets) { return Math.ceil(sheets / 2); }

// ───────── 상태 전환 ─────────
function setState(name, focusId) {
  body.dataset.state = name;
  const step = name === 'done' ? 3 : (name === 'chosen' || name === 'processing') ? 2 : 1;
  document.querySelectorAll('.steps li').forEach(li => {
    const k = Number(li.dataset.step);
    li.className = k < step ? 'ok' : k === step ? 'on' : '';
    if (k === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('pick-label').textContent = name === 'error' ? '다른 파일 선택' : 'PDF 파일 선택';
  if (focusId) { const el = $(focusId); if (el) el.focus({ preventScroll: true }); }
}
function showError(code, name) {
  const [title, detail] = ERRORS[code] || ERRORS.INVALID;
  $('err-title').textContent = title;
  $('err-detail').textContent = detail(name || '선택한');
  setBusy(false);
  setState('error');
  window.scrollTo(0, 0);
  $('pick').focus({ preventScroll: true });
}
function setBusy(busy) { $('drop').classList.toggle('is-busy', busy); $('opening').hidden = !busy; }

// ───────── 모드·딥링크 ─────────
function readJob() {
  const query = new URLSearchParams(location.search).get('job') || '';
  const hash = location.hash.replace(/^#/, '').replace(/^job=/, '');
  for (const raw of [query, hash]) { const key = String(raw).trim().toLowerCase(); if (Object.prototype.hasOwnProperty.call(JOBS, key)) return JOBS[key]; }
  return null;
}
function writeJob() {
  try {
    const url = new URL(location.href);
    url.searchParams.set('job', jobName()); url.hash = '';
    history.replaceState(history.state, '', url.pathname + url.search);
  } catch { /* 주소를 바꿀 수 없는 환경에서는 그대로 둔다 */ }
}
function buildPerSeg() {
  const seg = $('per-seg'); seg.replaceChildren();
  for (const n of Nup.COUNTS[state.mode]) {
    const label = document.createElement('label'); label.className = 'opt';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'per'; input.value = String(n); input.checked = n === state.per;
    const span = document.createElement('span'); span.textContent = state.mode === 'nup' ? `${n}쪽` : `${n}개`;
    label.append(input, span); seg.append(label);
  }
}
function buildDemo() {
  const demo = $('demo'); demo.replaceChildren(); demo.classList.toggle('one', state.mode === 'repeat');
  const pg = t => { const s = document.createElement('span'); s.className = 'pg'; s.textContent = t; return s; };
  demo.append(pg('1'), pg('2'));
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('class', 'ic'); arrow.setAttribute('viewBox', '0 0 24 24'); arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '1.7'); arrow.setAttribute('stroke-linecap', 'round'); arrow.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M5 12h14M13 6l6 6-6 6'); arrow.append(path);
  demo.append(arrow);
  const sheet = document.createElement('span'), grid = Nup.gridFor(state.per, state.per !== 4);
  sheet.className = 'sh' + (state.per === 4 ? ' tall' : '');
  sheet.style.setProperty('--c', grid.cols); sheet.style.setProperty('--r', grid.rows);
  for (let i = 1; i <= state.per; i++) { const s = document.createElement('span'); s.textContent = state.mode === 'repeat' ? '1' : String(i); sheet.append(s); }
  demo.append(sheet);
}
function applyMode() {
  body.dataset.mode = state.mode;
  document.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('title').textContent = titleText(); $('lead').textContent = leadText();
  document.title = `${titleText()} · 모두카피 PDF 도구`;
  $('per-legend').textContent = state.mode === 'nup' ? '한 면에 넣을 쪽 수' : '한 장에 넣을 개수';
  $('gap-legend').textContent = state.mode === 'nup' ? '쪽 사이 간격' : '사이 간격';
  $('make').textContent = state.mode === 'nup' ? '모아찍기 PDF 만들기' : '여러 개 찍기 PDF 만들기';
  const two = state.per === 2;
  $('lab-landscape').textContent = two ? '좌우로 나란히' : 'A4 가로';
  $('lab-portrait').textContent = two ? '위아래로' : 'A4 세로';
  buildPerSeg(); buildDemo();
}
function setMode(mode, per) {
  state.mode = mode;
  state.per = Nup.COUNTS[mode].includes(per) ? per : 2;
  applyMode(); writeJob(); refreshPreview();
}

// ───────── pdf.js ─────────
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`../vendor/pdfjs/pdf.min.js?v=${VERSION}`).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL(`../vendor/pdfjs/pdf.worker.min.js?v=${VERSION}`, import.meta.url).href;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}
const vendorUrl = path => new URL(`../vendor/pdfjs/${path}`, import.meta.url).href;
function openWithPdfjs(lib, data) {
  return lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, cMapUrl: vendorUrl('cmaps/'), cMapPacked: true,
    standardFontDataUrl: vendorUrl('standard_fonts/'), wasmUrl: vendorUrl('wasm/'), iccUrl: vendorUrl('iccs/'), verbosity: 0 });
}
function pageSize(page) {
  const vp = page.getViewport({ scale: 1 }), unit = page.userUnit > 0 ? page.userUnit : 1;   // /Rotate·CropBox 반영된 화면 크기
  return { width: vp.width * unit, height: vp.height * unit };
}
async function renderPage(doc, index, maxPx) {
  const page = await doc.getPage(index + 1), base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxPx / Math.max(base.width, base.height), 4), viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
  return canvas;
}

async function containsEncryptMarker(file) {
  // 암호 표시(/Encrypt)는 파일 머리나 꼬리의 문서 정보에 있다. 앞뒤 2MB만 살핀다.
  const span = 2 * 1024 * 1024, parts = [file.slice(0, span)];
  if (file.size > span) parts.push(file.slice(Math.max(span, file.size - span)));
  for (const part of parts) {
    const bytes = new Uint8Array(await part.arrayBuffer()), needle = [47, 69, 110, 99, 114, 121, 112, 116]; // "/Encrypt"
    outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
      for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
      return true;
    }
  }
  return false;
}
function probeEncrypted(bytes) {
  return new Promise(resolve => {
    let worker;
    try { worker = new Worker(`js/worker.js?v=${VERSION}`); } catch { resolve(false); return; }
    worker.onmessage = ({ data }) => { worker.terminate(); resolve(data && data.ok === false && data.code === 'ENCRYPTED'); };
    worker.onerror = () => { worker.terminate(); resolve(false); };
    worker.postMessage({ type: 'probe', bytes }, [bytes]);
  });
}

// ───────── 파일 선택 ─────────
async function closeDoc() {
  const doc = state.doc; state.doc = null; state.thumbs = new Map(); state.views = []; state.numPages = 0;
  if (doc) { try { await doc.loadingTask.destroy(); } catch { /* 이미 닫힘 */ } }
}
function clearResult() {
  if (state.result) { URL.revokeObjectURL(state.result.url); state.result = null; }
  const dl = $('dl'); dl.removeAttribute('download'); dl.setAttribute('href', '#');
  $('result').replaceChildren();
}
function stopWorker() { if (state.worker) { state.worker.terminate(); state.worker = null; } }

async function selectFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  if (files.length > 1) { showError('MULTI'); return; }
  const file = files[0], token = ++state.token;
  stopWorker(); clearResult();
  if (file.size > MAX_BYTES) { showError('TOO_BIG', file.name); return; }
  if (file.size === 0) { showError('EMPTY', file.name); return; }
  setState('empty'); setBusy(true);
  let head;
  try { head = new Uint8Array(await file.slice(0, 1024).arrayBuffer()); } catch { showError('INVALID', file.name); return; }
  if (token !== state.token) return;
  if (!new TextDecoder('latin1').decode(head).includes('%PDF-')) { showError('NOT_PDF', file.name); return; }

  let lib;
  try { lib = await loadPdfjs(); } catch { if (token === state.token) showError('LOAD'); return; }
  let doc, hasMarker = false;
  try {
    hasMarker = await containsEncryptMarker(file);
    doc = await openWithPdfjs(lib, await file.arrayBuffer()).promise;
  } catch (error) {
    if (token !== state.token) return;
    const name = error && error.name;
    showError(name === 'PasswordException' || hasMarker ? 'ENCRYPTED' : 'INVALID', file.name);
    return;
  }
  if (token !== state.token) { doc.loadingTask.destroy(); return; }
  if (hasMarker) {
    // 열기 암호 없이 '편집 제한'만 걸린 PDF: 미리보기는 되지만 새 PDF 로 만들 수는 없다. 미리 알려 준다.
    let encrypted = false;
    try { encrypted = await probeEncrypted(await file.arrayBuffer()); } catch { encrypted = false; }
    if (token !== state.token) { doc.loadingTask.destroy(); return; }
    if (encrypted) { doc.loadingTask.destroy(); showError('ENCRYPTED', file.name); return; }
  }
  if (!doc.numPages) { doc.loadingTask.destroy(); showError('EMPTY', file.name); return; }

  const views = [], limit = Math.min(doc.numPages, MAX_VIEW_PAGES);
  try {
    for (let i = 0; i < limit; i++) {
      const page = await doc.getPage(i + 1); views.push(pageSize(page)); page.cleanup();
      if (token !== state.token) { doc.loadingTask.destroy(); return; }
    }
  } catch { if (token === state.token) { doc.loadingTask.destroy(); showError('INVALID', file.name); } return; }

  await closeDoc();
  state.file = file; state.doc = doc; state.numPages = doc.numPages; state.views = views; state.viewsPartial = limit < doc.numPages;
  state.thumbs = new Map();
  $('f-name').textContent = file.name;
  const warn = $('warn');
  warn.hidden = file.size <= WARN_BYTES;
  warn.textContent = file.size > WARN_BYTES ? `큰 파일(${formatBytes(file.size)})이에요. 만드는 데 시간이 걸리거나, 기기 메모리가 부족하면 중간에 멈출 수 있습니다. 가능하면 PC에서 이용해 주세요.` : '';
  $('make-error').hidden = true;
  setBusy(false);
  setState('chosen', 'pvh');
  refreshPreview();
  renderThumbs(token);
}

function describeSource() {
  const v = state.views, first = v[0];
  const same = v.every(p => Math.abs(p.width - first.width) < 2 && Math.abs(p.height - first.height) < 2);
  const a4 = (w, h) => Math.abs(Math.min(w, h) - Nup.A4[0]) < 6 && Math.abs(Math.max(w, h) - Nup.A4[1]) < 6;
  const dir = p => p.width > p.height * 1.02 ? '가로' : p.height > p.width * 1.02 ? '세로' : '정사각';
  let size;
  if (!same) size = '크기 혼합';
  else if (a4(first.width, first.height)) size = `A4 ${dir(first)}`;
  else size = `${Math.round(first.width / Nup.MM)}×${Math.round(first.height / Nup.MM)}mm ${dir(first)}`;
  return `${state.numPages}쪽 · ${size} · ${formatBytes(state.file.size)}`;
}

// ───────── 미리보기 ─────────
function currentOptions() {
  return { mode: state.mode, per: state.per, sheet: state.sheet, order: state.order, gap: state.gap, border: state.border, guides: state.guides };
}
/** 전체 쪽 수 기준의 면 수와, 미리보기에 그릴 앞쪽 면들의 계획. */
function computePlan() {
  const options = currentOptions();
  const landscape = state.mode === 'nup' ? Nup.chooseLandscape(state.views, state.per, Nup.GAPS[state.gap], state.sheet) : null;
  const resolved = state.mode === 'nup' ? { ...options, sheet: landscape ? 'landscape' : 'portrait' } : options;
  const plan = Nup.plan(state.views, resolved);
  const totalSheets = state.mode === 'nup' ? Math.ceil(state.numPages / state.per) : state.numPages;
  return { plan, resolved, landscape, totalSheets };
}
function drawSheet(canvas, sheet, options, chips) {
  const cssWidth = sheet.landscape ? 380 : 270, ratio = Math.min(window.devicePixelRatio || 1, 2), k = cssWidth * ratio / sheet.W;
  canvas.width = Math.round(sheet.W * k); canvas.height = Math.round(sheet.H * k);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  const Y = y => (sheet.H - y) * k;
  for (const cell of sheet.cells) {
    const x = cell.x * k, y = Y(cell.y + cell.h), w = cell.w * k, h = cell.h * k, thumb = state.thumbs.get(cell.src);
    if (thumb) { g.imageSmoothingQuality = 'high'; g.drawImage(thumb, x, y, w, h); }
    else { g.fillStyle = '#EEF1F5'; g.fillRect(x, y, w, h); }
    if (options.border) { g.strokeStyle = '#59606B'; g.lineWidth = Math.max(1, ratio); g.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    else if (!thumb) { g.strokeStyle = '#C3CCD8'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    if (chips) {
      const r = Math.min(canvas.width * .058, Math.min(w, h) * .22), cx = x + r * 1.35, cy = y + r * 1.35;
      g.fillStyle = 'rgba(24,35,54,.88)'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(r * 1.05)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(cell.src + 1), cx, cy + r * .06);
    }
  }
  if (sheet.guides.length) {
    g.strokeStyle = '#6B7482'; g.lineWidth = Math.max(1, ratio); g.setLineDash([5 * ratio, 4 * ratio]);
    for (const line of sheet.guides) { g.beginPath(); g.moveTo(line.x1 * k, Y(line.y1)); g.lineTo(line.x2 * k, Y(line.y2)); g.stroke(); }
    g.setLineDash([]);
  }
}
function figure(canvas, caption) {
  const f = document.createElement('figure'); f.append(canvas);
  if (caption) { const c = document.createElement('figcaption'); c.textContent = caption; f.append(c); }
  return f;
}
function refreshPreview() {
  if (!state.doc || !state.views.length) return;
  const { plan, landscape, totalSheets } = computePlan();
  state.lastPlan = { plan, totalSheets };
  const n = state.numPages, first = plan.sheets[0];

  // 원본
  $('f-meta').textContent = describeSource();
  $('src-count').textContent = `${n}쪽`;
  const before = $('before'); before.replaceChildren();
  const shown = Math.min(n, SRC_THUMBS), wide = state.views[0].width > state.views[0].height;
  before.className = 'pages' + (wide ? ' land' : '');
  for (let i = 0; i < shown; i++) {
    const thumb = state.thumbs.get(i), canvas = document.createElement('canvas'), v = state.views[i];
    if (thumb) { canvas.width = thumb.width; canvas.height = thumb.height; canvas.getContext('2d').drawImage(thumb, 0, 0); }
    else { canvas.width = Math.round(v.width); canvas.height = Math.round(v.height); const g = canvas.getContext('2d'); g.fillStyle = '#EEF1F5'; g.fillRect(0, 0, canvas.width, canvas.height); }
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `원본 ${i + 1}쪽`);
    before.append(figure(canvas, String(i + 1)));
  }
  $('before-more').hidden = n <= shown; $('before-more').textContent = n > shown ? `외 ${n - shown}쪽` : '';

  // 결과
  const after = $('after'); after.replaceChildren();
  const sheetsShown = Math.min(plan.sheets.length, OUT_SHEETS), allLandscape = plan.sheets.slice(0, sheetsShown).every(s => s.landscape);
  after.className = 'sheets' + (allLandscape ? '' : ' tall') + (sheetsShown === 1 ? ' solo' : '');
  for (let s = 0; s < sheetsShown; s++) {
    const sheet = plan.sheets[s], canvas = document.createElement('canvas');
    drawSheet(canvas, sheet, plan.options, state.mode === 'nup');
    const pagesOn = sheet.cells.map(c => c.src + 1);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', state.mode === 'nup' ? `결과 ${s + 1}면: 원본 ${pagesOn.join(', ')}쪽` : `결과 ${s + 1}면: 원본 ${pagesOn[0]}쪽 ${state.per}개`);
    after.append(figure(canvas, `${s + 1}면`));
  }
  $('after-more').hidden = totalSheets <= sheetsShown; $('after-more').textContent = totalSheets > sheetsShown ? `외 ${totalSheets - sheetsShown}면` : '';
  const sheetDir = state.mode === 'nup' ? (landscape ? 'A4 가로' : 'A4 세로') : (plan.sheets.every(s => s.landscape === first.landscape) ? (first.landscape ? 'A4 가로' : 'A4 세로') : 'A4');
  $('out-count').textContent = `${sheetDir} ${totalSheets}면`;

  // 요약
  const each = state.mode === 'repeat' ? `(한 면에 ${state.per}개씩)` : '';
  $('sum').textContent = `원본 ${n}쪽 → A4 ${totalSheets}면${each} · 양면으로 인쇄하면 종이 ${papers(totalSheets)}장`;
  $('make-sum').textContent = `${n}쪽 → A4 ${totalSheets}면`;
  let min = Infinity, max = 0;
  for (const sheet of plan.sheets) for (const cell of sheet.cells) { min = Math.min(min, cell.scale); max = Math.max(max, cell.scale); }
  const pct = v => `${Math.round(v * 100)}%`;
  let note = max - min < 0.005 ? `원본의 약 ${pct(min)} 크기로 들어갑니다.` : `쪽 크기가 달라 원본의 약 ${pct(min)}~${pct(max)} 크기로 들어갑니다.`;
  if (state.mode === 'nup') note += ' 그림 위의 번호는 쪽 순서를 알려 주는 표시이며 인쇄되지 않습니다.';
  if (state.viewsPartial) note += ` 쪽이 많아 앞 ${MAX_VIEW_PAGES}쪽으로 방향을 정했습니다.`;
  $('pv-note').textContent = note;

  // 읽는 순서는 좌우로 놓일 때만 의미가 있다
  const oneColumn = state.mode === 'nup' && first.cols === 1;
  document.querySelectorAll('input[name=order]').forEach(i => { i.disabled = oneColumn; });
  $('order-note').hidden = !oneColumn;
}
async function renderThumbs(token) {
  const doc = state.doc, need = Math.min(state.numPages, Math.max(SRC_THUMBS, OUT_SHEETS * state.per, 16));
  for (let i = 0; i < need; i++) {
    if (token !== state.token || doc !== state.doc) return;
    if (state.thumbs.has(i)) continue;
    try { state.thumbs.set(i, await renderPage(doc, i, THUMB_PX)); } catch { continue; }
    if (token !== state.token || doc !== state.doc) return;
    if (body.dataset.state === 'chosen') refreshPreview();
  }
}

// ───────── 만들기 ─────────
function setProgress(percent, text) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $('prog').style.width = `${value}%`; $('bar').setAttribute('aria-valuenow', String(value));
  if (text) $('proc-text').textContent = text;
}
async function make() {
  if (!state.file || body.dataset.state !== 'chosen') return;
  const token = ++state.token, { resolved, totalSheets } = computePlan(), file = state.file, mode = state.mode, per = state.per;
  clearResult(); $('make-error').hidden = true;
  $('proc-title').textContent = mode === 'nup' ? '모아찍기 PDF를 만들고 있어요' : '여러 개 찍기 PDF를 만들고 있어요';
  setProgress(3, '파일을 읽고 있어요 · 창을 닫지 말고 잠시만 기다려 주세요.');
  setState('processing', 'proc-title'); window.scrollTo(0, 0);
  const fail = code => {
    if (token !== state.token) return;
    stopWorker();
    const box = $('make-error'); box.textContent = BUILD_ERRORS[code] || BUILD_ERRORS.FAILED; box.hidden = false;
    setState('chosen'); refreshPreview(); box.scrollIntoView({ block: 'center' });
  };
  let bytes;
  try { bytes = await file.arrayBuffer(); } catch { fail('MEMORY'); return; }
  if (token !== state.token) return;
  let worker;
  try { worker = new Worker(`js/worker.js?v=${VERSION}`); } catch { fail('FAILED'); return; }
  state.worker = worker;
  worker.onerror = () => fail('FAILED');
  worker.onmessageerror = () => fail('MEMORY');
  worker.onmessage = async ({ data }) => {
    if (token !== state.token) return;
    if (data.type === 'progress') {
      if (data.phase === 'read') setProgress(8, '파일을 읽고 있어요 · 창을 닫지 말고 잠시만 기다려 주세요.');
      else if (data.phase === 'place') setProgress(12 + 70 * data.done / Math.max(1, data.total), `A4 ${data.total}면 중 ${data.done}면째 · 창을 닫지 말고 잠시만 기다려 주세요.`);
      else setProgress(88, 'PDF 파일로 저장하고 있어요 · 거의 다 됐어요.');
      return;
    }
    if (data.type === 'error') { fail(data.code); return; }
    if (data.type !== 'done') return;
    stopWorker();
    setProgress(95, '결과를 확인하고 있어요.');
    const blob = new Blob([data.bytes], { type: 'application/pdf' });
    const stem = file.name.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '모두카피';
    const name = `${stem}_${mode === 'nup' ? `${per}쪽모아찍기` : `${per}개반복배치`}.pdf`;
    state.result = { url: URL.createObjectURL(blob), name, size: blob.size, sheets: data.sheets, sourcePages: data.sourcePages, landscape: data.landscape, mode, per };
    await showDone(blob, token);
  };
  worker.postMessage({ type: 'build', bytes, options: resolved }, [bytes]);
  void totalSheets;
}
async function showDone(blob, token) {
  const r = state.result, allSame = r.landscape.every(v => v === r.landscape[0]);
  const dir = allSame ? (r.landscape[0] ? 'A4 가로' : 'A4 세로') : 'A4';
  $('dnh').textContent = r.mode === 'nup' ? '모아찍기 PDF가 완성됐어요' : '여러 개 찍기 PDF가 완성됐어요';
  $('dn-sub').textContent = r.mode === 'nup' ? `원본 ${r.sourcePages}쪽이 A4 ${r.sheets}면으로 줄었습니다.` : `원본 ${r.sourcePages}쪽을 A4 한 면에 ${r.per}개씩 넣어 ${r.sheets}면을 만들었습니다.`;
  $('dn-name').textContent = r.name;
  $('dn-meta').textContent = `${dir} · ${r.sheets}면 · ${formatBytes(r.size)}`;
  const dl = $('dl'); dl.href = r.url; dl.download = r.name;
  const spec = $('spec'); spec.replaceChildren();
  for (const text of ['A4', `${r.sheets}면`, `양면이면 종이 ${papers(r.sheets)}장`]) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = text; spec.append(b); }

  // 완성된 PDF 를 다시 열어 실제 모습을 보여 준다(미리보기 계획이 아니라 결과 파일 그대로).
  const box = $('result'); box.replaceChildren();
  const shown = Math.min(r.sheets, OUT_SHEETS), firstLandscape = r.landscape.slice(0, shown).every(Boolean);
  box.className = 'sheets' + (firstLandscape ? ' wide' : '') + (shown === 1 ? ' solo' : '');
  $('result-more').hidden = r.sheets <= shown; $('result-more').textContent = r.sheets > shown ? `외 ${r.sheets - shown}면` : '';
  let verify = null;
  try {
    const lib = await loadPdfjs();
    verify = await openWithPdfjs(lib, await blob.arrayBuffer()).promise;
    for (let i = 0; i < shown; i++) {
      if (token !== state.token) break;
      const canvas = await renderPage(verify, i, 560);
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `완성된 PDF ${i + 1}면`);
      box.append(figure(canvas, `${i + 1}면`));
    }
  } catch { /* 결과 그림을 못 그려도 받기는 가능하다 */ }
  finally { if (verify) { try { await verify.loadingTask.destroy(); } catch { /* 무시 */ } } }
  if (token !== state.token) return;
  setProgress(100);
  setState('done', 'dnh'); window.scrollTo(0, 0);
}

// ───────── 이벤트 ─────────
function bind() {
  const input = $('file'), drop = $('drop');
  $('pick').addEventListener('click', () => input.click());
  $('change').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const files = Array.from(input.files); input.value = ''; selectFiles(files); });
  let depth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  drop.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.classList.add('is-over'); });
  drop.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  drop.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('is-over'); });
  // 빈 화면·오류·옵션 화면 어디에 놓아도 받는다. 브라우저가 파일을 대신 열어 버리지 않게 막는다.
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; drop.classList.remove('is-over');
    if (['empty', 'error', 'chosen'].includes(body.dataset.state)) selectFiles(e.dataTransfer.files);
  });

  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => { if (b.dataset.mode !== state.mode) setMode(b.dataset.mode, state.per); }));
  document.querySelector('.op').addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'per') { state.per = Number(t.value); applyMode(); writeJob(); if (state.doc) renderThumbs(state.token); }
    else if (t.name === 'sheet') state.sheet = t.value;
    else if (t.name === 'order') state.order = t.value;
    else if (t.name === 'gap') state.gap = t.value;
    else if (t.id === 'border') state.border = t.checked;
    else if (t.id === 'guides') state.guides = t.checked;
    $('make-error').hidden = true;
    refreshPreview();
  });
  $('make').addEventListener('click', make);
  $('cancel').addEventListener('click', () => { state.token++; stopWorker(); setState('chosen', 'pvh'); refreshPreview(); renderThumbs(state.token); });
  $('again').addEventListener('click', () => { setState('chosen', 'pvh'); refreshPreview(); window.scrollTo(0, 0); });
  $('restart').addEventListener('click', async () => {
    state.token++; stopWorker(); clearResult(); await closeDoc(); state.file = null;
    setBusy(false); setState('empty'); window.scrollTo(0, 0); $('pick').focus({ preventScroll: true });
  });
  $('dl').addEventListener('click', e => { if (!state.result) e.preventDefault(); });
  window.addEventListener('popstate', () => { const job = readJob(); if (job && body.dataset.state !== 'processing') { state.mode = job[0]; state.per = job[1]; applyMode(); refreshPreview(); } });
  window.addEventListener('pagehide', () => { stopWorker(); });
}

const job = readJob();
if (job) { state.mode = job[0]; state.per = job[1]; }
applyMode();
setState('empty');
bind();
// 첫 화면을 그린 뒤 미리보기 모듈을 미리 받아 둔다(파일 선택 후 기다림을 줄인다).
(window.requestIdleCallback || (fn => setTimeout(fn, 600)))(() => { loadPdfjs().catch(() => {}); });
