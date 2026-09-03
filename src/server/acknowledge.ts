/**
 * The acknowledgement cursor (#52): each grant keeps the last revision its holder acknowledged, so
 * the organizer sees what the store has read. The store's page and its agent post it through the
 * acknowledge_changes tool; the organizer's route takes it on behalf of a grant.
 */
import { z } from "zod";
import { currentRevision } from "../domain/procurement";
import { state } from "../domain/store";
import type { AccessGrant, CallerToken } from "../domain/types";
import { BadRequestError, NotFoundError } from "./api";
import { getGrant, readableDefinitionIds } from "./grants";

const AckBody = z.object({ revision: z.number().int().min(0) });

export type Acknowledged = { grant_id: string; acknowledged_revision: number; current_revision: number };

/**
 * Records the revision a grant's holder has seen.
 *
 * Raises:
 *   NotFoundError: when the grant is not on the event.
 *   BadRequestError: when the body carries no whole revision, or one past the current revision the holder may see.
 */
export function acknowledgeRevision(eventId: string, grantId: string, body: unknown): Acknowledged {
  const grant = getGrant(eventId, grantId);
  const parsed = AckBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError("revision: a whole number of 0 or more is required.");
  const current = currentRevision(grant.procurement_id, readableDefinitionIds(grant));
  if (parsed.data.revision > current) throw new BadRequestError(`Revision ${parsed.data.revision} is past the current revision ${current}.`);
  const row: AccessGrant = { ...grant, acknowledged_revision: parsed.data.revision };
  state().grants.set(grantId, row);
  return { grant_id: grantId, acknowledged_revision: parsed.data.revision, current_revision: current };
}

/** The tool as the MCP endpoint dispatches it: a grant's token acknowledges its own grant, and the organizer names one. */
export function acknowledgeChanges(eventId: string, token: CallerToken, args: Record<string, unknown>): Acknowledged {
  const named = args.grant_id === undefined || args.grant_id === null ? undefined : String(args.grant_id);
  const grantId = token.grant_id ?? named;
  if (!grantId) throw new BadRequestError("grant_id names the grant to acknowledge for.");
  if (token.grant_id && named && named !== token.grant_id) throw new NotFoundError(`No grant ${named} for this token.`);
  return acknowledgeRevision(eventId, grantId, { revision: Number(args.revision) });
}
