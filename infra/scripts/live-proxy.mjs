// One origin for the live stack, so a single tunnel can expose it for a live demo:
//
//   node infra/scripts/live-proxy.mjs [port] [backend port] [dashboard port]
//   cloudflared tunnel --url http://localhost:4000
//
// /api, /ws and /health go to the backend, everything else to the dashboard, which is built with an
// empty NEXT_PUBLIC_API_URL so it calls whatever host it was loaded from. Visitors are outsiders:
// service-to-service calls are refused here, and the backend's sign-in limits see each visitor's own
// address (set TRUST_PROXY_HEADERS=true on the backend).
import http from "node:http";
import net from "node:net";

const [port = 4000, backend = 8000, dashboard = 3200] = process.argv.slice(2).map(Number);
const target = (url = "/") => (/^\/(api|ws|health)(\/|\?|$)/.test(url) ? backend : dashboard);

function forwardHeaders(req) {
  const headers = { ...req.headers };
  // Only the AI service sends this, directly to the backend; through the tunnel it is always an outsider.
  delete headers["x-internal-api-key"];
  // Cloudflare sets CF-Connecting-IP and overwrites any value a client sends.
  headers["x-real-ip"] = req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "";
  return headers;
}

// The development backend serves interactive API docs; visitors have no use for them.
const HIDDEN = /^\/api\/(docs|redoc|openapi\.json)(\/|\?|$)/;

const server = http.createServer((req, res) => {
  if (HIDDEN.test(req.url ?? "")) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const upstream = http.request(
    { host: "127.0.0.1", port: target(req.url), path: req.url, method: req.method, headers: forwardHeaders(req) },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Live demo is starting or a service is down.");
  });
  req.pipe(upstream);
});

// WebSockets: replay the upgrade request to the backend, then splice the two sockets together.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(target(req.url), "127.0.0.1", () => {
    const headers = Object.entries(forwardHeaders(req)).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(port, () => console.log(`live proxy on http://localhost:${port} (api ${backend}, dashboard ${dashboard})`));
