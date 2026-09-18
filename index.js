#!/usr/bin/env node
/**
 * Check an instrument pack: will NeutronDesk accept it, and does it do what
 * its own cases say it does?
 *
 *   node tools/pack-check <pack dir> [--app <neutrondesk root>] [--write-golden] [--json]
 *   npx neutrondesk-pack-check <pack dir> [--write-golden] [--json]      (packaged)
 *
 * Runs without building the app and without a model. It needs four things
 * from NeutronDesk: the shared guides, the pack-api types, the retrieval
 * scoring (src/agent/retrievalCore.ts, so a pack is scored by the arithmetic
 * the app uses), and the vocabularies. Inside an app checkout it reads them
 * from the source; as the packaged tool (`tools/pack-check/build-dist.js`) it
 * carries a snapshot of them and runs anywhere.
 *
 * Every check prints one line: ok, warn or FAIL. Any FAIL means exit 1 and,
 * for `packs:pull`, that the pack is not vendored. `--write-golden` records
 * the current tool schemas, tool-run results and selfCheck output under
 * checks/golden/ for the next run to compare against; a person reviews and
 * commits those, never a CI job.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadPack, parseGuideFile } = require('./load-pack');
const helpers = require('./helpers');
const vocab = require('./vocab');

const MAX_PACK_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const MODULE_WARN_BYTES = 40 * 1024;
// .py is allowed so a pack can keep the script that produced checks/reference/;
// it is never run by the app or by this tool.
const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.sav', '.ts', '.csv', '.yaml', '.yml', '.py']);
const ALLOWED_NAMES = new Set(['README.md', 'LICENSE', '.gitattributes', '.gitignore', 'package.json', 'package-lock.json', 'AGENTS.md', 'CLAUDE.md']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);
const SHARED_TOOL_NAMES = ['list_ipts_catalog', 'get_latest_run', 'list_experiments'];
const FORBIDDEN_TOKENS = ['fetch(', 'XMLHttpRequest', 'require(', 'import(', 'process.', 'eval(', 'globalThis', 'setTimeout(', 'setInterval('];
const NUMBER_TOLERANCE = 1e-12;

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { packDir: null, app: null, writeGolden: false, json: false, reference: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--app') out.app = path.resolve(argv[++i]);
    else if (a === '--write-golden') out.writeGolden = true;
    else if (a === '--json') out.json = true;
    else if (a === '--reference') out.reference = path.resolve(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!out.packDir) out.packDir = path.resolve(a);
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!out.packDir) throw new Error('usage: pack-check <pack dir> [--app <root>] [--write-golden] [--reference <json>] [--json]');
  return out;
}

// ---------------------------------------------------------------------------
// what the tool needs from NeutronDesk
// ---------------------------------------------------------------------------

/**
 * Either an app checkout (source) or the packaged snapshot (dist). The
 * snapshot is marked by standalone.json next to this file, written by
 * build-dist.js together with the shared guides, the pack-api types and the
 * compiled retrieval core.
 */
function resolveResources(appArg) {
  const marker = path.join(__dirname, 'standalone.json');
  if (!appArg && fs.existsSync(marker)) {
    const meta = readJson(marker);
    return {
      mode: `packaged, built from neutrondesk ${meta.builtFrom.slice(0, 12)} on ${meta.builtAt.slice(0, 10)}`,
      sharedGuides: readJson(path.join(__dirname, 'shared-guides.json')),
      packApiDir: path.join(__dirname, 'pack-api'),
      retrievalCore: () => require(path.join(__dirname, 'retrievalCore.js')),
    };
  }
  const app = appArg ?? path.join(__dirname, '..', '..');
  if (!fs.existsSync(path.join(app, 'tools', 'pack-api', 'index.d.ts'))) {
    throw new Error(`no NeutronDesk checkout at ${app}; pass --app <root>, or install the packaged tool`);
  }
  const guidesDir = path.join(app, 'knowledge', 'guides');
  const sharedGuides = fs.existsSync(guidesDir)
    ? fs.readdirSync(guidesDir).filter((f) => f.endsWith('.md')).sort().map((f) => parseGuideFile(path.join(guidesDir, f), f))
    : [];
  return {
    mode: `app checkout at ${app}`,
    sharedGuides,
    packApiDir: path.join(app, 'tools', 'pack-api'),
    retrievalCore: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-pack-check-core-'));
      try {
        tsc(['--ignoreConfig', '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--outDir', tmp, path.join(app, 'src', 'agent', 'retrievalCore.ts')], app);
        // Loaded before the temp dir goes; require caches the module.
        return require(path.join(tmp, 'retrievalCore.js'));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name));
    } else {
      out.push(rel ? `${rel}/${entry.name}` : entry.name);
    }
  }
  return out;
}

function stable(value) {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function diffJson(a, b, at = '$') {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return null;
    return Math.abs(a - b) <= NUMBER_TOLERANCE ? null : `${at}: ${a} vs ${b}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${at}: array vs non-array`;
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i += 1) {
      const d = diffJson(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(key in a)) return `${at}.${key}: missing in golden`;
      if (!(key in b)) return `${at}.${key}: missing now`;
      const d = diffJson(a[key], b[key], `${at}.${key}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
}

function tsc(args, cwd) {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), ...args], { cwd, stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// the checks
// ---------------------------------------------------------------------------

async function run(opts) {
  const results = [];
  const record = (status, label, detail) => results.push({ status, label, detail: detail ?? null });
  const ok = (label) => record('ok', label);
  const warn = (label, detail) => record('warn', label, detail);
  const fail = (label, detail) => record('FAIL', label, detail);
  const check = (label, condition, detail) => (condition ? ok(label) : fail(label, detail));

  const packDir = opts.packDir;
  const res = resolveResources(opts.app);
  const sharedGuides = res.sharedGuides;
  const sharedGuideIds = sharedGuides.map((g) => g.id);

  // --- A. structure ----------------------------------------------------------
  let pack;
  try {
    pack = loadPack(packDir, { sharedGuideIds });
    ok('A1-6, C12-14, D15: pack.json, guides and PV catalogue load and validate');
  } catch (e) {
    fail('A: pack does not load', e.message);
    return { results, mode: res.mode };
  }
  const m = pack.manifest;

  if (!vocab.KNOWN_INSTRUMENT_IDS.includes(m.id)) {
    warn(
      `A3: "${m.id}" is not a known SNS or HFIR instrument id; the app links a pack to an instrument by this id`,
      `known: ${vocab.KNOWN_INSTRUMENT_IDS.join(', ')} (list dated ${vocab.KNOWN_INSTRUMENT_IDS_DATED})`
    );
  }

  const files = walk(packDir);
  let total = 0;
  const oversized = [];
  const badExt = [];
  const binary = [];
  for (const rel of files) {
    const full = path.join(packDir, rel);
    const bytes = fs.statSync(full).size;
    total += bytes;
    if (bytes > MAX_FILE_BYTES) oversized.push(`${rel} (${(bytes / 1024).toFixed(0)} KB)`);
    const name = path.basename(rel);
    if (!ALLOWED_NAMES.has(name) && !ALLOWED_EXTENSIONS.has(path.extname(name))) badExt.push(rel);
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) binary.push(rel);
    else {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        binary.push(`${rel} (not UTF-8)`);
      }
    }
  }
  check(`A7: pack is ${(total / 1024).toFixed(0)} KB, under ${MAX_PACK_BYTES / 1024 / 1024} MB`, total <= MAX_PACK_BYTES);
  check('A7: no file over 256 KB', oversized.length === 0, oversized.join(', '));
  check('A7: only allowed file types', badExt.length === 0, badExt.join(', '));
  check('A8: every file is UTF-8 text', binary.length === 0, binary.join(', '));

  // --- B. agent content -------------------------------------------------------
  if (m.capabilities.includes('agent')) {
    const p = pack.instructions ?? '';
    check('B9: system prompt is at least 200 characters', p.length >= 200, `${p.length} characters`);
    const placeholders = [...p.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].map((x) => x[1]).filter((x) => x !== 'INSTRUMENT_NAME');
    check('B9: no unknown placeholders in the system prompt', placeholders.length === 0, placeholders.join(', '));
  }
  const modulesDir = path.join(packDir, 'agent', 'modules');
  if (fs.existsSync(modulesDir)) {
    const ignored = fs.readdirSync(modulesDir).filter((f) => !f.endsWith('.md'));
    if (ignored.length) warn('B10: non-.md files in agent/modules are ignored', ignored.join(', '));
    const short = pack.modules.filter((x) => x.text.length < 100).map((x) => x.id);
    check('B10: every module has content', short.length === 0, `too short: ${short.join(', ')}`);
    const big = pack.modules.filter((x) => Buffer.byteLength(x.text) > MODULE_WARN_BYTES).map((x) => x.id);
    if (big.length) warn('B10: modules over 40 KB dilute their own retrieval score; consider splitting', big.join(', '));
    ok(`B10: ${pack.modules.length} module(s)`);
  }
  if (fs.existsSync(path.join(packDir, 'agent', 'scan-functions.txt'))) {
    check(`B11: scan-functions.txt parsed into ${pack.scanFunctions.length} function(s)`, pack.scanFunctions.length > 0);
  }

  // --- E. code ---------------------------------------------------------------
  let factory = null;
  let selfCheckFn = null;
  // null until the factory has run: a pack with code that failed to build has
  // no tools to run cases against, which is one failure, not one per case.
  let tools = pack.hasSrc ? null : [];
  const srcDir = path.join(packDir, 'src');
  if (pack.hasSrc) {
    const pkgFile = path.join(packDir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      const deps = readJson(pkgFile).dependencies ?? {};
      check('E16: package.json declares no dependencies', Object.keys(deps).length === 0, Object.keys(deps).join(', '));
    } else {
      ok('E16: no package.json, so no dependencies');
    }

    const srcFiles = walk(srcDir).filter((f) => f.endsWith('.ts'));
    const badImports = [];
    const forbidden = [];
    for (const rel of srcFiles) {
      const text = fs.readFileSync(path.join(srcDir, rel), 'utf8');
      for (const mt of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
        const isType = Boolean(mt[2]);
        const spec = mt[3];
        if (spec === 'neutrondesk-pack-api') {
          if (!isType) badImports.push(`${rel}: value import from neutrondesk-pack-api`);
        } else if (!spec.startsWith('./') && !spec.startsWith('../')) {
          badImports.push(`${rel}: "${spec}"`);
        } else {
          const target = path.resolve(path.dirname(path.join(srcDir, rel)), spec);
          if (!target.startsWith(srcDir + path.sep) && target !== srcDir) badImports.push(`${rel}: "${spec}" leaves src/`);
        }
      }
      for (const tok of FORBIDDEN_TOKENS) {
        if (text.includes(tok)) forbidden.push(`${rel}: ${tok}`);
      }
    }
    check('E17: src/ imports only relative files and types from neutrondesk-pack-api', badImports.length === 0, badImports.join('; '));
    check('E18: src/ contains no network, dynamic-loading or timer tokens', forbidden.length === 0, forbidden.join('; '));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-pack-check-'));
    try {
      const outDir = path.join(tmp, 'out');
      const tsconfig = {
        compilerOptions: {
          module: 'commonjs',
          target: 'es2020',
          lib: ['ES2020'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: [],
          outDir: outDir.replace(/\\/g, '/'),
          rootDir: srcDir.replace(/\\/g, '/'),
          // Absolute, so no baseUrl (deprecated in TypeScript 6) is needed.
          paths: { 'neutrondesk-pack-api': [res.packApiDir.replace(/\\/g, '/')] },
        },
        files: [path.join(srcDir, 'index.ts').replace(/\\/g, '/')],
      };
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
      let compiled = false;
      try {
        tsc(['-p', path.join(tmp, 'tsconfig.json')], tmp);
        compiled = true;
        ok('E19: src/ compiles under strict TypeScript without the DOM library');
      } catch (e) {
        fail('E19: src/ does not compile', (e.stdout?.toString() || e.message).trim().split('\n').slice(0, 12).join('\n         '));
      }

      if (compiled) {
        const mod = require(path.join(outDir, 'index.js'));
        factory = mod.default;
        selfCheckFn = typeof mod.selfCheck === 'function' ? mod.selfCheck : null;
        check('E20: src/index.ts default-exports a function', typeof factory === 'function');
        if (typeof factory === 'function') {
          const api = {
            instrumentId: m.id,
            knowledge: { modules: pack.modules, scanFunctions: pack.scanFunctions, data: pack.data },
            tools: helpers,
          };
          try {
            const def = factory(api);
            tools = Array.isArray(def?.tools) ? def.tools : null;
            check('E20: the factory returns { tools: [...] }', Array.isArray(tools));
          } catch (e) {
            fail('E20: the factory threw', e.message);
            tools = null;
          }
          if (tools) {
            const names = tools.map((t) => t?.schema?.function?.name);
            const problems = [];
            tools.forEach((t, i) => {
              const name = names[i];
              if (t?.schema?.type !== 'function') problems.push(`tool ${i}: schema.type is not "function"`);
              if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) problems.push(`tool ${i}: bad name ${JSON.stringify(name)}`);
              if (typeof t?.schema?.function?.description !== 'string') problems.push(`${name}: no description`);
              if (t?.schema?.function?.parameters?.type !== 'object') problems.push(`${name}: parameters.type is not "object"`);
              if (typeof t?.activity !== 'function' || typeof t.activity({}) !== 'string') problems.push(`${name}: activity({}) is not a string`);
              if (typeof t?.run !== 'function') problems.push(`${name}: no run()`);
              if (SHARED_TOOL_NAMES.includes(name)) problems.push(`${name}: collides with a shared app tool`);
            });
            if (new Set(names).size !== names.length) problems.push('duplicate tool names');
            check(`E21: ${tools.length} tool(s) are well-formed`, problems.length === 0, problems.join('; '));
          }
          if (selfCheckFn) {
            try {
              pack.selfCheck = selfCheckFn(api);
              ok('E20: selfCheck() ran');
            } catch (e) {
              fail('E20: selfCheck() threw', e.message);
            }
          }
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // --- F. cases and goldens ---------------------------------------------------
  const checksDir = path.join(packDir, 'checks');
  const goldenDir = path.join(checksDir, 'golden');
  const casesFile = path.join(checksDir, 'cases.json');
  const cases = fs.existsSync(casesFile) ? readJson(casesFile) : null;

  if (cases?.retrieval?.length) {
    let core = null;
    try {
      core = res.retrievalCore();
    } catch (e) {
      fail('F22: could not load the retrieval core', (e.stdout?.toString() || e.message).trim().slice(0, 400));
    }
    if (core) {
      const guideById = new Map([...sharedGuides, ...pack.guides].map((g) => [g.id, g]));
      const docs = [
        ...pack.modules.map(core.moduleDoc),
        ...m.guides.order.map((id) => guideById.get(id)).filter(Boolean).map(core.guideDoc),
      ];
      const corpus = core.buildCorpus(docs);
      for (const c of cases.retrieval) {
        const got = core.retrieveFrom(corpus, c.q, 5);
        const ids = got.map((d) => d.id);
        const short = c.q.length > 52 ? `${c.q.slice(0, 52)}…` : c.q;
        if (c.mustMention) {
          check(`F22: "${short}" retrieves something mentioning "${c.mustMention}"`, got.some((d) => d.text.toLowerCase().includes(c.mustMention.toLowerCase())), `got [${ids.join(', ')}]`);
        } else {
          check(`F22: "${short}" retrieves one of [${(c.expect ?? []).join(', ')}]`, (c.expect ?? []).some((e) => ids.includes(e)), `got [${ids.join(', ')}]`);
        }
      }
    }
  }

  const toolRunResults = [];
  if (cases?.toolRuns?.length) {
    if (!tools) {
      fail('F23: toolRuns cases present but no tools were built');
    } else {
      const byName = new Map(tools.map((t) => [t.schema.function.name, t]));
      const ctx = {
        adapter: { id: m.id, facility: m.facility, name: m.name, shortName: m.shortName, fullName: m.fullName, beamline: m.beamline },
        facility: m.facility,
        instrument: m.id,
        ipts: 'IPTS-99999',
      };
      for (const c of cases.toolRuns) {
        const tag = c.id ?? `${c.tool}(${JSON.stringify(c.args ?? {})})`;
        const tool = byName.get(c.tool);
        if (!tool) {
          fail(`F23: ${tag}: no tool named ${c.tool}`);
          continue;
        }
        let result;
        try {
          result = await tool.run(c.args ?? {}, ctx);
        } catch (e) {
          fail(`F23: ${tag}: threw`, e.message);
          continue;
        }
        toolRunResults.push({ id: c.id ?? null, tool: c.tool, args: c.args ?? {}, ok: result.ok, content: result.content });
        const problems = [];
        const expectOk = c.expectOk ?? true;
        if (result.ok !== expectOk) problems.push(`ok=${result.ok}, expected ${expectOk}`);
        for (const s of c.includes ?? []) if (!result.content.includes(s)) problems.push(`missing ${JSON.stringify(s)}`);
        for (const s of c.excludes ?? []) if (result.content.includes(s)) problems.push(`should not contain ${JSON.stringify(s)}`);
        check(`F23: ${tag}`, problems.length === 0, problems.join('; '));
      }
    }
  }

  const goldens = {};
  // A content pack has no tools, and an empty golden for them says nothing.
  if (tools && pack.hasSrc) goldens['tools.json'] = tools.map((t) => ({ schema: t.schema, activityEmpty: t.activity({}) }));
  if (toolRunResults.length) goldens['toolruns.json'] = toolRunResults;
  if (pack.selfCheck !== undefined) goldens['selfcheck.json'] = pack.selfCheck;

  if (opts.writeGolden) {
    fs.mkdirSync(goldenDir, { recursive: true });
    for (const [name, value] of Object.entries(goldens)) {
      fs.writeFileSync(path.join(goldenDir, name), stable(value), 'utf8');
      ok(`F24-26: wrote checks/golden/${name}`);
    }
  } else {
    for (const [name, value] of Object.entries(goldens)) {
      const file = path.join(goldenDir, name);
      if (!fs.existsSync(file)) {
        warn(`F24-26: no checks/golden/${name}; run with --write-golden to record it`);
        continue;
      }
      const d = diffJson(readJson(file), JSON.parse(stable(value)));
      check(`F24-26: checks/golden/${name} matches`, d === null, d);
    }
  }

  // --- H. reference comparison --------------------------------------------------
  //
  // For a pack whose code is a port of something else (EQSANS's Q-range and
  // script generation come from Python), "the port is identical" has to be a
  // pass/fail, not a claim. The original produces a JSON with the same shape
  // selfCheck() returns; this compares the two to 1e-12. checks/reference/
  // README.md in a pack should say how that file was made.
  const referenceFile = opts.reference ?? (fs.existsSync(path.join(checksDir, 'reference', 'selfcheck.json')) ? path.join(checksDir, 'reference', 'selfcheck.json') : null);
  if (referenceFile) {
    if (pack.selfCheck === undefined) {
      fail('H28: a reference file is present but src/index.ts exports no selfCheck() to compare it with');
    } else {
      let reference;
      try {
        reference = readJson(referenceFile);
      } catch (e) {
        reference = null;
        fail(`H28: could not read ${path.relative(packDir, referenceFile)}`, e.message);
      }
      if (reference) {
        const d = diffJson(reference, JSON.parse(stable(pack.selfCheck)));
        check(`H28: selfCheck() matches the reference ${path.relative(packDir, referenceFile)}`, d === null, d);
      }
    }
  }

  // --- G. determinism ---------------------------------------------------------
  const again = loadPack(packDir, { sharedGuideIds });
  check('G27: loading the pack twice gives the same result', stable(pack) === stable({ ...again, selfCheck: pack.selfCheck }));

  return { results, mode: res.mode };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  let outcome;
  try {
    outcome = await run(opts);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const { results, mode } = outcome;
  const failures = results.filter((r) => r.status === 'FAIL').length;
  const warnings = results.filter((r) => r.status === 'warn').length;
  if (opts.json) {
    console.log(JSON.stringify({ pack: opts.packDir, mode, failures, warnings, results }, null, 2));
  } else {
    console.log(`pack-check ${opts.packDir}\n  (${mode})`);
    for (const r of results) {
      const tag = r.status === 'ok' ? '  ok  ' : r.status === 'warn' ? '  warn' : '  FAIL';
      console.log(`${tag} ${r.label}${r.detail ? `\n         ${r.detail}` : ''}`);
    }
    console.log(failures === 0 ? `\npack ok${warnings ? ` (${warnings} warning(s))` : ''}` : `\n${failures} FAILED`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
