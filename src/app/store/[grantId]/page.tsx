import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { withPersistedEvent } from "../../../server/persistence";
import { STORE_COOKIE, storeSessionFrom } from "../../../server/store-session";
import { storeView, type StoreView } from "../../../server/store-view";
import { StorePage } from "./store-page";

type Props = { params: Promise<{ grantId: string }> };

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
  return <StorePage view={view} />;
}
