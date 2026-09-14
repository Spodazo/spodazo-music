import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { registerRoutes } from "./routes";
import { htmlWithSiteIcons } from "./htmlIcons";
import { convertStoredImages, prepareFaviconSet, stripStoredSongs, warmHomeCardImages } from "./media";
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
  try {
    const setup = await (await getStore()).getPlayerSetup();
    if (setup.favicon) await prepareFaviconSet(setup.favicon);
  } catch (err) {
    console.error("[media] favicon prepare failed:", err);
  }
  void getStore()
    .then(async (store) => {
      const [list, setup] = await Promise.all([store.listAlbums(), store.getPlayerSetup()]);
      await warmHomeCardImages(list, [setup.logo, setup.collectionCover]);
    })
    .catch((err) => {
      console.error("[media] home thumb warm failed:", err);
    });
  const port = Number(process.env.PORT || 3000);

  async function pageHtml(source: string): Promise<string> {
    try {
      const setup = await (await getStore()).getPlayerSetup();
      return htmlWithSiteIcons(source, setup.favicon);
    } catch {
      return source;
    }
  }

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
    app.get("*", async (req, res) => {
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/media") ||
        req.path.startsWith("/site-icons") ||
        /^\/icon-[a-f0-9]+\.png$/.test(req.path) ||
        /^\/touch-[a-f0-9]+\.png$/.test(req.path)
      ) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
      res.send(await pageHtml(html));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/media") ||
        req.path.startsWith("/site-icons") ||
        /^\/icon-[a-f0-9]+\.png$/.test(req.path) ||
        /^\/touch-[a-f0-9]+\.png$/.test(req.path)
      ) {
        next();
        return;
      }
      try {
        const indexPath = path.resolve(process.cwd(), "client/index.html");
        const html = await vite.transformIndexHtml(req.originalUrl, fs.readFileSync(indexPath, "utf8"));
        res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(await pageHtml(html));
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
