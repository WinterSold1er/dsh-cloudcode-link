#!/usr/bin/env bash
# t1-cli-probe.sh — ZERO-GENERATION eligibility probe via the official unpatched CLI.
#
# Runs `agy -p <prompt> --output-format json` exactly once (timeout 30s) with the
# UNPATCHED /usr/bin/agy by default.  The unpatched CLI performs the
# loadCodeAssist eligibility check and aborts before any streamGenerateContent
# call when the account is ineligible, so an `ineligible` verdict consumes no
# generation quota.
#
# If the account is eligible the CLI WILL generate a few tokens; that case is
# recorded as `generation_success_quota_consumed`, never silently treated as a
# free probe.
#
# Pool safety: --account runs the CLI against a throwaway HOME (mode 700) that
# contains only a COPY of the account's token file; pool.json and the real
# account dirs are never written.  The temp HOME is removed on exit unless
# --keep-home is given.
#
# JSON is written only to --out; stdout/stderr snippets are redacted.
set -euo pipefail
umask 077

PROG=${0##*/}
BIN_DEFAULT="/usr/bin/agy"
POOL_DEFAULT="${HOME}/.dsh/agy-accounts/pool.json"
TOKEN_REL=".gemini/antigravity-cli/antigravity-oauth-token"
LOG_REL=".gemini/antigravity-cli/log"

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 11; }
usage() {
  cat >&2 <<EOF
usage: $PROG --out <json path> [--account <index|email>] [--home <dir>] [--bin <path>]
             [--prompt <text>] [--timeout <sec>] [--keep-home]

  --out PATH        JSON result path (required)
  --account IDX     pool account index (0-based) or email: run against a throwaway
                    HOME seeded with that account's token (pool stays untouched)
  --home DIR        run with HOME=DIR (must already contain .gemini; mutually
                    exclusive with --account)
  --bin PATH        CLI binary (default: ${BIN_DEFAULT}; wrapper is NOT recommended:
                    the patched wrapper bypasses the gate and may spend quota)
  --prompt TEXT     prompt (default: "hi"; keep it tiny)
  --timeout SEC     hard timeout (default: 30)
  --keep-home       do not delete the throwaway HOME (debugging only)
EOF
}

OUT=""; ACCOUNT=""; HOME_ARG=""; BIN="$BIN_DEFAULT"; PROMPT="hi"; TIMEOUT_S=30; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT=${2:?missing value for --out}; shift 2 ;;
    --account) ACCOUNT=${2:?missing value for --account}; shift 2 ;;
    --home) HOME_ARG=${2:?missing value for --home}; shift 2 ;;
    --bin) BIN=${2:?missing value for --bin}; shift 2 ;;
    --prompt) PROMPT=${2:?missing value for --prompt}; shift 2 ;;
    --timeout) TIMEOUT_S=${2:?missing value for --timeout}; shift 2 ;;
    --keep-home) KEEP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$OUT" ] || die "missing --out"
[ -n "$ACCOUNT" ] && [ -n "$HOME_ARG" ] && die "--account and --home are mutually exclusive"
case "$TIMEOUT_S" in (*[!0-9]*|"") die "invalid --timeout" ;; esac
[ -x "$BIN" ] || die "binary not executable: $BIN"

TMP_HOME=""
EFF_HOME="$HOME"
ACCOUNT_MASK="(real-home)"
HOME_MODE="current-home"
cleanup() {
  if [ "$KEEP" = "1" ] && [ -n "$TMP_HOME" ]; then
    printf '%s: kept throwaway HOME at %s\n' "$PROG" "$TMP_HOME" >&2
  elif [ -n "$TMP_HOME" ]; then
    rm -rf "$TMP_HOME"
  fi
}
trap cleanup EXIT INT TERM

if [ -n "$ACCOUNT" ]; then
  POOL=${T1_POOL:-$POOL_DEFAULT}
  [ -f "$POOL" ] || die "pool file not found: $POOL"
  ACC_INFO=$(python3 - "$POOL" "$ACCOUNT" <<'PY'
import json, sys
pool, sel = sys.argv[1], sys.argv[2]
d = json.load(open(pool))
accs = d.get("accounts") or []
pick = None
for i, a in enumerate(accs):
    if sel.isdigit() and int(sel) == i:
        pick = a; break
    if sel.lower() in (str(a.get("email", "")).lower(), str(a.get("alias", "")).lower()):
        pick = a; break
if pick is None:
    sys.exit("no matching account for selector %r" % sel)
print("%s\t%s" % (pick.get("dir", ""), pick.get("email", "")))
PY
  ) || die "account resolution failed"
  ACC_DIR=$(printf '%s' "$ACC_INFO" | cut -f1)
  ACC_EMAIL=$(printf '%s' "$ACC_INFO" | cut -f2)
  TOKEN_FILE="$ACC_DIR/$TOKEN_REL"
  [ -f "$TOKEN_FILE" ] || die "token file not found: $TOKEN_FILE"
  local_part=${ACC_EMAIL%%@*}
  dom=${ACC_EMAIL#*@}
  ACCOUNT_MASK="${local_part:0:1}***@$dom"

  TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/t1-cli-home.XXXXXX")
  mkdir -p "$TMP_HOME/.gemini/antigravity-cli"
  cp -p "$TOKEN_FILE" "$TMP_HOME/$TOKEN_REL"
  chmod 600 "$TMP_HOME/$TOKEN_REL"
  # config dir is optional but mirrors what the CLI expects to find
  if [ -d "$ACC_DIR/.gemini/config" ]; then
    cp -a "$ACC_DIR/.gemini/config" "$TMP_HOME/.gemini/config"
  fi
  EFF_HOME="$TMP_HOME"
  HOME_MODE="throwaway-home-copy"
elif [ -n "$HOME_ARG" ]; then
  [ -d "$HOME_ARG/.gemini" ] || die "$HOME_ARG has no .gemini (not an agy state dir)"
  EFF_HOME="$HOME_ARG"
  HOME_MODE="explicit-home"
fi

BIN_REAL=$(readlink -f "$BIN" 2>/dev/null || printf '%s' "$BIN")
BIN_WRAPPER=0
if [ -f "$BIN" ] && head -c 200 "$BIN" 2>/dev/null | grep -q "Transparent wrapper"; then
  BIN_WRAPPER=1
fi
case "$BIN_REAL" in
  *".local/lib/agy/"*) BIN_WRAPPER=1 ;;
esac

LOG_DIR="$EFF_HOME/$LOG_REL"
mkdir -p "$LOG_DIR"

RUN_ID="t1cli-$(date -u +%Y%m%dT%H%M%SZ)-$$"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/t1-cli-probe.XXXXXX")
STDOUT_F="$WORK/stdout.txt"; STDERR_F="$WORK/stderr.txt"

snapshot_logs() {
  if [ -d "$LOG_DIR" ]; then
    find "$LOG_DIR" -maxdepth 1 -type f -name 'cli-*.log' -printf '%T@ %f %s\n' 2>/dev/null | sort -k2
  fi
}
BEFORE="$WORK/before.txt"
snapshot_logs > "$BEFORE"

START_MS=$(date +%s%3N)
set +e
timeout --signal=TERM "$TIMEOUT_S" env HOME="$EFF_HOME" "$BIN" -p "$PROMPT" --output-format json \
  > "$STDOUT_F" 2> "$STDERR_F" < /dev/null
EXIT_CODE=$?
set -e
END_MS=$(date +%s%3N)
DURATION_MS=$((END_MS - START_MS))
TIMED_OUT=0
[ "$EXIT_CODE" = "124" ] && TIMED_OUT=1

snapshot_logs > "$WORK/after.txt"
NEW_ENTRIES=$(comm -13 <(awk '{print $2}' "$BEFORE" | sort) <(awk '{print $2}' "$WORK/after.txt" | sort) || true)
NEW_COUNT=$(printf '%s\n' "$NEW_ENTRIES" | sed '/^$/d' | wc -l)

# newest log file (new one if created, else the most recently modified)
SCAN_FILE=""
if [ -d "$LOG_DIR" ]; then
  SCAN_FILE=$(find "$LOG_DIR" -maxdepth 1 -type f -name 'cli-*.log' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n1 | cut -d' ' -f2- || true)
fi

NEW_LINES=0; APPENDED_LINES=0
if [ -n "$SCAN_FILE" ] && [ -f "$SCAN_FILE" ]; then
  BASE=$(basename "$SCAN_FILE")
  PRE_SIZE=$(awk -v f="$BASE" '$2==f{print $3}' "$BEFORE" | tail -n1)
  if printf '%s\n' "$NEW_ENTRIES" | grep -qx "$BASE"; then
    NEW_LINES=$(wc -l < "$SCAN_FILE")
    APPENDED_LINES=$NEW_LINES
  elif [ -n "${PRE_SIZE:-}" ]; then
    APPENDED_LINES=$(tail -c +"$((PRE_SIZE + 1))" "$SCAN_FILE" | wc -l)
    NEW_LINES=$APPENDED_LINES
  fi
fi

mkdir -p "$(dirname "$OUT")"
python3 - "$WORK" "$OUT" "$RUN_ID" "$BIN" "$BIN_REAL" "$BIN_WRAPPER" "$HOME_MODE" \
  "$ACCOUNT_MASK" "$TIMEOUT_S" "$EXIT_CODE" "$TIMED_OUT" "$DURATION_MS" \
  "$LOG_DIR" "$SCAN_FILE" "$NEW_COUNT" "$NEW_LINES" "$APPENDED_LINES" "$PROMPT" <<'PY'
import datetime, hashlib, json, os, re, sys

(work, out, run_id, bin_path, bin_real, bin_wrapper, home_mode, account,
 timeout_s, exit_code, timed_out, duration_ms, log_dir, scan_file,
 new_count, new_lines, appended, prompt) = sys.argv[1:19]
exit_code = int(exit_code); timed_out = int(timed_out); duration_ms = int(duration_ms)
new_count = int(new_count); new_lines = int(new_lines); appended = int(appended)
bin_wrapper = int(bin_wrapper)

def redact(text: str) -> str:
    # Prefixes are bracketed so the literals never appear verbatim in this file.
    text = re.sub(r"ya[2]9\.[A-Za-z0-9._-]+", "[REDACTED_ACCESS_TOKEN]", text)
    text = re.sub(r"1[/]/[A-Za-z0-9._-]{20,}", "[REDACTED_REFRESH_TOKEN]", text)
    text = re.sub(r"e[y]J[A-Za-z0-9._-]{20,}", "[REDACTED_JWT]", text)
    text = re.sub(r"(?i)Bearer\s+[A-Za-z0-9._~+/-]{12,}=*", "Bearer ****", text)
    return text

stdout = redact(open(os.path.join(work, "stdout.txt"), encoding="utf-8", errors="replace").read())[:16000]
stderr = redact(open(os.path.join(work, "stderr.txt"), encoding="utf-8", errors="replace").read())[:16000]
logtext = ""
if scan_file and os.path.isfile(scan_file):
    logtext = open(scan_file, encoding="utf-8", errors="replace").read()

hits = {
    "server_oauth_114": logtext.count("server_oauth.go:114"),
    "server_oauth_133": logtext.count("server_oauth.go:133"),
    "account_ineligible": logtext.count("Account ineligible"),
    "eligibility_failed": logtext.count("Eligibility check failed"),
    "location_unavailable": logtext.count("not available in your location"),
    "not_logged_in": logtext.count("not logged into Antigravity"),
    "resource_exhausted": logtext.count("RESOURCE_EXHAUSTED"),
    "unavailable": logtext.count("UNAVAILABLE"),
}
blob = stdout + "\n" + stderr
hits["account_ineligible"] += blob.count("Account ineligible")
hits["eligibility_failed"] += blob.count("Eligibility check failed")
hits["location_unavailable"] += blob.count("not available in your location")

stdout_status = None
m = re.search(r'"status"\s*:\s*"([A-Z_]+)"', stdout)
if m:
    stdout_status = m.group(1)

if timed_out:
    verdict = "timeout"
elif hits["location_unavailable"] or hits["account_ineligible"] or hits["eligibility_failed"]:
    verdict = "ineligible_zero_quota"
elif hits["not_logged_in"]:
    verdict = "auth_missing"
elif exit_code == 0 and stdout_status == "SUCCESS":
    verdict = "generation_success_quota_consumed"
else:
    verdict = "other_error"

now = datetime.datetime.now(datetime.timezone.utc)
cst = now.astimezone(datetime.timezone(datetime.timedelta(hours=8)))
doc = {
    "kind": "cli_probe",
    "attempts": 1,
    "run_id": run_id,
    "ts_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "ts_cst": cst.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
    "binary": bin_path,
    "binary_realpath": bin_real,
    "binary_is_wrapper": bool(bin_wrapper),
    "binary_sha256": (hashlib.sha256(open(bin_real, "rb").read()).hexdigest()
                      if os.path.isfile(bin_real) else None),
    "home_mode": home_mode,
    "account_masked": account,
    "command": {"argv": [bin_path, "-p", prompt, "--output-format", "json"], "timeout_s": int(timeout_s)},
    "exit_code": exit_code,
    "timed_out": bool(timed_out),
    "duration_ms": duration_ms,
    "stdout": stdout,
    "stderr": stderr,
    "stdout_status": stdout_status,
    "log": {
        "dir": log_dir,
        "scanned_file": scan_file or None,
        "new_files": new_count,
        "new_lines": new_lines,
        "appended_lines": appended,
    },
    "hits": hits,
    "verdict": verdict,
    "zero_quota": verdict == "ineligible_zero_quota",
    "notes": [
        "unpatched CLI aborts before streamGenerateContent on ineligible accounts",
        "generation_success_quota_consumed means a small amount of quota was spent",
    ],
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=2)

print("run_id=%s verdict=%s exit_code=%s timed_out=%s duration_ms=%d" % (run_id, verdict, exit_code, timed_out, duration_ms))
print("binary=%s wrapper=%s home_mode=%s account=%s" % (bin_real, bin_wrapper, home_mode, account))
print("log_file=%s new_lines=%d new_files=%d" % (scan_file or "(none)", new_lines, new_count))
print("hits: ineligible=%d eligibility_failed=%d location=%d not_logged_in=%d" % (
    hits["account_ineligible"], hits["eligibility_failed"], hits["location_unavailable"], hits["not_logged_in"]))
print("zero_quota=%s out=%s" % (verdict == "ineligible_zero_quota", out))
PY

rm -rf "$WORK"
exit 0
