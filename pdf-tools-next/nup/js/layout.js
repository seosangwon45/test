/*
 * ModuNup — 모아찍기·같은 쪽 반복 배치 엔진 (pdf-lib 1.17.1).
 * 화면(app.js, 미리보기 계산)과 작업자(worker.js, 실제 PDF 생성)가 같은 plan() 을 쓴다.
 * 모든 길이는 pt(1/72 inch). y 는 PDF 좌표(아래가 0).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ModuNup = api;
})(typeof self !== 'undefined' ? self : undefined, function () {
  'use strict';

  var MM = 72 / 25.4;
  var A4 = [210 * MM, 297 * MM];           // 짧은 변, 긴 변
  var MARGIN_MM = 5;                       // 바깥 여백(일반 프린터의 인쇄 불가 영역)
  var GAPS = { none: 0, narrow: 4, wide: 10 }; // 쪽 사이 간격(mm)
  var COUNTS = { nup: [2, 4], repeat: [2, 4, 8] };

  function normRect(r) {
    var x1 = Math.min(r.x, r.x + r.width), x2 = Math.max(r.x, r.x + r.width);
    var y1 = Math.min(r.y, r.y + r.height), y2 = Math.max(r.y, r.y + r.height);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  function intersect(a, b) {
    var x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    var right = Math.min(a.x + a.width, b.x + b.width), top = Math.min(a.y + a.height, b.y + b.height);
    return right - x > 0.01 && top - y > 0.01 ? { x: x, y: y, width: right - x, height: top - y } : null;
  }

  /** 박스·회전·UserUnit → 화면에 보이는 영역과 크기. CropBox 는 MediaBox 와 교차시킨다. */
  function viewOf(mediaBox, cropBox, rotation, userUnit) {
    var media = normRect(mediaBox);
    var box = intersect(normRect(cropBox || mediaBox), media) || media;
    var rot = ((Math.round((Number(rotation) || 0) / 90) * 90) % 360 + 360) % 360;
    var unit = isFinite(userUnit) && userUnit > 0 ? userUnit : 1;
    if (![box.x, box.y, box.width, box.height].every(isFinite) || box.width <= 0 || box.height <= 0) {
      var error = new Error('page-geometry'); error.code = 'GEOMETRY'; throw error;
    }
    var swap = rot % 180 !== 0;
    return { box: box, rotation: rot, unit: unit,
      width: (swap ? box.height : box.width) * unit, height: (swap ? box.width : box.height) * unit };
  }

  /** 원본 좌표 → (0,0)~(view.width, view.height) 시각 좌표 행렬. */
  function viewMatrix(view) {
    var x = view.box.x, y = view.box.y, w = view.box.width, h = view.box.height, u = view.unit;
    if (view.rotation === 0) return [u, 0, 0, u, -x * u, -y * u];
    if (view.rotation === 90) return [0, -u, u, 0, -y * u, (x + w) * u];
    if (view.rotation === 180) return [-u, 0, 0, -u, (x + w) * u, (y + h) * u];
    return [0, u, -u, 0, (y + h) * u, -x * u];
  }

  function normalizeOptions(o) {
    o = o || {};
    var mode = o.mode === 'repeat' ? 'repeat' : 'nup';
    var per = Number(o.per);
    if (COUNTS[mode].indexOf(per) === -1) per = 2;
    return {
      mode: mode, per: per,
      sheet: ['auto', 'portrait', 'landscape'].indexOf(o.sheet) === -1 ? 'auto' : o.sheet,
      order: o.order === 'rtl' ? 'rtl' : 'ltr',
      gap: Object.prototype.hasOwnProperty.call(GAPS, o.gap) ? o.gap : 'none',
      border: o.border === true,
      guides: o.guides === true
    };
  }

  /** 용지 방향별 칸 구성. 2쪽: 가로 용지=좌우, 세로 용지=위아래. 4쪽: 2×2. 8개: 가로 4×2, 세로 2×4. */
  function gridFor(per, landscape) {
    if (per === 2) return landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    if (per === 4) return { cols: 2, rows: 2 };
    return landscape ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
  }

  function cellsFor(per, landscape, gapMm) {
    var W = landscape ? A4[1] : A4[0], H = landscape ? A4[0] : A4[1];
    var g = gridFor(per, landscape), margin = MARGIN_MM * MM, gap = gapMm * MM;
    return { W: W, H: H, cols: g.cols, rows: g.rows, margin: margin, gap: gap,
      w: (W - 2 * margin - (g.cols - 1) * gap) / g.cols, h: (H - 2 * margin - (g.rows - 1) * gap) / g.rows };
  }

  function fitScale(view, cells) { return Math.min(cells.w / view.width, cells.h / view.height); }

  /** 원고를 가장 크게 놓을 수 있는 용지 방향. views 전체의 배율 합으로 정한다. */
  function chooseLandscape(views, per, gapMm, sheet) {
    if (sheet === 'landscape') return true;
    if (sheet === 'portrait') return false;
    var p = cellsFor(per, false, gapMm), l = cellsFor(per, true, gapMm), sp = 0, sl = 0;
    for (var i = 0; i < views.length; i++) { sp += fitScale(views[i], p); sl += fitScale(views[i], l); }
    if (sl > sp * 1.0001) return true;
    if (sp > sl * 1.0001) return false;
    return per === 2;
  }

  function place(view, cells, slot, order) {
    var col = slot % cells.cols, row = Math.floor(slot / cells.cols);
    if (order === 'rtl') col = cells.cols - 1 - col;
    var cellX = cells.margin + col * (cells.w + cells.gap);
    var cellY = cells.H - cells.margin - (row + 1) * cells.h - row * cells.gap;
    var scale = fitScale(view, cells), w = view.width * scale, h = view.height * scale;
    return { slot: slot, col: col, row: row, x: cellX + (cells.w - w) / 2, y: cellY + (cells.h - h) / 2, w: w, h: h, scale: scale,
      cellX: cellX, cellY: cellY, cellW: cells.w, cellH: cells.h };
  }

  /** 자르는 선: 칸과 칸 사이(간격의 한가운데)를 용지 끝에서 끝까지. */
  function guideLines(cells) {
    var lines = [], i;
    for (i = 1; i < cells.cols; i++) {
      var x = cells.margin + i * cells.w + (i - 0.5) * cells.gap;
      lines.push({ x1: x, y1: 0, x2: x, y2: cells.H });
    }
    for (i = 1; i < cells.rows; i++) {
      var y = cells.H - cells.margin - i * cells.h - (i - 0.5) * cells.gap;
      lines.push({ x1: 0, y1: y, x2: cells.W, y2: y });
    }
    return lines;
  }

  /**
   * 배치 계획.
   * views: [{width,height}] (시각 기준 pt). options: normalizeOptions 참고.
   * 반환: { options, landscape(모아찍기일 때), sheets:[{ W, H, landscape, cols, rows, cells:[{src,…place}], guides:[] }] }
   */
  function plan(views, options) {
    var o = normalizeOptions(options), gapMm = GAPS[o.gap], sheets = [], i, cells, sheet;
    if (!views.length) return { options: o, sheets: sheets };
    if (o.mode === 'repeat') {
      for (i = 0; i < views.length; i++) {
        var ls = chooseLandscape([views[i]], o.per, gapMm, o.sheet);
        cells = cellsFor(o.per, ls, gapMm);
        sheet = { W: cells.W, H: cells.H, landscape: ls, cols: cells.cols, rows: cells.rows, cells: [], guides: o.guides ? guideLines(cells) : [] };
        for (var k = 0; k < o.per; k++) { var c = place(views[i], cells, k, 'ltr'); c.src = i; sheet.cells.push(c); }
        sheets.push(sheet);
      }
      return { options: o, sheets: sheets };
    }
    var landscape = chooseLandscape(views, o.per, gapMm, o.sheet);
    cells = cellsFor(o.per, landscape, gapMm);
    for (i = 0; i < views.length; i++) {
      var slot = i % o.per;
      if (slot === 0) { sheet = { W: cells.W, H: cells.H, landscape: landscape, cols: cells.cols, rows: cells.rows, cells: [], guides: [] }; sheets.push(sheet); }
      var p = place(views[i], cells, slot, o.order); p.src = i; sheet.cells.push(p);
    }
    return { options: o, landscape: landscape, sheets: sheets };
  }

  // ── 아래는 pdf-lib 가 필요한 부분(작업자에서만 호출) ──

  function pageView(PDFLib, page) {
    var raw = page.node.get(PDFLib.PDFName.of('UserUnit'));
    var unitObject = raw === undefined ? undefined : page.doc.context.lookup(raw);
    var unit = unitObject instanceof PDFLib.PDFNumber ? unitObject.asNumber() : 1;
    return viewOf(page.getMediaBox(), page.getCropBox(), page.getRotation().angle, unit);
  }

  /**
   * 주석(도장·메모·입력 양식 값 등)의 '보이는 모양'을 쪽 내용에 그려 넣고 주석은 떼어 낸다.
   * embedPage 는 주석을 옮기지 않으므로, 이 과정을 거치지 않으면 양식에 적힌 글자가 인쇄본에서 사라진다.
   * 숨김·인쇄 안 함으로 표시된 주석과 모양이 없는 주석(링크 등)은 건너뛴다.
   */
  function flattenAnnotations(PDFLib, page) {
    var N = PDFLib.PDFName.of, context = page.doc.context, flattened = 0;
    var annots = page.node.Annots();
    if (!annots) return 0;
    var num = function (v) { var o = context.lookup(v); return o instanceof PDFLib.PDFNumber ? o.asNumber() : NaN; };
    var nums = function (arr) { return arr.asArray().map(num); };
    for (var i = 0; i < annots.size(); i++) {
      try {
        var annot = annots.lookup(i);
        if (!(annot instanceof PDFLib.PDFDict)) continue;
        var flags = annot.has(N('F')) ? num(annot.get(N('F'))) : 0;
        if (flags & 2 || flags & 1) continue;                       // Hidden, Invisible
        var subtype = String(annot.get(N('Subtype')));
        if (subtype === '/Popup' || subtype === '/Link') continue;
        var ap = annot.lookup(N('AP'));
        if (!(ap instanceof PDFLib.PDFDict)) continue;
        var raw = ap.get(N('N')), normal = raw ? context.lookup(raw) : undefined;
        if (normal instanceof PDFLib.PDFDict) {                     // 체크박스처럼 상태별 모양이 있는 경우
          var state = annot.get(N('AS'));
          raw = state ? normal.get(state) : undefined;
          normal = raw ? context.lookup(raw) : undefined;
        }
        if (!(normal instanceof PDFLib.PDFStream)) continue;
        var rectArray = annot.lookup(N('Rect')), bboxArray = normal.dict.lookup(N('BBox'));
        if (!(rectArray instanceof PDFLib.PDFArray) || !(bboxArray instanceof PDFLib.PDFArray)) continue;
        var rect = nums(rectArray), bbox = nums(bboxArray), matrixArray = normal.dict.lookup(N('Matrix'));
        var m = matrixArray instanceof PDFLib.PDFArray ? nums(matrixArray) : [1, 0, 0, 1, 0, 0];
        if (rect.concat(bbox, m).some(function (v) { return !isFinite(v); })) continue;
        var xs = [], ys = [];
        [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].forEach(function (p) {
          xs.push(m[0] * p[0] + m[2] * p[1] + m[4]); ys.push(m[1] * p[0] + m[3] * p[1] + m[5]);
        });
        var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
        var bw = Math.max.apply(null, xs) - minX, bh = Math.max.apply(null, ys) - minY;
        var rx = Math.min(rect[0], rect[2]), ry = Math.min(rect[1], rect[3]);
        var rw = Math.abs(rect[2] - rect[0]), rh = Math.abs(rect[3] - rect[1]);
        if (!(bw > 0) || !(bh > 0) || !(rw > 0) || !(rh > 0)) continue;
        var sx = rw / bw, sy = rh / bh;
        var ref = raw instanceof PDFLib.PDFRef ? raw : context.register(normal);
        var name = page.node.newXObject('Ap', ref);
        page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(sx, 0, 0, sy, rx - sx * minX, ry - sy * minY),
          PDFLib.drawObject(name), PDFLib.popGraphicsState());
        flattened++;
      } catch (e) { /* 한 주석을 못 읽어도 나머지는 계속 */ }
    }
    page.node.delete(N('Annots'));
    return flattened;
  }

  /**
   * bytes(ArrayBuffer|Uint8Array) → 모아찍기/반복 배치 PDF.
   * 반환: { bytes:Uint8Array, sheets, sourcePages, landscape:[true|false…], minScale, maxScale }
   * 오류는 error.code 로 구분: ENCRYPTED | INVALID | EMPTY | GEOMETRY
   */
  async function build(PDFLib, bytes, options, onProgress) {
    var report = onProgress || function () {}, src, fail = function (code, cause) { var e = new Error(code); e.code = code; e.cause = cause; return e; };
    report({ phase: 'read', done: 0, total: 1 });
    try { src = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (error) { throw fail(/encrypt/i.test(String(error && error.message)) ? 'ENCRYPTED' : 'INVALID', error); }
    var count;
    try { count = src.getPageCount(); } catch (error) { throw fail('INVALID', error); }
    if (!count) throw fail('EMPTY');

    var out = await PDFLib.PDFDocument.create(), copied;
    try { copied = await out.copyPages(src, src.getPageIndices()); }   // 복사기 하나 → 글꼴·이미지가 한 번만 복사된다
    catch (error) { throw fail('INVALID', error); }
    var views = copied.map(function (page) { return pageView(PDFLib, page); });
    var layout = plan(views, options), o = layout.options, embedded = new Array(copied.length), N = PDFLib.PDFName.of;
    var total = layout.sheets.length, minScale = Infinity, maxScale = 0, orientations = [];

    async function embed(index) {
      if (embedded[index] !== undefined) return embedded[index];
      var page = copied[index], view = views[index], result = null;
      flattenAnnotations(PDFLib, page);
      if (page.node.Contents()) {                       // 내용이 없는 빈 쪽은 칸만 비워 둔다
        var b = view.box;
        result = await out.embedPage(page, { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }, viewMatrix(view));
        var group = page.node.get(N('Group'));          // 투명 그룹 보존
        if (group) { await result.embed(); out.context.lookup(result.ref).dict.set(N('Group'), group); }
      }
      embedded[index] = result;
      return result;
    }

    for (var s = 0; s < total; s++) {
      var sheet = layout.sheets[s], target = out.addPage([sheet.W, sheet.H]);
      orientations.push(sheet.landscape);
      for (var c = 0; c < sheet.cells.length; c++) {
        var cell = sheet.cells[c], xobject = await embed(cell.src);
        minScale = Math.min(minScale, cell.scale); maxScale = Math.max(maxScale, cell.scale);
        if (xobject) target.drawPage(xobject, { x: cell.x, y: cell.y, xScale: cell.scale, yScale: cell.scale });
        if (o.border) target.drawRectangle({ x: cell.x, y: cell.y, width: cell.w, height: cell.h, borderWidth: 0.5, borderColor: PDFLib.grayscale(0.35) });
      }
      for (var g = 0; g < sheet.guides.length; g++) {
        var line = sheet.guides[g];
        target.drawLine({ start: { x: line.x1, y: line.y1 }, end: { x: line.x2, y: line.y2 }, thickness: 0.4, color: PDFLib.grayscale(0.45), dashArray: [4, 3] });
      }
      report({ phase: 'place', done: s + 1, total: total });
      if (s % 4 === 3) await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
    out.setProducer('Moducopy PDF tools (pdf-lib 1.17.1)');
    out.setCreator('Moducopy N-up');
    report({ phase: 'save', done: total, total: total });
    var result = await out.save({ objectsPerTick: 40 });
    return { bytes: result, sheets: total, sourcePages: count, landscape: orientations, minScale: minScale, maxScale: maxScale };
  }

  return { MM: MM, A4: A4, MARGIN_MM: MARGIN_MM, GAPS: GAPS, COUNTS: COUNTS, viewOf: viewOf, viewMatrix: viewMatrix,
    normalizeOptions: normalizeOptions, gridFor: gridFor, cellsFor: cellsFor, chooseLandscape: chooseLandscape, plan: plan,
    flattenAnnotations: flattenAnnotations, build: build };
});
