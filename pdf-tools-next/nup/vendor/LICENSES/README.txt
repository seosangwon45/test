모두카피 PDF 도구 · 모아찍기 — 오픈소스 고지

이 도구는 아래 오픈소스 구성요소를 수정 없이 포함합니다. 각 라이선스 원문은 이 폴더에 있습니다.

  pdf-lib 1.17.1 (MIT)                    vendor/pdf-lib.min.js          pdf-lib-1.17.1-MIT.md
    └ 번들 포함: @pdf-lib/standard-fonts 1.0.0 (MIT)                    pdf-lib-standard-fonts-1.0.0-MIT.md
                 @pdf-lib/upng 1.0.1 (MIT)                              pdf-lib-upng-1.0.1-MIT.txt
                 pako 1.0.11 (MIT AND Zlib)                             pako-1.0.11-MIT-Zlib.txt
                 tslib 1.14.1 (0BSD)                                    tslib-1.14.1-0BSD.txt
  PDF.js (pdfjs-dist) 5.4.624 (Apache-2.0) vendor/pdfjs/pdf.min.js, pdf.worker.min.js
                                                                        pdfjs-dist-5.4.624-Apache-2.0.txt
    └ legacy 빌드의 pdf.min.mjs / pdf.worker.min.mjs 를 확장자만 .js 로 바꿔 실었습니다(내용 동일).
    └ cmaps/ (Adobe CMap, BSD-3-Clause)                                 vendor/pdfjs/cmaps/LICENSE
    └ standard_fonts/ (Foxit 글꼴, Liberation 글꼴)                      vendor/pdfjs/standard_fonts/LICENSE_FOXIT, LICENSE_LIBERATION
    └ wasm/ (OpenJPEG, JBIG2, QCMS)                                     vendor/pdfjs/wasm/LICENSE_*
    └ iccs/                                                             vendor/pdfjs/iccs/LICENSE

글꼴: 화면 글꼴 파일은 싣지 않았습니다. 쇼핑몰과 같은 Pretendard 를 우선 지정하고, 없으면 기기의 한글 글꼴로 표시합니다.

이 목록은 기술적 사실을 적은 것이며 법률 검토를 대신하지 않습니다.
