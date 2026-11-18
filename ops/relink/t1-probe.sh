#!/usr/bin/env bash
# t1-probe.sh — single-shot direct request probe for the cloudcode-pa egress test.
#
# Sends EXACTLY ONE HTTP request (no retry, no endpoint fallback) with a
# byte-identical body across arms; arms differ only in User-Agent / extra
# Google headers and in the default endpoint.
#
#   arm A: plugin headers  + https://cloudcode-pa.googleapis.com
#   arm B: CLI headers     + https://cloudcode-pa.googleapis.com
#   arm C: CLI headers     + https://daily-cloudcode-pa.googleapis.com
#
# The access token is refreshed in memory only (never written to disk, never
# echoed).  A --dry-run performs no network I/O at all.
#
# Exit codes: 0 request completed (any HTTP status), 10 token refresh failed,
#             11 usage error.
set -euo pipefail
umask 077

PROG=${0##*/}
POOL_DEFAULT="${HOME}/.dsh/agy-accounts/pool.json"
TOKEN_REL=".gemini/antigravity-cli/antigravity-oauth-token"
# Public installed-app OAuth client of the Antigravity CLI (see packages/core/src/oauth.ts).
# The client secret is deliberately not committed: export AGY_CLIENT_SECRET before running.
CLIENT_ID="1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
CLIENT_SECRET="${AGY_CLIENT_SECRET:?export AGY_CLIENT_SECRET (see AGY_PUBLIC_CLIENT_SECRET in packages/core/src/oauth.ts)}"
OAUTH_TOKEN_URL="https://oauth2.googleapis.com/token"
MODEL="gemini-3.5-flash-lite"
DEFAULT_PROJECT="aicode-consumers"
REFRESH_SKEW_SEC=180

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 11; }
usage() {
  cat >&2 <<EOF
usage: $PROG --arm <A|B|C> --out <json path> [--endpoint <url>] [--dry-run] [--account <index|email>] [--project <id>]

  --arm A|B|C      header/endpoint arm (A=plugin/cloudcode-pa, B=cli/cloudcode-pa, C=cli/daily-cloudcode-pa)
  --out PATH       JSON result path
  --endpoint URL   override the arm default endpoint (exactly one endpoint, no fallback)
  --dry-run        print the masked request that WOULD be sent; no network I/O
  --account IDX    pool account index (0-based, pool.json order) or email/alias
  --project ID     override project id (default: ${DEFAULT_PROJECT})
EOF
}

ARM=""; OUT=""; ENDPOINT=""; DRY=0; ACCOUNT=""; PROJECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arm) ARM=${2:?missing value for --arm}; shift 2 ;;
    --out) OUT=${2:?missing value for --out}; shift 2 ;;
    --endpoint) ENDPOINT=${2:?missing value for --endpoint}; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --account) ACCOUNT=${2:?missing value for --account}; shift 2 ;;
    --project) PROJECT=${2:?missing value for --project}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$ARM" ] || die "missing --arm"
[ -n "$OUT" ] || die "missing --out"
case "$ARM" in A|B|C) ;; *) die "invalid --arm '$ARM' (expected A, B or C)" ;; esac

POOL=${T1_POOL:-$POOL_DEFAULT}
[ -f "$POOL" ] || die "pool file not found: $POOL"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/t1-probe.XXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- account ---
ACC_INFO=$(python3 - "$POOL" "$ACCOUNT" <<'PY'
import json, sys
pool, sel = sys.argv[1], sys.argv[2]
d = json.load(open(pool))
accs = d.get("accounts") or []
if not accs:
    sys.exit("pool has no accounts")
pick = None
if sel == "":
    for a in accs:
        if a.get("enabled", True) and a.get("dir"):
            pick = a
            break
else:
    for i, a in enumerate(accs):
        if sel.isdigit() and int(sel) == i:
            pick = a
            break
        if sel.lower() in (str(a.get("email", "")).lower(), str(a.get("alias", "")).lower()):
            pick = a
            break
if pick is None:
    sys.exit("no matching account for selector %r" % sel)
print("%s\t%s\t%s" % (pick.get("dir", ""), pick.get("email", ""), pick.get("enabled", True)))
PY
) || die "account resolution failed"

ACC_DIR=$(printf '%s' "$ACC_INFO" | cut -f1)
ACC_EMAIL=$(printf '%s' "$ACC_INFO" | cut -f2)
TOKEN_FILE="$ACC_DIR/$TOKEN_REL"
[ -f "$TOKEN_FILE" ] || die "token file not found: $TOKEN_FILE"

mask_email() {
  local e=$1
  local localp=${e%%@*}
  local dom=${e#*@}
  if [ "$localp" = "$e" ] || [ -z "$localp" ]; then printf '%s' "***"; return; fi
  printf '%s***@%s' "${localp:0:1}" "$dom"
}
ACC_MASK=$(mask_email "$ACC_EMAIL")

# ------------------------------------------------------------ token state ---
TOK_STATE=$(python3 - "$TOKEN_FILE" "$REFRESH_SKEW_SEC" <<'PY'
import json, sys, datetime
path, skew = sys.argv[1], int(sys.argv[2])
d = json.load(open(path))
t = d.get("token") if isinstance(d.get("token"), dict) else d
at = t.get("access_token") or ""
rt = t.get("refresh_token") or ""
exp = t.get("expiry") or ""
epoch = None
if exp:
    try:
        s = exp.replace("Z", "+00:00")
        epoch = int(datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f%z").timestamp())
    except Exception:
        try:
            epoch = int(datetime.datetime.fromisoformat(s).timestamp())
        except Exception:
            epoch = None
now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
need = (not at) or epoch is None or (epoch - now) < skew
iso = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if epoch else ""
print("%d\t%d\t%s\t%d\t%d" % (1 if at else 0, 1 if rt else 0, iso, epoch or 0, 1 if need else 0))
PY
) || die "could not parse token file"
HAS_AT=$(printf '%s' "$TOK_STATE" | cut -f1)
HAS_RT=$(printf '%s' "$TOK_STATE" | cut -f2)
EXP_ISO=$(printf '%s' "$TOK_STATE" | cut -f3)
EXP_EPOCH=$(printf '%s' "$TOK_STATE" | cut -f4)
NEED_REFRESH=$(printf '%s' "$TOK_STATE" | cut -f5)

PROJECT_EFF=${PROJECT:-${ANTIGRAVITY_PROJECT_ID:-$DEFAULT_PROJECT}}

# --------------------------------------------------------------- endpoint ---
if [ -n "$ENDPOINT" ]; then
  BASE=${ENDPOINT%/}
else
  case "$ARM" in
    A|B) BASE="https://cloudcode-pa.googleapis.com" ;;
    C)   BASE="https://daily-cloudcode-pa.googleapis.com" ;;
  esac
fi
URL="$BASE/v1internal:streamGenerateContent?alt=sse"

# ------------------------------------------------------- deterministic body ---
BODY_FILE="$WORK/request.json"
python3 - "$BODY_FILE" "$PROJECT_EFF" "$MODEL" <<'PY'
import json, sys
out, project, model = sys.argv[1], sys.argv[2], sys.argv[3]
body = {
    "project": project,
    "requestId": "checkpoint/00000000-0000-4000-8000-000000000000",
    "request": {
        "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
        "generationConfig": {"thinkingConfig": {"includeThoughts": True, "thinkingLevel": "LOW"}},
        "sessionId": "-3750763034362895579",
    },
    "model": model,
    "userAgent": "antigravity",
    "requestType": "checkpoint",
}
with open(out, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(body, separators=(",", ":"), ensure_ascii=False))
PY
REQ_SHA=$(sha256sum "$BODY_FILE" | cut -d' ' -f1)

# ----------------------------------------------------------------- headers ---
PLUGIN_UA="antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)"
CLI_UA="antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)"
CLIENT_METADATA='{"ideType":"ANTIGRAVITY","platform":"PLATFORM_LINUX","pluginType":"GEMINI"}'
case "$ARM" in
  A)
    ARM_EXTRA_HEADERS=$'X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1\n'"Client-Metadata: $CLIENT_METADATA"
    ARM_UA="$PLUGIN_UA" ;;
  B|C)
    ARM_EXTRA_HEADERS=""
    ARM_UA="$CLI_UA" ;;
esac

# ----------------------------------------------------------------- dry-run ---
print_dryrun() {
  local exp_note
  if [ "$NEED_REFRESH" = "1" ]; then
    exp_note="would refresh access token (expiry ${EXP_ISO:-unknown})"
  else
    exp_note="access token still fresh (expiry ${EXP_ISO:-unknown})"
  fi
  printf '%s\n' \
    "DRY-RUN — no request sent" \
    "arm: $ARM" \
    "method: POST" \
    "url: $URL" \
    "endpoint: $BASE" \
    "path: /v1internal:streamGenerateContent?alt=sse" \
    "account: $ACC_MASK" \
    "token_exp_utc: ${EXP_ISO:-unknown}" \
    "token: $exp_note" \
    "headers:" \
    "  Host: ${BASE#https://}" \
    "  Authorization: Bearer ****" \
    "  Content-Type: application/json" \
    "  Accept: text/event-stream" \
    "  User-Agent: $ARM_UA"
  if [ -n "$ARM_EXTRA_HEADERS" ]; then
    printf '%s\n' "$ARM_EXTRA_HEADERS" | while IFS= read -r line; do printf '  %s\n' "$line"; done
  fi
  printf '%s\n' \
    "request_body_sha256: $REQ_SHA" \
    "request_body_bytes: $(wc -c < "$BODY_FILE")" \
    "request_body:" \
    "$(cat "$BODY_FILE")" \
    "attempts: 0" \
    "out: $OUT"
}

if [ "$DRY" = "1" ]; then
  print_dryrun
  exit 0
fi

# ------------------------------------------------------- token (in memory) ---
ACCESS=""
if [ "$NEED_REFRESH" = "1" ]; then
  [ "$HAS_RT" = "1" ] || { printf '%s\n' "$PROG: token expired and no refresh_token in $TOKEN_FILE" >&2; exit 10; }
  REFRESH_OUT=$(python3 - "$TOKEN_FILE" "$CLIENT_ID" "$CLIENT_SECRET" "$OAUTH_TOKEN_URL" 2>"$WORK/refresh.err" <<'PY'
import json, sys, urllib.parse, urllib.request
path, cid, sec, url = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = json.load(open(path))
t = d.get("token") if isinstance(d.get("token"), dict) else d
rt = t.get("refresh_token") or ""
if not rt:
    sys.exit("no refresh_token")
form = urllib.parse.urlencode({
    "client_id": cid,
    "client_secret": sec,
    "grant_type": "refresh_token",
    "refresh_token": rt,
}).encode()
req = urllib.request.Request(url, data=form, method="POST",
                             headers={"Content-Type": "application/x-www-form-urlencoded"})
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8", "replace"))
except Exception as exc:
    sys.exit("refresh request failed: %s" % exc)
at = payload.get("access_token") or ""
if not at:
    sys.exit("token endpoint returned no access_token")
print(at)
PY
  ) || { printf '%s: token refresh failed (exit 10, no retry)\n' "$PROG" >&2; sed -n '1,3p' "$WORK/refresh.err" >&2 || true; exit 10; }
  ACCESS="$REFRESH_OUT"
else
  ACCESS=$(python3 - "$TOKEN_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
t = d.get("token") if isinstance(d.get("token"), dict) else d
at = t.get("access_token") or ""
if not at:
    sys.exit("no access_token")
print(at)
PY
  ) || { printf '%s: could not read access_token\n' "$PROG" >&2; exit 10; }
fi
[ -n "$ACCESS" ] || { printf '%s: empty access token\n' "$PROG" >&2; exit 10; }
TOKEN_LAST4=${ACCESS: -4}

HDRS=(
  -H "Authorization: Bearer $ACCESS"
  -H "Content-Type: application/json"
  -H "Accept: text/event-stream"
  -H "User-Agent: $ARM_UA"
)
if [ -n "$ARM_EXTRA_HEADERS" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && HDRS+=(-H "$line")
  done <<< "$ARM_EXTRA_HEADERS"
fi

# ------------------------------------------------------- exactly ONE request ---
set +e
META=$(curl -sS --max-time 45 -o "$WORK/resp.bin" -D "$WORK/resp.hdr" \
  -w '%{http_code} %{time_total}' -X POST "$URL" "${HDRS[@]}" \
  --data-binary @"$BODY_FILE" 2>"$WORK/curl.err")
CURL_RC=$?
set -e

RESP_SHA=$(sha256sum "$WORK/resp.bin" | cut -d' ' -f1)
RESP_BYTES=$(wc -c < "$WORK/resp.bin")

# ---------------------------------------------------------------- JSON out ---
mkdir -p "$(dirname "$OUT")"
python3 - "$WORK" "$OUT" "$ARM" "$URL" "$ACC_MASK" "$PROJECT_EFF" "$EXP_ISO" \
  "$REQ_SHA" "$META" "$CURL_RC" "$TOKEN_LAST4" "$RESP_SHA" "$RESP_BYTES" <<'PY'
import hashlib, json, os, re, sys, datetime

work, out, arm, url, acc, project, exp_iso, req_sha, meta, curl_rc, last4, resp_sha, resp_bytes = sys.argv[1:15]
curl_rc = int(curl_rc)
resp_bytes = int(resp_bytes)
parts = meta.split()
http_status = parts[0] if parts else "000"
try:
    latency_ms = int(round(float(parts[1]) * 1000)) if len(parts) > 1 else None
except ValueError:
    latency_ms = None

raw = open(os.path.join(work, "resp.bin"), "rb").read()
CODEX = 200 * 1024
truncated = len(raw) > CODEX
if truncated:
    full_path = out + ".body.txt"
    with open(full_path, "wb") as fh:
        fh.write(raw)
    body_text = raw[:CODEX].decode("utf-8", "replace")
else:
    full_path = ""
    body_text = raw.decode("utf-8", "replace")

headers = {}
block = []
for line in open(os.path.join(work, "resp.hdr"), encoding="utf-8", errors="replace"):
    line = line.rstrip("\r\n")
    if line.startswith("HTTP/"):
        block = [line]
        headers = {}
    elif line == "":
        continue
    elif ":" in line:
        k, v = line.split(":", 1)
        k = k.strip(); v = v.strip()
        lk = k.lower()
        if lk in ("authorization", "proxy-authorization", "set-cookie"):
            continue
        headers[k] = v

now = datetime.datetime.now(datetime.timezone.utc)
ts_cst = now.astimezone(datetime.timezone(datetime.timedelta(hours=8)))
doc = {
    "kind": "http_probe",
    "arm": arm,
    "ts_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "ts_cst": ts_cst.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
    "endpoint": re.sub(r"^(https://[^/]+).*$", r"\1", url),
    "url": url,
    "method": "POST",
    "http_status": http_status,
    "curl_exit": curl_rc,
    "latency_ms": latency_ms,
    "attempts": 1,
    "account_masked": acc,
    "project": project,
    "model": "gemini-3.5-flash-lite",
    "token_exp_utc": exp_iso or None,
    "authorization_masked": "Bearer ****" + last4,
    "response_headers": headers,
    "response_body": body_text,
    "body_truncated": truncated,
    "full_body_path": full_path,
    "body_sha256": resp_sha,
    "response_body_bytes": resp_bytes,
    "request_body_sha256": req_sha,
    "request_body": open(os.path.join(work, "request.json"), encoding="utf-8").read(),
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=2)

print("arm=%s method=POST" % arm)
print("url=%s" % url)
print("authorization=Bearer ****%s" % last4)
print("request_body_sha256=%s" % req_sha)
print("http_status=%s latency_ms=%s curl_exit=%s" % (http_status, latency_ms, curl_rc))
print("response_body_bytes=%d body_sha256=%s truncated=%s" % (resp_bytes, resp_sha, truncated))
print("account=%s project=%s token_exp_utc=%s" % (acc, project, exp_iso or "unknown"))
print("attempts=1")
print("out=%s" % out)
PY

if [ "$CURL_RC" != "0" ]; then
  printf '%s: curl exited %s (single attempt, no retry); see %s\n' "$PROG" "$CURL_RC" "$OUT" >&2
fi
exit 0
