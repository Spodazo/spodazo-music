import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { registerRoutes } from "./routes";
import { convertStoredImages, stripStoredSongs } from "./media";
import { ensureDataDirs, syncBundledImages } from "./paths";
import { ensureSessionTable, sessionMiddleware } from "./session";
import { getStore, remapImageFilenames } from "./storage";

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware());

ensureDataDirs();
syncBundledImages();
stripStoredSongs();
registerRoutes(app);

async function start() {
  await ensureSessionTable();
  await getStore();
  try {
    await remapImageFilenames(await convertStoredImages());
  } catch (err) {
    console.error("[media] stored image conversion failed:", err);
  }
  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV === "production") {
    const publicDir = path.resolve(process.cwd(), "dist/public");
    app.use(
      express.static(publicDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            return;
          }
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.sendFile(path.join(publicDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
        next();
        return;
      }
      try {
        const indexPath = path.resolve(process.cwd(), "client/index.html");
        const html = await vite.transformIndexHtml(req.originalUrl, fs.readFileSync(indexPath, "utf8"));
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`[spodazo-music] listening on ${port}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
