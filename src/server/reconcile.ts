/**
 * The reconciliation service (#38): one decision per store requirement, in a fixed order. An exact
 * known mapping (the requirement's key on a definition, or the vendor field that created one), a
 * mapping saved on the gift, a deterministic alias match with a type check, the model over schema
 * metadata only, a new field, and a confirmation when the match is ambiguous or the confidence sits
 * under the threshold. Deterministic code validates types and constraints, turns a decision into the
 * mapping row and the question the request step stores, and computes completeness; the model only
 * proposes an attribute id, and a proposal naming an unknown or incompatible attribute is dropped.
 *
 * The model's verdicts, the organizer's confirmations, and the decisions they settle persist in the
 * state document's reconciliations collection (domain/reconciliation.ts), one row per gift per
 * schema version, so a confirmation survives a restart and a new schema version starts its own row.
 */
import { CLOCK_TIME, fieldConstraints, KIND_VALUE_TYPES } from "../domain/personalization";
import { reconciliationFor, updateReconciliation } from "../domain/reconciliation";
import { deriveSchemaVersion } from "../domain/requirement-schema";
import { state } from "../domain/store";
import type { AttributeDefinition, Batch, Confirmation, Constraints, DecisionConfirmer, DeriveMethod, DerivedSource, MatchMethod, ModelVerdict, Option, PersonalizationField, PersonalizationKind, PersonalizationMapping, PersonalizationTransform, ProposedDefinition, Reconciliation, ReconciliationCandidate, ReconciliationDecision, StoredDecision, ValueType } from "../domain/types";
import { canonicalRequirementKey, slugValue } from "../domain/values";
import type { Requirement } from "./api";
import { llmEnabled } from "./flags";

/* ---- Shapes ---- */

/** One requirement of the store's schema: a customization field or the variant axis the product sells by. */
export type VendorRequirement = { key: string; label: string; kind: PersonalizationKind | "variant"; required: boolean; max_length?: number; allowed?: Option[] };

/** The store's schema for one product: its id, its version, and its requirements. */
export type VendorSchema = { id: string; version: string; requirements: VendorRequirement[] };

export type { Confirmation, DeriveMethod, DerivedSource, MatchMethod, ProposedDefinition, ReconciliationDecision };
export type Candidate = ReconciliationCandidate;

/** What the model answers for one requirement: the attribute it proposes or null, with its confidence and reason. */
export type LlmMatch = { attribute_id: string | null; confidence: number; reason: string };
export type LlmMatchInput = { requirement: { key: string; label: string; type: string }; fields: { id: string; label: string; type: ValueType }[] };
export type LlmMatcher = (input: LlmMatchInput) => Promise<LlmMatch>;

export type ReconcileInput = { vendorSchema: VendorSchema; tokuchuAttributes: AttributeDefinition[]; savedMappings: PersonalizationMapping[] };
export type ReconcileOptions = {
  /** The model step; absent or null skips it. */
  llm?: LlmMatcher | null;
  /** A model proposal under this confidence becomes needs_confirmation. */
  threshold?: number;
  /** The organizer's confirmations by requirement key. */
  confirmations?: Map<string, Confirmation>;
  /** Model verdicts already recorded, by requirement key. */
  proposals?: Map<string, LlmMatch>;
};

/** The pending confirmation a requirement carries to the organizer. */
export type RequirementConfirmation = { candidates: Candidate[]; reason: string };

export type Completeness = { total: number; resolved: number; to_create: number; pending_confirmation: number; complete: boolean };

/** The module's configuration: the confidence a model proposal needs to stand without confirmation. */
export const RECONCILE_CONFIG = { threshold: 0.8 };

const ALIAS_CONFIDENCE = { key: 0.9, label: 0.85 };

/* ---- Aliases ---- */

/**
 * The alias table: one concept per row with the requirement words and kinds that name it, the
 * definition keys that hold it, and the derived source it falls back to. Extend it from the fields
 * the stores state; the demo store's star map fields and the library's questions seeded these rows.
 */
type Concept = { requirement: string[]; kinds: (PersonalizationKind | "variant")[]; attributes: string[]; derive?: { source: DerivedSource; transform?: PersonalizationTransform } };

const CONCEPTS: Record<string, Concept> = {
  name: { requirement: ["name", "printed_name", "name_to_print", "name_on_map", "full_name"], kinds: ["name", "monogram"], attributes: ["printed_name", "name", "name_to_print", "full_name"], derive: { source: { type: "guest", key: "display_name" } } },
  size: { requirement: ["size", "shirt_size", "tshirt_size", "variant_size"], kinds: ["variant"], attributes: ["variant_size", "size", "shirt_size", "tshirt_size"] },
  location: { requirement: ["location", "city", "place", "hometown", "star_map_location"], kinds: ["location"], attributes: ["location", "city", "hometown", "star_map_location"] },
  time: { requirement: ["time", "star_map_time"], kinds: ["time"], attributes: ["time", "star_map_time"] },
  event_date: { requirement: ["event_date", "star_map_date"], kinds: [], attributes: ["event_date", "star_map_date"], derive: { source: { type: "event", key: "starts_at" }, transform: "date_only" } },
  image: { requirement: ["photo", "image", "picture", "image_upload", "upload"], kinds: ["image"], attributes: ["photo", "image", "picture"] },
  dietary: { requirement: ["dietary", "allergies", "diet"], kinds: [], attributes: ["dietary", "allergies"] }
};

const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !/^\d+$/.test(t));

/** The concept a requirement names and how it named it: its key or kind, or only its label. */
function requirementConcept(req: VendorRequirement): { name: string; by: "key" | "label" } | null {
  const key = req.key.toLowerCase();
  const keyTokens = new Set(tokens(req.key));
  for (const [name, c] of Object.entries(CONCEPTS)) {
    if (c.requirement.includes(key) || c.kinds.includes(req.kind) || c.requirement.some((a) => keyTokens.has(a))) return { name, by: "key" };
  }
  const labelTokens = new Set(tokens(req.label));
  for (const [name, c] of Object.entries(CONCEPTS)) if (c.requirement.some((a) => labelTokens.has(a))) return { name, by: "label" };
  return null;
}

function attributeConcepts(def: AttributeDefinition): Set<string> {
  const key = def.key.toLowerCase();
  const keyTokens = new Set(tokens(def.key));
  const out = new Set<string>();
  for (const [name, c] of Object.entries(CONCEPTS)) if (c.attributes.includes(key) || c.attributes.some((a) => keyTokens.has(a))) out.add(name);
  return out;
}

/* ---- Type and constraint checks ---- */

/** The value types a requirement accepts: the field kind's table, and a choice for the variant axis. */
function acceptedTypes(req: VendorRequirement): ValueType[] {
  return req.kind === "variant" ? ["enum"] : KIND_VALUE_TYPES[req.kind];
}

/**
 * Why a definition cannot fill a requirement, or null when it can: the value type must be one the
 * kind accepts, and a choice must offer at least one value the requirement's allowed set takes.
 */
export function incompatibility(req: VendorRequirement, def: AttributeDefinition): string | null {
  if (!acceptedTypes(req).includes(def.value_type)) return `${def.label} is ${def.value_type} and ${req.label} needs ${acceptedTypes(req).join(" or ")}`;
  const allowed = req.allowed?.map((o) => o.value) ?? [];
  if (allowed.length && (def.value_type === "enum" || def.value_type === "multi_enum")) {
    const values = (def.constraints.options ?? []).map((o) => o.value);
    if (!values.some((v) => allowed.includes(v))) return `${def.label} offers none of the values ${req.label} takes`;
  }
  return null;
}

/** The question a requirement becomes: a date for a date kind, a file address for an image, a choice for an allowed set, and text with the store's cap otherwise. */
export function proposedDefinition(req: VendorRequirement): ProposedDefinition {
  const base = { key: req.key, label: req.label, scope: "guest" as const, required_rule: "going" as const, ...(req.kind === "variant" ? {} : { vendor_field: { key: req.key, label: req.label, kind: req.kind } }) };
  if (req.kind === "date") return { ...base, value_type: "date", constraints: {} };
  if (req.kind === "image") return { ...base, value_type: "file", constraints: {} };
  if (req.allowed?.length) return { ...base, value_type: "enum", constraints: { options: req.allowed } };
  const constraints: Constraints = {};
  if (req.max_length !== undefined) constraints.max_length = req.max_length;
  if (req.kind === "time") constraints.pattern = CLOCK_TIME.source;
  return { ...base, value_type: "text", constraints };
}

/* ---- The decision order ---- */

type Step = (req: VendorRequirement, ctx: Context) => ReconciliationDecision | null;
type Context = { defs: AttributeDefinition[]; shopDomain: string; byId: Map<string, AttributeDefinition>; saved: Map<string, PersonalizationMapping>; confirmations: Map<string, Confirmation>; proposals: Map<string, LlmMatch>; threshold: number };

const map = (req: VendorRequirement, def: AttributeDefinition, method: MatchMethod, confidence: number): ReconciliationDecision => ({ requirement_id: req.key, decision: "map_existing", attribute_id: def.id, confidence, method });
const candidate = (def: AttributeDefinition, method: MatchMethod, confidence: number): Candidate => ({ attribute_id: def.id, label: def.label, confidence, method });
const confirm = (req: VendorRequirement, candidates: Candidate[], reason: string): ReconciliationDecision => ({ requirement_id: req.key, decision: "needs_confirmation", candidates, reason });

/** The organizer's confirmation settles the requirement before any matching runs. */
const confirmed: Step = (req, ctx) => {
  const choice = ctx.confirmations.get(req.key);
  if (!choice) return null;
  // A confirmation to create stands until the request step has created the question; from then on the exact step maps it.
  if ("create" in choice) return ctx.defs.some((d) => d.vendor_field?.key === req.key) ? null : { requirement_id: req.key, decision: "create_field", proposed_definition: proposedDefinition(req), confidence: 1 };
  const def = ctx.byId.get(choice.attribute_id);
  return def && !incompatibility(req, def) ? map(req, def, "exact", 1) : null;
};

/** A definition carrying the requirement's key, or created by the vendor field with that key. */
const exact: Step = (req, ctx) => {
  // The canonical key drops a leading store name, so a store's own prefix on a field still meets the shared concept (#39).
  const canonical = canonicalRequirementKey(req.key, ctx.shopDomain);
  const def = ctx.defs.find((d) => d.vendor_field?.key === req.key) ?? ctx.defs.find((d) => d.key === req.key) ?? ctx.defs.find((d) => d.key === canonical && d.vendor_field?.kind === req.kind);
  if (!def) return null;
  const why = incompatibility(req, def);
  return why ? confirm(req, [candidate(def, "exact", 0.5)], why) : map(req, def, "exact", 1);
};

/** A mapping row saved on the gift: a definition that still exists, or a derived source. */
const saved: Step = (req, ctx) => {
  const row = ctx.saved.get(req.key);
  if (!row) return null;
  if (row.source.type !== "definition") return { requirement_id: req.key, decision: "derive", source: row.source, ...(row.transform ? { transform: row.transform } : {}), confidence: 1, method: "saved_mapping" };
  const def = ctx.byId.get(row.source.definition_id);
  return def && !incompatibility(req, def) ? map(req, def, "saved_mapping", 1) : null;
};

/** The alias table: one compatible definition under the requirement's concept maps, several ask for confirmation, none derives when the concept has a source. */
const alias: Step = (req, ctx) => {
  const concept = requirementConcept(req);
  if (!concept) return null;
  const confidence = ALIAS_CONFIDENCE[concept.by];
  const matches = ctx.defs.filter((d) => attributeConcepts(d).has(concept.name) && !incompatibility(req, d));
  if (matches.length === 1) return map(req, matches[0], "alias", confidence);
  if (matches.length > 1) return confirm(req, matches.map((d) => candidate(d, "alias", confidence)), `${matches.length} fields could fill ${req.label}`);
  const derive = CONCEPTS[concept.name].derive;
  if (derive && req.kind !== "variant") return { requirement_id: req.key, decision: "derive", source: derive.source, ...(derive.transform ? { transform: derive.transform } : {}), confidence, method: "deterministic" };
  return null;
};

/** A recorded model verdict: a compatible attribute over the threshold maps, under it asks for confirmation, and anything else falls through. */
const proposed: Step = (req, ctx) => {
  const verdict = ctx.proposals.get(req.key);
  const def = verdict?.attribute_id ? ctx.byId.get(verdict.attribute_id) : undefined;
  if (!verdict || !def || incompatibility(req, def)) return null;
  const confidence = Math.max(0, Math.min(1, verdict.confidence));
  return confidence >= ctx.threshold ? map(req, def, "llm", confidence) : confirm(req, [candidate(def, "llm", confidence)], verdict.reason || `The match for ${req.label} is uncertain`);
};

const create: Step = (req) => ({ requirement_id: req.key, decision: "create_field", proposed_definition: proposedDefinition(req), confidence: 1 });

const STEPS: Step[] = [confirmed, exact, saved, alias, proposed, create];

function context(input: ReconcileInput, options: ReconcileOptions): Context {
  return {
    defs: input.tokuchuAttributes,
    shopDomain: input.vendorSchema.id.split("/")[0] ?? "",
    byId: new Map(input.tokuchuAttributes.map((d) => [d.id, d])),
    saved: new Map(input.savedMappings.map((m) => [m.vendor_field_key, m])),
    confirmations: options.confirmations ?? new Map(),
    proposals: options.proposals ?? new Map(),
    threshold: options.threshold ?? RECONCILE_CONFIG.threshold
  };
}

function decide(req: VendorRequirement, ctx: Context): ReconciliationDecision {
  for (const step of STEPS) {
    const decision = step(req, ctx);
    if (decision) return decision;
  }
  return create(req, ctx) as ReconciliationDecision;
}

/** The decisions without the model: every step but the model's, with its recorded verdicts applied. */
export function reconcileDeterministically(input: ReconcileInput, options: ReconcileOptions = {}): ReconciliationDecision[] {
  const ctx = context(input, options);
  return input.vendorSchema.requirements.map((req) => decide(req, ctx));
}

/** The model's input for one requirement: the requirement's key, label, and type, and every definition's id, label, and type. Never a value. */
export function llmInput(req: VendorRequirement, defs: AttributeDefinition[]): LlmMatchInput {
  return { requirement: { key: req.key, label: req.label, type: req.kind }, fields: defs.map((d) => ({ id: d.id, label: d.label, type: d.value_type })) };
}

/**
 * One decision per requirement in the ticket's order. The model runs only for a requirement the
 * deterministic steps left to create, only when a matcher is given, and only over schema metadata;
 * its verdict is recorded in `options.proposals` so a later deterministic pass reads the same answer.
 */
export async function reconcileVendorRequirements(input: ReconcileInput, options: ReconcileOptions = {}): Promise<ReconciliationDecision[]> {
  const proposals = options.proposals ?? new Map<string, LlmMatch>();
  const withProposals = { ...options, proposals };
  const first = reconcileDeterministically(input, withProposals);
  if (!options.llm) return first;
  const compatible = (req: VendorRequirement) => input.tokuchuAttributes.filter((d) => !incompatibility(req, d));
  for (const decision of first) {
    if (decision.decision !== "create_field" || proposals.has(decision.requirement_id)) continue;
    const req = input.vendorSchema.requirements.find((r) => r.key === decision.requirement_id)!;
    const fields = compatible(req);
    if (!fields.length) continue;
    proposals.set(req.key, await options.llm(llmInput(req, fields)));
  }
  return reconcileDeterministically(input, withProposals);
}

/** How far the decisions take the schema: resolved, to create, and waiting on the organizer. */
export function completeness(decisions: ReconciliationDecision[]): Completeness {
  const pending = decisions.filter((d) => d.decision === "needs_confirmation").length;
  const create = decisions.filter((d) => d.decision === "create_field").length;
  return { total: decisions.length, resolved: decisions.length - pending - create, to_create: create, pending_confirmation: pending, complete: pending === 0 };
}

/* ---- The gift's schema and the module's records ---- */

/** The variant axis the store sells by (Size, or the first axis with a choice) as a requirement, when the product has one. */
export function variantAxis(gift: Batch): VendorRequirement | null {
  const byOption = new Map<string, Map<string, string>>();
  for (const v of gift.variants ?? []) for (const o of v.options ?? []) {
    if (!byOption.has(o.name)) byOption.set(o.name, new Map());
    byOption.get(o.name)!.set(slugValue(o.label), o.label);
  }
  const optionName = [...byOption.keys()].find((n) => /size/i.test(n)) ?? [...byOption.entries()].find(([, m]) => m.size > 1)?.[0];
  if (!optionName) return null;
  const allowed = [...byOption.get(optionName)!].map(([value, label]) => ({ value, label }));
  if (allowed.length < 2) return null;
  return { key: `variant_${slugValue(optionName)}`, label: optionName, kind: "variant", required: true, allowed };
}

function fieldRequirement(field: PersonalizationField): VendorRequirement {
  const { max_length, allowed } = fieldConstraints(field);
  const options = field.constraints?.options ?? allowed.map((value) => ({ value, label: value }));
  return { key: field.key, label: field.label, kind: field.kind, required: field.required, ...(max_length !== undefined ? { max_length } : {}), ...(options.length ? { allowed: options } : {}) };
}

/** The store's schema for a gift: the variant axis first, then each customization field. The id and the version follow the procurement's, derived the same way when the store gave none. */
export function vendorSchemaFor(gift: Batch): VendorSchema {
  const axis = variantAxis(gift);
  const fields = gift.personalization?.fields ?? [];
  return { id: gift.personalization?.schema_id ?? `${gift.shop_domain}/${gift.product_id}`, version: gift.personalization?.schema_version ?? deriveSchemaVersion(fields), requirements: [...(axis ? [axis] : []), ...fields.map(fieldRequirement)] };
}

/* ---- The stored reconciliation ---- */

/** The stored row for a gift at its current schema version. */
export function reconciliationOf(gift: Batch): Reconciliation {
  const schema = vendorSchemaFor(gift);
  return reconciliationFor(gift.id, schema.id, schema.version);
}

/** Forgets every stored reconciliation; tests call it between cases. */
export function resetReconcileState(): void {
  state().reconciliations.clear();
}

/** The organizer confirms a requirement: the attribute to map or a new field to create. */
export function confirmRequirement(gift: Batch, requirementKey: string, choice: Confirmation): Reconciliation {
  const row = reconciliationOf(gift);
  return updateReconciliation(row, { confirmations: { ...row.confirmations, [requirementKey]: { choice, confirmed_at: new Date().toISOString() } } });
}

function inputFor(gift: Batch, defs: AttributeDefinition[]): ReconcileInput {
  return { vendorSchema: vendorSchemaFor(gift), tokuchuAttributes: defs, savedMappings: gift.personalization_mappings ?? [] };
}

/** The row's confirmations and verdicts as the decision order reads them. */
function optionsFrom(row: Reconciliation): Pick<ReconcileOptions, "confirmations" | "proposals"> {
  const confirmations = new Map(Object.entries(row.confirmations).map(([key, c]) => [key, c.choice]));
  const proposals = new Map(Object.entries(row.verdicts).map(([key, v]) => [key, { attribute_id: v.attribute_id, confidence: v.confidence, reason: v.reason }]));
  return { confirmations, proposals };
}

/** Who settled a decision: the organizer when a confirmation stands behind it, the model when its verdict did, and nobody for a deterministic one. */
function confirmerOf(decision: ReconciliationDecision, row: Reconciliation): { confirmed_by: DecisionConfirmer | null; confirmed_at: string | null } {
  const confirmation = row.confirmations[decision.requirement_id];
  if (confirmation && decision.decision !== "needs_confirmation") return { confirmed_by: "organizer", confirmed_at: confirmation.confirmed_at };
  if ((decision.decision === "map_existing" || decision.decision === "derive") && decision.method === "llm") return { confirmed_by: "model", confirmed_at: row.verdicts[decision.requirement_id]?.recorded_at ?? null };
  return { confirmed_by: null, confirmed_at: null };
}

/** Stores the decisions on the row when they differ from the ones it holds, so a read leaves an unchanged row alone. */
function storeDecisions(row: Reconciliation, decisions: ReconciliationDecision[], verdicts: Record<string, ModelVerdict> = row.verdicts): Reconciliation {
  const stored: StoredDecision[] = decisions.map((decision) => ({ decision, ...confirmerOf(decision, row) }));
  const same = JSON.stringify(row.decisions) === JSON.stringify(stored) && JSON.stringify(row.verdicts) === JSON.stringify(verdicts);
  return same ? row : updateReconciliation(row, { decisions: stored, verdicts });
}

/** The decisions for a gift from the deterministic steps and the stored row, written back to the row. */
export function decisionsFor(gift: Batch, defs: AttributeDefinition[]): ReconciliationDecision[] {
  const row = reconciliationOf(gift);
  const decisions = reconcileDeterministically(inputFor(gift, defs), optionsFrom(row));
  storeDecisions(row, decisions);
  return decisions;
}

/**
 * Runs the whole order for a gift, the model included when the flag allows it, and stores the
 * model's verdicts so the next deterministic read agrees. A verdict is asked once per requirement
 * for a given set of definitions; a definition added since asks again.
 */
export async function reconcileGift(gift: Batch, defs: AttributeDefinition[], options: Pick<ReconcileOptions, "llm" | "threshold"> = {}): Promise<{ decisions: ReconciliationDecision[]; completeness: Completeness }> {
  const row = reconciliationOf(gift);
  const signature = defs.map((d) => d.id).sort().join(",");
  const verdicts: Record<string, ModelVerdict> = Object.fromEntries(Object.entries(row.verdicts).filter(([, v]) => v.seen === signature));
  const llm = options.llm === undefined ? (llmEnabled() ? (await import("../agent/reconcile-llm")).openaiMatcher() : null) : options.llm;
  const { confirmations, proposals } = optionsFrom({ ...row, verdicts });
  const decisions = await reconcileVendorRequirements(inputFor(gift, defs), { llm, threshold: options.threshold, confirmations, proposals });
  const at = new Date().toISOString();
  for (const [key, match] of proposals!) if (!verdicts[key]) verdicts[key] = { ...match, seen: signature, recorded_at: at };
  // The row is read again: the model step awaited, and a write in between must not be lost.
  storeDecisions(reconciliationOf(gift), decisions, verdicts);
  return { decisions, completeness: completeness(decisions) };
}

/* ---- Decisions as the request step reads them ---- */

/** A decision as the requirement the request step and the Attendees tab read: the source that fills it, the row to store, or the question to create. */
export function requirementFromDecision(req: VendorRequirement, decision: ReconciliationDecision, byId: Map<string, AttributeDefinition>): Requirement {
  const base = { key: req.key, label: req.label, kind: req.kind };
  switch (decision.decision) {
    case "map_existing": {
      const def = byId.get(decision.attribute_id)!;
      const mapping: PersonalizationMapping | undefined = req.kind === "variant" ? undefined : { vendor_field_key: req.key, source: { type: "definition", definition_id: def.id, subject_scope: def.scope } };
      return { ...base, source: "definition", definition_id: def.id, already: true, ...(mapping ? { mapping } : {}) };
    }
    case "derive":
      return { ...base, source: decision.source.type, already: true, mapping: { vendor_field_key: req.key, source: decision.source, ...(decision.transform ? { transform: decision.transform } : {}) } };
    case "create_field":
      return { ...base, source: "question", already: false, question: { value_type: decision.proposed_definition.value_type, constraints: decision.proposed_definition.constraints } };
    case "needs_confirmation":
      return { ...base, source: "question", already: false, confirmation: { candidates: decision.candidates, reason: decision.reason } };
  }
}

/** The gift's requirements from the deterministic decisions and the module's records. */
export function requirementsFor(gift: Batch, defs: AttributeDefinition[]): Requirement[] {
  const schema = vendorSchemaFor(gift);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const decisions = decisionsFor(gift, defs);
  return schema.requirements.map((req, i) => requirementFromDecision(req, decisions[i], byId));
}
