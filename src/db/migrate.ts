import { migrate } from "drizzle-orm/bun-sql/migrator";
import { db } from "./client";

export async function runMigrations() {
  console.log("[migrate] applying pending migrations");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[migrate] up to date");
}
