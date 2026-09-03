/**
 * Gives the rows persisted before ownership existed an owner: `npm run reparent-events`. A row with
 * no `owner_id` goes to the user the first `ORGANIZER_EMAILS` address names when that user exists;
 * otherwise the script lists the rows, and `--delete` removes them.
 */
import { getDatabase, type Database } from "../src/server/db";
import { organizerEmails } from "../src/server/organizers";

async function firstOrganizerId(db: Database): Promise<string | null> {
  const [email] = organizerEmails();
  if (!email) return null;
  const [user] = await db.query("select id from users where lower(email) = $1", [email]);
  return (user?.id as string | undefined) ?? null;
}

const db = await getDatabase();
try {
  const ownerless = await db.query("select id, data #>> '{events,0,1,title}' as title from events where owner_id is null order by updated_at");
  if (ownerless.length === 0) {
    console.log("Every event has an owner.");
  } else if (process.argv.includes("--delete")) {
    await db.query("delete from events where owner_id is null");
    console.log(`Deleted ${ownerless.length} ownerless event${ownerless.length === 1 ? "" : "s"}.`);
  } else {
    const ownerId = await firstOrganizerId(db);
    if (ownerId) {
      await db.query("update events set owner_id = $1, data = jsonb_set(data, '{events,0,1,owner_id}', to_jsonb($1::text)), updated_at = now() where owner_id is null", [ownerId]);
      console.log(`Moved ${ownerless.length} event${ownerless.length === 1 ? "" : "s"} under ${ownerId}.`);
    } else {
      console.log("No user matches the first ORGANIZER_EMAILS address; these events have no owner. Run with --delete to remove them.");
      for (const row of ownerless) console.log(`${row.id}  ${row.title ?? ""}`);
    }
  }
} finally {
  await db.close();
}
