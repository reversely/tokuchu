"use client";
import type { Requirement } from "../../../server/api";
import { Confirmations } from "./confirmations";
import { SchemaChange } from "./schema-change";

/** The reconciliation's two panels inside the requested-fields block (#51): the pending confirmations and the schema version change. */
export function ReconcilePanels({ eventId, giftId, requirements, seq, onChanged }: { eventId: string; giftId: string; requirements: Requirement[]; seq: number; onChanged: () => void }) {
  return (
    <>
      <SchemaChange eventId={eventId} giftId={giftId} seq={seq} onChanged={onChanged} />
      <Confirmations eventId={eventId} giftId={giftId} requirements={requirements} onChanged={onChanged} />
    </>
  );
}
