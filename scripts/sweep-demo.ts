/** Deletes the demo events older than 24 hours from the database at `DATABASE_URL`: `npm run sweep-demo`. */
import { getDatabase } from "../src/server/db";
import { sweepDemoEvents } from "../src/server/demo";

const db = await getDatabase();
try {
  const swept = await sweepDemoEvents(db);
  console.log(swept ? `Swept ${swept} demo event${swept === 1 ? "" : "s"}.` : "Nothing to sweep.");
} finally {
  await db.close();
}
