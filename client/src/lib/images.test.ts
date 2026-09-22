import assert from "node:assert/strict";
import test from "node:test";
import { LIST_THUMB_WIDTH, withImageWidth } from "./images";

test("withImageWidth adds a list thumb size to a versioned media URL", () => {
  assert.equal(
    withImageWidth("/media/images/Cover.webp?v=dev", LIST_THUMB_WIDTH),
    "/media/images/Cover.webp?v=dev&w=360",
  );
});

test("withImageWidth replaces an existing width", () => {
  assert.equal(
    withImageWidth("/media/images/Cover.webp?v=dev&w=720", LIST_THUMB_WIDTH),
    "/media/images/Cover.webp?v=dev&w=360",
  );
});

test("withImageWidth leaves an empty URL alone", () => {
  assert.equal(withImageWidth("", LIST_THUMB_WIDTH), "");
});
