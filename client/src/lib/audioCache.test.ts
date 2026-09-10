import assert from "node:assert/strict";
import test from "node:test";
import { albumPrimeOrder, HAVE_FUTURE_DATA, mediaNeedsRebuild } from "./audioCache";

test("albumPrimeOrder starts from the current song then wraps", () => {
  assert.deepEqual(albumPrimeOrder(["a", "b", "c"], "b"), ["b", "c", "a"]);
  assert.deepEqual(albumPrimeOrder(["a", "a", "", "b"], "a"), ["a", "b"]);
  assert.deepEqual(albumPrimeOrder(["a", "b"], "missing"), ["a", "b"]);
});

test("mediaNeedsRebuild is true after backgrounding or a dead buffer", () => {
  assert.equal(
    mediaNeedsRebuild({ readyState: HAVE_FUTURE_DATA, hasError: false, srcMatches: true, backgrounded: false }),
    false,
  );
  assert.equal(
    mediaNeedsRebuild({ readyState: HAVE_FUTURE_DATA, hasError: false, srcMatches: true, backgrounded: true }),
    true,
  );
  assert.equal(
    mediaNeedsRebuild({ readyState: 1, hasError: false, srcMatches: true, backgrounded: false }),
    true,
  );
  assert.equal(
    mediaNeedsRebuild({ readyState: HAVE_FUTURE_DATA, hasError: true, srcMatches: true, backgrounded: false }),
    true,
  );
  assert.equal(
    mediaNeedsRebuild({ readyState: HAVE_FUTURE_DATA, hasError: false, srcMatches: false, backgrounded: false }),
    true,
  );
});
