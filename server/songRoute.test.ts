import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { mp3DataOffset, sendSongFile } from "./media";

test("a song range is the real file and is not cacheable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-song-"));
  const file = path.join(dir, "tagged.mp3");
  const head = Buffer.alloc(10);
  head.write("ID3");
  head[9] = 20;
  const body = Buffer.concat([head, Buffer.alloc(20, 0x61), Buffer.alloc(200, 0x22)]);
  fs.writeFileSync(file, body);
  assert.ok(mp3DataOffset(file) > 0);

  const app = express();
  app.get("/media/songs/:file", (req, res) => {
    sendSongFile(res, file);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/media/songs/tagged.mp3`;
  try {
    const probe = await fetch(url, { headers: { Range: "bytes=0-2" } });
    assert.equal(probe.status, 206);
    assert.equal(probe.headers.get("content-range"), `bytes 0-2/${body.length}`);
    assert.match(probe.headers.get("cache-control") || "", /no-store/);
    assert.equal(probe.headers.get("cdn-cache-control"), "no-store");
    assert.equal(Buffer.from(await probe.arrayBuffer()).toString(), "ID3");

    const tailStart = body.length - 4;
    const tail = await fetch(url, { headers: { Range: `bytes=${tailStart}-${body.length - 1}` } });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get("content-range"), `bytes ${tailStart}-${body.length - 1}/${body.length}`);
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), body.subarray(tailStart));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
