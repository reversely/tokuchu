"use client";

/** The revision a grant's holder acknowledged, in the organizer's words (#52); a Share block renders one per grant. */
export function GrantSeen({ grant, current }: { grant: { id: string; grantee_id: string; acknowledged_revision: number | null }; current: number }) {
  const seen = grant.acknowledged_revision;
  const state = seen === null ? "none" : seen >= current ? "current" : "behind";
  return (
    <span data-testid="grant-seen" data-grant={grant.id} data-seen={seen ?? ""} data-state={state}>
      {seen === null ? `${grant.grantee_id} has not acknowledged a revision yet` : `${grant.grantee_id} has seen up to revision ${seen}`}
    </span>
  );
}
