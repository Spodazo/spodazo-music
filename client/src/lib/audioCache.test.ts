import assert from "node:assert/strict";
import test from "node:test";
import { HAVE_CURRENT_DATA, HEADER_HOLD, isMobilePlayback, isResumeTime, mediaUrl, pipelineIsDead, waitForAudible } from "./audioCache";

test("mediaUrl only adds a start fragment when resuming mid-song", () => {
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4"), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4#t=9.00", 0), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4", 0.05), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4", 45.2), "/media/songs/a.mp3?v=4#t=45.20");
});

test("a song start is not treated as a mid-song resume", () => {
  assert.equal(isResumeTime(0), false);
  assert.equal(isResumeTime(0.05), false);
  assert.equal(isResumeTime(HEADER_HOLD), false);
  assert.equal(isResumeTime(12), true);
});

test("waitForAudible resolves immediately when the playhead is already past the header", async () => {
  await waitForAudible({ currentTime: 0.4, addEventListener() {}, removeEventListener() {} } as unknown as HTMLAudioElement, 0.22);
});

test("opener mute is not used on desktop user agents", () => {
  assert.equal(isMobilePlayback(), false);
});

test("pipelineIsDead is true only when the element cannot play", () => {
  assert.equal(pipelineIsDead({ error: null, readyState: HAVE_CURRENT_DATA } as HTMLAudioElement), false);
  assert.equal(pipelineIsDead({ error: null, readyState: 3 } as HTMLAudioElement), false);
  assert.equal(pipelineIsDead({ error: null, readyState: 1 } as HTMLAudioElement), true);
  assert.equal(pipelineIsDead({ error: {} as MediaError, readyState: 3 } as HTMLAudioElement), true);
});
