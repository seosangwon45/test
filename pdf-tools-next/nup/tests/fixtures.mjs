// 합성 PDF 만들기 (실제 고객 파일을 쓰지 않는다). vendor/pdf-lib.min.js 를 그대로 사용.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const PDFLib = require(path.join(here, '..', 'vendor', 'pdf-lib.min.js'));
const { PDFDocument, StandardFonts, rgb, degrees, PDFName } = PDFLib;
export const mm = v => v * 72 / 25.4;
export const A4P = [mm(210), mm(297)], A4L = [mm(297), mm(210)];
const COLORS = [[.82, .1, .18], [.07, .4, .7], [.05, .5, .3], [.75, .5, 0], [.45, .2, .6], [.1, .55, .6], [.6, .3, .1], [.3, .3, .35]];

/**
 * specs: [{ size:[w,h], rot, crop:[x,y,w,h], media:[x,y,w,h], unit, empty }]
 * 쪽마다 큰 번호 "P{n}" 과 모서리 표식 "TL{n}"(시각 기준 왼쪽 위 부근) · "BR{n}"(오른쪽 아래 부근)을 그린다.
 * 표식은 회전하지 않은 쪽 좌표에 그리므로, 시각 위치는 테스트가 pdf.js 로 원본을 읽어 구한다.
 */
export async function makePdf(specs) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.HelveticaBold);
  specs.forEach((s, i) => {
    const n = i + 1, page = doc.addPage(s.size);
    if (s.media) page.setMediaBox(...s.media);
    if (s.crop) page.setCropBox(...s.crop);
    if (s.rot) page.setRotation(degrees(s.rot));
    if (s.unit) page.node.set(PDFName.of('UserUnit'), doc.context.obj(s.unit));
    if (s.empty) return;
    const c = page.getCropBox(), col = COLORS[i % COLORS.length], color = rgb(...col);
    page.drawRectangle({ x: c.x + 6, y: c.y + 6, width: c.width - 12, height: c.height - 12, borderWidth: 3, borderColor: color });
    page.drawRectangle({ x: c.x + 6, y: c.y + c.height - 46, width: c.width - 12, height: 40, color });   // 위쪽 띠(방향 확인용)
    const big = Math.min(c.width, c.height) * .34;
    page.drawText(`P${n}`, { x: c.x + c.width / 2 - font.widthOfTextAtSize(`P${n}`, big) / 2, y: c.y + c.height / 2 - big / 3, size: big, font, color });
    page.drawText(`TL${n}`, { x: c.x + 24, y: c.y + c.height - 80, size: 14, font, color: rgb(0, 0, 0) });
    page.drawText(`BR${n}`, { x: c.x + c.width - 70, y: c.y + 24, size: 14, font, color: rgb(0, 0, 0) });
  });
  return Buffer.from(await doc.save());
}
const many = (n, spec) => Array.from({ length: n }, () => ({ ...spec }));

export async function buildFixtures() {
  const f = {};
  f.a4p8 = await makePdf(many(8, { size: A4P }));
  f.a4p5 = await makePdf(many(5, { size: A4P }));
  f.a4l3 = await makePdf(many(3, { size: A4L }));
  f.mixed = await makePdf([{ size: A4P }, { size: [mm(420), mm(297)] }, { size: [400, 400] }, { size: [612, 792] }, { size: A4L }]);
  f.rot90 = await makePdf([{ size: A4P, rot: 90 }, { size: A4P, rot: 90 }, { size: A4P, rot: 270 }, { size: A4P, rot: 180, crop: [30, 40, 480, 700] },
    { size: A4P, rot: 90, crop: [20, 50, 500, 640] }]);
  f.one = await makePdf([{ size: A4P }]);
  f.p60 = await makePdf(many(60, { size: A4P }));
  f.odd = await makePdf([{ size: [300, 400], media: [100, 200, 300, 400] }, { size: [300, 400], unit: 2 }, { size: A4P, empty: true }, { size: A4P, crop: [-20, -20, 640, 900] }]);
  // 입력 양식에 적힌 값(주석)이 인쇄본에 남는지 확인용
  {
    const doc = await PDFDocument.create(), page = doc.addPage(A4P), font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('FORM PAGE', { x: 60, y: 760, size: 20, font });
    const field = doc.getForm().createTextField('name'); field.setText('FIELDVALUE'); field.addToPage(page, { x: 60, y: 600, width: 300, height: 40, font });
    doc.addPage(A4P).drawText('SECOND', { x: 60, y: 760, size: 20, font });
    f.form = Buffer.from(await doc.save());
  }
  f.encUser = fs.readFileSync(path.join(here, 'fixtures', 'encrypted-user.pdf'));
  f.encOwner = fs.readFileSync(path.join(here, 'fixtures', 'encrypted-owner.pdf'));
  f.fake = Buffer.from('이 파일은 PDF가 아닙니다. 확장자만 pdf 인 텍스트 파일입니다.\n'.repeat(20), 'utf8');
  f.broken = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('garbage '.repeat(400))]);
  return f;
}
