/**
 * The tool-result helpers a pack's factory receives, as pack-check provides
 * them.
 *
 * A deliberate copy of the five functions in `src/agent/tools/types.ts`, so
 * this tool can run without the app's TypeScript. `scripts/check-agent.js`
 * runs both sets on the same inputs and fails if they ever disagree.
 */

const ok = (content) => ({ ok: true, content });
const fail = (content) => ({ ok: false, content });

function str(args, key) {
  const v = args[key];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function strArray(args, key) {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : String(x))).filter(Boolean);
}

function numArray(args, key) {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

module.exports = { ok, fail, str, strArray, numArray };
