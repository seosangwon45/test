/* 모아찍기 작업자: 화면이 멈추지 않도록 PDF 생성은 여기서 한다. 파일은 어디로도 전송하지 않는다. */
'use strict';
importScripts('../vendor/pdf-lib.min.js', 'layout.js');

self.onmessage = async function (event) {
  var data = event.data || {};
  try {
    if (data.type === 'probe') {
      // 암호 여부만 확인(쪽을 만들지 않는다)
      try { await PDFLib.PDFDocument.load(data.bytes, { updateMetadata: false }); self.postMessage({ type: 'probe', ok: true }); }
      catch (error) { self.postMessage({ type: 'probe', ok: false, code: /encrypt/i.test(String(error && error.message)) ? 'ENCRYPTED' : 'INVALID' }); }
      return;
    }
    if (data.type !== 'build') return;
    var result = await ModuNup.build(PDFLib, data.bytes, data.options, function (progress) {
      self.postMessage({ type: 'progress', phase: progress.phase, done: progress.done, total: progress.total });
    });
    self.postMessage({ type: 'done', bytes: result.bytes.buffer, sheets: result.sheets, sourcePages: result.sourcePages,
      landscape: result.landscape, minScale: result.minScale, maxScale: result.maxScale }, [result.bytes.buffer]);
  } catch (error) {
    // 내부(영어) 메시지는 화면으로 보내지 않는다. 코드만 보낸다.
    var code = error && typeof error.code === 'string' ? error.code : (error && error.name === 'RangeError' ? 'MEMORY' : 'FAILED');
    self.postMessage({ type: 'error', code: code });
  }
};
