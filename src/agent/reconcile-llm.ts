/**
 * The model step of the reconciliation service (#38): one structured answer per requirement over
 * schema metadata only. The service validates the answer against the definitions and the type
 * tables; this module only asks the question and returns the proposal.
 */
import type { Model } from "@openai/agents";
import { z } from "zod";
import type { LlmMatch, LlmMatcher } from "../server/reconcile";
import { MODEL } from "./curation-agent";

const Verdict = z.object({
  attribute_id: z.string().nullable().describe("The id of the one field that holds the requirement's value by meaning, or null when none does"),
  confidence: z.number().min(0).max(1).describe("How sure the match is, 0 to 1"),
  reason: z.string().describe("One short sentence naming why")
});

const INSTRUCTIONS = `You match one store requirement to one of an organizer's RSVP fields by meaning. The input is JSON: the requirement's key, label, and type, and the fields with an id, a label, and a value type. Answer with the id of the one field whose meaning is the requirement's, or null when no field carries that meaning. Judge by meaning, not by string overlap; a field for a guest's home city is not a field for the event's venue. Give a confidence between 0 and 1 and a one-sentence reason. Never invent an id.`;

/** A matcher over the OpenAI Agents SDK; a Model instance replaces the configured model name, so tests script one. The SDK loads on the first call. */
export function openaiMatcher(options: { model?: Model } = {}): LlmMatcher {
  return async (input): Promise<LlmMatch> => {
    const sdk = await import("@openai/agents");
    const agent = new sdk.Agent({ name: "RequirementMatcher", model: options.model ?? MODEL, instructions: INSTRUCTIONS, outputType: Verdict });
    const result = await sdk.run(agent, JSON.stringify(input), { maxTurns: 1 });
    const parsed = Verdict.safeParse(result.finalOutput);
    return parsed.success ? parsed.data : { attribute_id: null, confidence: 0, reason: "The model gave no usable answer" };
  };
}
