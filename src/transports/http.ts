import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import {
  clientSourceFromRequest,
  logMcpRequest,
  mcpMethodsFromBody,
  runWithRequestContextAsync
} from "../log.js";
import { createServer } from "../server.js";

const SESSION_HEADER = "mcp-session-id";

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Reject browser requests whose Origin is not allow-listed (DNS-rebinding protection). */
function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (config.allowedOrigins.length === 0) {
    next();
    return;
  }
  const origin = req.headers.origin;
  // Non-browser MCP clients omit Origin; only enforce when one is present.
  if (origin && !config.allowedOrigins.includes(origin)) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Origin not allowed" },
      id: null
    });
    return;
  }
  next();
}

/** Require a matching bearer token unless auth is explicitly disabled. */
function authGuard(req: Request, res: Response, next: NextFunction): void {
  if (config.allowNoAuth) {
    next();
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token || !safeEqual(token, config.authToken)) {
    res
      .status(401)
      .set("WWW-Authenticate", "Bearer")
      .json({
        jsonrpc: "2.0",
        error: { code: -32002, message: "Unauthorized" },
        id: null
      });
    return;
  }
  next();
}

function logIncomingMcpRequest(req: Request): void {
  const methods = mcpMethodsFromBody(req.body);
  if (methods.length === 0) return;

  for (const method of methods) {
    if (method === "tools/call") {
      const messages = Array.isArray(req.body) ? req.body : [req.body];
      for (const message of messages) {
        if (!message || typeof message !== "object" || (message as { method?: string }).method !== "tools/call") {
          continue;
        }
        const params = (message as { params?: { name?: string; arguments?: unknown } }).params;
        logMcpRequest(method, {
          tool: params?.name,
          args: params?.arguments ?? {}
        });
      }
      continue;
    }

    if (method === "initialize") {
      const messages = Array.isArray(req.body) ? req.body : [req.body];
      for (const message of messages) {
        if (!message || typeof message !== "object" || (message as { method?: string }).method !== "initialize") {
          continue;
        }
        const clientInfo = (message as { params?: { clientInfo?: unknown } }).params?.clientInfo;
        logMcpRequest(method, clientInfo ? { client: clientInfo } : undefined);
      }
      continue;
    }

    logMcpRequest(method);
  }
}

async function withRequestLogging<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const source = clientSourceFromRequest(req);
  return runWithRequestContextAsync({ source }, async () => {
    logIncomingMcpRequest(req);
    return fn();
  });
}

function assertAuthConfigured(): void {
  if (!config.authToken && !config.allowNoAuth) {
    throw new Error(
      "Refusing to start without authentication. Set MCP_AUTH_TOKEN to a secret, " +
        "or set MCP_ALLOW_NO_AUTH=1 to run unauthenticated (local dev only)."
    );
  }
}

function assertBackendEnabled(): void {
  if (!config.controllerEnabled && !config.localEnabled) {
    throw new Error(
      "No backend enabled. Set ANKA_CONTROLLER_URL for the controller backend, " +
        "and/or run on a host with the anka CLI (or set ANKA_LOCAL=on) for the local backend."
    );
  }
}

/**
 * Run the MCP server over streamable HTTP. Each MCP session gets its own
 * server + transport pair, keyed by the session id the SDK assigns on
 * initialize.
 */
export async function startHttp(): Promise<void> {
  assertAuthConfigured();
  assertBackendEnabled();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", originGuard, authGuard, async (req: Request, res: Response) => {
    await withRequestLogging(req, async () => {
      const sessionId = req.headers[SESSION_HEADER] as string | undefined;
      const existing = sessionId ? transports.get(sessionId) : undefined;

      if (existing) {
        await existing.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session ID provided" },
          id: null
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        }
      });

      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
  });

  // GET (server-to-client SSE stream) and DELETE (terminate session).
  const handleSessionRequest = async (req: Request, res: Response) => {
    await withRequestLogging(req, async () => {
      const sessionId = req.headers[SESSION_HEADER] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }
      logMcpRequest(`${req.method} /mcp`, { session: sessionId });
      await transport.handleRequest(req, res);
    });
  };

  app.get("/mcp", originGuard, authGuard, handleSessionRequest);
  app.delete("/mcp", originGuard, authGuard, handleSessionRequest);

  await new Promise<void>((resolve) => {
    app.listen(config.httpPort, config.httpHost, () => {
      const authState = config.allowNoAuth ? "UNAUTHENTICATED" : "token auth";
      const backends = [
        config.controllerEnabled ? "controller" : null,
        config.localEnabled ? "local" : null
      ]
        .filter(Boolean)
        .join(", ");
      process.stderr.write(
        `anka-mcp: listening on http://${config.httpHost}:${config.httpPort}/mcp (${authState}; backends: ${backends})\n`
      );
      if (config.allowNoAuth) {
        process.stderr.write(
          "anka-mcp: WARNING running without authentication; do not expose this beyond localhost\n"
        );
      }
      resolve();
    });
  });
}
