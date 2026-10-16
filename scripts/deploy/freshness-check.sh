#!/usr/bin/env bash
#
# freshness-check.sh — independent, read-only freshness audit.
#
# WHY THIS EXISTS: the post-restart probe derives its process-freshness verdict
# from the installed artifact's mtime. An mtime is one `touch` away from being
# whatever the operator wants, and in this release it was in fact rewritten by
# the operator. A check whose passing condition can be manufactured by the
# subject of the check is not evidence, so this script does not use mtime at
# all. It reports, separately:
#
#   * what CAN be established from sources the operator cannot silently forge
#     (content hashes, systemd's process start time, and the install-phase
#     record consumed from disk);
#   * what CANNOT be established, as UNKNOWN, with the reason — never as PASS.
#
# It NEVER restarts anything, never writes timestamps, and never modifies the
# host or the installed artifact. Exit code is 0 when every check is PASS,
# 0 when only UNKNOWN is reported (UNKNOWN is an honest answer, not a failure),
# and 1 when a check FAILs.
#
# USAGE
#   scripts/deploy/freshness-check.sh [--record <install-complete.json>]
#                                     [--installed <plugin dir>]
set -euo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SELF_DIR
readonly REPO_ROOT="$(cd -- "${SELF_DIR}/../.." && pwd)"
readonly SERVICE="${CCH_SERVICE:-deepseek-harness.service}"
readonly INSTALL_RECORD_DEFAULT="${REPO_ROOT}/ops/release/install-complete.json"
readonly INSTALLED_DIR_DEFAULT="/home/csy/.dsh/profiles/web/node_modules/dsh-cloudcode-link"

RECORD="${INSTALL_RECORD_DEFAULT}"
INSTALLED="${INSTALLED_DIR_DEFAULT}"

PASSES=0
FAILS=0
UNKNOWNS=0

emit() {
  local id="$1" verdict="$2" summary="$3"
  printf '%-22s %-7s %s\n' "${id}" "${verdict}" "${summary}"
  case "${verdict}" in
    PASS) PASSES=$((PASSES + 1)) ;;
    FAIL) FAILS=$((FAILS + 1)) ;;
    *) UNKNOWNS=$((UNKNOWNS + 1)) ;;
  esac
}

sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

main() {
  while (($#)); do
    case "$1" in
      --record) RECORD="$2"; shift 2 ;;
      --installed) INSTALLED="$2"; shift 2 ;;
      -h | --help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; return 0 ;;
      *) printf 'unknown argument: %s\n' "$1" >&2; return 2 ;;
    esac
  done

  echo "# independent freshness audit (read-only; no restart, no timestamp writes)"
  echo "# record:    ${RECORD}"
  echo "# installed: ${INSTALLED}"
  echo

  # ---- 1. artifact content vs repo HEAD (operator cannot forge: content hash)
  if [[ ! -f "${RECORD}" ]]; then
    emit artifact_hash FAIL "install record ${RECORD} missing"
  elif [[ ! -f "${INSTALLED}/dist/index.js" ]]; then
    emit artifact_hash FAIL "installed artifact missing at ${INSTALLED}/dist/index.js"
  else
    local want got head_sha
    want="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("installedSha256") or "")' "${RECORD}")"
    got="$(sha_of "${INSTALLED}/dist/index.js")"
    head_sha="$(git -C "${REPO_ROOT}" show HEAD:dist/index.js 2>/dev/null | sha256sum | awk '{print $1}')"
    if [[ -n "${want}" && "${got}" == "${want}" && "${got}" == "${head_sha}" ]]; then
      emit artifact_hash PASS "installed == record == HEAD:dist/index.js (${got:0:12}…)"
    else
      emit artifact_hash FAIL "installed=${got:0:12}… record=${want:0:12}… HEAD:dist=${head_sha:0:12}…"
    fi
  fi

  # ---- 2. process start vs the install-phase record (systemd is the source)
  local pid start_iso start_ms record_ms
  pid="$(systemctl --user show "${SERVICE}" -p MainPID --value 2>/dev/null || echo 0)"
  start_iso="$(systemctl --user show "${SERVICE}" -p ExecMainStartTimestamp --value 2>/dev/null || true)"
  # Same derivation the probe uses: starttime ticks since boot + /proc/stat btime.
  start_ms="$(python3 -c 'import sys
pid=sys.argv[1]
f=open("/proc/%s/stat"%pid).read().rsplit(") ",1)[1].split()
st=int(f[19]); hz=100
btime=next(int(l.split()[1]) for l in open("/proc/stat") if l.startswith("btime "))
print(int((btime+st/hz)*1000))' "${pid}" 2>/dev/null || echo "")"
  if [[ ! -f "${RECORD}" ]]; then
    emit process_after_install UNKNOWN "no install record to compare against"
  else
    record_ms="$(python3 -c 'import datetime, json, sys
raw = json.load(open(sys.argv[1]))["installCompletedUtc"]
print(int(datetime.datetime.fromisoformat(raw).timestamp() * 1000))' "${RECORD}" 2>/dev/null || echo "")"
    if [[ -z "${record_ms}" || -z "${start_ms}" ]]; then
      emit process_after_install UNKNOWN "could not compute process start (pid=${pid}) or record time"
    elif ((start_ms > record_ms)); then
      emit process_after_install PASS "host started ${start_iso} AFTER recorded install completion (pid=${pid})"
    else
      emit process_after_install FAIL "host started ${start_iso} which is NOT after the recorded install completion"
    fi
  fi

  # ---- 3. mtime-derived freshness: reported, never trusted
  if [[ ! -f "${INSTALLED}/dist/index.js" ]]; then
    emit mtime_freshness UNKNOWN "artifact missing"
  else
    local artifact_ms
    artifact_ms="$(stat -c '%Y' "${INSTALLED}/dist/index.js" 2>/dev/null || echo 0)"
    emit mtime_freshness UNKNOWN "artifact mtime $(date -d "@${artifact_ms}" -Iseconds) is OPERATOR-REWRITTEN in this release — a touch can set it to any value, so a PASS here would be manufactured, not observed"
  fi

  # ---- 4. served /ccl route (live behaviour, not a timestamp)
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:3080/plugins/cloudcode-link/status" 2>/dev/null || echo 000)"
  if [[ "${code}" == "200" ]]; then
    emit live_plugin_route PASS "live host serves the plugin route (HTTP ${code})"
  else
    emit live_plugin_route UNKNOWN "plugin route answered HTTP ${code} (auth fence may apply; not evidence of absence)"
  fi

  echo
  printf 'SUMMARY PASS=%d FAIL=%d UNKNOWN=%d\n' "${PASSES}" "${FAILS}" "${UNKNOWNS}"
  if ((FAILS > 0)); then
    return 1
  fi
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
