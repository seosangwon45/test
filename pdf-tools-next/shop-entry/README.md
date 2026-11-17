# shop-entry/ — 쇼핑몰에서 PDF 도구로 들어가는 입구

| 파일 | 역할 |
|---|---|
| `main-block.html` | 메인 화면 "인쇄 파일 준비" 블록 교체용 조각 (인기 작업 6개 + 전체 도구 보기 + 글꼴·디자인 도구) |
| `item-helper.html` | 상품 상세 "첨부파일" 칸 아래 한 줄 도우미 |
| `mc-tools-entry.css` | 두 조각의 공용 스타일. 모든 선택자가 `.mcte` 로 시작 |
| `preview.html` | 미리보기(밝은/어두운 테마 전환). 쇼핑몰에 올리지 않음 |
| `shots/` | 점검 스크린샷. 올리지 않음 |

스크립트는 없습니다. 팝업 창을 쓰지 않고 모두 일반 링크입니다.

## 지금 운영 중인 블록 (2026-11-17 읽기 전용 확인)
메인 화면 HTML에 아래 순서로 들어 있습니다.

1. 주석 `<!-- mc-resource-links: internal PDF tools with a collapsed shortlist -->`
2. `<style>` — `#mc-resource-links …` 규칙 묶음(`.rl-inner`, `.rl-quick`, `.mc-pdf-shop-menu` 등)
3. `<section id="mc-resource-links" aria-labelledby="rl-title">` — "PDF 편집"·"PDF 변환" 버튼 2개와 접힌 "글꼴·디자인 도구"
4. 섹션 안의 `<script id="mc-pdf-shop-popup">` — 버튼을 팝업 창으로 열고, 막히면 경고창
5. 섹션 뒤의 `<script id="mc-resource-tool-window">` — 외부 링크(눈누·Canva)를 팝업 창으로 열기

- 기록상 테마 파일은 `theme/eb4_basic/shop/mc-resource-links.block.php` 입니다(서버 파일은 직접 확인하지 못함. 위 주석 문구로 찾을 수 있음).
- 이 블록은 상품 상세·카테고리 화면 HTML에도 들어 있지만 묶음 CSS의 아래 규칙으로 숨겨져 있습니다.
  `body.mc-category-list-page #mc-resource-links, body.mc-product-page #mc-resource-links, body.mc-fold-first-page #mc-resource-links{display:none!important}`
- 묶음 CSS·JS에서 `mc-resource-links` 를 쓰는 곳은 이 숨김 규칙 하나뿐이었습니다.
- 쇼핑몰에는 어두운 테마(`html[data-mc-shop-theme="dark"]`)가 있습니다.

## 메인 블록 교체 방법
1. `mc-resource-links.block.php` 를 `mc-resource-links.block.php.bak-20261117` 로 복사해 둡니다.
2. `mc-tools-entry.css` 를 `theme/eb4_basic/css/` 에 올립니다.
3. 블록 파일에서 위 1~5(주석, `<style>`, `<section>`, 스크립트 2개)를 모두 지우고 `main-block.html` 내용을 넣습니다.
   - 조각 첫머리의 `<link rel="stylesheet" href="/theme/eb4_basic/css/mc-tools-entry.css?v=…">` 는 테마 방식에 맞게 `<?php echo G5_THEME_URL ?>/css/…` 로 바꾸거나, head에서 한 번만 불러오게 옮겨도 됩니다.
   - `section` 의 `id="mc-resource-links"` 는 일부러 그대로 뒀습니다. 기존 숨김 규칙이 계속 적용되어 상품·카테고리 화면에서 지금처럼 보이지 않습니다. 같은 숨김 규칙을 `mc-tools-entry.css` 에도 넣어 두었습니다.
4. 묶음 캐시(`data/mc-bundle`)를 쓰는 화면이면 캐시를 새로 만듭니다.
5. 메인 화면에서 6개 타일과 "전체 도구 보기"를 눌러 확인합니다.

## 상품 상세 도우미 넣는 방법
- 상품 상세의 주문 표에는 `<th scope="row">첨부파일</th>` 행이 있고, 그 칸에 `Dropbox 업로드` 버튼(`onclick="openDropboxPopup()"`)이 있습니다. 같은 행이 화면 크기별로 여러 번 들어 있으니(확인한 상품에서 3곳) 각각의 버튼 `</a>` 바로 뒤에 `item-helper.html` 내용을 넣습니다.
- 어느 스킨 파일인지는 확인하지 못했습니다. `openDropboxPopup` 으로 검색하면 찾을 수 있습니다.
- `aria-labelledby="mcte-helper-title"` 의 id가 한 화면에 여러 번 생기므로, 여러 곳에 넣을 때는 id 끝에 번호를 붙입니다(`mcte-helper-title-2` 등).
- 상품 상세에는 `mc-tools-entry.css` 가 따로 불려야 합니다(head 또는 조각 위에 `<link>` 한 줄).
- 도우미 링크는 새 탭으로 엽니다. 고르던 주문 옵션이 사라지지 않게 하기 위해서입니다.
- 휴대폰에서는 칸 너비가 약 200px이라 버튼이 한 줄에 하나씩 놓입니다. 더 낮게 보이게 하려면 표 아래에 `<tr><td colspan="2">` 한 행으로 넣는 방법이 있습니다.

## 링크가 가는 곳
| 항목 | 주소 |
|---|---|
| 전체 도구 보기 / 전체 도구 | `/pdf-tools/start/` |
| PDF 합치기 | `/pdf-tools/basic/?job=merge` (편집 화면 딥링크 패치 전에도 기본이 합치기라 그대로 맞음) |
| 2쪽 · 4쪽 모아찍기, 같은 쪽 여러 개 찍기 | `/pdf-tools/nup/?job=nup2` · `nup4` · `repeat2` (**`nup/` 배포 후 열림**) |
| 워드·엑셀 → PDF, 사진 → PDF | `/pdf-tools/converter/` |
| 눈누, Canva | 외부 사이트, 새 탭 |

## 적용 순서 (전체)
1. `nup/` 배포 → 주소로 직접 확인
2. `start/` 배포 → 주소로 직접 확인
3. `mc-tools-entry.css` 올리기 → 메인 블록 교체 → 상품 상세 도우미
4. (나중) 편집 화면 딥링크 패치

1·2가 끝나기 전에 3을 먼저 하면 타일 4개와 "전체 도구 보기"가 없는 주소로 갑니다.

## 되돌리기
- 메인 블록: 백업해 둔 `mc-resource-links.block.php.bak-20261117` 을 원래 이름으로 되돌리고 캐시를 새로 만듭니다.
- 도우미: 넣은 `<!-- mc-tools-entry … -->` ~ `<!-- /mc-tools-entry -->` 사이를 지웁니다.
- `mc-tools-entry.css` 는 남겨 둬도 `.mcte` 가 없는 화면에는 영향이 없습니다.

## 어두운 테마
`html[data-mc-shop-theme="dark"]` 일 때 색을 바꿉니다. 운영 메인 화면에 끼워 본 결과, 어두운 테마에서는 쇼핑몰 쪽 규칙이 타일 글자색을 연한 파랑(`rgb(156,212,255)`)으로 바꿉니다. 읽는 데는 문제가 없어 그대로 뒀습니다.
