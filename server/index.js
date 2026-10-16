import express from "express";
import multer from "multer";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openStore, buildTree } from "./data.js";

export function createApp({
  store,
  password,
  secure = false,
  now = () => Date.now(),
}) {
  if (!password || password.length < 12)
    throw Error("APP_PASSWORD must contain at least 12 characters.");
  const app = express(),
    sessions = new Map(),
    attempts = new Map();
  const salt = randomBytes(32),
    expected = scryptSync(password, salt, 64);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  // Reject cross-origin mutation, including multipart imports. Configure APP_ORIGIN behind a proxy.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin"),
        expectedOrigin =
          process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
      if (
        req.get("sec-fetch-site") === "cross-site" ||
        (origin && origin !== expectedOrigin)
      )
        return res
          .status(403)
          .json({ error: "Cross-origin request rejected." });
    }
    next();
  });
  const cookie = (token, age) =>
    `pv_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const getSession = (req) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("pv_session="))
      ?.slice(11);
    const expiry = sessions.get(token);
    if (!expiry || expiry < now()) {
      sessions.delete(token);
      return null;
    }
    return token;
  };
  app.post("/api/login", (req, res) => {
    const ip = req.socket.remoteAddress || "unknown";
    let attempt = attempts.get(ip);
    if (!attempt || attempt.until < now()) {
      attempt = { count: 0, until: now() + 15 * 60 * 1000 };
      attempts.set(ip, attempt);
    }
    if (attempt.count >= 10)
      return res
        .status(429)
        .json({ error: "Too many login attempts. Try again in 15 minutes." });
    attempt.count++;
    const supplied = req.body?.password;
    if (
      typeof supplied !== "string" ||
      supplied.length > 1024 ||
      !timingSafeEqual(scryptSync(supplied, salt, 64), expected)
    )
      return res.status(401).json({ error: "Incorrect password." });
    attempts.delete(ip);
    for (const [token, expiry] of sessions)
      if (expiry < now()) sessions.delete(token);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, now() + 12 * 60 * 60 * 1000);
    res.set("Set-Cookie", cookie(token, 43200)).json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    if (!getSession(req))
      return res.status(401).json({ error: "Please sign in." });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/session", (_req, res) => res.json({ ok: true }));
  app.post("/api/logout", (req, res) => {
    sessions.delete(getSession(req));
    res.set("Set-Cookie", cookie("", 0)).json({ ok: true });
  });
  app.get("/api/dataset", (_req, res) =>
    res.json(store.current?.metadata || null),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 40 * 1024 * 1024, files: 4, fields: 0, parts: 4 },
  }).fields(
    ["items", "connectors", "components", "routings"].map((name) => ({
      name,
      maxCount: 1,
    })),
  );
  let importing = false;
  app.post("/api/import", (req, res, next) => {
    if (importing)
      return res.status(409).json({ error: "Another import is running." });
    importing = true;
    upload(req, res, (error) => {
      try {
        if (error) throw error;
        const files = Object.fromEntries(
          Object.entries(req.files || {}).map(([kind, list]) => [
            kind,
            {
              buffer: list[0].buffer,
              name: path.basename(list[0].originalname),
            },
          ]),
        );
        res.json(store.import(files));
      } catch (e) {
        res.status(400).json({ error: e.message });
      } finally {
        importing = false;
      }
    });
  });
  app.get("/api/search", (req, res) => {
    if (!store.current)
      return res.status(409).json({ error: "Import a dataset first." });
    const q = String(req.query.q || "")
      .trim()
      .toLowerCase();
    if (!q) return res.json([]);
    const results = [];
    let exact = null;
    for (const [id, item] of store.current.items) {
      if (id === q) {
        exact = {
          id,
          name: item["Item Name"],
          type: item.Type,
          inactive: item.Inactive === "Yes",
        };
        continue;
      }
      if (results.length < 50 && item["Item Name"].toLowerCase().includes(q))
        results.push({
          id,
          name: item["Item Name"],
          type: item.Type,
          inactive: item.Inactive === "Yes",
        });
    }
    res.json(exact ? [exact, ...results.slice(0, 49)] : results);
  });
  app.post("/api/view", (req, res) => {
    if (!store.current)
      return res.status(409).json({ error: "Import a dataset first." });
    const { id, quantity, selections = {}, datasetId } = req.body || {};
    if (datasetId && datasetId !== store.current.metadata.id)
      return res
        .status(409)
        .json({
          error:
            "Dataset changed. Reload the dataset and select revisions again.",
        });
    if (!store.current.items.has(id))
      return res.status(404).json({ error: "Part not found." });
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    )
      return res
        .status(400)
        .json({ error: "Quantity must be a positive number." });
    if (
      !selections ||
      typeof selections !== "object" ||
      Array.isArray(selections) ||
      Object.values(selections).some((v) => typeof v !== "string")
    )
      return res.status(400).json({ error: "Invalid revision selections." });
    res.json(buildTree(store.current, id, quantity, selections));
  });
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );
  app.use(express.static(dist));
  app.get("/{*path}", (req, res) =>
    req.path.startsWith("/api/")
      ? res.status(404).json({ error: "Not found" })
      : fs.existsSync(path.join(dist, "index.html"))
        ? res.sendFile(path.join(dist, "index.html"))
        : res
            .status(503)
            .send("Build the frontend with npm run build, or run npm run dev."),
  );
  app.use((error, req, res, next) => {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json({
        error: error.status === 400 ? "Invalid request." : "Request failed.",
      });
  });
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = openStore(process.env.DB_PATH || "data/part-viewer.sqlite");
  const app = createApp({
    store,
    password: process.env.APP_PASSWORD,
    secure: process.env.COOKIE_SECURE === "true",
  });
  app.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "0.0.0.0",
    () =>
      console.log(
        "Part Viewer listening on port " + (process.env.PORT || 3000),
      ),
  );
}
