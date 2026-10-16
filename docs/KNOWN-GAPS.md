# Known gaps

Deliberate v1 boundaries and upstream-behavior notes.

## Not forwarded to agy

- **Images as true multimodal blocks** - agy print mode (`-p`) has no image
  input flag. Since v0.2 the bridge stages DSH image attachments to a local
  media directory (`mediaDir`, TTL-swept) and references them by absolute
  path in the prompt, granting `--add-dir` so agy can view them with its own
  file/vision tools. Same approach as the pi extension.
- **DSH tools to agy (reverse MCP bridge)** - available since v0.2 behind the
  `mcpBridge` config flag (experimental): the plugin runs a loopback-only,
  token-guarded HTTP endpoint and registers a zero-dependency stdio MCP
  server (`dsh-tools`) in the workspace `.mcp.json` (merged in, restored on
  disable). `run_code` and `agy_ask` are never bridged; `mcpToolAllowlist`
  restricts the set further.
- **Structured outputs** - `agy_ask` accepts a `schema` parameter (JSON
  Schema as a JSON string) enforced via `--json-schema` since v0.2. Wiring
  schema enforcement into DSH-native tool-call generation remains future
  work: DSH `GenerateOptions` has no schema field to map onto.

## Mapping choices

- agy tool activity becomes **reasoning-block annotations**
  (`[agy tool: name] ... -> output`), not DSH tool-call blocks — there is no
  DSH-side tool round-trip to honor.
- Gemini effort suffixes fold into one base model with selectable efforts
  (`gemini-3-6-flash` + `--effort`); Claude / GPT-OSS slugs stay verbatim
  (agy rejects `--effort` for them).
- Compaction / session-title auxiliary calls run as one-shot agy turns in
  forced `plan` mode, capped at 800K chars of history.

## Upstream behaviors observed

- Permission prompts hang print mode (upstream issue #318) — hence the
  permission-mode design.
- `--sandbox` must not combine with `--dangerously-skip-permissions`
  (upstream issue #36).
- First unauthenticated call takes ~60-70s to fail (agy waits for a pasted
  code); later failures are faster.

## Fallbacks

- If `agy models` fails (signed out, old CLI), a bundled fallback catalog is
  served so the model picker is never empty; unknown ids are still accepted.
- Conversation-id discovery prefers stream-embedded ids and falls back to a
  conversations-directory snapshot diff (newest file wins; ambiguity is
  tolerated).

## Release evidence: this release is UNKNOWN, not PASS (2026-10-16)

The post-restart probe for this release reports **UNKNOWN (PASS=7 FAIL=0 UNKNOWN=2)**.
The two UNKNOWNs are `process_fresh` and `ccl_registered_in_live_host`, and they
are deliberate: an independent install -> restart -> new-process ordering proof
requires a clean release in which the host may be restarted, and restarting was
forbidden in that session (other tasks were running on the same host).

What IS established, from sources the operator cannot silently forge:

- artifact content binding: `HEAD:dist` == working tree == profile install copy
  == `6b8e1fad176bfc5ba6e584b13f392b7c436a6e1dcb88161751871b08516a50a4`
  (`artifact_pinned` = PASS);
- the running host (PID 581348, started 2026-10-16 15:42:17 CST) answers the
  plugin route: `GET /plugins/cloudcode-link/status` -> HTTP 200;
- the release pipeline restarted only after the hash gate passed
  (`release-20261016T074145Z.log`: 15:41:45 start -> phase 2 hash OK ->
  15:42:07 restart unit -> 15:42:17 new PID).

The installed artifact's mtime is **not** admissible evidence here: it was
rewritten by hand once and later rewritten again by a `pnpm update` side effect.
Full disclosure: `ops/release/release-audit.md` §4.1.1 and §9.1; final ruling and
tracking items: §10; superseded artifacts and their reasons:
`ops/release/superseded/SUPERSEDED.md`.

### Open gaps (tracked, not yet fixed)

1. `release-runner.sh --dry-phases` still runs phase 1's `pnpm update`, so it
   rewrites the install copy's mtime. Suggested: add `--no-install`, or skip
   phase 1 under `--dry-phases`.
2. `release-runner.sh` phase 6 requires `verdict == PASS`, so a Lead-accepted
   UNKNOWN canonical cannot be published by the runner. Suggested: an explicit,
   Lead-signed switch naming the accepted hash.
3. The profile lock records the commit of the install-time HEAD
   (`a318b24`), not the HEAD used for later commits (`a7ebb95`, `0dc6c43`).
   Correct description: "the lock commit's artifact == HEAD:dist" — content is
   identical (`6b8e1fad…`), the recorded commit is simply older.
4. `models_upstream_side` compares only 10 hand-picked model slugs while the
   upstream catalogue holds 20+. Suggested: compare the full list from
   `docs/models-and-fix.md`, or label the check as a sample.
5. The interactive output of the hand-run `touch` in the first round was never
   captured to a file (availability of evidence, not concealment). Future
   operations of that kind should redirect to a log first.
6. `docs/review/**` is reviewer-owned and intentionally left uncommitted by the
   release worker.

### Precondition for the next release to turn PASS

The install phase must write `ops/release/install-complete.json` **live**
(`provenance.writtenAfterTheFact=false`) before any restart, and the restart
must happen inside a window where restarting is authorised. Only then can
`process_fresh` legitimately be PASS.
