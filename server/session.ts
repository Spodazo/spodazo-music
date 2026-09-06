import type { RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET || "spodazo-music-dev-secret";
  const databaseUrl = process.env.DATABASE_URL;
  const PgStore = connectPgSimple(session);

  return session({
    name: "spodazo.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store:
      databaseUrl && /^postgres/i.test(databaseUrl)
        ? new PgStore({
            conString: databaseUrl,
            createTableIfMissing: true,
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
