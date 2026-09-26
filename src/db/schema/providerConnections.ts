import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One row per Rova user who has signed in with their ChatGPT Plus/Pro
 * subscription as a packet-generation provider (see src/applications/codexAuth.ts).
 * Plaintext columns, same honest security bar as the reference implementation
 * this was ported from (a plaintext file, protected only by OS permissions) —
 * protection here comes from Postgres access control, not encryption-at-rest.
 */
export const chatgptConnections = pgTable("chatgpt_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  idToken: text("id_token").notNull(),
  accountId: text("account_id").notNull(),
  accountEmail: text("account_email"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
