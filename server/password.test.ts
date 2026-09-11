import assert from "node:assert/strict";
import test from "node:test";
import { curatorPasswordMatches, curatorRecoveryError, emailsMatch, hashPassword, passwordsMatch, verifyPasswordHash } from "./password";

test("hashed curator passwords verify and env password is the fallback", async () => {
  const hash = await hashPassword("curator-secret");
  assert.equal(await verifyPasswordHash("curator-secret", hash), true);
  assert.equal(await verifyPasswordHash("nope", hash), false);
  assert.equal(await curatorPasswordMatches("curator-secret", hash), true);

  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "env-secret";
  try {
    assert.equal(await curatorPasswordMatches("env-secret", ""), true);
    assert.equal(await curatorPasswordMatches("env-secret", undefined), true);
    assert.equal(await curatorPasswordMatches("wrong", ""), false);
    assert.equal(passwordsMatch("env-secret", "env-secret"), true);
    assert.equal(emailsMatch("W@Example.com", "w@example.com"), true);
    assert.equal(curatorRecoveryError({
      isAdmin: true,
      email: "",
      recoveryPassword: "",
      newPassword: "new-secret",
      curatorEmail: "w@example.com",
    }), null);
    assert.equal(curatorRecoveryError({
      isAdmin: false,
      email: "w@example.com",
      recoveryPassword: "env-secret",
      newPassword: "new-secret",
      curatorEmail: "w@example.com",
    }), null);
    assert.equal(curatorRecoveryError({
      isAdmin: false,
      email: "other@example.com",
      recoveryPassword: "env-secret",
      newPassword: "new-secret",
      curatorEmail: "w@example.com",
    })?.error, "Email does not match");
    assert.equal(curatorRecoveryError({
      isAdmin: false,
      email: "w@example.com",
      recoveryPassword: "wrong",
      newPassword: "new-secret",
      curatorEmail: "w@example.com",
    })?.error, "Wrong recovery password");
    assert.equal(curatorRecoveryError({
      isAdmin: true,
      email: "",
      recoveryPassword: "",
      newPassword: "short",
      curatorEmail: "",
    })?.error, "New password must be at least 8 characters");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});
