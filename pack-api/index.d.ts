/**
 * The contract between NeutronDesk and an instrument pack's code.
 *
 * A pack's `src/index.ts` imports these with `import type` only. This package
 * has no runtime: there is no `main`, so a value import fails to compile, which
 * is the point. Everything a pack needs at runtime — its own knowledge, the
 * tool-result helpers — arrives as the argument to its factory, so the pack
 * never resolves a module outside its own folder.
 *
 * Structural typing does the rest: the app passes its real adapter where an
 * `InstrumentInfo` is expected, and its own `ToolDef` type is this one.
 */

export type FacilityId = 'SNS' | 'HFIR';

/** The part of the app's instrument adapter a pack may read. */
export interface InstrumentInfo {
  readonly id: string;
  readonly facility: FacilityId;
  readonly name: string;
  readonly shortName: string;
  readonly fullName: string;
  readonly beamline: string;
}

/** JSON Schema as the OpenAI-compatible tool-calling API expects it. */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolContext {
  adapter: InstrumentInfo;
  facility: FacilityId | null;
  instrument: string | null;
  /** The experiment currently open in the app, used when a call omits one. */
  ipts: string | null;
}

export interface ToolResult {
  ok: boolean;
  content: string;
}

export interface ToolDef {
  schema: ToolSchema;
  /** A short present-tense line shown in the chat while this runs. */
  activity: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export interface KnowledgeModule {
  id: string;
  title: string;
  text: string;
}

export interface ScanFunction {
  name: string;
  /** The function's real source, from its `def` line to the next one. */
  body: string;
}

export interface PackKnowledge {
  /** agent/modules/*.md, in file order. */
  readonly modules: readonly KnowledgeModule[];
  /** agent/scan-functions.txt split at each top-level `def`. */
  readonly scanFunctions: readonly ScanFunction[];
  /** data/** as UTF-8 text, keyed by path relative to data/, forward slashes. */
  readonly data: Readonly<Record<string, string>>;
}

export interface ToolHelpers {
  ok(content: string): ToolResult;
  fail(content: string): ToolResult;
  str(args: Record<string, unknown>, key: string): string;
  strArray(args: Record<string, unknown>, key: string): string[];
  numArray(args: Record<string, unknown>, key: string): number[];
}

export interface PackApi {
  readonly instrumentId: string;
  readonly knowledge: PackKnowledge;
  readonly tools: ToolHelpers;
}

export interface PackDefinition {
  tools: ToolDef[];
}

/** What a pack's `src/index.ts` default-exports. Called once per app run. */
export type PackFactory = (api: PackApi) => PackDefinition;
