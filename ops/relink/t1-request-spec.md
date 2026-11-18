# T1 direct-egress request spec (cloudcode-pa)

Status: recon complete, **0 real upstream requests issued by this session**.
Executor: the T1 experiment agent (not recon). Recon only read local files and ran
`--dry-run` (no network I/O).

Repo: `/home/csy/Code/Github/dsh-cloudcode-link`
Plugin call chain: `packages/core/src/client.ts`, `net.ts`, `oauth.ts`, `quota.ts`, `pool.ts`.
CLI evidence: `/usr/bin/agy` 1.3.5, `~/.local/lib/agy/agy-1.3.5-patched`, wrapper `~/.local/bin/agy`,
`/tmp/agy-fix/gate2/**` (read-only), `/tmp/agy-fix/mitm/capture/**` (read-only capture files),
`~/.gemini/antigravity-cli/log/*.log` (read-only).

---

## 1. Endpoint candidates

Plugin (`packages/core/src/client.ts`):

| order | URL | source |
|---|---|---|
| 1 | `https://cloudcode-pa.googleapis.com` | `DEFAULT_ENDPOINT` + `ENDPOINT_FALLBACKS[0]` |
| 2 | `https://daily-cloudcode-pa.googleapis.com` | `ENDPOINT_FALLBACKS[1]` |
| 3 | `https://daily-cloudcode-pa.sandbox.googleapis.com` | `ENDPOINT_FALLBACKS[2]` |

Quota/oauth module (`packages/core/src/oauth.ts` `AGY_ENDPOINTS`) additionally lists
`https://autopush-cloudcode-pa.sandbox.googleapis.com` (4th, used by `quota.ts` only).

Override: `endpointCandidates()` returns exactly one endpoint if `--endpoint`-style
`ANTIGRAVITY_BASE_URL` is set or a custom base URL is passed (trailing `/` stripped).

Generation call (plugin):

```
POST {base}/v1internal:streamGenerateContent?alt=sse
```

Other RPCs used by the plugin (all `POST`, 10 s discovery timeout):
`/v1internal:loadCodeAssist`, `/v1internal:listCloudAICompanionProjects`,
`/v1internal:onboardUser`, `/v1internal:getOperation`, `/v1internal:retrieveUserQuotaSummary`.

Observed CLI traffic (MITM capture `capture/daily-cloudcode-pa.googleapis.com/`):
CLI hits **`daily-cloudcode-pa.googleapis.com`** with the same
`/v1internal:streamGenerateContent?alt=sse` path and got `HTTP/1.1 200 OK`
(`20261116T081811Z-33.resp.txt`, also `...-35`). A `GET /v1internal:loadCodeAssist`
attempt got 404; valid requests use POST. A stale token produced 401
`invalid_token` (`20261116T074608Z-4.resp.txt`).

**Primary endpoint recommendation:** `https://cloudcode-pa.googleapis.com`
(plugin order, task target). Arm C (`daily-cloudcode-pa`) exists because it is the
only endpoint with an observed 200 for this account/body family; run it as the
positive control, not as a fallback inside one probe run.

---

## 2. Headers

Plugin assembly (`antigravityHeaders()` + `streamGenerateContent()`):

| header | value |
|---|---|
| `Authorization` | `Bearer <access_token>` |
| `Content-Type` | `application/json` |
| `Accept` | `text/event-stream` |
| `User-Agent` | `antigravity/hub/${ANTIGRAVITY_HUB_VERSION:-2.8.0} (aidev_client; os_type=linux; arch=x64; cl=${ANTIGRAVITY_HUB_CL:-963137146})` |
| `X-Goog-Api-Client` | `google-cloud-sdk vscode_cloudshelleditor/0.1` |
| `Client-Metadata` | `{"ideType":"ANTIGRAVITY","platform":"PLATFORM_LINUX","pluginType":"GEMINI"}` |
| `anthropic-beta` | `interleaved-thinking-2025-05-14` (only when model starts with `claude-`) |

`platform` is `PLATFORM_LINUX` / `PLATFORM_DARWIN` / `PLATFORM_WINDOWS` from `process.platform`;
`os` in UA is `linux` / `darwin` / `windows`; `arch` is `arm64` or `x64`.

CLI actual headers (MITM capture, authoritative):

```
Host: daily-cloudcode-pa.googleapis.com
User-Agent: antigravity/cli/1.3.5 (aidev_client; os_type=linux; arch=amd64; cl=998863838; auth_method=consumer)
Content-Length: <n>
Authorization: Bearer ***REDACTED***
Content-Type: application/json
Accept-Encoding: gzip
```

The CLI binary does **not** contain the strings `X-Goog-Api-Client` or `Client-Metadata`
(`strings -a | grep -c` = 0 both), so those two headers are plugin-specific. It contains
both OAuth client ids (`1071006060591-tmhs...`, `884354919052-36tr...`) and both
`GOCSPX-...` secrets; the plugin/CLI consumer flow uses the `1071...` client.

Arms in `t1-probe.sh` therefore differ only by UA / extra headers / endpoint:

| arm | UA | extra headers | default endpoint |
|---|---|---|---|
| A | plugin `antigravity/hub/2.8.0 ... arch=x64; cl=963137146` | `X-Goog-Api-Client`, `Client-Metadata` | `cloudcode-pa` |
| B | CLI `antigravity/cli/1.3.5 ... arch=amd64; cl=998863838; auth_method=consumer` | none | `cloudcode-pa` |
| C | CLI (same as B) | none | `daily-cloudcode-pa` |

`--endpoint <url>` overrides the default but still yields exactly one URL.

---

## 3. Body

Plugin request type (`AntigravityGenerateRequest`, `client.ts:94`):

```json
{
  "project": "<project id>",
  "model": "<wire model slug>",
  "request": {
    "contents": [{"role": "user", "parts": [{"text": "..."}]}],
    "systemInstruction": {"parts": [{"text": "..."}]},
    "generationConfig": {"temperature": 0, "maxOutputTokens": 0,
      "thinkingConfig": {"includeThoughts": true, "thinkingLevel": "LOW"}},
    "tools": [{"functionDeclarations": []}],
    "toolConfig": {"functionCallingConfig": {"mode": "AUTO"}},
    "sessionId": "<fnv1a64 of session>",
    "labels": {}
  },
  "requestType": "AGENT",
  "userAgent": "ANTIGRAVITY",
  "requestId": "agent/<trajectoryId>/<step>"
}
```

`requestType` is always `AGENT`, `userAgent` always `ANTIGRAVITY`; `labels` carries
`last_step_index`, `trajectory_id`, `used_claude`, `used_claude_conservative`, and
`model_enum` when known (`ANTIGRAVITY_MODEL_ENUM`).

Project id source, in order: in-memory cache (30 min, keyed by token) →
`loadCodeAssist` → `extractProjectId()` (accepts `antigravityProjectId`, `projectId`,
`backendProjectId`, `userDefinedCloudaicompanionProject`, `cloudaicompanionProject`,
`project`, `id`, plus nested `projects[]`) → `listCloudAICompanionProjects` →
`onboardUser` + `getOperation` poll → deterministic `stableProjectId(seed)` /
`ANTIGRAVITY_PROJECT_ID`. Captured `loadCodeAssist` response for this account returned
`"cloudaicompanionProject": "aicode-consumers"` (and `currentTier` `standard-tier`).

CLI generation body (captured, 942 bytes, same endpoint):

```json
{"project":"aicode-consumers","requestId":"checkpoint/<uuid>","request":{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"systemInstruction":{"role":"user","parts":[{"text":"You are a conversation title generator. ..."}]},"generationConfig":{"thinkingConfig":{"includeThoughts":true,"thinkingLevel":"LOW"}},"sessionId":"-3750763034362895579"},"model":"gemini-3.5-flash-lite","userAgent":"antigravity","requestType":"checkpoint"}
```

This exact shape produced HTTP 200 + SSE (`data: {"response": ...}`) twice
(`/tmp/agy-fix/gate2/exp/pre_single/out_1.txt`, `out_2.txt`, both `status: SUCCESS`).

### Probe body (identical across arms, 362 bytes with default project)

```json
{"project":"aicode-consumers","requestId":"checkpoint/00000000-0000-4000-8000-000000000000","request":{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"thinkingConfig":{"includeThoughts":true,"thinkingLevel":"LOW"}},"sessionId":"-3750763034362895579"},"model":"gemini-3.5-flash-lite","userAgent":"antigravity","requestType":"checkpoint"}
```

Differences from the captured CLI body: fixed requestId UUID instead of a random one,
no `systemInstruction` (title-generator prompt omitted). Everything else is
byte-compatible with the body that returned 200.

Body byte-identity rule: the script writes the body once via
`json.dumps(..., separators=(",", ":"), ensure_ascii=False)`, then sends that same file
in every arm. The hash is over the raw file:

```bash
python3 - <<'EOF'
import hashlib
print(hashlib.sha256(open('/tmp/request.json','rb').read()).hexdigest())
EOF
# or: sha256sum /tmp/request.json
```

Default-project sha256: `8d9647890ce6f8b7b82ac466db3c324499225016fc3b527cd7964fb5967f40bb`
(362 bytes). If `--project` changes, the hash changes; all arms must use the same
`--project`, and the JSON records `request_body_sha256` for comparison.

---

## 4. 429 / 404 / SSE / timeout / retry semantics

- `streamGenerateContent` returns immediately on `400`, `401`, `403`, `429`.
  For any other non-ok status (e.g. 404, 500) it **falls through to the next endpoint**,
  so the plugin itself is not a single-shot client. The probe deliberately does not
  reproduce this: one endpoint, one `curl`, no `--retry`, no fallback.
- Stream timeout: `timeoutMs: null` for `streamGenerateContent`, i.e. no client timeout.
  The probe uses `curl --max-time 45`.
- SSE frames are `data: {json}`; payload nests the Gemini response under
  `{"response": {...}, "traceId": ..., "metadata": ...}` (`sse-mapper.ts`).
- 429 observed at pool level: `{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}`
  stored in `pool.json` cooldowns (expired by now).
- `--dry-run` exits 0 without refreshing or sending; real run exits 0 even on a non-2xx
  HTTP status (status recorded), `10` on refresh failure, `11` on usage errors.

---

## 5. Token: source, file, refresh

Pool: `~/.dsh/agy-accounts/pool.json` (read-only for recon).
5 accounts, all `enabled: true`, each with `id`, `email`, `dir`, `cooldowns`, `quotas`.
Token file per account: `<dir>/.gemini/antigravity-cli/antigravity-oauth-token`, shape:

```json
{"token":{"access_token":"<opaque>","token_type":"Bearer","refresh_token":"<opaque>","expiry":"2026-11-16T10:34:38.124Z"},"auth_method":"consumer"}
```

- Account used for evidence: index 3, `z***@gmail.com`, dir `.../acc_1788769443420_5ptu4`.
  Access token present (261 chars, opaque, not a JWT), expiry `2026-11-16T10:34:38Z`,
  refresh token present (103 chars).
- Plugin token read/refresh: `quota.ts getTokenFilePath()` → `readFileSync` →
  `normalizeStoredToken()` (`token.access_token` / `token.refresh_token` / `token.expiry`);
  refresh via `oauth.ts refreshTokens()` → `postTokenForm({grant_type: 'refresh_token',
  refresh_token})` to `https://oauth2.googleapis.com/token` with
  `client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`,
  `client_secret=<AGY_CLIENT_SECRET>` (public installed-app client; the literal is not
  committed here — it is `AGY_PUBLIC_CLIENT_SECRET` in `packages/core/src/oauth.ts`, and
  both id and secret are overridable with `AGY_CLIENT_ID` / `AGY_CLIENT_SECRET`).
  Scopes: `cloud-platform`, `aicode`, `userinfo.email`, `userinfo.profile`, `cclog`,
  `experimentsandconfigs` — six scopes, matching `oauth.ts AGY_SCOPES`. The five-scope list this
   file used to carry is superseded: `https://www.googleapis.com/auth/aicode` was missing, and a
   token minted without it comes back `403 PERMISSION_DENIED / Request had insufficient
   authentication scopes / ACCESS_TOKEN_SCOPE_INSUFFICIENT` from the AICode backend that
   `use-aicode-mendel=true` routes agy through. Only a scope was added, none removed.
   Binary evidence (read-only, 2026-11-18, `/usr/bin/agy` sha256
   `b5385638174a5e720e904f3a2678752534fb8414d10c2c302fa16daf56cbcfc9`, 215 060 688 B):
   `strings -a /usr/bin/agy | grep -o 'https://www.googleapis.com/auth/[a-z0-9._-]*' | sort -u`.
   Trap — do not skip the recount: Go packs adjacent string literals back-to-back in one rodata
   run with no separator, so `grep -o` prints merged tokens such as `auth/aicodefailed`,
   `auth/cloud-platformhttps`, `auth/drive.metadatahttps` and `auth/drivecall`; a name cut out of
   such a run is not a scope name. Count the shared prefix instead, which concatenation cannot
   distort: `grep -a -o 'https://www\.googleapis\.com/auth/' /usr/bin/agy | wc -l` → **16**
   literals. Then recount per candidate name
   (`grep -a -o -F "https://www.googleapis.com/auth/<name>" /usr/bin/agy | wc -l`): 6 CLI-auth
   names at 1 occurrence each (the six listed) + 10 Drive-integration names (`drive`,
   `drive.appdata`, `drive.apps.readonly`, `drive.file`, `drive.meet.readonly`, `drive.metadata`,
   `drive.metadata.readonly`, `drive.photos.readonly`, `drive.readonly`, `drive.scripts`).
   Per-name counts overlap by prefix — `drive` matches 10 times because it is also the prefix of
   the nine `drive.*` names, `drive.metadata` twice because of `drive.metadata.readonly` — so a
   per-name number only adds up once the longer names it shadows are subtracted. 6 + 10 = 16 ✓.
   The Drive half is deliberately **not** requested by the probe: it widens the consent screen for
   our shared client, and one scope the client is not registered for makes Google reject the whole
   authorize request.
- Important: the plugin's refresh **writes the new access token back** to the account
  token file (`quota.ts persistRefreshedToken`). The probe does **not** do this — it
  refreshes in memory and never writes `pool.json`, the account dir, or any token file.

In-memory refresh command (no file writes, no token on stdout except the captured
shell variable; use it only inside the experiment session):

```bash
ACCESS=$(python3 - "$HOME/.dsh/agy-accounts/acc_1788769443420_5ptu4/.gemini/antigravity-cli/antigravity-oauth-token" <<'PY'
import json,sys,urllib.parse,urllib.request
t=json.load(open(sys.argv[1])); t=t.get("token",t)
form=urllib.parse.urlencode({"client_id":"1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
 "client_secret":__import__("os").environ["AGY_CLIENT_SECRET"],
 "grant_type":"refresh_token","refresh_token":t["refresh_token"]}).encode()
r=urllib.request.Request("https://oauth2.googleapis.com/token",data=form,
 headers={"Content-Type":"application/x-www-form-urlencoded"})
print(json.load(urllib.request.urlopen(r,timeout=20))["access_token"])
PY
)
```

Alternative with curl (token stays in a shell variable; `-d @-` keeps the refresh token
out of argv):

```bash
curl -sS --max-time 20 https://oauth2.googleapis.com/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com' \
  --data-urlencode "client_secret=$AGY_CLIENT_SECRET" \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$(python3 -c 'import json,sys;t=json.load(open(sys.argv[1]));print((t.get("token") or t)["refresh_token"])' TOKENFILE)"
```

Both print the access token to stdout — do not pipe into logs; the probe captures it in
a variable only.

Curl equivalent of the probe request (token in `$ACCESS`, body in `$BODY`):

```bash
curl -sS --max-time 45 -X POST \
  'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse' \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -H 'User-Agent: antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)' \
  -H 'X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1' \
  -H 'Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"PLATFORM_LINUX","pluginType":"GEMINI"}' \
  --data-binary "$BODY"
```

Masked header example (what the probe prints):

```
Authorization: Bearer ****<last4>
Content-Type: application/json
Accept: text/event-stream
User-Agent: antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)
```

---

## 6. Probe usage and output

```bash
# dry run (no network)
ops/relink/t1-probe.sh --arm A --account 3 --out /tmp/armA.json --dry-run

# single real request (executor only)
ops/relink/t1-probe.sh --arm A --account 3 --out /tmp/armA.json
ops/relink/t1-probe.sh --arm B --account 3 --out /tmp/armB.json
ops/relink/t1-probe.sh --arm C --account 3 --out /tmp/armC.json
```

JSON fields: `kind, arm, ts_utc, ts_cst, endpoint, url, method, http_status, curl_exit,
latency_ms, attempts(=1), account_masked, project, model, token_exp_utc,
authorization_masked, response_headers(脱敏), response_body, body_truncated,
full_body_path, body_sha256, response_body_bytes, request_body_sha256, request_body`.

If the response exceeds 200 KB, the first 200 KB land in `response_body`, the full bytes
in `<out>.body.txt`, and `body_truncated=true`.

Dry-run sample (trimmed):

```
DRY-RUN — no request sent
arm: A
method: POST
url: https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
account: z***@gmail.com
token_exp_utc: 2026-11-16T10:34:38Z
headers:
  Host: cloudcode-pa.googleapis.com
  Authorization: Bearer ****
  Content-Type: application/json
  Accept: text/event-stream
  User-Agent: antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)
request_body_sha256: 8d9647890ce6f8b7b82ac466db3c324499225016fc3b527cd7964fb5967f40bb
attempts: 0
```

---

## 7. Risks and rollback

- Each real arm request consumes a small amount of generation quota (proven body used
  119 prompt + ~30 output tokens in the CLI success). Run arms sequentially, with the
  account's cooldown window in mind.
- No writes to `pool.json`, sqlite, `/tmp/agy-fix/**`, `src/**`, `dist/**`, `/usr/bin/agy`,
  or the patched CLI. The probe refreshes in memory only.
- `curl` appears in process args with the Authorization header (single short-lived
  request). This is inherent to a curl-based probe; run it on a trusted host.
- If a 429 appears, stop and do not retry inside the same run (`attempts:1`).
- Rollback: delete the probe outputs only (`rm -f /tmp/arm*.json`). Nothing else is
  mutated. No git operations were performed by recon.

---

## 8. Re-run commands

```bash
bash -n ops/relink/t1-probe.sh
bash -n ops/relink/t1-cli-probe.sh
ops/relink/t1-probe.sh --arm A --account 3 --out /tmp/armA.json --dry-run
# real runs: drop --dry-run, one arm at a time
```

---

## 9. Zero-quota CLI eligibility probe (t1-cli-probe.sh)

### Mechanism

- `command -v agy` → `~/.local/bin/agy` (bash wrapper). `readlink -f` does not follow it
  (it is a regular script, not a symlink). The wrapper:
  - exports `AGY_CLI_DISABLE_AUTO_UPDATE=true` (only literal `true` is honoured by agy),
  - hashes `/usr/bin/agy` and execs the byte-verified patched copy
    `~/.local/lib/agy/agy-1.3.5-patched` (SHA-256 `29600d4e...`) when the cached copy
    matches `baseline.env`,
  - re-patches from `/usr/bin/agy` when the upstream hash/size drifts, otherwise falls
    back to the original binary with a warning on stderr,
  - does not touch `HOME`, arguments, stdout, or stderr.
- The eligibility decision is **server-side**: `POST /v1internal:loadCodeAssist` returns
  `ineligibleTiers: [{reasonCode: "UNSUPPORTED_LOCATION", reasonMessage: "Your current
  account is not eligible for Antigravity, because it is not currently available in your
  location.", tierId: "free-tier"}]` (capture `20261116T081540Z-2.resp.txt`). The CLI
  then makes a **local** branch: patched site `0x877cd0d` `jne 0x877cf21` →
  `jmp 0x877cf21` skips the block `0x877cd13..0x877cf21`, the only producer of the
  `server_oauth.go:114` `Account ineligible: ...` log line. `patch_agy.py` documents this
  and implements no other in-binary change (self-update is blocked by env + `chmod 555`
  lib dir).
- Therefore the unpatched `/usr/bin/agy` costs **one loadCodeAssist call and no
  generation** when the account is ineligible: it aborts in `printmode.go` before any
  `streamGenerateContent` (evidence: every ineligible run in `exp/*/results.csv` has
  `rc=1`, no `streamGenerateContent` in the log, output JSON `duration_seconds:0`).
  If the account *is* eligible, the probe will generate a small response and spend quota;
  the JSON verdict says so explicitly.

### Logs

- Dir: `$HOME/.gemini/antigravity-cli/log/`, file name `cli-YYYYMMDD_HHMMSS.log`
  (local time), one new file per CLI invocation (confirmed: `run_exp.sh` detects the
  new file via `comm -13` of sorted `ls`; every run created exactly one).
- Load-bearing grep strings (exact, case-sensitive):

| signal | string |
|---|---|
| ineligible (server log) | `server_oauth.go:114] Account ineligible:` |
| ineligible (print mode) | `Print mode: eligibility check failed: Eligibility check failed:` |
| region/eligibility reason | `not available in your location` |
| alternate gate site | `server_oauth.go:133` |
| logged out | `error getting token source: You are not logged into Antigravity.` |
| quota | `RESOURCE_EXHAUSTED` / `HTTP 429` |

- "Did this run produce new lines" is decided by file identity (new `cli-*.log`) plus
  byte-offset tail of the existing newest file, never by grepping the whole directory
  (old logs already contain the ineligible strings).

### Account used by the CLI

- CLI state is anchored at `$HOME`: token file
  `$HOME/.gemini/antigravity-cli/antigravity-oauth-token`, app data
  `$HOME/.gemini/antigravity-cli`, logs under it. The MITM harness proves this: its
  throwaway `HOME` contained only that token file and received authenticated 200s.
- On the real `$HOME` that token file is currently **absent** (removed after 17:31 CST),
  so a plain `agy` run now logs `You are not logged into Antigravity` instead of the
  eligibility result. For an eligibility probe, point `HOME` at an account dir that has
  the token, or let `--account` build a throwaway HOME copy (recommended: pool untouched,
  CLI token rewrites land in the temp copy).
- Pool accounts are the same accounts the CLI used (`z***@gmail.com` appears in
  the captured `loadCodeAssist` response `manageSubscriptionUri`), token format identical.
- Token expiry is handled by the CLI itself: it refreshes with the stored refresh token
  and rewrites the token file. In the throwaway HOME that write is harmless.

### CLI probe script

```bash
ops/relink/t1-cli-probe.sh --out /tmp/cli-probe.json --account 3
# uses /usr/bin/agy (unpatched) + throwaway HOME; timeout 30s; one run
```

JSON: `kind:"cli_probe"`, `attempts:1`, ts, binary + sha256 + wrapper flag, home mode,
account masked, argv, exit code, timeout flag, duration, redacted stdout/stderr,
`stdout_status`, log file/new-line counts, hit counters, `verdict`, `zero_quota`.

Verdicts: `ineligible_zero_quota` | `generation_success_quota_consumed` | `auth_missing` |
`timeout` | `other_error`.

Reusable judgement snippet:

```bash
newlog=$(comm -13 <(ls -1 "$LOGDIR"/cli-*.log 2>/dev/null | sed 's#.*/##' | sort) \
                 <(ls -1 "$LOGDIR"/cli-*.log 2>/dev/null | sed 's#.*/##' | sort))
f="$LOGDIR/${newlog%% *}"
grep -q 'not available in your location' "$f" && echo INELIGIBLE
grep -q 'not logged into Antigravity' "$f" && echo AUTH_MISSING
```

(For a pre-existing file, compare byte offsets before/after instead of file identity.)

### Evidence: proven vs inferred

| claim | status |
|---|---|
| CLI endpoint is `daily-cloudcode-pa.googleapis.com` | proven (MITM request lines) |
| CLI UA string | proven (MITM headers) |
| CLI `streamGenerateContent` can return 200 + SSE for this account body | proven (MITM 200; `pre_single` success runs) |
| `ineligibleTiers` / `UNSUPPORTED_LOCATION` is server-side | proven (captured response body) |
| patched binary only skips the local ineligible block | proven (`patch_agy.py`, byte-verified patch site) |
| plain `agy` now returns ineligible on the real `$HOME` | **not currently true** — that HOME is logged out; use `--account` |
| `cloudcode-pa.googleapis.com` (primary) accepts this body | unknown (only `daily-` observed 200) |
| plugin header set is accepted | unknown |

---

## 10. Desensitization self-check

Commands and counts are recorded in `ops/relink/t1-request-spec.log`.
Required result: `0` matches for the three token-prefix patterns in
`t1-probe.sh`, `t1-cli-probe.sh`, `t1-request-spec.md`, and this log.
No plaintext access/refresh token was printed by recon; only masked account
(`z***@gmail.com`) and token expiry timestamps are recorded.
