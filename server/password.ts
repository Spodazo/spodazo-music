import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb);
const KEYLEN = 64;

export function passwordsMatch(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  if (!salt.length || !expected.length) return false;
  const key = (await scrypt(password, salt, expected.length)) as Buffer;
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function curatorPasswordMatches(provided: string, passwordHash?: string | null): Promise<boolean> {
  if (passwordHash) return verifyPasswordHash(provided, passwordHash);
  return passwordsMatch(provided, process.env.ADMIN_PASSWORD || "");
}

export const MIN_PASSWORD_LENGTH = 8;

export function emailsMatch(provided: string, stored: string): boolean {
  const a = provided.trim().toLowerCase();
  const b = stored.trim().toLowerCase();
  return Boolean(a) && passwordsMatch(a, b);
}

export type CuratorRecoveryInput = {
  isAdmin: boolean;
  email: string;
  recoveryPassword: string;
  newPassword: string;
  curatorEmail: string;
};

export function curatorRecoveryError(input: CuratorRecoveryInput): { status: number; error: string } | null {
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { status: 400, error: "New password must be at least 8 characters" };
  }
  if (input.isAdmin) return null;
  const recovery = process.env.ADMIN_PASSWORD || "";
  if (!recovery) {
    return { status: 400, error: "Password recovery is not set up. Add ADMIN_PASSWORD on the server." };
  }
  if (!passwordsMatch(input.recoveryPassword, recovery)) {
    return { status: 401, error: "Wrong recovery password" };
  }
  if (input.curatorEmail && !emailsMatch(input.email, input.curatorEmail)) {
    return { status: 401, error: "Email does not match" };
  }
  return null;
}
