import type { RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function postgresUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  return url && /^postgres/i.test(url) ? url : undefined;
}

export async function ensureSessionTable(): Promise<void> {
  const url = postgresUrl();
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        sid varchar NOT NULL PRIMARY KEY,
        sess json NOT NULL,
        expire timestamp(6) NOT NULL
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_expire ON admin_sessions (expire)
    `);
  } finally {
    await pool.end();
  }
}

export function sessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET || "spodazo-music-dev-secret";
  const url = postgresUrl();
  const PgStore = connectPgSimple(session);

  return session({
    name: "spodazo.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: url
      ? new PgStore({
          conString: url,
          createTableIfMissing: false,
          tableName: "admin_sessions",
          pruneSessionInterval: 60 * 60,
        })
      : undefined,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: THIRTY_DAYS_MS,
    },
  });
}
