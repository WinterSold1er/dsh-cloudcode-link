#!/usr/bin/env bash
#
# release-runner.sh — detached release orchestrator for dsh-cloudcode-link.
#
# Runs OUTSIDE the agent session (launched with `systemd-run --user --collect`)
# because the restart in the middle of this runbook kills every session hosted
# by deepseek-harness.service. Nothing here may depend on the caller's
# environment or cwd: a transient unit inherits neither.
#
# PHASES
#   0 pre-state        record host PID / start / uptime
#   1 reinstall        pnpm update dsh-cloudcode-link in the web profile
#   2 verify artifact  installed dist/index.js sha256 == expected
#   3 git cleanliness  profile + repo state recorded (informational)
#   4 restart          scripts/deploy/restart-host.sh --schedule --force
#                      (single-owner restart path; it schedules a detached unit
#                       and returns immediately, so this runner stays alive and
#                       keeps polling from OUTSIDE the restart)
#   5 wait             poll until the host's ActiveEnterTimestamp changes and the
#                      HTTP endpoint answers
#   6 probe            node scripts/verify/post-restart-probe.mjs
#   7 summary          write everything to ops/release/release-<UTC>.log
#
# EXIT CODES
#   0   all phases passed
#   1   installed artifact hash mismatch (release MUST NOT restart on this)
#   2   reinstall failed
#   3   host did not restart within RESTART_TIMEOUT_SEC
#   4   host did not become ready within READY_TIMEOUT_SEC
#   5   probe failed
#
# USAGE
#   systemd-run --user --collect --unit ccl-release-$$ bash scripts/deploy/release-runner.sh
#   scripts/deploy/release-runner.sh --dry-phases   # phases 0-3 only, no restart
#
set -euo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SELF_DIR
readonly REPO_ROOT="$(cd -- "${SELF_DIR}/../.." && pwd)"
readonly PROFILE_DIR="${CCH_PROFILE_DIR:-/home/csy/.dsh/profiles/web}"
readonly INSTALLED_DIR="${CCH_INSTALLED_DIR:-${PROFILE_DIR}/node_modules/dsh-cloudcode-link}"
readonly HOST_URL="${CCH_URL:-http://127.0.0.1:3080/}"
readonly SERVICE="${CCH_SERVICE:-deepseek-harness.service}"
readonly READY_HTTP_EXPECTED="${CCH_READY_HTTP:-401}"
readonly LOG_DIR="${CCH_LOG_DIR:-${REPO_ROOT}/ops/release}"
readonly PROBE_SCRIPT="${REPO_ROOT}/scripts/verify/post-restart-probe.mjs"

# Expected artifact hash. Must be passed in or agreed out of band; this runner
# refuses to release an artifact it cannot pin. No default on purpose.
readonly EXPECTED_INDEX_SHA256="${CCH_EXPECTED_INDEX_SHA256:-}"

readonly PNPM_TIMEOUT_SEC="${CCH_PNPM_TIMEOUT:-600}"
readonly RESTART_TIMEOUT_SEC="${CCH_RESTART_TIMEOUT:-120}"
readonly READY_TIMEOUT_SEC="${CCH_READY_TIMEOUT:-120}"
readonly POLL_INTERVAL_SEC="${CCH_POLL_INTERVAL:-2}"
readonly HTTP_TIMEOUT_SEC="${CCH_HTTP_TIMEOUT:-3}"

readonly EX_HASH_MISMATCH=1
readonly EX_REINSTALL_FAILED=2
readonly EX_NO_RESTART=3
readonly EX_NOT_READY=4
readonly EX_PROBE_FAILED=5

LOG_FILE=""
DRY_PHASES=0
RUN_START_EPOCH=0
REPO_HEAD=""
PROBE_JSON=""

utc_stamp() { date -u +%Y%m%dT%H%M%SZ; }
now_iso() { date +%Y-%m-%dT%H:%M:%S%z; }

log_line() {
  printf '%s\n' "$*"
  [[ -n "${LOG_FILE}" ]] && printf '%s\n' "$*" >>"${LOG_FILE}"
}

log_raw() {
  if [[ -n "${LOG_FILE}" ]]; then
    "$@" 2>&1 | tee -a "${LOG_FILE}"
  else
    "$@" 2>&1
  fi
}

init_log() {
  mkdir -p -- "${LOG_DIR}"
  LOG_FILE="${LOG_DIR}/release-$(utc_stamp).log"
  : >"${LOG_FILE}"
  # Boundaries used later to prove the probe artifact belongs to THIS run.
  RUN_START_EPOCH="$(date +%s)"
  REPO_HEAD="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo '<n/a>')"
  log_line "# dsh-cloudcode-link release run"
  log_line "# started_at: $(now_iso)"
  log_line "# repo_root: ${REPO_ROOT}"
  log_line "# repo_head_at_start: ${REPO_HEAD}"
  log_line "# profile_dir: ${PROFILE_DIR}"
  log_line "# installed_dir: ${INSTALLED_DIR}"
  log_line "# expected_index_sha256: ${EXPECTED_INDEX_SHA256:-<unset>}"
  log_line "# host_url: ${HOST_URL}"
}

host_start() { systemctl --user show "${SERVICE}" -p ActiveEnterTimestamp --value 2>/dev/null || true; }
host_pid() { systemctl --user show "${SERVICE}" -p MainPID --value 2>/dev/null || true; }
http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time "${HTTP_TIMEOUT_SEC}" "${HOST_URL}" 2>/dev/null || echo "000"; }

require_expected_hash() {
  if [[ -z "${EXPECTED_INDEX_SHA256}" ]]; then
    log_line "FAIL: CCH_EXPECTED_INDEX_SHA256 is unset — refusing to release an unpinned artifact"
    return "${EX_HASH_MISMATCH}"
  fi
  return 0
}

phase0_pre_state() {
  OLD_START="$(host_start)"
  OLD_PID="$(host_pid)"
  log_line "--- phase 0: pre-state ---"
  log_line "pre_pid=${OLD_PID}"
  log_line "pre_start=${OLD_START}"
  log_line "pre_uptime=$(ps -o etime= -p "${OLD_PID}" 2>/dev/null | tr -d ' ' || echo '<n/a>')"
}

phase1_reinstall() {
  log_line "--- phase 1: profile reinstall ---"
  log_line "cmd: pnpm update dsh-cloudcode-link (cwd=${PROFILE_DIR})"
  local out rc=0
  # ERR_PNPM_IGNORED_BUILDS makes pnpm exit 1 even though the package installed
  # correctly: the shipped tarball already contains the built dist/, so the
  # ignored postinstall is irrelevant. That one case is tolerated — phase 2
  # remains the real gate, because a bad artifact fails the hash check anyway.
  out="$(timeout "${PNPM_TIMEOUT_SEC}" pnpm --dir "${PROFILE_DIR}" update dsh-cloudcode-link 2>&1)" || rc=$?
  printf '%s\n' "${out}" | tee -a "${LOG_FILE}"
  log_line "pnpm_exit=${rc}"
  if ((rc != 0)) && ! grep -q 'ERR_PNPM_IGNORED_BUILDS' <<<"${out}"; then
    log_line "FAIL: pnpm update failed (exit ${rc}, timeout ${PNPM_TIMEOUT_SEC}s) — see output above"
    return "${EX_REINSTALL_FAILED}"
  fi
  if ((rc != 0)); then
    log_line "note: tolerating ERR_PNPM_IGNORED_BUILDS (pnpm exit ${rc}); verifying the artifact instead"
  fi
  log_line "lock_entry: $(grep -m1 -A2 'dsh-cloudcode-link@https://codeload' "${PROFILE_DIR}/pnpm-lock.yaml" 2>/dev/null | tr '\n' ' ' || echo '<not found>')"
}

phase2_verify_artifact() {
  log_line "--- phase 2: installed artifact verification ---"
  local installed_sha repo_sha
  installed_sha="$(sha256sum "${INSTALLED_DIR}/dist/index.js" 2>/dev/null | awk '{print $1}')"
  repo_sha="$(sha256sum "${REPO_ROOT}/dist/index.js" 2>/dev/null | awk '{print $1}')"
  log_line "installed_sha256=${installed_sha:-<missing>}"
  log_line "repo_sha256=${repo_sha:-<missing>}"
  log_line "expected_sha256=${EXPECTED_INDEX_SHA256}"
  if [[ "${installed_sha}" != "${EXPECTED_INDEX_SHA256}" ]]; then
    log_line "FAIL: installed artifact does not match expected hash — NOT restarting"
    return "${EX_HASH_MISMATCH}"
  fi
  if [[ "${repo_sha}" != "${EXPECTED_INDEX_SHA256}" ]]; then
    log_line "WARN: repo dist differs from expected (repo=${repo_sha}) — installed copy is authoritative"
  fi
  log_line "artifact_verified: OK"
}

phase3_git_state() {
  log_line "--- phase 3: git state (informational) ---"
  log_line "repo_head=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo '<n/a>')"
  log_raw git -C "${REPO_ROOT}" status --short
}

phase4_restart() {
  log_line "--- phase 4: single-owner restart ---"
  local runner="${REPO_ROOT}/scripts/deploy/restart-host.sh"
  log_line "cmd: ${runner} --schedule --force --no-probe"
  # --schedule returns as soon as the detached unit is scheduled; this runner
  # keeps running because systemd-run started the harness host, not this process.
  if ! log_raw bash "${runner}" --schedule --force --no-probe; then
    log_line "FAIL: restart-host.sh refused or failed to schedule"
    return "${EX_NO_RESTART}"
  fi
}

phase5_wait_ready() {
  log_line "--- phase 5: wait for restart + readiness (restart<=${RESTART_TIMEOUT_SEC}s, ready<=${READY_TIMEOUT_SEC}s) ---"
  local waited=0 new_start new_pid
  while ((waited < RESTART_TIMEOUT_SEC)); do
    new_start="$(host_start)"
    new_pid="$(host_pid)"
    if [[ -n "${new_start}" && "${new_start}" != "${OLD_START}" ]]; then
      log_line "restarted_after=${waited}s new_pid=${new_pid} new_start=${new_start}"
      break
    fi
    sleep "${POLL_INTERVAL_SEC}"
    waited=$((waited + POLL_INTERVAL_SEC))
  done
  if [[ "${new_start}" == "${OLD_START}" ]]; then
    log_line "FAIL: host did not restart within ${RESTART_TIMEOUT_SEC}s (start still ${OLD_START})"
    return "${EX_NO_RESTART}"
  fi

  waited=0
  local code
  while ((waited < READY_TIMEOUT_SEC)); do
    code="$(http_status)"
    if [[ "${code}" == "${READY_HTTP_EXPECTED}" ]]; then
      log_line "ready_http=${code} after=${waited}s"
      NEW_PID="${new_pid}"
      NEW_START="${new_start}"
      return 0
    fi
    sleep "${POLL_INTERVAL_SEC}"
    waited=$((waited + POLL_INTERVAL_SEC))
  done
  log_line "FAIL: HTTP never returned ${READY_HTTP_EXPECTED} within ${READY_TIMEOUT_SEC}s (last=${code})"
  return "${EX_NOT_READY}"
}

phase6_probe() {
  log_line "--- phase 6: post-restart probe ---"
  if [[ ! -f "${PROBE_SCRIPT}" ]]; then
    log_line "FAIL: probe script missing at ${PROBE_SCRIPT}"
    return "${EX_PROBE_FAILED}"
  fi

  # The probe resolves repo HEAD with git, so it MUST run with the repository as
  # cwd. A detached unit's cwd is $HOME, where `git rev-parse HEAD` fails and the
  # artifact_pinned check degrades to UNKNOWN — that is a probe-environment bug,
  # not a verdict. --repo/--out are passed explicitly so nothing depends on cwd,
  # and --out is a fresh directory so only THIS run's artifacts can appear in it.
  local probe_out="${LOG_DIR}/probe-out-$(utc_stamp)"
  mkdir -p -- "${probe_out}"
  local probe_exit=0
  ( cd "${REPO_ROOT}" && exec node "${PROBE_SCRIPT}" \
      --repo "${REPO_ROOT}" --out "${probe_out}" --installed "${INSTALLED_DIR}" ) || probe_exit=$?
  log_line "probe_exit=${probe_exit}"
  log_line "probe_out_dir=${probe_out}"

  # Exactly one json must have been produced by this run. Anything else (zero, or
  # leftovers) is a release failure — never fall back to "newest json on disk",
  # which is how a stale artifact once got published as this release's evidence.
  local produced
  produced="$(find "${probe_out}" -maxdepth 1 -name 'probe-*.json' -newermt "@${RUN_START_EPOCH}" 2>/dev/null | sort)"
  if [[ -z "${produced}" ]]; then
    log_line "FAIL: the probe produced no json in ${probe_out} — refusing to substitute an older artifact"
    return "${EX_PROBE_FAILED}"
  fi
  if [[ "$(printf '%s\n' "${produced}" | wc -l)" != "1" ]]; then
    log_line "FAIL: expected exactly one fresh probe json, got: $(printf '%s ' ${produced})"
    return "${EX_PROBE_FAILED}"
  fi
  PROBE_JSON="${produced}"
  log_line "probe_json_produced=${PROBE_JSON}"

  # Field-level assertions: the artifact must describe THIS release.
  local probe_report
  if ! probe_report="$(python3 - "${PROBE_JSON}" "${NEW_PID:-}" "${EXPECTED_INDEX_SHA256}" "${REPO_HEAD}" "${RUN_START_EPOCH}" <<'PY'
import json, sys
path, want_pid, want_sha, want_head, start = sys.argv[1:6]
d = json.load(open(path))
def bad(msg):
    print(f"MISMATCH {msg}")
    sys.exit(1)
got_sha = (d.get("installedSha256") or "")
got_pid = str(d.get("hostPid") or "")
got_head = (d.get("repoHead") or "")
verdict = d.get("verdict") or "UNKNOWN"
counts = d.get("counts") or {}
if got_sha != want_sha:
    bad(f"installedSha256={got_sha} expected {want_sha}")
if want_pid and got_pid != want_pid:
    bad(f"hostPid={got_pid} expected {want_pid}")
if not got_head:
    bad("repoHead is empty (probe could not resolve HEAD in its cwd)")
if want_head and got_head != want_head:
    bad(f"repoHead={got_head} expected {want_head}")
print(f"probe_verdict={verdict} counts={counts} hostPid={got_pid} repoHead={got_head} installedSha256={got_sha}")
if verdict != "PASS":
    print(f"VERDICT {verdict}")
    sys.exit(1)
PY
  )"; then
    log_line "FAIL: ${probe_report}"
    log_line "FAIL: probe artifact does not describe this release"
    return "${EX_PROBE_FAILED}"
  fi
  log_line "${probe_report}"

  cp -f -- "${PROBE_JSON}" "${LOG_DIR}/probe-$(utc_stamp).json"
  log_line "probe_json_published=${LOG_DIR}/probe-$(utc_stamp).json (from ${PROBE_JSON})"

  if ((probe_exit != 0)); then
    log_line "FAIL: probe exited ${probe_exit}"
    return "${EX_PROBE_FAILED}"
  fi
  return 0
}

phase7_summary() {
  log_line "--- phase 7: summary ---"
  log_line "old_pid=${OLD_PID} new_pid=${NEW_PID:-<unchanged>}"
  log_line "old_start=${OLD_START}"
  log_line "new_start=${NEW_START:-<unchanged>}"
  log_line "installed_sha256=$(sha256sum "${INSTALLED_DIR}/dist/index.js" 2>/dev/null | awk '{print $1}')"
  log_line "expected_sha256=${EXPECTED_INDEX_SHA256}"
  log_line "repo_head_at_start=${REPO_HEAD}"
  log_line "repo_head_at_end=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo '<n/a>')"
  log_line "probe_json=${PROBE_JSON:-<none>}"
  log_line "RESULT: RELEASE_OK"
  log_line "# finished_at: $(now_iso)"
}

usage() {
  cat <<'USAGE'
release-runner.sh — detached release orchestrator (see header for phases).

  (no args)      run all phases 0-7 (this restarts the host and kills sessions)
  --dry-phases   run phases 0-3 only: reinstall + artifact hash verification,
                 no restart, no probe
USAGE
}

main() {
  while (($#)); do
    case "$1" in
      --dry-phases) DRY_PHASES=1 ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        printf 'unknown argument: %s\n' "$1" >&2
        usage >&2
        return 2
        ;;
    esac
    shift
  done

  init_log
  require_expected_hash || return $?
  phase0_pre_state
  phase1_reinstall || return $?
  phase2_verify_artifact || return $?
  phase3_git_state

  if ((DRY_PHASES == 1)); then
    log_line "RESULT: DRY_PHASES_OK (phases 0-3, no restart performed)"
    return 0
  fi

  phase4_restart || return $?
  phase5_wait_ready || return $?
  phase6_probe || return $?
  phase7_summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
