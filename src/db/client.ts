import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";
import { env } from "@/config";

export const db = drizzle(env.DATABASE_URL, { schema });

export type Database = typeof db;
