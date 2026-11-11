#!/usr/bin/env bash
# 경량화 이미지와 .htaccess 설정을 서버에 올린다. GitHub Actions에서 실행한다.
# 필요한 환경변수: FTP_HOST FTP_USER LFTP_PASSWORD
# 선택: FTP_PROTOCOL(ftp|ftps|sftp, 기본 ftp) FTP_PORT FTP_WEBROOT(기본 .) SITE_URL
#       APPLY_IMAGES(기본 true) APPLY_HTACCESS(기본 false) DRY_RUN(기본 false)
set -euo pipefail

: "${FTP_HOST:?FTP_HOST 시크릿이 없습니다}"
: "${FTP_USER:?FTP_USER 시크릿이 없습니다}"
: "${LFTP_PASSWORD:?FTP_PASSWORD 시크릿이 없습니다}"
export LFTP_PASSWORD
PROTO="${FTP_PROTOCOL:-ftp}"; [ -n "$PROTO" ] || PROTO=ftp
WEBROOT="${FTP_WEBROOT:-.}"; [ -n "$WEBROOT" ] || WEBROOT=.
SITE_URL="${SITE_URL:-https://moducopy.co.kr}"
APPLY_IMAGES="${APPLY_IMAGES:-true}"; APPLY_HTACCESS="${APPLY_HTACCESS:-false}"; DRY_RUN="${DRY_RUN:-false}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/optimized-images"
WORK="${WORK_DIR:-$(mktemp -d)}"; BACKUP="$WORK/backup"; mkdir -p "$BACKUP"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SENTINEL="theme/eb4_basic/skin/item/book/img/item_info_01.jpg"

case "$PROTO" in ftp|ftps|sftp) ;; *) echo "FTP_PROTOCOL은 ftp, ftps, sftp 중 하나여야 합니다"; exit 1;; esac
URL="$PROTO://$FTP_HOST"; [ -n "${FTP_PORT:-}" ] && URL="$URL:$FTP_PORT"

run_lftp() {
  lftp --env-password -u "$FTP_USER" "$URL" -e "set cmd:fail-exit yes; set net:max-retries 2; set net:timeout 30; set ftp:ssl-allow $([ "$PROTO" = ftp ] && echo no || echo yes); set sftp:auto-confirm yes; set xfer:clobber on; cd \"$WEBROOT\"; $1; bye"
}

site_code() { curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' --max-time 30 "$SITE_URL/" || true; }

echo "== 1. 웹루트 확인"
if ! run_lftp "cls -1 \"$SENTINEL\"" >/dev/null 2>&1; then
  echo "웹루트($WEBROOT)에서 $SENTINEL 을 찾지 못했습니다. FTP_WEBROOT 시크릿을 사이트 루트 경로로 지정하세요. 아무것도 변경하지 않았습니다."
  exit 1
fi
echo "확인됨"

if [ "$APPLY_IMAGES" = true ]; then
  echo "== 2. 이미지: 원본 백업 후 더 작은 파일만 교체"
  cd "$SRC"; changed=0; skipped=0
  while IFS= read -r f; do
    f="${f#./}"; mkdir -p "$BACKUP/$(dirname "$f")"
    if ! run_lftp "get \"$f\" -o \"$BACKUP/$f\"" >/dev/null 2>&1; then
      echo "건너뜀(서버에 없음): $f"; skipped=$((skipped+1)); continue
    fi
    remote=$(stat -c %s "$BACKUP/$f"); local_size=$(stat -c %s "$f")
    if [ "$remote" -le "$local_size" ]; then skipped=$((skipped+1)); continue; fi
    if [ "$DRY_RUN" = true ]; then echo "교체 예정: $f ($remote -> $local_size)"; else
      run_lftp "put \"$f\" -o \"$f\"" >/dev/null
      echo "교체: $f ($remote -> $local_size)"
    fi
    changed=$((changed+1))
  done < <(find . -type f | sort)
  echo "이미지 교체 $changed개, 건너뜀 $skipped개"
  cd "$HERE"
fi

if [ "$APPLY_HTACCESS" = true ]; then
  echo "== 3. .htaccess: 압축·캐시 설정 추가"
  : > "$WORK/htaccess.orig"
  run_lftp "get .htaccess -o \"$WORK/htaccess.orig\"" >/dev/null 2>&1 || echo "기존 .htaccess 없음, 새로 만듭니다"
  if grep -q "# BEGIN mc-perf" "$WORK/htaccess.orig"; then
    echo "이미 적용되어 있어 건너뜁니다"
  elif [ "$DRY_RUN" = true ]; then
    echo "추가 예정 (dry run)"
  elif [ "$(site_code)" != 200 ]; then
    echo "적용 전 사이트 응답이 200이 아니어서 .htaccess는 건드리지 않았습니다."; exit 1
  else
    { cat "$WORK/htaccess.orig"; [ -s "$WORK/htaccess.orig" ] && echo; echo "# BEGIN mc-perf"; grep -v '^# moducopy' "$HERE/htaccess-snippet.txt"; echo "# END mc-perf"; } > "$WORK/htaccess.new"
    [ -s "$WORK/htaccess.orig" ] && run_lftp "put \"$WORK/htaccess.orig\" -o \".htaccess.bak-perf-$STAMP\"" >/dev/null
    run_lftp "put \"$WORK/htaccess.new\" -o .htaccess" >/dev/null
    code=$(site_code)
    if [ "$code" != 200 ]; then
      echo "적용 후 사이트 응답이 $code 입니다. 원래 .htaccess로 되돌립니다."
      if [ -s "$WORK/htaccess.orig" ]; then run_lftp "put \"$WORK/htaccess.orig\" -o .htaccess" >/dev/null; else run_lftp "rm .htaccess" >/dev/null; fi
      exit 1
    fi
    echo "적용됨, 사이트 응답 200. 서버 백업: .htaccess.bak-perf-$STAMP"
  fi
fi

echo "== 완료"
