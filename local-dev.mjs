import { createReadStream, existsSync, statSync, readFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { onRequestGet as downloadGet } from "./functions/api/download.js";
import { onRequestGet as extractGet, onRequestPost as extractPost } from "./functions/api/extract.js";
import { onRequest as middleware } from "./functions/_middleware.js";
import { onRequest as auth } from "./functions/api/auth.js";
import { onRequest as saved } from "./functions/api/saved.js";
import { onRequestGet as history } from "./functions/api/history.js";
import { onRequestPost as importSaved } from "./functions/api/import.js";
import { onRequestPost as capture } from "./functions/api/capture.js";
import { localD1 } from "./scripts/local-d1.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 8788);
mkdirSync(path.join(__dirname, '.local'), { recursive: true });
const varsPath = path.join(__dirname, '.dev.vars');
const localHash = existsSync(varsPath) ? readFileSync(varsPath, 'utf8').match(/^OWNER_PASSWORD_SHA256=([a-f0-9]{64})\s*$/m)?.[1] : '';
const env = { DB: localD1(path.join(__dirname, '.local/storage.sqlite')), OWNER_PASSWORD_SHA256: process.env.OWNER_PASSWORD_SHA256 || localHash };

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);

    const request = await toFetchRequest(req, requestUrl);
    const context = { request, env, next: async () => {
      if (requestUrl.pathname === '/api/auth') return auth(context);
      if (requestUrl.pathname === '/api/saved') return saved(context);
      if (requestUrl.pathname === '/api/history' && req.method === 'GET') return history(context);
      if (requestUrl.pathname === '/api/import' && req.method === 'POST') return importSaved(context);
      if (requestUrl.pathname === '/api/capture' && req.method === 'POST') return capture(context);
      if (requestUrl.pathname === '/api/extract') return req.method === 'POST' ? extractPost(context) : extractGet(context);
      if (requestUrl.pathname === '/api/download') return downloadGet(context);
      return serveStatic(requestUrl.pathname);
    } };
    await sendFetchResponse(res, await middleware(context));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error?.message || "Local server error");
  }
});

server.listen(port, () => {
  console.log(`Video URL Extractor local server: http://localhost:${port}`);
});

async function toFetchRequest(req, requestUrl) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  return new Request(requestUrl, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function sendFetchResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

function serveStatic(pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(publicDir, relativePath);
  const traversal = path.relative(publicDir, filePath);

  if (traversal.startsWith("..") || path.isAbsolute(traversal) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(Readable.toWeb(createReadStream(filePath)), { headers: {
    "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    "Cache-Control": "no-store",
  } });
}
