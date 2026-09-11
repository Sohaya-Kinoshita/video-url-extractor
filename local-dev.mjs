import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { onRequestGet as downloadGet } from "./functions/api/download.js";
import { onRequestGet as extractGet, onRequestPost as extractPost } from "./functions/api/extract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 8788);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);

    if (requestUrl.pathname === "/api/extract") {
      await sendFetchResponse(
        res,
        req.method === "POST"
          ? await extractPost({ request: await toFetchRequest(req, requestUrl) })
          : await extractGet(),
      );
      return;
    }

    if (requestUrl.pathname === "/api/download") {
      await sendFetchResponse(res, await downloadGet({ request: await toFetchRequest(req, requestUrl) }));
      return;
    }

    serveStatic(requestUrl.pathname, res);
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

function serveStatic(pathname, res) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(publicDir, relativePath);
  const traversal = path.relative(publicDir, filePath);

  if (traversal.startsWith("..") || path.isAbsolute(traversal) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}
