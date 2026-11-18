#!/usr/bin/env bash
# t1-row.sh — run ONE row of the T1 egress matrix.
#
#   t1-row.sh <Rn> <node> [--no-switch]
#
# Steps (per spec P1): pin Google -> node and verify; capture egress geo via the
# method-B window (漏网之鱼 temporarily pinned to the same node, always restored);
# sample /connections while running the zero-quota CLI eligibility probe.
#
# Writes: ops/relink/t1-ipinfo-<Rn>.json (+ .ipapi.json), t1-cli-probe-<Rn>.json,
#         t1-connections-<Rn>.log
# Exit: 0 row completed, 2 switch/verify failure, 3 geo failure, 4 probe failure.
set -uo pipefail

RN=${1:?usage: t1-row.sh <Rn> <node> [--no-switch]}
NODE=${2:?usage: t1-row.sh <Rn> <node> [--no-switch]}
NOSW=${3:-}
DIR=$(dirname "$0")
SW="$DIR/t1-switch.sh"
LOG="$DIR/t1-run.log"
OUT_GEO="$DIR/t1-ipinfo-$RN.json"
OUT_PROBE="$DIR/t1-cli-probe-$RN.json"
OUT_CONN="$DIR/t1-connections-$RN.log"
BIN=/tmp/t1-agy-official

say() { printf '%s\n' "$*" | tee -a "$LOG"; }

say "===== ROW $RN  node=$NODE  $(date -Is) ====="

if [ "$NOSW" = "--no-switch" ]; then
  bash "$SW" verify Google "$NODE" 2>&1 | tee -a "$LOG" || exit 2
else
  bash "$SW" set Google "$NODE" 2>&1 | tee -a "$LOG" || exit 2
  bash "$SW" verify Google "$NODE" 2>&1 | tee -a "$LOG" || exit 2
fi

say "--- $RN egress geo (method B window) ---"
bash "$SW" egress "$NODE" "$OUT_GEO" 2>&1 | tee -a "$LOG"
GEO_RC=${PIPESTATUS[0]}
[ "$GEO_RC" -eq 0 ] || say "WARN $RN geo rc=$GEO_RC"

# --- connections sampler: samples /connections during the CLI probe -----------
CFG=${CLASH_CONFIG:-$HOME/.config/clash-meta/config.yaml}
SECRET=$(grep -m1 -E '^[[:space:]]*secret:' "$CFG" \
  | sed -E 's/^[[:space:]]*secret:[[:space:]]*//' | sed -E 's/[[:space:]]+#.*$//' \
  | tr -d '"' | xargs)

: > "$OUT_CONN"
sampler() {
  local i
  for i in $(seq 1 20); do
    curl -sS -m 3 -H "Authorization: Bearer $SECRET" http://127.0.0.1:9090/connections 2>/dev/null
    printf '\n'
    sleep 2
  done
}

say "--- $RN zero-quota CLI probe ---"
sampler > "$OUT_CONN" 2>/dev/null &
SPID=$!
# --keep-home so the raw hit log line can be captured as evidence; the throwaway
# HOME is deleted by this script immediately afterwards (it holds a token copy).
bash "$DIR/t1-cli-probe.sh" --out "$OUT_PROBE" --account 3 --bin "$BIN" --timeout 30 --keep-home 2>&1 | tee -a "$LOG"
PRC=${PIPESTATUS[0]}
kill "$SPID" 2>/dev/null
wait "$SPID" 2>/dev/null

printf '%s\n' "# $RN: cli_probes+1 (rc=$PRC)" >> "$DIR/t1-counter.txt"

# --- capture the raw ineligible/location log line, then wipe the temp HOME -----
OUT_EXCERPT="$DIR/t1-cli-log-$RN.txt"
python3 - "$OUT_PROBE" "$OUT_EXCERPT" <<'PY' | tee -a "$LOG"
import json,sys,re,os,shutil,glob
p,excerpt=sys.argv[1],sys.argv[2]
try: d=json.load(open(p))
except Exception as e: print("PROBE_JSON_UNREADABLE %s"%e); raise SystemExit(0)
lg=d.get("log") or {}
scan=lg.get("scanned_file")
lines=[]
if scan and os.path.isfile(scan):
    pat=re.compile(r"ineligible|not available in your location|eligibility|not_logged_in",re.I)
    with open(scan,encoding="utf-8",errors="replace") as fh:
        for ln in fh:
            if pat.search(ln): lines.append(ln.rstrip("\n"))
with open(excerpt,"w",encoding="utf-8") as fh:
    fh.write("# %s raw eligibility log lines (from throwaway HOME, now deleted)\n"%sys.argv[1])
    fh.write("\n".join(lines) if lines else "(no matching lines in scanned log)")
print("excerpt_lines=%d -> %s"%(len(lines),excerpt))
for ln in lines[:4]: print("   HIT: %s"%ln[:300])
# delete the throwaway HOME (path must look like a t1-cli-home mktemp dir)
home=lg.get("dir")
if home:
    root=home
    while root and os.path.basename(root) and not os.path.basename(root).startswith("t1-cli-home."):
        root=os.path.dirname(root)
    if root and os.path.basename(root).startswith("t1-cli-home.") and root.startswith("/tmp/"):
        shutil.rmtree(root,ignore_errors=True)
        print("temp_home_removed=%s exists=%s"%(root,os.path.exists(root)))
    else:
        print("temp_home_NOT_removed (unrecognized path, left for manual review): %s"%home)
PY

# --- verdict summary ---------------------------------------------------------
python3 - "$OUT_PROBE" "$RN" <<'PY' | tee -a "$LOG"
import json,sys
p,rn=sys.argv[1],sys.argv[2]
try:
    d=json.load(open(p))
except Exception as e:
    print("PROBE_JSON_UNREADABLE %s: %s"%(p,e)); raise SystemExit(0)
print("%s verdict=%s exit=%s timed_out=%s duration_ms=%s zero_quota=%s"%(
    rn,d.get("verdict"),d.get("exit_code"),d.get("timed_out"),d.get("duration_ms"),d.get("zero_quota")))
for k,v in (d.get("hits") or {}).items():
    if v: print("   hit %s=%s"%(k,v))
PY

exit 0
