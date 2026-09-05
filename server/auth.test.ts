import assert from "node:assert/strict";
import test from "node:test";
import { passwordsMatch } from "./auth";

test("admin password compare rejects mismatches", () => {
  assert.equal(passwordsMatch("secret", "secret"), true);
  assert.equal(passwordsMatch("secret", "Secret"), false);
  assert.equal(passwordsMatch("short", "longerpass"), false);
  assert.equal(passwordsMatch("anything", ""), false);
});
