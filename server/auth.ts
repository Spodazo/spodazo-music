import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";

declare module "express-session" {
  interface SessionData {
    admin?: boolean;
  }
}

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}

export function passwordsMatch(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.admin) {
    next();
    return;
  }
  res.status(401).json({ error: "Admin login required" });
}

export function loginAdmin(req: Request, password: string): Promise<boolean> {
  const expected = adminPassword();
  if (!passwordsMatch(password, expected)) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      req.session.admin = true;
      req.session.save((saveErr) => {
        if (saveErr) reject(saveErr);
        else resolve(true);
      });
    });
  });
}

export function logoutAdmin(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
