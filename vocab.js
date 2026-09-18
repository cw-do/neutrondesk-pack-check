/**
 * The vocabularies a pack may use, as the app currently defines them.
 *
 * Kept here as plain constants so the pack tools can run without the app's
 * TypeScript. `scripts/check-agent.js` asserts these equal the unions in
 * `src/types/index.ts` and `src/instruments/types.ts`, so the two cannot drift
 * silently. Phase 2 of docs/upgradeplan/ moves these vocabularies into the
 * packs themselves, at which point this file goes away.
 */

exports.CAPABILITIES = ['runs', 'monitor', 'detector', 'pv', 'guides', 'reduction'];

/**
 * Accepted and dropped with a warning. "agent" meant "has the Ask assistant",
 * but every instrument has it; a pack tunes it by shipping agent/system-prompt.md.
 */
exports.DEPRECATED_CAPABILITIES = ['agent'];

exports.GUIDE_CATEGORIES = [
  'experiment',
  'reduction',
  'data-access',
  'eqsanscli',
  'sansdir',
  'troubleshooting',
];

exports.PV_CATEGORIES = ['geometry', 'beam', 'chopper', 'sample-environment', 'aperture', 'acquisition'];

exports.LINK_GROUPS = ['start', 'reduce', 'data', 'facility'];

exports.FACILITIES = ['SNS', 'HFIR'];

/** Top-level pack.json keys. Anything else is a typo, and fails. */
exports.MANIFEST_KEYS = [
  'schemaVersion',
  'id',
  'facility',
  'name',
  'shortName',
  'fullName',
  'beamline',
  'blurb',
  'capabilities',
  'usesSansTitleConvention',
  'guides',
  'links',
  'agent',
  'maintainers',
];

exports.SUPPORTED_SCHEMA_VERSIONS = [1];

/**
 * ONCat instrument ids at SNS and HFIR, as the app's instrument picker shows
 * them. A pack is linked to an instrument by this id alone, so a typo here
 * means a pack that never attaches to anything. Maintained by hand: ONCat's
 * /api/instruments needs a login, so the tool cannot read it. An id not in
 * this list is a warning, not a failure, because the list can be behind.
 */
exports.KNOWN_INSTRUMENT_IDS = [
  // SNS
  'ARCS', 'BSS', 'CNCS', 'CORELLI', 'EQSANS', 'HYS', 'MANDI', 'NOM', 'PG3', 'REF_L', 'REF_M',
  'SEQ', 'SNAP', 'TOPAZ', 'USANS', 'VENUS', 'VIS', 'VULCAN',
  // HFIR
  'CG1D', 'CG2', 'CG3', 'CG4C', 'HB1', 'HB1A', 'HB2A', 'HB2B', 'HB2C', 'HB3', 'HB3A',
];
exports.KNOWN_INSTRUMENT_IDS_DATED = '2026-09-18';
