// 테스트·미리보기용 정적 서버. 운영 서버에 권장하는 보안 헤더(README 참고)를 그대로 붙여 CSP 위반도 함께 검증한다.
//   node tests/serve.mjs [port]   → http://127.0.0.1:port/pdf-tools/nup/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PREFIX = '/pdf-tools/nup/';
export const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; " +
  "worker-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png' };

export function createServer() {
  return http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(PREFIX)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    let rel = url.slice(PREFIX.length) || 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || rel.startsWith('tests/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}
export function listen(port = 0) {
  const server = createServer();
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}${PREFIX}` })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { base } = await listen(Number(process.argv[2]) || 8787);
  console.log('열기:', base);
}
