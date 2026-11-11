# test

실험과 연습용으로 쓰는 저장소입니다.

## 작업 방식

- `main`에 직접 커밋하지 않고, 작업마다 브랜치를 만들어 풀 리퀘스트로 올립니다.
- 브랜치 이름은 작업 내용을 알 수 있게 짓습니다 (예: `claude/readme-setup`).
- 풀 리퀘스트는 초안으로 열고, 확인이 끝나면 병합합니다.

## 현재 상태

사이트 코드는 아직 없고, 속도 개선용 산출물만 `perf/`에 있습니다.

## moducopy.co.kr 상품 페이지 속도 개선

대상: `shop/item.php` (책자 상품 페이지). 측정값(2026-11-11, PC 크롬): 로딩 약 24초, 전송 26MB, 요청 293개.

### 1단계 — 소스 없이 서버에 바로 적용 (이 저장소에 준비됨)

- `perf/optimized-images/`: 무거운 이미지 49개의 경량화본(19.2MB → 4.7MB). 폴더 구조가 서버 웹루트와 같으므로, 원본을 백업한 뒤 웹루트에 덮어씁니다.
- `perf/htaccess-snippet.txt`: gzip 압축과 정적 파일 캐시 30일. 웹루트 `.htaccess`에 추가합니다 (`mod_deflate`, `mod_expires` 필요).

### 자동 배포 (권장)

1단계를 손으로 올리는 대신 GitHub Actions로 한 번에 적용할 수 있습니다.

1. 저장소 Settings → Secrets and variables → Actions 에 `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` 등록. 필요하면 `FTP_PORT`, `FTP_WEBROOT`(사이트 루트 경로, 예: `www`)도 등록
   - 접속 방식 `FTP_PROTOCOL`: 기본은 `ftps`(TLS 강제, 인증서 검증). `sftp`를 쓰면 `SFTP_KNOWN_HOSTS`(서버 호스트 키, `ssh-keyscan 호스트` 결과 한 줄)도 등록. 호스팅이 암호화를 지원하지 않을 때만 `ftp-plain`(비밀번호 평문 전송)
2. Actions 탭 → "속도 개선 배포" → Run workflow

동작: 웹루트가 맞는지 확인 → 원본 이미지를 내려받아 백업(실행 결과의 `original-images-backup`, 90일 보관) → 서버 파일이 더 클 때만 교체 → `.htaccess` 원본을 서버에 `.htaccess.bak-perf-날짜`로 남기고 설정 추가 → 사이트 응답이 200이 아니면 `.htaccess`를 자동으로 되돌림. 여러 번 실행해도 안전합니다. `dry_run`을 켜면 변경 없이 바뀔 내용만 보여 줍니다.

### 2단계 — 테마 소스 수정 (소스가 올라와야 가능)

아래 파일을 서버와 같은 경로로 이 저장소에 올리면 브랜치에서 수정합니다.

- `theme/eb4_basic/skin/item/book/` 전체
- `theme/eb4_basic/head.sub.php`, `tail.sub.php` 및 head·tail 계열 파일

수정할 내용:

1. 페이지 진입 시 반복되는 견적 옵션 AJAX 89회 줄이기 (`book_bind_thickness_Data2.php` 22회 등)
2. 중복 로딩 제거: `slick.min.js` 2회, `quote-print.js` 2회, `sweetalert2.min.js` 2회, `viewimageresize.js` 4회
3. `<head>`의 동기 스크립트 18개를 지연 로딩으로 전환, 상품 페이지에서 쓰지 않으면 `AXJ.all.js`(1.9MB) 제외
4. 상세 이미지에 width/height를 넣어 지연 로딩이 실제로 동작하게 하기
5. 유튜브 iframe을 클릭 시 로딩으로 변경

### 주의

`data/` 폴더와 `dbconfig.php`는 올리지 않습니다 (`.gitignore`에 등록됨). 이 저장소는 공개 상태이므로 소스를 올리기 전에 비공개 전환을 권합니다.
