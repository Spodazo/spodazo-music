import type { NextFunction, Request, Response } from "express";
import { curatorPasswordMatches, passwordsMatch } from "./password";
import { getStore } from "./storage";

export { passwordsMatch };

declare module "express-session" {
  interface SessionData {
    admin?: boolean;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.admin) {
    next();
    return;
  }
  res.status(401).json({ error: "Admin login required" });
}

export async function loginAdmin(req: Request, password: string): Promise<boolean> {
  const store = await getStore();
  const curator = await store.getCuratorRecord();
  if (!(await curatorPasswordMatches(password, curator.passwordHash))) return false;
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
