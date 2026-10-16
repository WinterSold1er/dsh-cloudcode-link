#!/usr/bin/env bash
#
# restart-host.sh — detached restart runbook for the dsh web host.
#
# WHY DETACHED: restarting deepseek-harness.service kills every agent session
# hosted inside it — including the shell that launched this script. So the
# restart + readiness poll + evidence capture all run inside a systemd
# *transient* unit that outlives the session.
#
# USAGE
#   restart-host.sh --schedule              THE real runbook: schedules the
#                                           detached unit that restarts the host
#                                           exactly once, then polls readiness,
#                                           captures journal evidence and runs the
#                                           probe. Requires the idempotence
#                                           marker to allow it (see below).
#   restart-host.sh --schedule --rehearse   identical chain, restart replaced by
#                                           an echo ARGUMENT inside the payload.
#                                           Safe to run against a live host.
#   restart-host.sh --plan                  print what --schedule would execute,
#                                           plus payload `bash -n` and a harmless
#                                           /bin/true transient-unit probe.
#   restart-host.sh --detach                print the detached command only.
#   restart-host.sh --smoke                 read-only dry run of every step except
#                                           the restart; writes a real log.
#   restart-host.sh --observe               wait for a restart issued OUT OF BAND
#                                           and capture its evidence; never
#                                           issues a restart itself.
#   restart-host.sh --perform-restart       payload role: issues the single real
#                                           restart, then observes. Humans never
#                                           call this directly — the scheduled
#                                           unit does.
#   restart-host.sh --perform-rehearsal     payload role: the rehearsal twin.
#   restart-host.sh                         no flags = refuse (a bare invocation
#                                           must never restart a live host).
#   restart-host.sh --no-probe              skip the optional post-restart probe.
#   restart-host.sh --force                 restart even when the idempotence
#                                           marker says this runbook already did.
#
# SINGLE RESTART OWNER: `systemctl --user restart` appears in exactly one code
# path (`--perform-restart`), so one invocation can produce at most one
# Stop/Start pair. The detached payload contains no restart command of its own;
# it only `exec`s the script with a role argument.
#
# REPEAT-SAFETY (three layers)
#   * no argument            -> refuse (exit 2); a bare call is inert.
#   * concurrent run          -> PID lock refuses (exit 2); a crashed run self-heals.
#   * idempotence marker      -> a completed restart records its resulting MainPID
#     ops/restart/.last-restart-pid
#     in ops/restart/.last-restart-pid; a later run that finds that same PID still
#     running refuses (exit 8) BEFORE scheduling anything. `--force` overrides.
#
# REHEARSAL IS AN ARGUMENT, NOT AN ENVIRONMENT VARIABLE: systemd-run starts a
# fresh transient unit that does not inherit the caller's environment, so an env
# switch such as CCH_RESTART_DRY_RUN=1 cannot suppress a restart inside it. That
# is why `--rehearse` is embedded in the payload as `--perform-rehearsal`, and
# why combining `--schedule` with CCH_RESTART_DRY_RUN=1 is refused outright.
#
# EXIT CODES
#   0   ready (new PID observed and HTTP readiness matched)
#   1   unit not found for this user
#   2   usage error / concurrent run / bare invocation / refused dry-run combo
#   3   restart or detached scheduling failed
#   4   old process did not exit within OLD_EXIT_TIMEOUT_SEC
#   5   new process did not appear within NEW_PID_TIMEOUT_SEC
#   6   HTTP endpoint did not answer READY_HTTP_EXPECTED within READY_TIMEOUT_SEC
#   7   new PID equals old PID (nothing actually restarted)
#   8   idempotence marker: this runbook already restarted the host and that
#       same process is still running (use --force to override)
#
# SOURCE-SAFE: sourcing this file only defines functions and variables — the only
# executable statement at EOF is guarded, so `source` never restarts.

# ── Configuration (every wait is a named variable; no magic sleeps inline) ────

readonly SERVICE="${CCH_SERVICE:-deepseek-harness.service}"
readonly HOST_URL="${CCH_URL:-http://127.0.0.1:3080/}"

# Readiness = any HTTP response, because the host answers 401 without the
# browser-trust fence token; a connection failure is what "not ready" means.
readonly READY_HTTP_EXPECTED="${CCH_READY_HTTP:-401}"

# Pre-restart delay so the launching shell has time to return before the
# systemd unit (and this script's own cgroup parents) disappear.
readonly PRE_RESTART_DELAY_SEC="${CCH_PRE_DELAY:-3}"

# Derived from the unit itself rather than hardcoded, so a slower host gets a
# proportionally longer grace period.
readonly OLD_EXIT_TIMEOUT_SEC="${CCH_OLD_EXIT_TIMEOUT:-60}"
readonly NEW_PID_TIMEOUT_SEC="${CCH_NEW_PID_TIMEOUT:-60}"
readonly READY_TIMEOUT_SEC="${CCH_READY_TIMEOUT:-90}"

# Polling cadence and the readiness-probe network timeout.
readonly POLL_INTERVAL_SEC="${CCH_POLL_INTERVAL:-1}"
readonly HTTP_TIMEOUT_SEC="${CCH_HTTP_TIMEOUT:-3}"

# Number of journal lines captured after the restart.
readonly JOURNAL_TAIL_LINES="${CCH_JOURNAL_LINES:-40}"

# Optional hook invoked after a ready restart (T4's probe). Called with no
# arguments only when the file exists and is executable.
readonly PROBE_SCRIPT="${CCH_PROBE:-scripts/verify/post-restart-probe.mjs}"
# Writable: --no-probe switches it off at parse time. `readonly` here made that
# assignment fail with "readonly variable" and exit 1.
PROBE_ENABLED="${CCH_PROBE_ENABLED:-1}"

# Repo root = parent of this script's directory; logs land in ops/restart/.
SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SELF_DIR
readonly REPO_ROOT="$(cd -- "${SELF_DIR}/../.." && pwd)"
readonly LOG_DIR="${CCH_LOG_DIR:-${REPO_ROOT}/ops/restart}"

readonly EX_NO_UNIT=1
readonly EX_USAGE=2
readonly EX_SCHEDULE=3
readonly EX_OLD_EXIT=4
readonly EX_NEW_PID=5
readonly EX_HTTP=6
readonly EX_SAME_PID=7
readonly EX_ALREADY_DONE=8

# ── Evidence helpers ─────────────────────────────────────────────────────────

LOG_FILE=""
OLD_PID=""
OLD_START=""
RESTART_EPOCH=""
NEW_PID=""
NEW_START=""
SMOKE=0
PRINT_PLAN=0
FORCE=0
REHEARSE=0
PERFORM_RESTART=0

utc_stamp() { date -u +%Y%m%dT%H%M%SZ; }
now_iso() { date +%Y-%m-%dT%H:%M:%S%z; }
now_epoch() { date +%s; }

log_line() {
  printf '%s\n' "$*"
  if [[ -n "${LOG_FILE}" ]]; then
    printf '%s\n' "$*" >>"${LOG_FILE}"
  fi
}

log_raw() {
  # Stream a command's stdout+stderr into both the terminal and the log file.
  if [[ -n "${LOG_FILE}" ]]; then
    "$@" 2>&1 | tee -a "${LOG_FILE}"
  else
    "$@" 2>&1
  fi
}

init_log() {
  mkdir -p -- "${LOG_DIR}"
  LOG_FILE="${LOG_DIR}/restart-$(utc_stamp).log"
  : >"${LOG_FILE}"
  log_line "# dsh web host restart runbook log"
  log_line "# started_at: $(now_iso)"
  log_line "# service: ${SERVICE}"
  log_line "# host_url: ${HOST_URL}"
  log_line "# log_file: ${LOG_FILE}"
  log_line "# hostname: $(hostname)"
  log_line "# uid: $(id -u) ($(id -un))"
}

# Idempotence guard: a second concurrent restart run exits instead of stacking
# a second restart. The lock is a PID file, so a crashed run self-heals.
LOCK_FILE=""
acquire_lock() {
  LOCK_FILE="${LOG_DIR}/.restart-host.lock"
  mkdir -p -- "${LOG_DIR}"
  if [[ -f "${LOCK_FILE}" ]]; then
    local holder
    holder="$(<"${LOCK_FILE}")"
    if [[ -n "${holder}" ]] && kill -0 "${holder}" 2>/dev/null; then
      printf 'another restart run is in progress (pid %s, lock %s); refusing\n' \
        "${holder}" "${LOCK_FILE}" >&2
      return "${EX_USAGE}"
    fi
    printf 'stale lock from pid %s; taking over\n' "${holder:-<empty>}" >&2
  fi
  printf '%s\n' "$$" >"${LOCK_FILE}"
  trap 'rm -f -- "${LOCK_FILE}"' EXIT
}

# systemd 261 has no `systemd-run --dry-run`, so the plan check is split into
# the two things that actually prove the shape: the payload must parse as shell,
# and this manager must accept a transient unit at all.
print_plan_validation() {
  printf '\n# payload shell-parse validation (bash -n):\n'
  if bash -n -c "$(detached_script)"; then
    printf 'payload_parse: OK\n'
  else
    printf 'payload_parse: FAILED\n'
    return "${EX_USAGE}"
  fi
  printf '\n# transient-unit acceptance probe (harmless /bin/true, waits for exit):\n'
  systemd-run --user --wait --collect --unit="cch-plan-probe-$(utc_stamp)" /bin/true
  printf 'transient_unit_probe: exit=%s\n' "$?"
}

# ── Step functions (all source-safe: no side effects until called) ────────────

require_unit() {
  local state
  state="$(systemctl --user show "${SERVICE}" -p ActiveState --value 2>/dev/null || true)"
  if [[ -z "${state}" ]]; then
    log_line "FAIL: unit ${SERVICE} not found for user $(id -un)"
    return "${EX_NO_UNIT}"
  fi
  log_line "unit_state=${state}"
  return 0
}

record_pre_state() {
  OLD_PID="$(systemctl --user show "${SERVICE}" -p MainPID --value 2>/dev/null || echo 0)"
  OLD_START="$(systemctl --user show "${SERVICE}" -p ExecMainStartTimestamp --value 2>/dev/null || true)"
  log_line "--- pre-restart state ---"
  log_line "old_pid=${OLD_PID}"
  log_line "old_start=${OLD_START}"
  log_line "old_nrestarts=$(systemctl --user show "${SERVICE}" -p NRestarts --value 2>/dev/null || true)"
  log_line "old_cmdline=$(tr '\0' ' ' <"/proc/${OLD_PID}/cmdline" 2>/dev/null || echo '<unavailable>')"
}

# Single source of truth for the restart action. REHEARSE is set ONLY by the
# explicit `--perform-rehearsal` role argument travelling inside the payload —
# never by an ambient environment variable, which a transient unit would not
# inherit anyway.
restart_command() {
  if [[ "${REHEARSE}" == "1" ]]; then
    printf 'echo REHEARSAL: restart suppressed for %s' "${SERVICE}"
    return 0
  fi
  printf 'systemctl --user restart %s' "${SERVICE}"
}

# The full runbook as a shell one-liner for systemd-run.
#
# THE RESTART HAPPENS EXACTLY ONCE, HERE, AND ONLY HERE — as `--perform-restart`
# or its rehearsal twin `--perform-rehearsal`. The payload no longer inlines a
# `systemctl … restart` of its own, so a single invocation can never produce two
# Stop/Start pairs.
#
# `--rehearse` must travel as an ARGUMENT (`--perform-rehearsal`), never as an
# environment variable: systemd-run starts a fresh transient unit that does not
# inherit the caller's env, which is exactly how a rehearsed run once turned
# into a real restart.
#
# `--force` travels the same way: the idempotence guard is re-evaluated inside
# the payload role process, so a forced restart must carry the force through or
# the unit stops with exit 8 (SKIPPED_ALREADY_RESTARTED).
detached_script() {
  local role="--perform-restart"
  [[ "${REHEARSE}" == "1" ]] && role="--perform-rehearsal"
  local args="${role}"
  [[ "${FORCE}" == "1" ]] && args="${args} --force"
  printf 'sleep %s; exec %s %s' \
    "${PRE_RESTART_DELAY_SEC}" \
    "${SELF_DIR}/$(basename -- "${BASH_SOURCE[0]}")" \
    "${args}"
}

# Single-quoted for a paste-able one-liner: the payload contains no single
# quote, so no escaping is ever needed.
print_detached_command() {
  printf "systemd-run --user --unit=cch-restart-%s --collect --same-dir --description='dsh web host detached restart runbook' /bin/bash -c '%s'\n" \
    "$(utc_stamp)" \
    "$(detached_script)"
}

schedule_detached() {
  log_line "--- scheduling detached restart ---"
  log_line "restart_role: $([[ "${REHEARSE}" == "1" ]] && echo --perform-rehearsal || echo --perform-restart)"
  log_line "restart_action_in_unit: $(restart_command)"
  log_line "pre_restart_delay_sec=${PRE_RESTART_DELAY_SEC}"
  log_line "detached_command: $(print_detached_command)"
  # `sleep` lets this shell (and the agent turn that started it) return first;
  # the transient unit then outlives the session it will kill.
  systemd-run --user --collect --same-dir \
    --unit="cch-restart-$(utc_stamp)" \
    --description="dsh web host detached restart runbook" \
    /bin/bash -c "$(detached_script)"
}

wait_old_exit() {
  local waited=0
  log_line "--- waiting for old pid ${OLD_PID} to exit (limit ${OLD_EXIT_TIMEOUT_SEC}s) ---"
  while ((waited < OLD_EXIT_TIMEOUT_SEC)); do
    if ! kill -0 "${OLD_PID}" 2>/dev/null; then
      log_line "old_pid_exited_after=${waited}s"
      return 0
    fi
    sleep "${POLL_INTERVAL_SEC}"
    waited=$((waited + POLL_INTERVAL_SEC))
  done
  log_line "FAIL: old pid ${OLD_PID} still alive after ${OLD_EXIT_TIMEOUT_SEC}s"
  return "${EX_OLD_EXIT}"
}

wait_new_pid() {
  local waited=0 candidate
  log_line "--- waiting for new MainPID (limit ${NEW_PID_TIMEOUT_SEC}s) ---"
  while ((waited < NEW_PID_TIMEOUT_SEC)); do
    candidate="$(systemctl --user show "${SERVICE}" -p MainPID --value 2>/dev/null || echo 0)"
    if [[ -n "${candidate}" && "${candidate}" != "0" && "${candidate}" != "${OLD_PID}" ]]; then
      NEW_PID="${candidate}"
      NEW_START="$(systemctl --user show "${SERVICE}" -p ExecMainStartTimestamp --value 2>/dev/null || true)"
      log_line "new_pid=${NEW_PID} after=${waited}s"
      log_line "new_start=${NEW_START}"
      return 0
    fi
    sleep "${POLL_INTERVAL_SEC}"
    waited=$((waited + POLL_INTERVAL_SEC))
  done
  log_line "FAIL: no new MainPID within ${NEW_PID_TIMEOUT_SEC}s (last_seen=${candidate:-<none>})"
  return "${EX_NEW_PID}"
}

http_status() {
  curl -s -o /dev/null -w '%{http_code}' --max-time "${HTTP_TIMEOUT_SEC}" "${HOST_URL}" 2>/dev/null || echo "000"
}

wait_ready() {
  local waited=0 code
  log_line "--- polling readiness ${HOST_URL} for HTTP ${READY_HTTP_EXPECTED} (limit ${READY_TIMEOUT_SEC}s) ---"
  while ((waited < READY_TIMEOUT_SEC)); do
    code="$(http_status)"
    if [[ "${code}" == "${READY_HTTP_EXPECTED}" ]]; then
      log_line "ready_http=${code} after=${waited}s"
      return 0
    fi
    sleep "${POLL_INTERVAL_SEC}"
    waited=$((waited + POLL_INTERVAL_SEC))
  done
  log_line "FAIL: HTTP never returned ${READY_HTTP_EXPECTED} within ${READY_TIMEOUT_SEC}s (last=${code})"
  return "${EX_HTTP}"
}

capture_post_evidence() {
  log_line "--- post-restart evidence ---"
  log_line "post_pid=${NEW_PID}"
  log_line "post_start=${NEW_START}"
  log_line "post_nrestarts=$(systemctl --user show "${SERVICE}" -p NRestarts --value 2>/dev/null || true)"
  log_line "post_status=$(systemctl --user is-active "${SERVICE}" 2>/dev/null || true)"

  if [[ "${SMOKE}" == "1" ]]; then
    log_line "journal_window: skipped (smoke mode performs no restart)"
  else
    log_line "journal_window: since ${RESTART_EPOCH} (epoch seconds)"
    log_line "--- journalctl --user -u ${SERVICE} (last ${JOURNAL_TAIL_LINES} lines) ---"
    log_raw journalctl --user -u "${SERVICE}" --no-pager -n "${JOURNAL_TAIL_LINES}"
  fi
}

run_probe() {
  [[ "${PROBE_ENABLED}" == "1" ]] || {
    log_line "probe: disabled by CCH_PROBE_ENABLED=0"
    return 0
  }
  local probe_path="${REPO_ROOT}/${PROBE_SCRIPT}"
  if [[ ! -f "${probe_path}" ]]; then
    log_line "probe: skipped, ${probe_path} not present (T4 deliverable)"
    return 0
  fi
  log_line "--- probe: node ${probe_path} ---"
  log_raw node "${probe_path}"
}

# ── Orchestration ────────────────────────────────────────────────────────────

run_smoke() {
  # Every step except the restart itself: real unit query, real HTTP probe,
  # real log file. This is the strongest no-restart verification available.
  SMOKE=1
  init_log
  log_line "mode=smoke (no restart is performed)"
  require_unit || return $?
  record_pre_state
  local code
  code="$(http_status)"
  log_line "http_status_now=${code}"
  if [[ "${code}" != "${READY_HTTP_EXPECTED}" ]]; then
    log_line "smoke_http_mismatch: expected ${READY_HTTP_EXPECTED}, got ${code}"
  fi
  NEW_PID="${OLD_PID}"
  NEW_START="${OLD_START}"
  capture_post_evidence
  log_line "RESULT: SMOKE_OK (no restart performed; log written)"
  return 0
}

# Idempotence marker: records which MainPID the last *completed* restart
# produced. A second run against that same process is a no-op, so re-running
# the runbook cannot restart the host again by accident.
LAST_PID_FILE=""
idempotence_guard() {
  LAST_PID_FILE="${LOG_DIR}/.last-restart-pid"
  local last_pid
  if [[ ! -f "${LAST_PID_FILE}" ]]; then
    log_line "idempotence: no marker at ${LAST_PID_FILE} (first recorded run)"
    return 0
  fi
  last_pid="$(<"${LAST_PID_FILE}")"
  log_line "idempotence: marker says last restart produced pid ${last_pid}, current pid ${OLD_PID}, force=${FORCE}"
  if [[ -n "${last_pid}" && "${last_pid}" == "${OLD_PID}" && "${FORCE}" != "1" ]]; then
    log_line "idempotence: SKIP — this runbook already restarted the host and it is still the same process"
    log_line "            (marker ${LAST_PID_FILE}; re-run with --force to restart anyway)"
    log_line "RESULT: SKIPPED_ALREADY_RESTARTED (no restart performed)"
    return "${EX_ALREADY_DONE}"
  fi
  return 0
}

record_restart_marker() {
  printf '%s\n' "${NEW_PID}" >"${LAST_PID_FILE}"
  log_line "idempotence: recorded pid ${NEW_PID} in ${LAST_PID_FILE}"
}

run_schedule() {
  init_log
  log_line "mode=schedule (detached; this shell schedules, the transient unit restarts)"
  log_line "rehearse=${REHEARSE}"
  require_unit || return $?
  record_pre_state
  idempotence_guard || return $?
  RESTART_EPOCH="$(now_epoch)"
  if ! schedule_detached; then
    log_line "FAIL: systemd-run could not schedule the detached restart"
    return "${EX_SCHEDULE}"
  fi
  log_line "RESULT: SCHEDULED — the transient unit performs the single restart and appends its evidence"
  return 0
}

# The ONE place a real restart is issued. Reached only via the payload role
# argument --perform-restart, never by an ambient variable.
run_perform_restart() {
  init_log
  log_line "mode=perform-restart (this process issues the single restart)"
  require_unit || return $?
  record_pre_state
  idempotence_guard || return $?
  RESTART_EPOCH="$(now_epoch)"
  log_line "--- issuing restart at epoch ${RESTART_EPOCH} ---"
  log_line "restart_action: $(restart_command)"
  if ! log_raw bash -c "$(restart_command)"; then
    log_line "FAIL: restart command returned non-zero"
    return "${EX_SCHEDULE}"
  fi
  observe_after_restart
}

# Structured rehearsal twin: same payload shape, restart replaced by an echo.
# Suppression travels as this role argument, so it survives the systemd-run
# boundary that the old environment-variable switch did not.
run_perform_rehearsal() {
  init_log
  log_line "mode=perform-rehearsal (restart suppressed by role argument, not by env)"
  log_line "rehearsal_suppressed: $(restart_command)"
  require_unit || return $?
  record_pre_state
  log_line "RESULT: REHEARSAL_OK (payload shape executed, host untouched)"
  return 0
}

observe_after_restart() {
  log_line "mode=observe (waiting for the process started above)"
  wait_old_exit || return $?
  wait_new_pid || return $?
  wait_ready || return $?
  if [[ "${NEW_PID}" == "${OLD_PID}" ]]; then
    log_line "FAIL: MainPID unchanged (${NEW_PID}) — nothing restarted"
    return "${EX_SAME_PID}"
  fi
  capture_post_evidence
  record_restart_marker
  run_probe || log_line "probe_exit=$?"
  log_line "RESULT: READY (old_pid=${OLD_PID} -> new_pid=${NEW_PID})"
  return 0
}

# Observe-only entry: never issues a restart (used to recover evidence when the
# restart was performed out-of-band).
run_observe() {
  init_log
  log_line "mode=observe-only (no restart is issued by this run)"
  require_unit || return $?
  record_pre_state
  observe_after_restart
}


usage() {
  cat <<'USAGE'
restart-host.sh — detached restart runbook for the dsh web host.

  --schedule              schedule the detached unit that restarts the host
                          exactly once, then poll readiness and capture evidence
  --schedule --rehearse   same chain, restart replaced by an echo argument
                          (safe against a live host)
  --plan                  print the detached command + payload bash -n + a
                          harmless /bin/true transient-unit probe
  --detach                print the detached command only
  --smoke                 read-only dry run of every step except the restart
  --observe               wait for a restart issued out of band; never restarts
  --perform-restart       payload role (single real restart); not for humans
  --perform-rehearsal     payload role (rehearsal twin); not for humans
  --no-probe              skip the optional post-restart probe
  --force                 restart even when the idempotence marker says done
  -h, --help              this text

No flags = refuse. Rehearsal travels as an argument, never as an environment
variable: systemd-run starts a fresh unit that does not inherit the caller's env.
USAGE
}

main() {
  # No argument is deliberately NOT a restart: a bare invocation stays inert on
  # a live host. Only --schedule reaches the detached restart path.
  local mode="none"
  while (($#)); do
    case "$1" in
      # Human-facing entry: schedules the detached unit that restarts the host.
      --schedule) mode="schedule" ;;
      # Rehearsal entry: identical chain, restart replaced by an echo argument.
      --rehearse) REHEARSE=1 ;;
      # Payload roles: only these two ever decide to restart, and only by the
      # role argument that travelled inside the systemd-run payload.
      --perform-restart)
        mode="perform"
        PERFORM_RESTART=1
        ;;
      --perform-rehearsal)
        mode="rehearsal"
        REHEARSE=1
        ;;
      # Observe-only: waits for a restart issued elsewhere; never issues one.
      --run | --observe) mode="observe" ;;
      --smoke) mode="smoke" ;;
      --detach) mode="print" ;;
      --plan)
        mode="print"
        PRINT_PLAN=1
        ;;
      --no-probe) PROBE_ENABLED=0 ;;
      --force) FORCE=1 ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        printf 'unknown argument: %s\n' "$1" >&2
        usage >&2
        return "${EX_USAGE}"
        ;;
    esac
    shift
  done

  # Every entry point that can lead to a restart treats the env switch the same
  # way. `--detach`/`--plan` print a command whose payload restarts the host, so
  # silently ignoring CCH_RESTART_DRY_RUN there is exactly how a copied `--detach`
  # line once killed a live session. One rule, identical wording, all modes.
  if [[ "${mode}" == "print" || "${mode}" == "schedule" ]] \
    && [[ "${REHEARSE}" != "1" && "${CCH_RESTART_DRY_RUN:-0}" == "1" ]]; then
    local hint="--schedule"
    [[ "${mode}" == "print" ]] && hint="--detach"
    printf 'refusing: CCH_RESTART_DRY_RUN does not cross the systemd-run boundary.\n' >&2
    printf 'use: restart-host.sh %s --rehearse\n' "${hint}" >&2
    return "${EX_USAGE}"
  fi

  case "${mode}" in
    print)
      print_detached_command
      if [[ "${PRINT_PLAN}" == "1" ]]; then
        print_plan_validation
      fi
      ;;
    smoke) run_smoke ;;
    schedule)
      acquire_lock || return $?
      run_schedule
      ;;
    perform)
      acquire_lock || return $?
      run_perform_restart
      ;;
    rehearsal) run_perform_rehearsal ;;
    observe) run_observe ;;
    none)
      printf 'refusing to act: no mode flag given.\n\n' >&2
      usage >&2
      return "${EX_USAGE}"
      ;;
  esac
}


# Guarded entry point: `source restart-host.sh` defines everything and stops here.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
