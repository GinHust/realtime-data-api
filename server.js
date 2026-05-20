const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_DB_PATH = path.join(__dirname, "data.json");
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

let db = {
  items: [],
  updates: [],
  updatedAt: new Date().toISOString()
};

const clients = new Set();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(html);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function flattenItems() {
  return db.items.map((item) => ({
    id: item.id,
    ...item.data,
    sourceRow: item.source?.row,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}

function renderHomePage() {
  const rows = flattenItems();
  const columns = db.source?.columns || Object.keys(rows[0] || {}).filter((key) => !["id", "sourceRow", "createdAt", "updatedAt"].includes(key));
  const visibleColumns = ["id", ...columns, "sourceRow"];
  const tableRows = rows.map((row) => `
          <tr>
            ${visibleColumns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}
          </tr>`).join("");

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Realtime Data API</title>
    <style>
      :root { color-scheme: light; font-family: Arial, sans-serif; }
      body { margin: 0; color: #17202a; background: #f6f8fa; }
      main { max-width: 1200px; margin: 0 auto; padding: 28px; }
      h1 { margin: 0 0 8px; font-size: 26px; }
      .meta { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0 20px; }
      .meta span { background: #ffffff; border: 1px solid #d7dde4; border-radius: 6px; padding: 8px 10px; }
      .links { margin: 0 0 18px; display: flex; gap: 12px; flex-wrap: wrap; }
      a { color: #0b63ce; }
      table { width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #d7dde4; }
      th, td { padding: 8px 10px; border-bottom: 1px solid #e6ebf1; text-align: left; font-size: 14px; white-space: nowrap; }
      th { position: sticky; top: 0; background: #eef3f8; font-weight: 700; }
      .table-wrap { overflow: auto; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Realtime Data API</h1>
      <div class="meta">
        <span>Records: ${rows.length}</span>
        <span>Updated: ${escapeHtml(db.updatedAt)}</span>
        <span>Source: ${escapeHtml(db.source?.file || "manual")}</span>
      </div>
      <div class="links">
        <a href="/data">JSON data</a>
        <a href="/items">Raw items</a>
        <a href="/health">Health</a>
        <a href="/updates">Updates</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${visibleColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${tableRows || `<tr><td colspan="${visibleColumns.length}">No data</td></tr>`}
          </tbody>
        </table>
      </div>
    </main>
  </body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

async function loadDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    db = JSON.parse(raw);
    db.items ||= [];
    db.updates ||= [];
    db.updatedAt ||= new Date().toISOString();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    if (DB_PATH !== DEFAULT_DB_PATH) {
      try {
        const raw = await fs.readFile(DEFAULT_DB_PATH, "utf8");
        db = JSON.parse(raw);
        await saveDb();
        return;
      } catch (seedError) {
        if (seedError.code !== "ENOENT") {
          throw seedError;
        }
      }
    }

    await saveDb();
  }
}

async function saveDb() {
  db.updatedAt = new Date().toISOString();
  const tempPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, DB_PATH);
}

function publish(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

async function recordUpdate(type, data) {
  const update = {
    id: crypto.randomUUID(),
    type,
    data,
    createdAt: new Date().toISOString()
  };

  db.updates.unshift(update);
  db.updates = db.updates.slice(0, 1000);
  await saveDb();
  publish("update", update);
  return update;
}

function getIdFromPath(pathname, prefix) {
  const value = pathname.slice(prefix.length);
  return value && !value.includes("/") ? decodeURIComponent(value) : null;
}

async function handleItems(req, res, pathname) {
  if (req.method === "GET" && pathname === "/items") {
    sendJson(res, 200, { data: db.items, updatedAt: db.updatedAt });
    return;
  }

  if (req.method === "POST" && pathname === "/items") {
    const body = await readBody(req);
    const item = {
      id: body.id || crypto.randomUUID(),
      data: body.data ?? body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.items.push(item);
    await recordUpdate("item.created", item);
    sendJson(res, 201, { data: item });
    return;
  }

  const id = getIdFromPath(pathname, "/items/");
  if (!id) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const index = db.items.findIndex((item) => item.id === id);
  if (index === -1) {
    sendJson(res, 404, { error: "Item not found." });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { data: db.items[index] });
    return;
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const body = await readBody(req);
    const existing = db.items[index];
    const nextData = req.method === "PATCH"
      ? { ...existing.data, ...(body.data ?? body) }
      : (body.data ?? body);

    const item = {
      ...existing,
      data: nextData,
      updatedAt: new Date().toISOString()
    };

    db.items[index] = item;
    await recordUpdate("item.updated", item);
    sendJson(res, 200, { data: item });
    return;
  }

  if (req.method === "DELETE") {
    const [item] = db.items.splice(index, 1);
    await recordUpdate("item.deleted", item);
    sendJson(res, 200, { data: item });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}

async function handleUpdates(req, res, pathname) {
  if (req.method === "GET" && pathname === "/updates") {
    sendJson(res, 200, { data: db.updates });
    return;
  }

  if (req.method === "POST" && pathname === "/updates") {
    const body = await readBody(req);
    const update = await recordUpdate(body.type || "custom", body.data ?? body);
    sendJson(res, 201, { data: update });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

function handleStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  res.write(`event: ready\ndata: ${JSON.stringify({ updatedAt: db.updatedAt })}\n\n`);
  clients.add(res);

  req.on("close", () => {
    clients.delete(res);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      items: db.items.length,
      updates: db.updates.length,
      updatedAt: db.updatedAt
    });
    return;
  }

  if (req.method === "GET" && pathname === "/") {
    sendHtml(res, 200, renderHomePage());
    return;
  }

  if (req.method === "GET" && pathname === "/data") {
    sendJson(res, 200, {
      source: db.source || null,
      data: flattenItems(),
      updatedAt: db.updatedAt
    });
    return;
  }

  if (req.method === "GET" && pathname === "/stream") {
    handleStream(req, res);
    return;
  }

  if (pathname === "/items" || pathname.startsWith("/items/")) {
    await handleItems(req, res, pathname);
    return;
  }

  if (pathname === "/updates") {
    await handleUpdates(req, res, pathname);
    return;
  }

  sendJson(res, 404, {
    error: "Not found.",
    routes: ["GET /", "GET /data", "GET /health", "GET /items", "POST /items", "GET /items/:id", "PATCH /items/:id", "DELETE /items/:id", "GET /updates", "POST /updates", "GET /stream"]
  });
}

async function main() {
  await loadDb();

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      sendJson(res, 400, { error: error.message || "Request failed." });
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`Database path: ${DB_PATH}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
