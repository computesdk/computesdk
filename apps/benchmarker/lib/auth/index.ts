import { betterAuth } from "better-auth";
import { db } from "../database";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

export const auth = betterAuth({
  experimental: { joins: true },
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
});
