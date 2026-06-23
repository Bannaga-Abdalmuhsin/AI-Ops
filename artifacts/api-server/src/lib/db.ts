import pg from "pg";
import { logger } from "./logger.js";

const { Pool, types } = pg;

// pg parses timestamp/timestamptz columns as JS Date objects by default,
// but our Zod schemas (matching the Supabase/PostgREST contract) expect ISO strings.
// Override the parsers to return ISO-8601 strings instead.
types.setTypeParser(20, (val: string) => parseInt(val, 10));                   // int8/bigint → number
types.setTypeParser(1114, (val: string) => new Date(val + "Z").toISOString()); // timestamp → ISO string
types.setTypeParser(1184, (val: string) => new Date(val).toISOString());        // timestamptz → ISO string

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set — provision the Replit database first");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL pool error");
});
