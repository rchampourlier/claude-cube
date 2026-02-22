import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SessionTracker } from "./session-tracker.js";
import { createLogger } from "./util/logger.js";

const log = createLogger("server");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncHandler = (body: any) => Promise<any>;

interface ServerRoutes {
  PreToolUse: AsyncHandler;
  Stop: AsyncHandler;
  SessionStart: AsyncHandler;
  SessionEnd: AsyncHandler;
  Notification: AsyncHandler;
}

export function createHttpServer(
  port: number,
  routes: ServerRoutes,
  sessionTracker: SessionTracker,
) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // GET /status
      if (req.method === "GET" && req.url === "/status") {
        const sessions = sessionTracker.getAll();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessions, count: sessions.length }));
        return;
      }

      // POST /hooks/:event
      if (req.method === "POST" && req.url?.startsWith("/hooks/")) {
        const event = req.url.slice("/hooks/".length) as keyof ServerRoutes;
        const handler = routes[event];

        if (!handler) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown event: ${event}` }));
          return;
        }

        const body = await readBody(req);
        log.debug("Hook request", { event, sessionId: body.session_id });

        const result = await handler(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (e) {
      log.error("Request error", { url: req.url, error: String(e) });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, () => {
          log.info("HTTP server listening", { port });
          resolve();
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
        resolve(body);
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${e}`));
      }
    });
    req.on("error", reject);
  });
}
