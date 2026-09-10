import assert from "node:assert/strict";
import test from "node:test";
import { HAVE_CURRENT_DATA, mediaUrl, pipelineIsDead } from "./audioCache";

test("mediaUrl only adds a start fragment when resuming mid-song", () => {
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4"), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4#t=9.00", 0), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4", 45.2), "/media/songs/a.mp3?v=4#t=45.20");
});

test("pipelineIsDead is true only when the element cannot play", () => {
  assert.equal(pipelineIsDead({ error: null, readyState: HAVE_CURRENT_DATA } as HTMLAudioElement), false);
  assert.equal(pipelineIsDead({ error: null, readyState: 3 } as HTMLAudioElement), false);
  assert.equal(pipelineIsDead({ error: null, readyState: 1 } as HTMLAudioElement), true);
  assert.equal(pipelineIsDead({ error: {} as MediaError, readyState: 3 } as HTMLAudioElement), true);
});
