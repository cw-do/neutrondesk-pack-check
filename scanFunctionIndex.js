"use strict";
/**
 * Scan-function reference lookup.
 *
 * A port of `cw-do/eqsans-agent-for-ndesk` `scanfunctions.py`, which found that
 * generic chunk-and-embed retrieval is a poor fit for one large file of short
 * function definitions: splitting mid-function loses the signature, and vector
 * similarity on "control peltier" does not reliably surface `setpeltier1temp`.
 *
 * So a pack's `agent/scan-functions.txt` is parsed into whole named functions
 * at build time (the pack loader splits it at every top-level `def`, folding a
 * duplicated name to one entry as a Python dict would) and matched here by
 * exact name or keyword. A question about a function gets that function's real
 * source, not a chunk that happens to overlap it — which matters because the
 * alternative is a model inventing a plausible signature for a command someone
 * then runs at a beamline.
 *
 * Pure: no imports beyond types, so tools/pack-check can compile and run it
 * outside the app and give a pack the same answer the app will.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScanFunctionIndex = createScanFunctionIndex;
/** Lookups over one instrument's functions. Built once per instrument. */
function createScanFunctionIndex(fns) {
    const byName = new Map(fns.map((f) => [f.name.toLowerCase(), f]));
    // Code-point order, as Python's sorted() gives it; localeCompare would
    // ignore underscores and reorder names against the original.
    const listFunctionNames = () => fns.map((f) => f.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    /** Exact, case-insensitive name lookup. */
    const getFunction = (name) => byName.get(name.trim().toLowerCase()) ?? null;
    /**
     * Keyword search over names and bodies, best first.
     *
     * Scoring mirrors the original: an exact name match dominates, a
     * substring-in-name match comes next, and hits in the body (comments, EPICS PV
     * names) contribute least. Ties break by name so output is stable.
     */
    const searchFunctions = (query, limit = 5) => {
        const words = (query.toLowerCase().match(/\w+/g) ?? []).filter(Boolean);
        if (words.length === 0)
            return [];
        const exact = query.trim().toLowerCase();
        const scored = [];
        for (const fn of fns) {
            const lname = fn.name.toLowerCase();
            const lbody = fn.body.toLowerCase();
            let score = 0;
            if (lname === exact)
                score += 100;
            for (const w of words)
                if (lname.includes(w))
                    score += 20;
            for (const w of words)
                if (lbody.includes(w))
                    score += 1;
            if (score > 0)
                scored.push({ score, fn });
        }
        scored.sort((a, b) => b.score - a.score || (a.fn.name < b.fn.name ? -1 : a.fn.name > b.fn.name ? 1 : 0));
        return scored.slice(0, limit).map((s) => s.fn);
    };
    return { listFunctionNames, getFunction, searchFunctions };
}
