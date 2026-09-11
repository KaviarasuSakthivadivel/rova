import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userRoles = ["user", "admin"] as const;
export type UserRole = (typeof userRoles)[number];

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // No self-serve way to become admin — set via `rova make-admin <email>`
  // (src/main.ts) only. Single flat role is enough for one-operator admin
  // access; a real permissions model is a later problem (see PRD.md).
  role: text("role", { enum: userRoles }).notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
