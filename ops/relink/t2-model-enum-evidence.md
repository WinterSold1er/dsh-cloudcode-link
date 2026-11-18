# T2 evidence — `model_enum` ↔ wire-model-id pairs in agy's own conversation DBs

Run date: **2026-11-18** (Asia/Shanghai). Author: fix-docs-evidence (fix engineer).
Purpose: put the evidence for the three rows below into the repo, so they are reproducible
instead of living only in code comments and working-memory notes.

| row in `packages/core/src/models.ts` | status |
|---|---|
| `gemini-4-hydrogen` -> `MODEL_PLACEHOLDER_M526` (line 621, **family row**) | **derived** — see §6 |
| `gemini-4-argon` -> `MODEL_PLACEHOLDER_M418` (line 630, **family row**) | **derived** — see §6 |
| `gemini-4-argon-trial` -> `MODEL_PLACEHOLDER_M418` (line 634) | **observed** — §4 |

Everything below was produced with read-only queries. No file in the repo, in `~/.gemini`, or
in `~/.dsh` was created, modified, or deleted; no token, email, or account identifier is
quoted here. Per-variant rows other than the ones in this table come from
`test/fixtures/fetch-available-models.json` (a `FetchAvailableModelsResponse` capture) and are
not the subject of this file.

---

## 1. Where the evidence lives

`agy` (Antigravity CLI, 1.3.5) keeps one SQLite file per conversation:

```
~/.gemini/antigravity-cli/conversations/<uuid>.db
```

Inspect the schema read-only (`immutable=1` means SQLite never writes, not even `-shm`/`-wal`):

```bash
DB=~/.gemini/antigravity-cli/conversations/0431a2f3-2ec9-47ea-96ec-33bb9c82eaac.db
sqlite3 "file:$DB?immutable=1" .schema
```

The table that matters is `gen_metadata(idx, data blob, size)`; `data` is one protobuf record
for the conversation. Measured inventory on this machine (`SELECT COUNT(*)` per db, `immutable=1`):

```
dbs=138  total gen_metadata rows=68  max rows in one db=1
```

So 138 conversation dbs exist, 68 of them carry a `gen_metadata` blob, one blob each, and
**all 68 of those blobs contain a `model_enum` label**. The other tables (`steps`,
`executor_metadata`, `trajectory_metadata_blob`, `battle_mode_infos`, `parent_references`,
`trajectory_meta`) contain no `model_enum` / `MODEL_PLACEHOLDER_*` occurrence in any db — that
was checked before the pairs below were extracted, which is why every query below reads only
`gen_metadata`.

## 2. How the pair is encoded inside the blob

Two separate encodings appear in the same blob, and both have to be read to pair anything:

1. **the enum** — a labels entry, key and value as length-delimited protobuf fields:
   `\n \n "model_enum" \x12 \x16 "MODEL_PLACEHOLDER_M418"`
   (tag `0a`, len `0a` = `model_enum`; tag `12`, len `16` = 22-byte value).
2. **the wire model id** — a bare string field, in two different slots:
   * `tag e2 01, len, slug` — slot 28, the conversation's own model setting, near the head of
     the blob. Carries the **suffixed variant** actually used: `gemini-4-hydrogen-medium`,
     `gemini-4-argon-medium`.
   * `tag 9a 01, len, slug` — slot 19, inside the same record region as the labels, i.e.
     adjacent to the `model_enum` entry. Carries `gemini-4-hydrogen` and `gemini-4-argon-trial`.

Worth stating so nobody re-derives this wrong: there is **no** literal key `model`
(`\n \x05 model \x12`) in any of the 68 blobs — 0 hits. The pairing is
*`model_enum` label + a length-delimited slug string field*, not two plain keys.

Byte distance from the slug field to the `model_enum` label in the same blob (python, §3):

```
slot 0xe201 : min 48031  median 56596  max 57344      # conversation config, far from the labels
slot 0x9a01 : min 23     median 223    max 363        # same record region as the labels
```

## 3. Reproduce it (read-only, both variants)

### 3a. sqlite3 + shell only

```bash
cd ~/.gemini/antigravity-cli/conversations || exit 1
slug_hex() { printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | tr 'a-f' 'A-F'; }
pat()      { local h; h=$(slug_hex "$2"); printf '%s%02X%s' "$1" "${#2}" "$h"; }   # slot + length + slug
E526='4D4F44454C5F504C414345484F4C4445525F4D353236'          # MODEL_PLACEHOLDER_M526
E418='4D4F44454C5F504C414345484F4C4445525F4D343138'          # MODEL_PLACEHOLDER_M418
KEY='0A0A6D6F64656C5F656E756D1216'                          # \n model_enum \x12 \x16
P_HMED=$(pat E201 gemini-4-hydrogen-medium); P_AMED=$(pat E201 gemini-4-argon-medium)
P_HFAM=$(pat 9A01 gemini-4-hydrogen);        P_ATRI=$(pat 9A01 gemini-4-argon-trial)
n_db=0 n_enum=0 n526=0 n418=0 c_hmed=0 c_amed=0 c_hfam=0 c_atri=0 bad=0
for db in *.db; do
  n_db=$((n_db+1))
  hx=$(sqlite3 "file:$db?immutable=1" "SELECT hex(data) FROM gen_metadata;")
  case "$hx" in *"$KEY"*)   n_enum=$((n_enum+1));; esac
  case "$hx" in *"$E526"*)  n526=$((n526+1));;   esac
  case "$hx" in *"$E418"*)  n418=$((n418+1));;   esac
  case "$hx" in *"$P_HMED"*) c_hmed=$((c_hmed+1));; esac
  case "$hx" in *"$P_AMED"*) c_amed=$((c_amed+1));; esac
  case "$hx" in *"$P_HFAM"*) c_hfam=$((c_hfam+1))
    case "$hx" in *"$E526"*) : ;; *) bad=$((bad+1));; esac;; esac
  case "$hx" in *"$P_ATRI"*) c_atri=$((c_atri+1))
    case "$hx" in *"$E418"*) : ;; *) bad=$((bad+1));; esac;; esac
done
printf 'db files %s\nblobs with model_enum %s\nM526 %s\nM418 %s\n' "$n_db" "$n_enum" "$n526" "$n418"
printf 'hydrogen-medium(slot e201) %s\nargon-medium(slot e201) %s\n' "$c_hmed" "$c_amed"
printf 'hydrogen-family(slot 9a01) %s\nargon-trial(slot 9a01) %s\nmismatches %s\n' \
       "$c_hfam" "$c_atri" "$bad"
```

Real output on this machine (2026-11-18):

```
db files                       : 138
blobs carrying model_enum      : 68
  enum = MODEL_PLACEHOLDER_M526: 63
  enum = MODEL_PLACEHOLDER_M418: 5
field E201 gemini-4-hydrogen-medium : 63
field E201 gemini-4-argon-medium    : 5
field 9A01 gemini-4-hydrogen        : 59
field 9A01 gemini-4-argon-trial     : 3
slug/enum family mismatches         : 0
```

### 3b. python, no shell string building (cross-check, also yields distances)

```python
import sqlite3, re, glob, os, collections
files = sorted(glob.glob(os.path.expanduser('~/.gemini/antigravity-cli/conversations/*.db')))
RE_ENUM = re.compile(rb'\n\nmodel_enum\x12\x16(MODEL_PLACEHOLDER_M\d+)')   # labels entry: key + value
RE_SLUG = re.compile(rb'(?P<tag>\xe2\x01|\x9a\x01)(?P<len>[\x01-\x7f])(?P<slug>gemini-4-[a-z0-9.\-]+)')
pairs, sigs, dist = collections.Counter(), collections.Counter(), collections.defaultdict(list)
n_blob = n_enum = 0
for f in files:
    con = sqlite3.connect(f"file:{f}?mode=ro&immutable=1", uri=True)       # read-only, immutable
    rows = con.execute("SELECT data FROM gen_metadata").fetchall(); con.close()
    for (data,) in rows:
        if not isinstance(data, (bytes, bytearray)): continue
        enums = [(m.start(), m.group(1).decode()) for m in RE_ENUM.finditer(data)]
        if not enums: continue
        n_blob += 1; n_enum += len(enums)
        eoff, ev = enums[0]; seen = set()
        for m in RE_SLUG.finditer(data):
            key = (m.group('tag').hex(), m.group('slug').decode(), ev)
            dist[m.group('tag')].append(abs(m.start() - eoff))
            if key in seen: continue
            seen.add(key); pairs[key] += 1
        sigs[tuple(sorted(seen))] += 1
print(f'db files: {len(files)}   gen_metadata blobs with model_enum: {n_blob}   model_enum occurrences: {n_enum}')
for (tag, slug, ev), c in sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0])):
    print(f'  field 0x{tag}  {slug:26s} <-> {ev:24s}  {c} blobs')
for tag, d in dist.items():
    d.sort(); print(f'  distance to model_enum, 0x{tag.hex()}: min {d[0]} median {d[len(d)//2]} max {d[-1]}')
print('distinct per-blob signatures:')
for k, c in sigs.most_common():
    print(f'  x{c}: ' + ' | '.join(f'0x{t} {s} {e}' for t, s, e in k))
```

Real output on this machine (2026-11-18) — identical counts to §3a:

```
db files: 138   gen_metadata blobs with model_enum: 68   model_enum occurrences: 68
  field 0xe201  gemini-4-hydrogen-medium   <-> MODEL_PLACEHOLDER_M526    63 blobs
  field 0x9a01  gemini-4-hydrogen          <-> MODEL_PLACEHOLDER_M526    59 blobs
  field 0xe201  gemini-4-argon-medium      <-> MODEL_PLACEHOLDER_M418     5 blobs
  field 0x9a01  gemini-4-argon-trial       <-> MODEL_PLACEHOLDER_M418     3 blobs
  byte distance to the model_enum label, field 0xe201: min 48031  median 56596  max 57344
  byte distance to the model_enum label, field 0x9a01: min 23  median 223  max 363
distinct per-blob signatures:
  x59: 0x9a01 gemini-4-hydrogen MODEL_PLACEHOLDER_M526 | 0xe201 gemini-4-hydrogen-medium MODEL_PLACEHOLDER_M526
  x4 : 0xe201 gemini-4-hydrogen-medium MODEL_PLACEHOLDER_M526
  x3 : 0x9a01 gemini-4-argon-trial MODEL_PLACEHOLDER_M418 | 0xe201 gemini-4-argon-medium MODEL_PLACEHOLDER_M418
  x2 : 0xe201 gemini-4-argon-medium MODEL_PLACEHOLDER_M418
```

Caveats a re-runner must know:

* `immutable=1` guarantees SQLite writes nothing, but it also **skips the WAL**. Some dbs here
  have a non-empty `<db>-wal`; data living only in the WAL is invisible to the counts above.
  To include it, open with `mode=ro` alone (`sqlite3 "file:$db?mode=ro"`), which may create or
  update the `-shm` file — do that only if you accept touching those sidecars.
* Counts are blob counts, not request counts: these conversations are one-blob-each.
* The tool set used: `sqlite3 3.54.1`, `python3` with `sqlite3.sqlite_version 3.54.1`.

## 4. Observed pairs

| wire id as stored by agy | slot | paired `model_enum` | blobs |
|---|---|---|---|
| `gemini-4-hydrogen-medium` | 0xe201 | `MODEL_PLACEHOLDER_M526` | **63** |
| `gemini-4-hydrogen` (bare family) | 0x9a01 | `MODEL_PLACEHOLDER_M526` | **59** |
| `gemini-4-argon-medium` | 0xe201 | `MODEL_PLACEHOLDER_M418` | **5** |
| `gemini-4-argon-trial` | 0x9a01 | `MODEL_PLACEHOLDER_M418` | **3** |

Enum distribution over the 68 blobs: `MODEL_PLACEHOLDER_M526` in 63, `MODEL_PLACEHOLDER_M418`
in 5. Nothing else appears. **Contradictions: 0** — no blob pairs an argon slug with M526, and
none pairs a hydrogen slug with M418 (checked explicitly in §3a's `mismatches` counter).

## 5. Raw byte windows (redacted: cascade/trajectory UUIDs shortened, no tokens, no emails)

Adjacency in the labels region — db `0431a2f3`, slug slot 0x9a01 then the `model_enum` label:

```
... \x103ba859b51aeb0cea \x9a\x01\x11 gemini-4-hydrogen
    \xa2\x017 \n\x0f root_cascade_id \x12$ <cascade-uuid>
    \xa2\x014 \n\n  request_id \x12& <trajectory-uuid>-0
    \xa2\x012 \n\n  cascade_id  \x12$ <cascade-uuid>
    \xa2\x01\x1e \n\x15 used_non_gemini_model \x12\x05 false
    \xa2\x01$ \n\n  model_enum \x12\x16 MODEL_PLACEHOLDER_M526
```

Adjacency for argon — db `063b054f` (`gemini-4-argon-trial`, 20-byte field, 363 bytes from the label):

```
... \x10fb2a765f20522f49 \x9a\x01\x14 gemini-4-argon-trial
    \xa2\x017 \n\x0f root_cascade_id \x12$ <cascade-uuid>
    ... (used_non_gemini_model, last_step_index, cascade_id, trajectory_id,
         used_claude, used_claude_conservative, request_id) ...
    \xa2\x01$ \n\n  model_enum \x12\x16 MODEL_PLACEHOLDER_M418
```

The conversation's own model setting, slot 0xe201 near the head of the blob (same two dbs):

```
db 0431a2f3: running_tasks_reminder@\x00 \xe2\x01\x18 gemini-4-hydrogen-medium \xf2\x01' ...
db 001cab1e: running_tasks_reminder@\x00 \xe2\x01\x15 gemini-4-argon-medium    \xf2\x01' ...
```

## 6. The derivation rule for the family rows (one auditable line)

**Family-row rule as implemented:** the value of a bare family row (`gemini-4-hydrogen`,
`gemini-4-argon`) is the enum measured for that family's `-medium` variant — the variant agy
actually puts on the wire in `request.model` — because `lookupModelEnum` only consults a family
row for a suffixed variant the table does not list, and a request labelled
`model: gemini-4-hydrogen-medium` is served with `labels.model_enum = MODEL_PLACEHOLDER_M526`.

Applied honestly to the three rows this file exists for:

* `gemini-4-hydrogen-medium` ↔ M526 is **observed** in 63 blobs → the `gemini-4-hydrogen`
  family row (models.ts:621) is **derived from it**, not independently measured.
* `gemini-4-argon-medium` ↔ M418 (5 blobs) **and** `gemini-4-argon-trial` ↔ M418 (3 blobs) are
  **observed**; the bare slug `gemini-4-argon` was **never** observed with any enum in these 68
  blobs, so models.ts:630 is **derived**, and the two observed variants agreeing on M418 is the
  whole basis for it.
* The bare slug `gemini-4-hydrogen` *is* observed 59× next to M526 (slot 0x9a01), which
  corroborates the derived value; it is reported separately rather than reclassified as the
  source of the row, so the derivation stays a single consistent rule across both families.

## 7. What this file does **not** prove

* Only the `-medium` variants and `-trial` appear in these dbs. The per-variant enums
  `-high` M525, `-low` M527, `-xhigh` M528, `-tiered-high` M530, `-tiered-xhigh` M531,
  `-sonar` M578, `gemini-4-argon-high` M417, `gemini-4-argon-low` M419 come from the
  `FetchAvailableModelsResponse` capture in `test/fixtures/fetch-available-models.json`, not
  from this source.
* Two enum values only (M526, M418) appear here; no Claude or gemini-3.x pair can be read off
  these dbs.
* `MODEL_PLACEHOLDER_M{n}` ↔ `1000 + n` is the binary's numbering rule, used only to *read*
  pairs found elsewhere — no value in the table was back-computed from it.
* These dbs are agy's client-side record of what it labelled its own requests; they are not a
  server-side statement about quota or availability.
