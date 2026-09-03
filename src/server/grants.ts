/**
 * Access grants (issue #41): the relationship that authorizes a CallerToken. An AccessGrant names
 * which outside party may reach which procurement and what it may retrieve; the token stays the
 * credential a request carries. The grant authorizes the token and the token authorizes the request:
 * a token minted from a grant takes its gifts, its readable definitions, and its callable tools from
 * the grant, and the MCP endpoint reads the grant again on every call, so a revoked or expired grant
 * cuts access at once. Fulfilment completion expires every grant on the procurement.
 */
import { z } from "zod";
import { manifest } from "../domain/gifts";
import { requirementKeys } from "../domain/procurement";
import { definitionsFor, newId, state } from "../domain/store";
import { GranteeType, GrantPermission, type AccessGrant, type CallerToken } from "../domain/types";
import { BadRequestError, NotFoundError, requireEvent, requireGift } from "./api";
import { storeLinkPath } from "./store-session";
import { TOOLS } from "../webmcp/tools";

export const GrantBody = z.object({
  procurement_id: z.string().min(1),
  grantee_type: GranteeType,
  grantee_id: z.string().min(1),
  permissions: z.array(GrantPermission).min(1),
  allowed_attribute_ids: z.array(z.string()).optional(),
  created_by: z.string().min(1).default("organizer"),
  expires_at: z.string().nullable().default(null)
});

/** The tools each permission lets a token call; the order of TOOLS decides the token's list. */
const TOOLS_FOR: Record<GrantPermission, readonly string[]> = {
  "manifest:read": ["get_procurement", "get_manifest", "get_fulfillment_manifest"],
  "requirements:read": ["get_requirements"],
  "changes:read": ["get_changes"],
  "updates:read": ["get_updates"],
  "updates:write": ["post_update", "post_procurement_update"]
};

export type GrantStatus = "active" | "revoked" | "expired";

const now = () => new Date().toISOString();

export function grantStatus(grant: AccessGrant, at: number = Date.now()): GrantStatus {
  if (grant.revoked_at) return "revoked";
  if (grant.expires_at && Date.parse(grant.expires_at) <= at) return "expired";
  return "active";
}

/**
 * Records a grant on one procurement of the event.
 *
 * Raises:
 *   BadRequestError: when the body is not a grant, or an allowed attribute is not a definition of the event.
 *   NotFoundError: when the procurement is not a gift of the event.
 */
export function createGrant(eventId: string, body: unknown): AccessGrant {
  requireEvent(eventId);
  const parsed = GrantBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  requireGift(eventId, parsed.data.procurement_id);
  const known = new Set(definitionsFor(eventId).map((d) => d.id));
  const unknown = (parsed.data.allowed_attribute_ids ?? []).filter((id) => !known.has(id));
  if (unknown.length) throw new BadRequestError(`Unknown definitions: ${unknown.join(", ")}.`);
  const { allowed_attribute_ids, ...rest } = parsed.data;
  const grant: AccessGrant = { id: newId("grant"), event_id: eventId, ...rest, ...(allowed_attribute_ids ? { allowed_attribute_ids } : {}), created_at: now(), revoked_at: null };
  state().grants.set(grant.id, grant);
  return grant;
}

export function getGrant(eventId: string, grantId: string): AccessGrant {
  const grant = state().grants.get(grantId);
  if (!grant || grant.event_id !== eventId) throw new NotFoundError(`No grant ${grantId} on event ${eventId}.`);
  return grant;
}

export function grantsFor(eventId: string, procurementId?: string): AccessGrant[] {
  return [...state().grants.values()].filter((g) => g.event_id === eventId && (procurementId === undefined || g.procurement_id === procurementId));
}

/** Revokes a grant; a second call keeps the first revocation time. */
export function revokeGrant(eventId: string, grantId: string): AccessGrant {
  const grant = getGrant(eventId, grantId);
  if (grant.revoked_at) return grant;
  const revoked = { ...grant, revoked_at: now() };
  state().grants.set(grantId, revoked);
  return revoked;
}

/** Expires every active grant on a procurement, as fulfilment completion does. */
export function expireGrantsFor(eventId: string, procurementId: string, at: string = now()): AccessGrant[] {
  const expired: AccessGrant[] = [];
  for (const grant of grantsFor(eventId, procurementId)) {
    if (grantStatus(grant) !== "active") continue;
    const row = { ...grant, expires_at: at };
    state().grants.set(grant.id, row);
    expired.push(row);
  }
  return expired;
}

/**
 * A grant as the organizer's page and the grant routes show it: its status, what its holder may
 * reach (the readable fields and the fulfilment records on the procurement), and the signed link
 * while it is active. The token id stays out of the view.
 */
export type GrantView = AccessGrant & { status: GrantStatus; access: { fields: number; records: number }; link: string | null };

export function grantView(grant: AccessGrant): GrantView {
  const status = grantStatus(grant);
  const records = manifest(requireGift(grant.event_id, grant.procurement_id)).filter((row) => row.unit_status !== "excluded").length;
  return { ...grant, status, access: { fields: readableDefinitionIds(grant).length, records }, link: status === "active" ? storeLinkPath(grant) : null };
}

/** The tools the grant's permissions allow, in the order TOOLS lists them. */
export function callableTools(grant: AccessGrant): string[] {
  const allowed = new Set(grant.permissions.flatMap((p) => TOOLS_FOR[p]));
  return TOOLS.map((t) => t.name).filter((name) => allowed.has(name));
}

/** The definitions the grant lets its holder read: the allowed attributes, or every definition the procurement maps. */
export function readableDefinitionIds(grant: AccessGrant): string[] {
  if (grant.allowed_attribute_ids) return grant.allowed_attribute_ids;
  return [...requirementKeys(requireGift(grant.event_id, grant.procurement_id)).byDefinition.keys()];
}

/** The scope a token takes from its grant, read fresh on every call. */
export function tokenScope(grant: AccessGrant): Pick<CallerToken, "gift_ids" | "readable_definition_ids" | "callable_tools" | "expires_at"> {
  return { gift_ids: [grant.procurement_id], readable_definition_ids: readableDefinitionIds(grant), callable_tools: callableTools(grant), expires_at: grant.expires_at };
}

/**
 * The token for a grant: the one already minted for it, or a new one whose scope derives from the
 * grant. The token id is the secret a holder sends as the bearer.
 *
 * Raises:
 *   NotFoundError: when the grant is not on the event, or is revoked or expired.
 */
export function tokenForGrant(eventId: string, grantId: string): CallerToken {
  const grant = getGrant(eventId, grantId);
  if (grantStatus(grant) !== "active") throw new NotFoundError(`Grant ${grantId} is ${grantStatus(grant)}.`);
  const existing = [...state().tokens.values()].find((t) => t.grant_id === grantId);
  const scope = tokenScope(grant);
  const token: CallerToken = existing ? { ...existing, ...scope } : { id: newId("tok"), event_id: eventId, holder: grant.grantee_id, ...scope, last_profile_url: null, grant_id: grantId };
  state().tokens.set(token.id, token);
  return token;
}
