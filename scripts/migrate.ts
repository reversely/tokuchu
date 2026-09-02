/** Applies the schema migrations to the database at `DATABASE_URL`: `npm run migrate`. */
import { getDatabase } from "../src/server/db";
import { migrate } from "../src/server/migrations";

const db = await getDatabase();
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied ${applied.join(", ")}.` : "Nothing to apply.");
} finally {
  await db.close();
}
