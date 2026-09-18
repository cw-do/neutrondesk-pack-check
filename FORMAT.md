# NeutronDesk instrument pack — format, schema version 1

An instrument pack is one git repository holding everything NeutronDesk needs to
support one instrument: the assistant's rules and reference knowledge, the guide
library, the friendly names for the instrument's process variables, links, and,
optionally, code for calculations the assistant should do deterministically.

The app vendors packs at build time. Nothing in a pack is fetched while the app
runs, and nothing in a pack can open a network connection.

Two kinds of pack exist and use the same layout:

- **Content pack** — no `src/`. Prompt, modules, guides, PV catalogue, links.
  Most instruments need only this.
- **Code pack** — adds `src/` with TypeScript that builds assistant tools from
  the pack's own data. EQSANS is one: Q-range arithmetic, a scan-function
  index, and script builders.

## Making a pack, step by step

1. **Start from the template.** Clone
   [neutrondesk-pack-template](https://github.com/cw-do/neutrondesk-pack-template)
   into a repository of your own (any name). Run `npm install` there; that
   brings in `neutrondesk-pack-check`, and `npm test` runs it on the pack.
2. **Fill `pack.json`.** The `id` is the instrument's ONCat id exactly as the
   app's instrument picker shows it (`EQSANS`, `CG2`, `PG3`), upper case. The
   app links the pack to the instrument by this id and nothing else; a typo
   here means a pack that never attaches. The check warns if the id is not one
   it knows. Then the names, the beamline, the one-line blurb, and the
   capabilities the instrument really has.
3. **Write `agent/system-prompt.md`.** Only what is true at your beamline: the
   task domains, the measurement sequence, the defaults, which tools to
   prefer over memory. The app already supplies the shared rules.
4. **Add modules under `agent/modules/`.** One topic per file. Each is scored
   whole against every question, so a file that covers two topics competes with
   itself.
5. **Add guides under `guides/`** with the front matter below, and list every
   one in `pack.json` `guides.order`.
6. **Curate `pv/catalogue.json`.** The handful of process variables people
   search for by concept. Leave `units` empty rather than guess.
7. **Optionally add `src/`** when the assistant should compute something
   deterministically (a Q-range, a script). Read the constraints under
   `src/` below first; most instruments need no code.
8. **Write `checks/cases.json`**: a few questions with the module you expect
   them to reach, and if you have tools, a few calls with what their output
   must contain. Run `npm test`, then `npx neutrondesk-pack-check . --write-golden`,
   look at what it wrote under `checks/golden/`, and commit it.
9. **Hand over the repository URL.** The app maintainer adds one line to the
   app's `packs.json` and pulls; the same checks run again there, and the pack
   ships in the next build.

## Layout

```
<pack root>/
  pack.json                 required
  README.md                 recommended
  LICENSE                   recommended
  .gitattributes            recommended: * text=auto eol=lf
  agent/
    system-prompt.md        what tunes the assistant; without it the instrument gets the shared behaviour only
    modules/*.md            optional; one topic per file; only .md is read
    scan-functions.txt      optional; split at each top-level `def`
  guides/*.md               optional; front matter required
  pv/
    catalogue.json          optional; PVDefinition[]
  data/**                   optional; text files, handed to pack code verbatim
  src/                      optional; TypeScript; index.ts default-exports a factory
  checks/
    cases.json              optional; retrieval and tool cases
    golden/**               optional; expected outputs
```

Rules:

- The folder the app vendors the pack into is the manifest `id` lower-cased
  (`EQSANS` → `packs/eqsans/`). The pack repository can be named anything.
- Every file is UTF-8 with LF line endings. Ship a `.gitattributes` so Windows
  checkouts do not turn them into CRLF.
- Whole pack at most 2 MB, no file over 256 KB, no binaries. Allowed
  extensions: `.md .txt .json .sav .ts .csv .yaml .yml`, plus `README.md`,
  `LICENSE` and `.gitattributes`.
- If the pack has a `package.json`, its `dependencies` must be empty. Pack code
  uses only what the app already has.

## `pack.json`

```jsonc
{
  "schemaVersion": 1,
  "id": "EQSANS",                       // ONCat instrument id, upper case
  "facility": "SNS",                    // "SNS" | "HFIR"
  "name": "EQSANS",
  "shortName": "EQ-SANS",
  "fullName": "Extended Q-Range Small-Angle Neutron Scattering Diffractometer",
  "beamline": "BL-6",
  "blurb": "Small-angle scattering, time-of-flight. Full NeutronDesk support.",
  "capabilities": ["runs", "monitor", "detector", "pv", "guides", "reduction"],
  "usesSansTitleConvention": true,
  "guides": {
    "order": ["eqsans-overview", "reduction-routes"],
    "categories": ["experiment", "reduction", "data-access"]
  },
  "links": [
    {
      "id": "eqsans-userguide",
      "label": "EQ-SANS user guide",
      "url": "https://sites.google.com/view/eqsans",
      "what": "The instrument team's own how-to for reducing EQ-SANS data.",
      "group": "start",
      "login": false
    }
  ],
  "agent": {
    "suggestions": ["What Q range do I get at 4m 2.5a?"],
    "retrievalTerms": ["eqsans", "drtsans"]
  },
  "maintainers": [{ "name": "…", "email": "…" }]
}
```

| Field | Meaning |
|---|---|
| `id` | ONCat instrument id, upper case, exactly as the app's instrument picker shows it. This is the only thing that links the pack to an instrument. |
| `facility` | `SNS` or `HFIR`. |
| `name`, `shortName`, `fullName`, `beamline` | Shown in the header, the picker and the assistant's context line. |
| `blurb` | One line under the name in the instrument picker. |
| `capabilities` | Which screens the app offers. Vocabulary: `runs`, `monitor`, `detector`, `pv`, `guides`, `reduction`. Every instrument has the Ask assistant, so there is no capability for it; `monitor` is the live SNS monitor and applies to SNS instruments only. |
| `usesSansTitleConvention` | Whether run titles follow the S-/T- convention the run classifier assumes. `false` shows raw titles without a class badge. |
| `guides.order` | Guide ids in the order the Guides screen shows them. Every guide in `guides/` must appear. Shared guides the app ships (currently `oncat-access`) may appear too. May be empty when the pack has no guides. |
| `guides.categories` | Which categories the pack's guides use. Vocabulary: `experiment`, `reduction`, `data-access`, `eqsanscli`, `sansdir`, `troubleshooting`. |
| `links` | Web pages shown above the guides. `group` is `start`, `reduce`, `data` or `facility`. `login` marks pages that need an ORNL account. |
| `agent.suggestions` | One to six opening questions on the Ask screen. Each at most 120 characters. |
| `agent.retrievalTerms` | Optional. Lower-case words that mark a question as being about this instrument (its id, the name of its reduction tool). Retrieval gives a document a bonus when it and the question share one of these; the app already has the words common to every beamline (`sans`, `detector`, `reduction`, …). |
| `maintainers` | Who to ask. Not shown in the app. |

## `agent/`

**`system-prompt.md`** holds the instrument's own rules only. The app already
provides, for every instrument: how to answer on a phone, that the assistant
never executes anything, the refusal to rule on a Research Safety Summary, how
to use the catalogue tools, and what wins when rules conflict. Do not repeat
those. `{{INSTRUMENT_NAME}}` is substituted with `shortName`. Do not write
`<!-- instrument -->`; that marker belongs to the app's template.

Use EQSANS's as the shape: what the task domains are, the measurement sequence,
the defaults, which tools to prefer over answering from memory.

**`modules/*.md`** are reference documents scored against each question by
keyword. Whole files are scored, so one topic per file: a module that grows into
two topics dilutes its own score and should be split. A Setext title (`Title`
underlined with `===`) becomes the module title; otherwise the file name is
used. Files sort by the first number in their name, so `module2` comes before
`module10`. Anything that is not `.md` is ignored.

**`scan-functions.txt`** is a copy of the instrument's scan-function source. It is
split at every top-level `def name(` so a question about one function returns
that function's real signature and body. A name defined twice keeps its first
position and its last body, as a Python dict built from the file would; the
check warns about such duplicates because they are usually a mistake in the
source file. Kept as `.txt` so nothing tries to run or lint it.

## `guides/*.md`

Front matter, all keys required:

```
---
id: protocol                         # must equal the file name
title: Reduction protocol rules
category: reduction                  # one of guides.categories
summary: One sentence the library shows under the title.
updated: 2026-08-17
source: cw-do/eqsanscli knowledge/protocol.md
---
```

The body is Markdown. Guides are shown on the Guides screen and retrieved by the
assistant alongside the modules, so writing one does both. Ids must not collide
with the app's shared guides.

## `pv/catalogue.json`

The instrument's process variables a user searches for by concept. Everything
the DAS logged is still listed under its real name; this overlay gives the
handful that matter a friendly name and an explanation.

```jsonc
[
  {
    "logName": "daslogs.detectorz",          // path as ONCat exposes it
    "friendlyName": "Sample-to-detector distance",
    "description": "Position of the main detector along the beam.",
    "units": "m",                            // "" when the unit is genuinely unknown
    "category": "geometry",                  // geometry | beam | chopper | sample-environment | aperture | acquisition
    "scale": 0.001,                          // optional: multiply the stored value to reach `units`
    "epicsName": "BL6:Mot:detectorZ",        // optional: only where known, never guessed
    "aliases": ["detector distance", "sdd"]  // optional: extra search terms
  }
]
```

Leave `units` empty rather than guess. A wrong unit on a temperature is worse
than no unit.

## `data/**`

Any text files the pack's code needs, bundled verbatim and handed to the factory
as `{ "<path relative to data/>": "<contents>" }`. The app does not parse them,
and the folder names under `data/` are the pack's own choice. EQSANS keeps its
Q-range planner's `.sav` files under `data/qrange-configs/` and parses them
itself.

## `src/` — pack code

```ts
// src/index.ts
import type { PackApi, PackDefinition, PackFactory } from 'neutrondesk-pack-api';

const pack: PackFactory = (api: PackApi): PackDefinition => ({
  tools: buildTools(api),
});
export default pack;

// Optional. pack-check calls it and compares the result with checks/golden/selfcheck.json
// (and with checks/reference/selfcheck.json if present). Return raw numbers and
// names, keep it NaN-free, and keep it well under the 256 KB file limit: names
// of scan functions, not their bodies.
export function selfCheck(api: PackApi): unknown { /* ... */ }
```

`api` carries the pack's own knowledge (`api.knowledge.modules`,
`api.knowledge.scanFunctions`, `api.knowledge.data`), the instrument id, and
the tool-result helpers (`api.tools.ok`, `fail`, `str`, `strArray`, `numArray`).
The factory runs once per app launch, when the instrument's assistant is first
used.

A tool is:

```ts
{
  schema: { type: 'function', function: { name, description, parameters } },  // JSON Schema
  activity: (args) => 'Working out the Q-range for 4m 2.5a',                   // shown while it runs
  run: (args, ctx) => ({ ok: true, content: '…' }),                            // may be async
}
```

Constraints, enforced by `pack-check`:

- Imports are relative paths inside `src/`, or `import type … from 'neutrondesk-pack-api'`.
  No other module, no value import from the API package, nothing from outside `src/`.
- No `fetch(`, `XMLHttpRequest`, `require(`, `import(`, `process.`, `eval(`,
  `globalThis`, `setTimeout(`, `setInterval(` anywhere in `src/`. This is a
  substring scan, so it applies to comments too ("the process." in a comment
  fails). The code is compiled without the DOM library, so `fetch` and
  `console` do not even type-check.
- Tool names are `snake_case`, unique, and not one of the app's shared tools
  (`list_ipts_catalog`, `get_latest_run`, `list_experiments`).
- Where a wrong answer costs beam time, the model supplies arguments and code
  renders the result. Do not let the model write a script; let it call a tool
  that writes it.

## `checks/`

`cases.json`:

```jsonc
{
  "retrieval": [
    { "q": "what moderator does EQ-SANS use?", "expect": ["module11"] },
    { "q": "what is a banjo cell", "mustMention": "banjo" }
  ],
  "toolRuns": [
    {
      "tool": "build_sample_script",
      "args": { "ipts": 37902, "configs": ["4m 2.5a"], "samples": [{ "name": "sampleA", "items": 0, "pos": 2, "rack": "peltier" }] },
      "expectOk": true,
      "includes": ["T-emptybeam"],
      "excludes": ["S-emptybeam"]
    }
  ]
}
```

`golden/` holds expected outputs written by `pack-check --write-golden`:
`tools.json` (schemas and activity lines), `toolruns.json` (each case's result),
`selfcheck.json` (whatever `selfCheck` returns). Goldens are reviewed by a person
and committed; never regenerate them in CI.

`reference/selfcheck.json`, if present, is a `selfCheck`-shaped JSON produced
by something *other than the pack's code*, and the check fails unless the two
agree to 1e-12. It is compared top-level key by key, so it may leave out a key
that only the pack can produce (the check then warns which keys it did not
cover). This is how a pack whose `src/` is a port (of a Python agent,
say) proves the port is identical rather than claiming it. Keep the script that
produced the file next to it (`reference/make-reference.py` is fine; `.py` is an
allowed extension and is never run by the app or the check) and say in
`reference/README.md` what it was run against.

## Checking a pack

```bash
npm install --save-dev github:cw-do/neutrondesk-pack-check
npx neutrondesk-pack-check .            # or: npm test, in a repository made from the template
```

Passes when the layout, manifest, guides, catalogue and code satisfy everything
above, the cases pass, and the goldens match. A pack that fails is not vendored.
The packaged tool is assembled from the NeutronDesk source and carries a
snapshot of the app's vocabularies, shared guides and retrieval scoring, so it
gives the same answer the app's own check gives. If you have a NeutronDesk
checkout, `node tools/pack-check <pack dir>` runs the same thing from source.

`package.json` may declare `devDependencies` (that is how the check tool comes
in); `dependencies` must stay empty, because pack code runs inside the app and
brings nothing of its own.

## Registering a pack with the app

Add a line to the app's `packs.json` and run `npm run packs:pull`. The tool
clones the repository at the given ref, runs `pack-check`, copies the pack into
`packs/<id>/`, records the commit in `packs.lock`, and regenerates the app's
registry. Commit the result. Nothing under `packs/` is edited by hand; a fix
goes to the pack repository and is pulled again.
