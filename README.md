# neutrondesk-pack-check

Checks an instrument pack for [NeutronDesk](https://github.com/cw-do/neutrondesk):
will the app accept it, and does it do what its own cases say? Runs without
the app and without a model.

```bash
npm install --save-dev github:cw-do/neutrondesk-pack-check
npx neutrondesk-pack-check .                 # in a pack repository
npx neutrondesk-pack-check . --write-golden  # record expected outputs, then review and commit them
npx neutrondesk-pack-check . --json
```

The pack format is [FORMAT.md](./FORMAT.md). Start a new pack from
[neutrondesk-pack-template](https://github.com/cw-do/neutrondesk-pack-template).

This package is assembled from the NeutronDesk source by `tools/pack-check/build-dist.js`
and republished when the checks, the pack-api types, the retrieval scoring or
the shared guides change. `standalone.json` says which app commit it came from.
Nothing in it is edited by hand; changes go to the app repository.

## What it checks

Lettered as in `docs/upgradeplan/05-pack-check.md`.

- **A structure** — `pack.json` parses and validates (id, facility, capabilities,
  guides, links, suggestions, unknown keys), size limits, allowed file types,
  UTF-8 everywhere.
- **B agent** — a real system prompt with no stray placeholders, modules with
  content (a warning for ones big enough to dilute their own score), scan
  functions parsed.
- **C guides / D PV** — front matter, ids, categories, no collision with shared
  guides, every guide in `guides.order`, a well-formed PV catalogue.
- **E code** (if `src/` exists) — no dependencies, only relative imports plus
  `import type` from the API, no network or timer tokens, compiles under strict
  TypeScript without the DOM library, the factory returns well-formed tools that
  do not collide with the app's shared tools.
- **F cases** (if `checks/` exists) — `cases.json` retrieval expectations against
  the pack's own corpus, `toolRuns` executed and asserted, and `checks/golden/*`
  compared with a numeric tolerance of 1e-12.
- **G determinism** — loading twice gives the same result.

## Goldens

`--write-golden` writes `checks/golden/tools.json`, `toolruns.json` and, if the
pack exports `selfCheck(api)`, `selfcheck.json`. Look at the diff, then commit.
Never regenerate goldens in CI: their whole point is that a change to them is a
change a person has looked at.

## Exit codes

0 when nothing failed (warnings allowed), 1 on any failure, 2 on bad arguments.
