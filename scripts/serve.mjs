import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"]
]);

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const requestedPath = safePath(url.pathname);

    if (!requestedPath) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let filePath = requestedPath;
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
    const body = await readFile(filePath);
    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; media-src 'self' blob:; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`POCKET is running at http://127.0.0.1:${port}`);
});
