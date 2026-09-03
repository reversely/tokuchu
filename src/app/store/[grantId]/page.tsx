import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { staticMode } from "../../../server/flags";
import { withPersistedEvent } from "../../../server/persistence";
import { adminConfigured } from "../../../server/shopify-admin";
import { lookupOrder } from "../../../server/store-orders";
import { STORE_COOKIE, storeSessionFrom } from "../../../server/store-session";
import { storeView, type StoreView } from "../../../server/store-view";
import { AGENT_TASK_META, agentTaskText } from "../../../webmcp/agent-task";
import { StorePage } from "./store-page";

type Props = { params: Promise<{ grantId: string }> };

/** In static mode the head carries the agent's task for the store's page (#56). */
export function generateMetadata(): Metadata {
  return staticMode() ? { other: { [AGENT_TASK_META]: agentTaskText("store") } } : {};
}

/**
 * The store-facing page (#47): the Procurement one grant opens, read under the store session the
 * signed link set. A missing session, another grant's session, a revoked grant, and an expired grant
 * each render the not-found page.
 */
export default async function Page({ params }: Props) {
  const { grantId } = await params;
  const session = storeSessionFrom((await cookies()).get(STORE_COOKIE)?.value);
  if (!session || session.grant_id !== grantId) notFound();
  let view: StoreView;
  try {
    view = await withPersistedEvent(session.event_id, () => storeView(session.event_id, grantId));
  } catch {
    notFound();
  }
  // The order behind the checkout (#59) comes from the store's Admin API; a store the app holds no credentials for shows the link alone.
  const order = view.checkout_url && adminConfigured() ? await lookupOrder({ checkout_url: view.checkout_url }).catch(() => null) : null;
  return <StorePage view={view} order={order} agentNotes={staticMode()} />;
}
