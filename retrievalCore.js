"use strict";
/**
 * Keyword scoring at whole-document granularity — no embeddings, no vector
 * store, no network, and no imports. A port of `cw-do/eqsans-agent-for-ndesk`
 * `knowledge.py`, which is in the spirit of ESAC v2's own retrieval.
 *
 * This file is the scoring only. `retrieve.ts` wraps it with the app's
 * knowledge and guides; `tools/pack-check` compiles this file alone to score a
 * candidate pack's documents before the pack is vendored, so the check runs the
 * same arithmetic the app runs.
 *
 * Whole-document rather than chunked because each module already covers one
 * focused topic, and because these documents are Setext-headed with `#` only
 * appearing inside Python comments in fenced blocks — splitting on headings
 * would fragment the code examples badly. The corpus is tens of kilobytes, so
 * re-scoring everything per question costs nothing worth optimising.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCorpus = buildCorpus;
exports.retrieveFrom = retrieveFrom;
exports.moduleDoc = moduleDoc;
exports.guideDoc = guideDoc;
/**
 * Terms that mean the question is about this domain at all.
 *
 * They lift a document that shares the subject over one that merely shares a
 * couple of common words — the difference between retrieving the temperature
 * module for "what temperature can the peltier reach" and retrieving whichever
 * document happens to say "can" most often.
 *
 * Only words that are about neutron scattering at any beamline belong here.
 * An instrument's own names (its id, its reduction tool) come from its pack's
 * `agent.retrievalTerms`, so no instrument is named in shared code.
 */
const SHARED_TERMS = [
    'sans',
    'scan',
    'function',
    'script',
    'instrument',
    'detector',
    'sample',
    'transmission',
    'scattering',
    'configuration',
    'temperature',
    'reduction',
    'reduce',
    'stitch',
];
function wordCounts(text) {
    const counts = new Map();
    for (const w of text.match(/\b\w+\b/g) ?? []) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    return counts;
}
function buildCorpus(docs, extraTerms = []) {
    const candidates = docs.map((d) => {
        const lower = d.lower ?? d.text.toLowerCase();
        return { id: d.id, title: d.title, text: d.text, origin: d.origin, lower, counts: wordCounts(lower) };
    });
    const documentFrequency = new Map();
    for (const doc of candidates) {
        for (const word of doc.counts.keys()) {
            documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
        }
    }
    const terms = [...new Set([...SHARED_TERMS, ...extraTerms.map((t) => t.toLowerCase())])];
    return { docs: candidates, documentFrequency, terms };
}
/**
 * How much one matched word is worth.
 *
 * A word in every document says nothing about which document to read. Scoring
 * every match equally is what made "what moderator does EQ-SANS use?" retrieve
 * the reduction module: "what", "does" and "use" are everywhere, and their
 * combined weight buried the one word that actually located the answer.
 * Weighting by rarity puts `moderator` — in one document out of twenty — far
 * above them.
 */
function inverseDocumentFrequency(word, total, df) {
    if (df <= 0)
        return 0;
    return Math.log(1 + total / df);
}
function score(doc, words, queryLower, c) {
    let s = 0;
    if (doc.lower.includes(queryLower))
        s += 100;
    const total = c.docs.length;
    for (const word of words) {
        const occurrences = doc.counts.get(word) ?? 0;
        if (occurrences === 0) {
            // Still count a match inside a longer word — "reduce" in "reduced" — but
            // at the weight of a common term, since it is a weaker signal.
            if (doc.lower.includes(word))
                s += 4;
            continue;
        }
        const idf = inverseDocumentFrequency(word, total, c.documentFrequency.get(word) ?? total);
        // Repetition means the document dwells on the term, but a document that
        // says it eighty times is not eighty times better — so the count saturates.
        const tf = 1 + Math.log(Math.min(occurrences, 12));
        s += 10 * idf * tf;
    }
    for (const t of c.terms) {
        if (queryLower.includes(t) && doc.lower.includes(t))
            s += 12;
    }
    return s;
}
/**
 * The best `k` documents for a question, highest score first.
 *
 * Empty when nothing scores at all, which is a real answer: the caller should
 * let the model say it does not have the information rather than padding the
 * context with the least-irrelevant document.
 */
function retrieveFrom(c, query, k = 5) {
    const words = [...new Set(query.toLowerCase().match(/\b\w+\b/g) ?? [])];
    if (words.length === 0)
        return [];
    const queryLower = query.toLowerCase();
    return c.docs
        .map((doc) => ({ doc, s: score(doc, words, queryLower, c) }))
        .filter((e) => e.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, k)
        .map(({ doc, s }) => ({
        id: doc.id,
        title: doc.title,
        text: doc.text,
        origin: doc.origin,
        score: s,
    }));
}
/** A knowledge module as a corpus document. */
function moduleDoc(m) {
    return { id: m.id, title: m.title, text: m.text, origin: 'module' };
}
/**
 * A guide as a corpus document.
 *
 * The summary carries wording the body often does not, and it is what a
 * question is most likely to echo — so it is scored along with the title.
 */
function guideDoc(g) {
    return {
        id: `guide:${g.id}`,
        title: g.title,
        text: `${g.title}\n\n${g.summary}\n\n${g.body}`,
        origin: 'guide',
        lower: `${g.title}\n${g.summary}\n${g.body}`.toLowerCase(),
    };
}
