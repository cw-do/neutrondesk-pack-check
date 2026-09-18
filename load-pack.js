/**
 * Read one instrument pack folder into a validated object.
 *
 * Used by two things that must agree on what a pack is: `scripts/gen-packs.js`,
 * which bundles every vendored pack into the app, and `tools/pack-check`,
 * which a pack team runs before handing a pack over. The format is
 * docs/packs/format.md; this is that document as code.
 *
 * Validation here is the part that makes a pack loadable at all. The wider
 * checks (sizes, forbidden imports, cases, goldens) live in pack-check.
 */

const fs = require('fs');
const path = require('path');

const vocab = require('./vocab');

const GUIDE_REQUIRED = ['id', 'title', 'category', 'summary', 'updated', 'source'];
const INSTRUMENT_MARKER = '<!-- instrument -->';
const MAX_SUGGESTIONS = 6;

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function exists(file) {
  return fs.existsSync(file);
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function unique(list) {
  return new Set(list).size === list.length;
}

// --- guides ----------------------------------------------------------------

/** Parse one guide file. Exported so gen-packs can read the app's shared guides too. */
function parseGuideFile(file, label) {
  const text = read(file);
  if (!text.startsWith('---\n')) throw new Error(`${label}: no front matter`);
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`${label}: front matter is not closed`);

  const meta = {};
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon < 0) throw new Error(`${label}: bad front-matter line "${line}"`);
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  for (const key of GUIDE_REQUIRED) {
    if (!meta[key]) throw new Error(`${label}: front matter is missing "${key}"`);
  }
  const expectedId = path.basename(file).replace(/\.md$/, '');
  if (meta.id !== expectedId) {
    throw new Error(`${label}: id "${meta.id}" does not match the filename`);
  }
  return { ...meta, body: text.slice(end + 5).trim() };
}

function loadGuides(dir, label) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseGuideFile(path.join(dir, f), `${label}/guides/${f}`));
}

// --- agent -----------------------------------------------------------------

function loadModules(dir) {
  if (!exists(dir)) return [];
  // Only *.md: anything else is invisible rather than partially useful, which
  // is the honest failure mode for a knowledge base.
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => {
      // module2 before module10: a plain string sort puts them the wrong way round.
      const na = Number((a.match(/(\d+)/) ?? [])[1] ?? 0);
      const nb = Number((b.match(/(\d+)/) ?? [])[1] ?? 0);
      return na - nb || a.localeCompare(b);
    })
    .map((file) => {
      const text = read(path.join(dir, file)).trim();
      // The title is a Setext header ("Title\n=====") or an ATX one ("# Title")
      // on the first line; failing both, the file name. Setext is checked
      // first because a Python-heavy corpus has '#' comments inside fenced
      // blocks, and only the first line is considered for ATX for the same
      // reason.
      const lines = text.split('\n');
      const setext = lines.findIndex((l, i) => i > 0 && /^[=-]{3,}\s*$/.test(l));
      const atx = /^#\s+(.+?)\s*#*\s*$/.exec(lines[0] ?? '');
      const title = setext > 0 ? lines[setext - 1].trim() : atx ? atx[1] : file.replace(/\.md$/, '');
      return { id: file.replace(/\.md$/, ''), title, text };
    });
}

/**
 * Split the scan-function source at each top-level `def`, so a lookup returns
 * a whole function rather than a chunk that happens to straddle one.
 *
 * A name defined twice keeps its first position and its last body, which is
 * what a Python dict built from the same file does and what the original
 * agents did. The duplicates are reported so pack-check can warn: a function
 * defined twice in a live scan file is a mistake worth telling the team about.
 */
function loadScanFunctions(file) {
  if (!exists(file)) return { functions: [], duplicates: [] };
  const source = read(file);
  const defs = [...source.matchAll(/^def\s+(\w+)\s*\(/gm)];
  const byName = new Map();
  const duplicates = [];
  defs.forEach((m, i) => {
    const body = source.slice(m.index, i + 1 < defs.length ? defs[i + 1].index : source.length).trimEnd();
    if (byName.has(m[1])) duplicates.push(m[1]);
    byName.set(m[1], body);
  });
  return {
    functions: [...byName.entries()].map(([name, body]) => ({ name, body })),
    duplicates: [...new Set(duplicates)],
  };
}

// --- data ------------------------------------------------------------------

function loadData(dir) {
  const out = {};
  if (!exists(dir)) return out;
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else out[rel] = read(path.join(dir, rel));
    }
  };
  walk('');
  // Sorted keys, so the generated bundle and the content hash are stable.
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

// --- manifest --------------------------------------------------------------

function validateManifest(m, label) {
  const bad = (what) => {
    throw new Error(`${label}/pack.json: ${what}`);
  };
  if (!m || typeof m !== 'object' || Array.isArray(m)) bad('not an object');

  for (const key of Object.keys(m)) {
    if (!vocab.MANIFEST_KEYS.includes(key)) bad(`unknown key "${key}"`);
  }
  if (!vocab.SUPPORTED_SCHEMA_VERSIONS.includes(m.schemaVersion)) {
    bad(`schemaVersion ${JSON.stringify(m.schemaVersion)} is not supported (${vocab.SUPPORTED_SCHEMA_VERSIONS.join(', ')})`);
  }
  for (const key of ['id', 'name', 'shortName', 'fullName', 'beamline', 'blurb']) {
    if (typeof m[key] !== 'string' || !m[key].trim()) bad(`"${key}" must be a non-empty string`);
  }
  if (!/^[A-Z][A-Z0-9]*$/.test(m.id)) bad(`id "${m.id}" must be upper-case letters and digits`);
  if (!vocab.FACILITIES.includes(m.facility)) bad(`facility must be one of ${vocab.FACILITIES.join(', ')}`);

  if (!isStringArray(m.capabilities) || !unique(m.capabilities)) bad('capabilities must be an array of unique strings');
  for (const c of m.capabilities) {
    if (!vocab.CAPABILITIES.includes(c) && !vocab.DEPRECATED_CAPABILITIES.includes(c)) bad(`unknown capability "${c}"`);
  }
  if (typeof m.usesSansTitleConvention !== 'boolean') bad('usesSansTitleConvention must be a boolean');

  if (!m.guides || typeof m.guides !== 'object') bad('guides must be an object');
  if (!isStringArray(m.guides.order) || !unique(m.guides.order)) bad('guides.order must be an array of unique guide ids');
  if (!isStringArray(m.guides.categories) || !unique(m.guides.categories)) bad('guides.categories must be an array of unique categories');
  for (const c of m.guides.categories) {
    if (!vocab.GUIDE_CATEGORIES.includes(c)) bad(`unknown guide category "${c}"`);
  }

  if (!Array.isArray(m.links)) bad('links must be an array');
  const linkIds = [];
  for (const l of m.links) {
    for (const key of ['id', 'label', 'url', 'what']) {
      if (typeof l[key] !== 'string' || !l[key].trim()) bad(`link "${l.id ?? '?'}": "${key}" must be a non-empty string`);
    }
    if (!/^https:\/\//.test(l.url)) bad(`link "${l.id}": url must be https`);
    if (!vocab.LINK_GROUPS.includes(l.group)) bad(`link "${l.id}": group must be one of ${vocab.LINK_GROUPS.join(', ')}`);
    if ('login' in l && typeof l.login !== 'boolean') bad(`link "${l.id}": login must be a boolean`);
    for (const key of Object.keys(l)) {
      if (!['id', 'label', 'url', 'what', 'group', 'login'].includes(key)) bad(`link "${l.id}": unknown key "${key}"`);
    }
    linkIds.push(l.id);
  }
  if (!unique(linkIds)) bad('link ids must be unique');

  if (!m.agent || typeof m.agent !== 'object') bad('agent must be an object');
  for (const key of Object.keys(m.agent)) {
    if (!['suggestions', 'retrievalTerms'].includes(key)) bad(`agent: unknown key "${key}"`);
  }
  if ('retrievalTerms' in m.agent) {
    if (!isStringArray(m.agent.retrievalTerms) || !unique(m.agent.retrievalTerms)) bad('agent.retrievalTerms must be an array of unique strings');
    for (const t of m.agent.retrievalTerms) {
      if (t !== t.toLowerCase() || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) bad(`agent.retrievalTerms: "${t}" must be a lower-case word`);
    }
  }
  if (!isStringArray(m.agent.suggestions)) bad('agent.suggestions must be an array of strings');
  if (m.agent.suggestions.length < 1 || m.agent.suggestions.length > MAX_SUGGESTIONS) {
    bad(`agent.suggestions must have 1 to ${MAX_SUGGESTIONS} entries`);
  }
  for (const s of m.agent.suggestions) {
    if (!s.trim() || s.length > 120) bad(`suggestion "${s.slice(0, 30)}…" must be 1 to 120 characters`);
  }

  if ('maintainers' in m) {
    if (!Array.isArray(m.maintainers)) bad('maintainers must be an array');
    for (const p of m.maintainers) {
      if (typeof p.name !== 'string' || !p.name.trim()) bad('each maintainer needs a name');
      if ('email' in p && typeof p.email !== 'string') bad('maintainer email must be a string');
    }
  }
}

function loadPvCatalogue(file, label) {
  if (!exists(file)) return [];
  const list = JSON.parse(read(file));
  const bad = (what) => {
    throw new Error(`${label}/pv/catalogue.json: ${what}`);
  };
  if (!Array.isArray(list)) bad('must be an array');
  const seen = new Set();
  for (const pv of list) {
    for (const key of ['logName', 'friendlyName', 'description']) {
      if (typeof pv[key] !== 'string' || !pv[key].trim()) bad(`"${pv.logName ?? '?'}": "${key}" must be a non-empty string`);
    }
    if (typeof pv.units !== 'string') bad(`"${pv.logName}": units must be a string (empty is allowed)`);
    if (!vocab.PV_CATEGORIES.includes(pv.category)) bad(`"${pv.logName}": unknown category "${pv.category}"`);
    if ('scale' in pv && !(typeof pv.scale === 'number' && Number.isFinite(pv.scale))) bad(`"${pv.logName}": scale must be a finite number`);
    if ('epicsName' in pv && typeof pv.epicsName !== 'string') bad(`"${pv.logName}": epicsName must be a string`);
    if ('aliases' in pv && !isStringArray(pv.aliases)) bad(`"${pv.logName}": aliases must be an array of strings`);
    for (const key of Object.keys(pv)) {
      if (!['logName', 'friendlyName', 'description', 'units', 'category', 'scale', 'epicsName', 'aliases'].includes(key)) {
        bad(`"${pv.logName}": unknown key "${key}"`);
      }
    }
    if (seen.has(pv.logName)) bad(`duplicate logName "${pv.logName}"`);
    seen.add(pv.logName);
  }
  return list;
}

// --- the pack --------------------------------------------------------------

/**
 * @param {string} dir  pack root
 * @param {{ sharedGuideIds?: string[] }} [opts]  ids of the guides the app ships itself
 */
function loadPack(dir, opts = {}) {
  const sharedGuideIds = new Set(opts.sharedGuideIds ?? []);
  const label = path.basename(dir);

  const manifestFile = path.join(dir, 'pack.json');
  if (!exists(manifestFile)) throw new Error(`${label}: pack.json is missing`);
  let manifest;
  try {
    manifest = JSON.parse(read(manifestFile));
  } catch (e) {
    throw new Error(`${label}/pack.json: ${e.message}`);
  }
  validateManifest(manifest, label);

  const guides = loadGuides(path.join(dir, 'guides'), label);
  const guideIds = new Set(guides.map((g) => g.id));
  if (!unique(guides.map((g) => g.id))) throw new Error(`${label}: duplicate guide id`);
  for (const g of guides) {
    if (!manifest.guides.categories.includes(g.category)) {
      throw new Error(`${label}/guides/${g.id}.md: category "${g.category}" is not in pack.json guides.categories`);
    }
    if (sharedGuideIds.has(g.id)) throw new Error(`${label}/guides/${g.id}.md: id collides with a shared guide`);
    if (!manifest.guides.order.includes(g.id)) throw new Error(`${label}: guide "${g.id}" is not in pack.json guides.order`);
  }
  for (const id of manifest.guides.order) {
    if (!guideIds.has(id) && !sharedGuideIds.has(id)) {
      throw new Error(`${label}/pack.json: guides.order names "${id}", which is neither a pack guide nor a shared guide`);
    }
  }

  const promptFile = path.join(dir, 'agent', 'system-prompt.md');
  const instructions = exists(promptFile) ? read(promptFile).trim() : null;
  if (instructions !== null && instructions.includes(INSTRUMENT_MARKER)) {
    throw new Error(`${label}/agent/system-prompt.md: must not contain ${INSTRUMENT_MARKER}; that marker belongs to the app template`);
  }

  const scan = loadScanFunctions(path.join(dir, 'agent', 'scan-functions.txt'));
  // A deprecated capability is dropped here so nothing downstream sees it;
  // pack-check reports it from the raw manifest.
  manifest.capabilities = manifest.capabilities.filter((c) => !vocab.DEPRECATED_CAPABILITIES.includes(c));
  return {
    folder: label,
    manifest,
    pvs: loadPvCatalogue(path.join(dir, 'pv', 'catalogue.json'), label),
    guides,
    instructions,
    modules: loadModules(path.join(dir, 'agent', 'modules')),
    scanFunctions: scan.functions,
    /** Names defined more than once in scan-functions.txt; not bundled, only reported. */
    scanFunctionDuplicates: scan.duplicates,
    data: loadData(path.join(dir, 'data')),
    hasSrc: exists(path.join(dir, 'src', 'index.ts')),
  };
}

module.exports = { loadPack, parseGuideFile, INSTRUMENT_MARKER };
