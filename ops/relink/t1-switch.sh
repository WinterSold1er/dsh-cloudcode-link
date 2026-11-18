#!/usr/bin/env bash
# t1-switch.sh — Clash selector switch/restore helper for the T1 egress matrix.
#
# Guarantees: every mutation that pins 漏网之鱼 for an ipinfo probe is restored by
# a trap on EXIT/INT/TERM, and every switch is verified by a GET afterwards.
# The controller secret is read from config at runtime and never echoed.
#
# Subcommands:
#   get   <group>            -> prints group.now
#   set   <group> <node>     -> PUT then verify now==node (exit 3 on mismatch)
#   egress <node> <outfile>  -> pin 漏网之鱼 to <node>, curl ipinfo.io/json, restore
#   verify <group> <expect>  -> exit 0 iff now==expect
#
# Exit: 0 ok, 3 verify/restore failure, 4 API error, 5 usage.
set -uo pipefail

CFG=${CLASH_CONFIG:-$HOME/.config/clash-meta/config.yaml}
API=${CLASH_API:-http://127.0.0.1:9090}
PROG=${0##*/}

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 4; }

read_secret() {
  grep -m1 -E '^[[:space:]]*secret:' "$CFG" \
    | sed -E 's/^[[:space:]]*secret:[[:space:]]*//' \
    | sed -E 's/[[:space:]]+#.*$//' \
    | tr -d '"'"'" \
    | xargs
}

SECRET=$(read_secret)
[ -n "$SECRET" ] || die "empty secret parsed from $CFG"

api() { # api <GET|PUT> <path> [body-json-file]
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -m 10 -X "$method" \
      -H "Authorization: Bearer $SECRET" \
      -H "Content-Type: application/json" \
      --data-binary @"$body" "$API$path"
  else
    curl -sS -m 10 -X "$method" -H "Authorization: Bearer $SECRET" "$API$path"
  fi
}

# json_put_body <node> <file> — encode a node name (emoji/spaces) as {"name":...}
json_put_body() {
  python3 -c 'import json,sys; json.dump({"name":sys.argv[1]}, open(sys.argv[2],"w"), ensure_ascii=False)' "$1" "$2"
}

get_now() { # prints group.now, empty+exit 4 on failure
  api GET "/proxies/$1" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(4)
now=d.get("now")
if now is None: sys.exit(4)
print(now)' || die "cannot read now for group '$1'"
}

set_node() {
  local group=$1 node=$2 now tf rc
  tf=$(mktemp) || die "mktemp failed"
  json_put_body "$node" "$tf" || { rm -f "$tf"; die "body encode failed"; }
  api PUT "/proxies/$group" "$tf" >/dev/null
  rc=$?
  rm -f "$tf"
  [ $rc -eq 0 ] || die "PUT $group -> '$node' failed (curl rc=$rc)"
  now=$(get_now "$group")
  if [ "$now" != "$node" ]; then
    printf '%s: VERIFY_FAIL group=%s expected=%s actual=%s\n' "$PROG" "$group" "$node" "$now" >&2
    return 3
  fi
  return 0
}

cmd=${1:-}
case "$cmd" in
  get)
    [ $# -eq 2 ] || exit 5
    get_now "$2"
    ;;
  set)
    [ $# -eq 3 ] || exit 5
    set_node "$2" "$3"
    ;;
  verify)
    [ $# -eq 3 ] || exit 5
    now=$(get_now "$2")
    if [ "$now" = "$3" ]; then echo "VERIFY_OK $2 == $3"; exit 0; fi
    echo "VERIFY_FAIL $2 expected=$3 actual=$now"; exit 3
    ;;
  egress)
    # Pin 漏网之鱼 to <node> for one egress-geo window, then restore unconditionally.
    # Primary source is ipinfo.io (per spec); ipapi.co is queried IN PARALLEL inside
    # the same pinned window as a co-source, because ipinfo.io was returning HTTP 429
    # (rate limit) during this run. Both are zero-quota diagnostics. Parallel (not
    # sequential) calls keep the collateral window at ~max(timeout) not the sum.
    [ $# -eq 3 ] || exit 5
    node=$2 out=$3
    out_alt="${out%.json}.ipapi.json"
    out_2="${out%.json}.ipapicom.json"
    LW_ORIG=$(get_now "漏网之鱼") || exit 4
    restored=0
    restore() {
      [ "$restored" = 1 ] && return 0
      restored=1
      if set_node "漏网之鱼" "$LW_ORIG"; then
        printf 'LW_RESTORED ok now=%s\n' "$LW_ORIG" >&2
      else
        printf 'LW_RESTORE_FAILED wanted=%s\n' "$LW_ORIG" >&2
      fi
    }
    trap restore EXIT INT TERM
    set_node "漏网之鱼" "$node" || { printf 'LW_PIN_FAILED node=%s\n' "$node" >&2; exit 3; }
    # all probes run concurrently inside a single pinned window
    curl -sS --max-time 6 https://ipinfo.io/json -o "$out" 2>"$out.err" &
    pid_primary=$!
    curl -sS --max-time 8 https://ipapi.co/json/ -o "$out_alt" 2>"$out_alt.err" &
    pid_alt=$!
    curl -sS --max-time 8 'http://ip-api.com/json?fields=status,country,countryCode,regionName,city,isp,org,as,query' -o "$out_2" 2>"$out_2.err" &
    pid_2=$!
    wait $pid_primary; rc=$?
    wait $pid_alt; rc_alt=$?
    wait $pid_2; rc_2=$?
    # always leave a readable artifact even when a source returned nothing
    [ -s "$out" ] || printf '{"error":"empty_response","curl_rc":%d}\n' "$rc" > "$out"
    [ -s "$out_alt" ] || printf '{"error":"empty_response","curl_rc":%d}\n' "$rc_alt" > "$out_alt"
    [ -s "$out_2" ] || printf '{"error":"empty_response","curl_rc":%d}\n' "$rc_2" > "$out_2"
    printf 'ipinfo_curl_rc=%d ipapi_curl_rc=%d ipapicom_curl_rc=%d\n' "$rc" "$rc_alt" "$rc_2" >&2
    restore
    trap - EXIT INT TERM
    # final independent verification of the restored value
    now=$(get_now "漏网之鱼")
    if [ "$now" != "$LW_ORIG" ]; then
      printf 'LW_FINAL_VERIFY_FAIL expected=%s actual=%s\n' "$LW_ORIG" "$now" >&2
      exit 3
    fi
    printf 'LW_FINAL_VERIFY_OK now=%s\n' "$now" >&2
    # success requires at least one usable geo source (ipinfo.io + ipapi.co were
    # 429/rate-limited this run, so ip-api.com is the working co-source)
    if [ "$rc" -ne 0 ] && [ "$rc_alt" -ne 0 ] && [ "$rc_2" -ne 0 ]; then
      printf 'EGRESS_GEO_FAILED all sources failed rc=%d rc_alt=%d rc_2=%d\n' "$rc" "$rc_alt" "$rc_2" >&2
      exit 3
    fi
    ;;
  *)
    printf 'usage: %s get <group> | set <group> <node> | verify <group> <expect> | egress <node> <out>\n' "$PROG" >&2
    exit 5
    ;;
esac
