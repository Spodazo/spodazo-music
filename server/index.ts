import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { registerRoutes } from "./routes";
import { ensureDataDirs, syncBundledImages } from "./paths";
import { sessionMiddleware } from "./session";
import { getStore } from "./storage";

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
registerRoutes(app);

async function start() {
  await getStore();
  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV === "production") {
    const publicDir = path.resolve(process.cwd(), "dist/public");
    app.use(express.static(publicDir));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
        res.status(404).json({ error: "Not found" });
        return;
      }
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
