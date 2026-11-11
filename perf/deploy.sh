#!/usr/bin/env bash
# 경량화 이미지와 .htaccess 설정을 서버에 올린다. GitHub Actions에서 실행한다.
# 필요한 환경변수: FTP_HOST FTP_USER LFTP_PASSWORD
# 선택: FTP_PROTOCOL FTP_PORT FTP_WEBROOT(기본 .) SITE_URL
#   FTP_PROTOCOL=ftps(기본): FTP 위에서 TLS를 강제하고 서버 인증서를 검증한다.
#   FTP_PROTOCOL=sftp: SFTP_KNOWN_HOSTS(서버 호스트 키, known_hosts 형식 한 줄)가 있어야 한다.
#   FTP_PROTOCOL=ftp-plain: 암호화 없는 FTP. 비밀번호가 평문으로 전송되므로 다른 방법이 없을 때만 쓴다.
#       APPLY_IMAGES(기본 true) APPLY_HTACCESS(기본 false) DRY_RUN(기본 false)
#       CREATE_HTACCESS(기본 false): 서버에 .htaccess가 없는 것이 확실할 때만 true
#
# 안전 규칙
#   - 서버 파일은 임시 이름으로 올려 되받아 비교한 뒤에만 제자리로 옮긴다. 전송이 끊겨도 원본은 그대로다.
#   - 내려받기에 실패한 파일은 "없는 파일"로 간주하지 않고 건드리지 않는다.
set -euo pipefail

: "${FTP_HOST:?FTP_HOST 시크릿이 없습니다}"
: "${FTP_USER:?FTP_USER 시크릿이 없습니다}"
: "${LFTP_PASSWORD:?FTP_PASSWORD 시크릿이 없습니다}"
export LFTP_PASSWORD
PROTO="${FTP_PROTOCOL:-ftps}"; [ -n "$PROTO" ] || PROTO=ftps
WEBROOT="${FTP_WEBROOT:-.}"; [ -n "$WEBROOT" ] || WEBROOT=.
SITE_URL="${SITE_URL:-https://moducopy.co.kr}"
CHECK_PATHS="${CHECK_PATHS:-/ /shop/item.php?it_id=1437511967&ca_id=10}"
APPLY_IMAGES="${APPLY_IMAGES:-true}"; APPLY_HTACCESS="${APPLY_HTACCESS:-false}"
DRY_RUN="${DRY_RUN:-false}"; CREATE_HTACCESS="${CREATE_HTACCESS:-false}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/optimized-images"
WORK="${WORK_DIR:-$(mktemp -d)}"; mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"
BACKUP="$WORK/backup"; VERIFY="$WORK/verify"; mkdir -p "$BACKUP" "$VERIFY"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SENTINEL="theme/eb4_basic/skin/item/book/img/item_info_01.jpg"
TMP_SUFFIX=".mc-tmp"

case "$PROTO" in
  ftps)
    SCHEME=ftp
    CONN="set ftp:ssl-force yes; set ftp:ssl-protect-data yes; set ftp:ssl-protect-list yes; set ssl:verify-certificate yes; set ssl:check-hostname yes" ;;
  sftp)
    SCHEME=sftp
    : "${SFTP_KNOWN_HOSTS:?FTP_PROTOCOL=sftp 이면 SFTP_KNOWN_HOSTS 시크릿(서버 호스트 키)이 필요합니다}"
    KH="$WORK/known_hosts"; printf '%s\n' "$SFTP_KNOWN_HOSTS" > "$KH"
    CONN="set sftp:auto-confirm no; set sftp:connect-program \"ssh -a -x -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KH\"" ;;
  ftp-plain)
    SCHEME=ftp
    echo "경고: 암호화 없는 FTP입니다. 비밀번호와 파일이 평문으로 전송됩니다."
    CONN="set ftp:ssl-allow no" ;;
  *) echo "FTP_PROTOCOL은 ftps, sftp, ftp-plain 중 하나여야 합니다"; exit 1 ;;
esac
URL="$SCHEME://$FTP_HOST"; [ -n "${FTP_PORT:-}" ] && URL="$URL:$FTP_PORT"
BASE_SET="set net:max-retries 2; set net:timeout 30; $CONN; set xfer:clobber on"

# 한 번의 접속으로 명령 하나를 실행하고, 실패하면 0이 아닌 값으로 끝난다.
run_lftp() {
  lftp --env-password -u "$FTP_USER" "$URL" -e "set cmd:fail-exit yes; $BASE_SET; cd \"$WEBROOT\"; $1; bye"
}
# 한 번의 접속으로 명령 파일 전체를 실행한다. 개별 명령이 실패해도 계속하며,
# 성공 여부는 명령 파일 안의 "&& !echo ... >> 기록파일"로 남긴다.
run_batch() {
  { echo "set cmd:fail-exit no; $BASE_SET"; echo "open --env-password -u \"$FTP_USER\" \"$URL\""; echo "cd \"$WEBROOT\" || exit 1"; cat "$1"; echo "bye"; } > "$1.full"
  lftp -f "$1.full" >/dev/null 2>"$1.err" || true
}
site_ok() {
  local p code
  for p in $CHECK_PATHS; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' --max-time 30 "$SITE_URL$p" || true)
    [ "$code" = 200 ] || { echo "응답 $code: $p"; return 1; }
  done
}
# 로컬 파일 $1 을 서버 경로 $2 에 안전하게 올린다: 임시 이름 → 되받아 비교 → 제자리로 이동.
safe_put() {
  local src="$1" dst="$2" tmp="$2$TMP_SUFFIX" chk="$VERIFY/safe_put.chk"
  rm -f "$chk"
  run_lftp "put \"$src\" -o \"$tmp\"" >/dev/null || { run_lftp "rm -f \"$tmp\"" >/dev/null 2>&1 || true; return 1; }
  run_lftp "get \"$tmp\" -o \"$chk\"" >/dev/null && cmp -s "$src" "$chk" || { run_lftp "rm -f \"$tmp\"" >/dev/null 2>&1 || true; return 1; }
  run_lftp "mv \"$tmp\" \"$dst\"" >/dev/null 2>&1 || run_lftp "rm -f \"$dst\"; mv \"$tmp\" \"$dst\"" >/dev/null
}

echo "== 1. 접속 및 웹루트 확인 ($PROTO)"
if ! err=$(lftp --env-password -u "$FTP_USER" "$URL" -e "set cmd:fail-exit yes; $BASE_SET; cls -1; bye" 2>&1 >/dev/null); then
  echo "서버 접속에 실패했습니다. 아무것도 변경하지 않았습니다."
  echo "$err" | tail -3
  exit 1
fi
if ! run_lftp "cls -1 \"$SENTINEL\"" >/dev/null 2>&1; then
  echo "웹루트($WEBROOT)에서 $SENTINEL 을 찾지 못했습니다. FTP_WEBROOT 시크릿을 사이트 루트 경로로 지정하세요. 아무것도 변경하지 않았습니다."
  exit 1
fi
echo "확인됨"

if [ "$APPLY_IMAGES" = true ]; then
  echo "== 2. 이미지: 원본 백업 후 더 작은 파일만 교체"
  cd "$SRC"
  mapfile -t FILES < <(find . -type f | sed 's|^\./||' | sort)

  # 2-1. 원본 내려받기 (한 번 접속). 성공한 파일만 got 에 기록된다.
  : > "$WORK/got"; : > "$WORK/b1"
  for f in "${FILES[@]}"; do
    mkdir -p "$BACKUP/$(dirname "$f")"; rm -f "$BACKUP/$f"
    echo "get \"$f\" -o \"$BACKUP/$f\" && !echo \"$f\" >> \"$WORK/got\"" >> "$WORK/b1"
  done
  run_batch "$WORK/b1"

  # 2-2. 교체 대상 결정. 내려받지 못한 파일은 건드리지 않는다.
  TODO=(); same=0; smaller=0; missing=0
  for f in "${FILES[@]}"; do
    if ! grep -qxF "$f" "$WORK/got"; then
      rm -f "$BACKUP/$f"; echo "건너뜀(서버에 없거나 내려받기 실패): $f"; missing=$((missing+1)); continue
    fi
    if cmp -s "$f" "$BACKUP/$f"; then same=$((same+1)); rm -f "$BACKUP/$f"; continue; fi
    remote=$(stat -c %s "$BACKUP/$f"); mine=$(stat -c %s "$f")
    if [ "$remote" -le "$mine" ]; then
      echo "건너뜀(서버 파일이 이미 더 작음, $remote <= $mine): $f"; smaller=$((smaller+1)); continue
    fi
    TODO+=("$f")
  done

  moved=0; failed=0
  if [ "${#TODO[@]}" -gt 0 ] && [ "$DRY_RUN" = true ]; then
    for f in "${TODO[@]}"; do echo "교체 예정: $f ($(stat -c %s "$BACKUP/$f") -> $(stat -c %s "$f"))"; done
    moved=${#TODO[@]}
  elif [ "${#TODO[@]}" -gt 0 ]; then
    # 2-3. 임시 이름으로 올리고 되받는다 (한 번 접속).
    : > "$WORK/b2"
    for f in "${TODO[@]}"; do
      mkdir -p "$VERIFY/$(dirname "$f")"; rm -f "$VERIFY/$f"
      echo "put \"$f\" -o \"$f$TMP_SUFFIX\" && get \"$f$TMP_SUFFIX\" -o \"$VERIFY/$f\"" >> "$WORK/b2"
    done
    run_batch "$WORK/b2"
    # 2-4. 되받은 내용이 같을 때만 제자리로 옮기고, 아니면 임시 파일을 지운다 (한 번 접속).
    : > "$WORK/moved"; : > "$WORK/b3"
    for f in "${TODO[@]}"; do
      if [ -f "$VERIFY/$f" ] && cmp -s "$f" "$VERIFY/$f"; then
        echo "mv \"$f$TMP_SUFFIX\" \"$f\" && !echo \"$f\" >> \"$WORK/moved\"" >> "$WORK/b3"
      else
        echo "rm -f \"$f$TMP_SUFFIX\"" >> "$WORK/b3"
      fi
    done
    run_batch "$WORK/b3"
    # 2-5. 덮어쓰는 이름 바꾸기를 서버가 거부한 파일은 하나씩 처리하고, 실패하면 원본을 되돌린다.
    for f in "${TODO[@]}"; do
      if grep -qxF "$f" "$WORK/moved"; then
        echo "교체: $f ($(stat -c %s "$BACKUP/$f") -> $(stat -c %s "$f"))"; moved=$((moved+1)); continue
      fi
      if [ -f "$VERIFY/$f" ] && cmp -s "$f" "$VERIFY/$f" && run_lftp "rm -f \"$f\"; mv \"$f$TMP_SUFFIX\" \"$f\"" >/dev/null 2>&1; then
        echo "교체: $f"; moved=$((moved+1)); continue
      fi
      run_lftp "rm -f \"$f$TMP_SUFFIX\"" >/dev/null 2>&1 || true
      if ! run_lftp "cls -1 \"$f\"" >/dev/null 2>&1; then
        safe_put "$BACKUP/$f" "$f" && echo "원본 복구: $f" || echo "오류: $f 가 서버에서 빠졌고 복구하지 못했습니다. 백업에서 직접 올려야 합니다."
      fi
      echo "실패(원본 유지): $f"; failed=$((failed+1))
    done
  fi
  echo "이미지 교체 $moved개, 이미 적용됨 $same개, 건너뜀 $((smaller+missing))개, 실패 $failed개"
  cd "$HERE"
  [ "$failed" -eq 0 ] || { echo "일부 파일을 교체하지 못했습니다. 다시 실행하면 남은 파일만 처리합니다."; IMAGES_FAILED=1; }
fi

if [ "$APPLY_HTACCESS" = true ]; then
  echo "== 3. .htaccess: 압축·캐시 설정 추가"
  ORIG="$WORK/htaccess.orig"; NEW="$WORK/htaccess.new"; rm -f "$ORIG"; had_file=true
  if ! run_lftp "get .htaccess -o \"$ORIG\"" >/dev/null 2>&1; then
    if [ "$CREATE_HTACCESS" != true ]; then
      echo "서버의 .htaccess를 내려받지 못했습니다. 파일이 없는지 전송 오류인지 구분할 수 없어 건드리지 않았습니다."
      echo "서버에 .htaccess가 없는 것이 확실하면 create_htaccess 를 켜고 다시 실행하세요."
      exit 1
    fi
    echo "create_htaccess 가 켜져 있어 새로 만듭니다"; : > "$ORIG"; had_file=false
  fi
  if grep -q "# BEGIN mc-perf" "$ORIG"; then
    echo "이미 적용되어 있어 건너뜁니다"
  elif [ "$DRY_RUN" = true ]; then
    echo "추가 예정 (dry run)"
  elif ! site_ok; then
    echo "적용 전부터 사이트 응답이 정상이 아니어서 .htaccess는 건드리지 않았습니다."; exit 1
  else
    { cat "$ORIG"; [ -s "$ORIG" ] && echo; echo "# BEGIN mc-perf"; grep -v '^# moducopy' "$HERE/htaccess-snippet.txt"; echo "# END mc-perf"; } > "$NEW"
    if [ "$had_file" = true ]; then
      safe_put "$ORIG" ".htaccess.bak-perf-$STAMP" || { echo "서버에 백업을 남기지 못해 중단합니다. 변경 없음."; exit 1; }
    fi
    safe_put "$NEW" ".htaccess" || { echo ".htaccess 업로드에 실패했습니다. 원본은 그대로입니다."; exit 1; }
    if ! site_ok; then
      echo "적용 후 사이트 응답이 정상이 아닙니다. 원래 .htaccess로 되돌립니다."
      if [ "$had_file" = true ]; then
        safe_put "$ORIG" ".htaccess" || { echo "오류: 되돌리기에 실패했습니다. 서버의 .htaccess.bak-perf-$STAMP 를 .htaccess 로 복사하세요."; exit 1; }
      else
        run_lftp "rm -f .htaccess" >/dev/null
      fi
      site_ok && echo "되돌린 뒤 사이트 응답 정상" || echo "되돌린 뒤에도 응답이 정상이 아닙니다. 사이트 상태를 확인하세요."
      exit 1
    fi
    echo "적용됨, 사이트 응답 정상.$([ "$had_file" = true ] && echo " 서버 백업: .htaccess.bak-perf-$STAMP")"
  fi
fi

[ -z "${IMAGES_FAILED:-}" ] || exit 1
echo "== 완료"
