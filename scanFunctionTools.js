"use strict";
/**
 * The two scan-function tools the app gives every instrument whose pack ships
 * `agent/scan-functions.txt`.
 *
 * They used to be part of the EQSANS pack's own code. Looking a function up by
 * name or keyword and quoting its source is not an EQ-SANS calculation, it is
 * the same for any instrument scripted in Python — so a pack with no code at
 * all gets these for free, and a pack that wants its own reader gives its tool
 * a different name. The two names here are reserved; pack-check refuses a
 * pack that defines either.
 *
 * Pure: takes the functions, the instrument's name for the descriptions, and
 * the result helpers, so tools/pack-check can run it outside the app and a
 * pack's cases exercise exactly what the app will ship.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCAN_FUNCTION_TOOL_NAMES = void 0;
exports.buildScanFunctionTools = buildScanFunctionTools;
const scanFunctionIndex_1 = require("./scanFunctionIndex");
exports.SCAN_FUNCTION_TOOL_NAMES = ['list_scan_functions', 'lookup_scan_function'];
function buildScanFunctionTools(fns, instrumentName, helpers) {
    if (fns.length === 0)
        return [];
    const { ok, fail, str } = helpers;
    const sf = (0, scanFunctionIndex_1.createScanFunctionIndex)(fns);
    const listScanFunctions = {
        schema: {
            type: 'function',
            function: {
                name: 'list_scan_functions',
                description: `List the names of every ${instrumentName} scan function. Use before lookup_scan_function when ` +
                    'you need to see what exists.',
                parameters: { type: 'object', properties: {} },
            },
        },
        activity: () => 'Listing the scan functions',
        run: () => ok(sf.listFunctionNames().join('\n')),
    };
    const lookupScanFunction = {
        schema: {
            type: 'function',
            function: {
                name: 'lookup_scan_function',
                description: 'Get the exact source — signature, parameters, comments, the real EPICS/PV calls — of ' +
                    `${instrumentName} scan functions, by name or by topic keyword. Use this for ANY question about ` +
                    'what a function does, its parameters, or how to control something. Never guess a ' +
                    'function name or signature.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: "A function name ('setpeltier1temp') or a topic keyword ('peltier', 'transmission').",
                        },
                    },
                    required: ['query'],
                },
            },
        },
        activity: (a) => `Looking up ${str(a, 'query') || 'the scan function'}`,
        run: (args) => {
            const query = str(args, 'query');
            const exact = sf.getFunction(query);
            if (exact)
                return ok(exact.body);
            const matches = sf.searchFunctions(query);
            if (matches.length === 0) {
                return fail(`No scan function matches "${query}". Call list_scan_functions to see all ` +
                    `${sf.listFunctionNames().length} names.`);
            }
            return ok(matches.map((m) => `# ${m.name}\n${m.body}`).join('\n\n'));
        },
    };
    return [listScanFunctions, lookupScanFunction];
}
