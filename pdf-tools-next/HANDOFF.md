# 모두카피 PDF 도구 — 로컬(PC) 작업 인계서

작성: 2026-11-17, 클라우드 세션 "PDF 변환 편집 서비스"에서 PC 세션으로 넘기는 문서입니다.
클라우드에서는 서버·PC 파일·구글 드라이브에 닿지 못해 여기까지만 했고, 나머지는 PC에서 이어갑니다.

## 1. 목표

손님이 https://www.ilovepdf.com/ko 처럼 쉽게 쓰는 PDF 서비스를 모두카피 쇼핑몰(https://moducopy.co.kr/shop/)에서 제공한다.
"할 일 고르기 → 파일 올리기 → 바로 받기"의 쉬움과 기능 범위가 기준이고, 모두카피만의 강점(모아찍기, 인쇄 주문 연결)을 얹는다.
모양은 ilovepdf를 베끼지 않고 모두카피 로고·색·글꼴로 만든다.

대표님이 확정한 것:
- 시안 방향 그대로 진행
- 모아찍기는 두 가지 모두 필요: ① 여러 쪽을 한 장에 2쪽·4쪽 모으기 ② 같은 쪽을 한 장에 2개·4개 찍기

## 2. 현재 운영 상태 (2026-11-17 공개 화면 검수, 익명 방문자·합성 파일만 사용)

기존 도구는 지워지지 않았고 모두 열린다.

| 주소 | 내용 | 검수 결과 |
|---|---|---|
| `/pdf-tools/` | 작업실(허브) | 카드 3개. 쇼핑몰에서 여기로 오는 링크가 거의 없음 |
| `/pdf-tools/basic/` | PDF 편집 13개 작업 (pdf-lib 1.17.1, 브라우저 처리) | 13개 모두 동작 |
| `/pdf-tools/converter/` | 파일 → PDF 변환 (서버 처리, `api.php`) | PDF·JPEG·PNG·TIFF·DOCX·XLSX·PPTX·ODT·RTF 9개 통과, 한글 정상 |
| `/pdf-tools/print/` | 인쇄용 PDF 준비: 합치기, 2쪽·4쪽 모아찍기, 쪽 번호 (pdf-lib + PDF.js 5.4.624) | 합치기 정상, 모아찍기는 아래 버그 |

### 고쳐야 할 버그 (재현 확인됨)

1. **[치명] 모아찍기 기본값**: `/pdf-tools/print/`의 2쪽·4쪽 탭에 A4 세로 파일을 넣고 그대로 실행하면 원본 그대로 나오는데 "완성 100%"가 뜬다. 접힌 "모아찍기 적용 원고" 안의 기본값이 "가로 원고만 · 세로는 유지"이기 때문. "모든 페이지"로 바꿔도 용지 기본이 세로라 2쪽 배율이 45.6%로 작다(가로 용지면 64.5%).
2. **[높음] 순서 변경에서 쪽이 조용히 사라짐**: `/pdf-tools/basic/` 페이지 순서 변경에 6쪽 파일을 넣고 "3,1,2"만 입력하면 경고 없이 3쪽짜리가 "작업 완료"로 나온다.
3. **암호 PDF에 영어 개발자 오류 노출**: 편집(`pdf-worker.js:155`에서 `PDFDocument.load`가 먼저 예외)과 인쇄 준비 모두.
4. **쪽 번호 결과가 실행마다 다름**: `/pdf-tools/print/` 쪽 번호 탭에 3쪽·2쪽·1쪽 파일 3개를 넣고 반복 실행하면 일부 면이 95.7%로 축소되는 경우와 아닌 경우가 섞인다(8회 중 3회).
5. **"원본·설정 함께 담기"(`keepJob`)가 기본 체크**: 받은 PDF 안에 원본 파일이 통째로 첨부된다. 기본값을 끄는 것을 권함.
6. **편집 결과 링크가 30초 뒤 사라지고 올린 파일도 비워짐.**
7. **한도 안내가 비현실적**: 편집 "최대 2.5GB"(`upload-selection.js:40`)는 메모리를 입력의 약 3배 쓰므로 실제로는 PC 300~500MB, 모바일 50~100MB 추정. 변환은 1GB 안내인데 화면이 180초에 끊긴다.
8. 변환 화면: 작은 파일이 "0.0MB"로 표시, PC에서 "사용 가능" 표시가 세로로 깨짐, HWP·구형 DOC 손님에게 대안 안내 없음(구형 DOC는 "OLE 매크로…" 개발자 문구).

### 손님이 못 쓰는 이유 (동선)

- 쇼핑몰 입구가 첫 화면의 버튼 2개(편집, 변환)뿐이고 약 1.3화면 아래에 있다. 팝업 창(`window.open`)으로 열린다.
- 모아찍기(`/pdf-tools/print/`)는 쇼핑몰에서 직접 갈 수 없다. 편집·변환 화면 메뉴에도 없다.
- 상품·카테고리 화면에는 같은 블록(`section#mc-resource-links`)이 숨김 처리돼 있다. 파일 올리기 버튼 옆에 도구 안내가 없다.
- 편집·변환 화면은 사용방법·면책문 뒤에 파일 선택이 있다(편집은 모바일에서 3화면 아래).
- 세 도구의 머리글·색 테마가 제각각이고(편집·인쇄 준비는 기본이 어두운 화면), 결과 화면에 주문으로 가는 링크가 없다.
- 작업으로 바로 가는 주소(`?job=`, `#`)를 읽지 않는다.
- 부수 발견: 공개 파일업로드 게시판(`/bbs/board.php?bo_table=upload`) 맨 위에 광고성 글이 있고 고객 이름·파일 제목이 목록에 노출된다. 대표님 확인 필요.

## 3. 이 저장소에 만들어 둔 것 (`pdf-tools-next/`)

운영 사이트에는 아직 아무것도 올리지 않았다. 각 폴더의 `README.md`에 올리는 법과 되돌리는 법이 있다.

| 폴더 | 내용 | 검증 |
|---|---|---|
| `nup/` | 새 모아찍기 도구. 여러 쪽 모아찍기(2·4쪽), 같은 쪽 여러 개 찍기(2·4·8개). 정적 페이지, 브라우저 처리, 서버 코드 불필요. 바로 가기 주소 `?job=nup2|nup4|repeat2|repeat4|repeat8` | `node tests/run.mjs` 78개 통과 (Chromium, `LANG=C.UTF-8` 필요) |
| `start/` | 작업 이름으로 고르는 도구 모음 화면, 작업 이름 검색 | PC 1280·모바일 390 점검 |
| `shop-entry/` | 쇼핑몰 첫 화면 블록 교체용 `main-block.html`, 상품 화면 도우미 `item-helper.html`, `mc-tools-entry.css` | 운영 화면에 브라우저 안에서만 끼워 확인 |

확인하지 못한 것: Safari, Firefox, 삼성 인터넷, 카카오톡 안 브라우저, 실제 휴대폰, 수십 MB 이상의 실제 파일, 실제 Apache에서의 동작.

디자인 기준(쇼핑몰에서 추출): 크림슨 `#B5122E`, 버튼 크림슨 `#AA1836`, 네이비 `#182336`, 3색 띠 `#B5122E`·`#25A1B0`·`#E8BD25`, 글꼴 Pretendard, 버튼 높이 44px, 모서리 8px. 밝은 테마 하나만 쓴다.

주문 연결 대상: 칼라·흑백 출력 `/shop/item.php?it_id=1441618748`, 책 만들기 `/shop/item.php?it_id=1437511967`.

## 4. PC에 남아 있는 자료 (PC 세션이 경로·파일명·날짜만 확인, 내용은 아직 안 읽음)

기준 폴더: `C:\Users\USER\Documents\Codex\`

- **주 소스**: `2026-10-04\https-accounts-google-com-signin-oauth\work\pdf-tools\` (604개, 최근 10-20)
  - `client-imposition\` — 인쇄 준비(모아찍기) 엔진 원본으로 추정. `src\nup-plan.js`, test, dist, scripts
  - `client-imposition-ui\` — 인쇄 준비 화면
  - `client-basic\` — 편집 도구
  - `converter\` — 변환 서버 소스 (`api.php`, `runner.py`, `service.py`, `hwpx_preflight.py`, `legacy_preflight.py`, `runtime-inventory.json`)
  - `docs\superpowers\specs\2026-10-08-nup-full-feature-design.md`, `docs\superpowers\plans\2026-10-08-nup-full-feature-implementation.md`
  - `docs\operations\improvement-ledger.jsonl`, `.superpowers\sdd\2026-10-08-nup-full-feature-implementation\progress.md` (보고가 7단계 중 5단계까지만 있음)
- **변환기 최신 사본과 반영 기록**: `2026-11-02\https-moducopy-co-kr-pdf-tools-2\`
- **운영본 되읽기 사본(가장 최신)**: `2026-11-10\https-moducopy-co-kr-pdf-tools\work\` (`READBACK.json` 등)
- **모아찍기 배포 후보·배포 스크립트**: `2026-09-29\referenced-chatgpt-conversation-this-is-an-3\release-candidates\`, `deployment\`. `IMPOSITION-DO-NOT-DEPLOY.txt`가 붙은 후보 2건 있음
- **도구 허브 목록**: `2026-09-29\referenced-chatgpt-conversation-this-is-an\work\moducopy-tools-hub-20261020\`
- **이어서 할 일 문서로 추정**: `2026-10-09\new-chat\work\pdf-usage-feedback-20261021\CONTINUE.ko.md`
- **서버 접속 절차 문서**: `C:\Users\USER\.claude\codex-handoff\MODUCOPY-SSH.ko.md` (SSH 설정과 키는 `C:\Users\USER\.ssh\`에 있음)
- 구글 드라이브: PC 크롬으로 검색한 결과 PDF 도구 관련 파일 0건

서버(기존 기록, 현재 상태는 재확인 필요): 웹루트 `/home/moducopy/public_html`, PHP 7.4, 테마 `theme/eb4_basic`, 첫 화면 블록은 `theme/eb4_basic/shop/mc-resource-links.block.php`로 기록됨.

## 5. PC에서 이어서 할 일

원칙: 운영 파일을 바꾸기 전에 반드시 백업하고, 가능한 한 시험 위치에서 먼저 확인하고, 운영에 반영하기 직전에 대표님께 확인받는다. 시험은 합성 파일만 쓰고 고객 파일·개인정보는 건드리지 않는다. 비밀번호·키는 문서나 저장소에 넣지 않는다.

1. **자료 읽기**: 4번의 설계서·계획·진행 기록·`CONTINUE.ko.md`를 읽고, 무엇이 미완성으로 남았는지와 "배포하지 말 것" 표시의 이유를 정리한다.
2. **서버 현황 조회(읽기만)**: `/pdf-tools/` 파일 목록, 백업 위치, 변환 서비스 구성. PC 사본과 운영본이 같은지 대조한다.
3. **로컬에서 띄우기**: `nup/`, `start/`를 PC에서 정적 서버로 띄워 대표님이 직접 눌러볼 수 있게 한다. 실제 휴대폰과 사파리·삼성 인터넷에서도 확인한다.
4. **엔진 결정**: `client-imposition` 원본을 확인한 뒤, 기존 엔진의 기본값을 고쳐 새 화면에 붙일지 `nup/`의 새 엔진을 쓸지 비교해 정한다. 기존 엔진은 회전·여백 처리가 검증돼 있다.
5. **서버 반영(순서 지킬 것)**: ① `nup/` → `/pdf-tools/nup/` ② `start/` → `/pdf-tools/start/` ③ 첫 화면 블록 교체 ④ 상품 화면 도우미 ⑤ 편집 화면 `?job=` 패치. ①②는 새 폴더라 덮어쓰는 파일이 없다.
6. **기존 도구 버그 수정**: 2번의 버그 목록. 특히 모아찍기 기본값, 순서 변경 쪽 누락, 암호 PDF 문구, `keepJob` 기본값.
7. **공통 머리글과 밝은 테마 통일, 면책문을 파일 선택 아래 접힌 칸으로, 결과 화면에 주문 링크.** 면책 문구를 줄일지는 대표님 판단.
8. **새 기능**: 브라우저만으로 가능 — PDF → JPG, 사진 여러 장 → PDF, 썸네일로 순서·삭제·회전, 워터마크, 소책자 배치. 서버 필요 — 용량 줄이기, 암호 풀기·걸기, 구형 DOC·XLS·PPT, 한글(HWP) 변환(LibreOffice + H2Orestart, "미리보기 품질" 고지 필수). 권하지 않음 — PDF → 워드·엑셀, 개인정보 가리기, 전자서명.

## 6. 참고

- 초안 풀 리퀘스트: https://github.com/seosangwon45/test/pull/3 (브랜치 `claude/pdf-tools-customer-flow`)
- 이 저장소는 공개 저장소다. 서버 측 소스, 접속 정보, 고객 자료는 올리지 않는다.
- Notion "모두카피 매일 개선 프로젝트" 페이지에 10월 기준 배포 기록과 QA 기준이 있다.
