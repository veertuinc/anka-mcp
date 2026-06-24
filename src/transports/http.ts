import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { isMcpAuthConfigured, resolveMcpCredential } from "../auth.js";
import { config } from "../config.js";
import {
  buildRequestContext,
  clientSourceFromRequest,
  limitActorFromContext,
  limitActorFromRequest,
  logAuthFailure,
  logLimitReached,
  logMcpRequest,
  logSessionEvent,
  logStartupTools,
  mcpClientInfoFromBody,
  mcpMethodsFromBody,
  runWithRequestContextAsync,
  type LimitActor,
  type McpClientInfo
} from "../log.js";
import { isLoopbackHost } from "../security/host.js";
import { rateLimitMiddleware, SlidingWindowRateLimiter } from "../security/rate-limit.js";
import { createServer } from "../server.js";
import { initTokenStore, getTokenStore } from "../tokens/store.js";
import { enabledTools } from "../tools/index.js";
import { registerAdminRoutes } from "./admin.js";
import { registerStatusRoute } from "./status.js";

const SESSION_HEADER = "mcp-session-id";

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  clientInfo?: McpClientInfo;
  lastActivityAt: number;
  actor: LimitActor;
}

declare module "express-serve-static-core" {
  interface Request {
    mcpCredential?: { credentialId: string; credentialLabel?: string };
  }
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
    logLimitReached({
      limit: "MCP_ALLOWED_ORIGINS",
      configured: config.allowedOrigins.join(","),
      route: req.originalUrl,
      actor: limitActorFromRequest(req),
      detail: `origin=${origin}`
    });
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Origin not allowed" },
      id: null
    });
    return;
  }
  next();
}

/** Require a valid MCP bearer token unless auth is explicitly disabled. */
function authGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const resolved = resolveMcpCredential(bearerToken);
  if (!resolved) {
    logAuthFailure(clientSourceFromRequest(req), "/mcp");
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
  req.mcpCredential = resolved;
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

async function withRequestLogging<T>(
  req: Request,
  fn: () => Promise<T>,
  clientInfo?: McpClientInfo,
  sessionId?: string
): Promise<T> {
  return runWithRequestContextAsync(buildRequestContext(req, clientInfo, sessionId), async () => {
    logIncomingMcpRequest(req);
    return fn();
  });
}

function assertAuthConfigured(): void {
  if (!isMcpAuthConfigured()) {
    throw new Error(
      "Refusing to start without authentication. Set MCP_AUTH_TOKEN or MCP_ADMIN_TOKEN, " +
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

function sweepIdleSessions(sessions: Map<string, McpSession>): void {
  const idleBefore = Date.now() - config.sessionIdleMs;
  for (const [id, session] of sessions) {
    if (session.lastActivityAt >= idleBefore) continue;
    const idleMs = Date.now() - session.lastActivityAt;
    sessions.delete(id);
    void session.transport.close?.();
    logLimitReached({
      limit: "MCP_SESSION_IDLE_MS",
      configured: String(config.sessionIdleMs),
      route: "/mcp",
      actor: session.actor,
      detail: `session_id=${id} idle_ms=${idleMs}`
    });
  }
}

/**
 * Run the MCP server over streamable HTTP. Each MCP session gets its own
 * server + transport pair, keyed by the session id the SDK assigns on
 * initialize.
 */
export async function startHttp(): Promise<void> {
  initTokenStore(config.dbPath);
  if (config.authToken) {
    getTokenStore().ensureLegacyCredential();
  }

  assertAuthConfigured();
  assertBackendEnabled();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: config.maxBodyBytes }));

  const rateLimiter = new SlidingWindowRateLimiter(config.rateLimitRpm);
  const limit = rateLimitMiddleware(rateLimiter);

  registerAdminRoutes(app, limit);
  registerStatusRoute(app);

  const sessions = new Map<string, McpSession>();

  const sessionSweep = setInterval(() => {
    sweepIdleSessions(sessions);
    rateLimiter.prune();
  }, 60_000);
  sessionSweep.unref();

  app.post("/mcp", limit, originGuard, authGuard, async (req: Request, res: Response) => {
    const sessionId = req.headers[SESSION_HEADER] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    await withRequestLogging(
      req,
      async () => {
        if (existing) {
          existing.lastActivityAt = Date.now();
          await existing.transport.handleRequest(req, res, req.body);
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

        if (sessions.size >= config.maxSessions) {
          logLimitReached({
            limit: "MCP_MAX_SESSIONS",
            configured: String(config.maxSessions),
            route: "/mcp",
            actor: limitActorFromContext(),
            detail: `active_sessions=${sessions.size}`
          });
          res.status(503).json({
            jsonrpc: "2.0",
            error: { code: -32004, message: "Too many active sessions" },
            id: null
          });
          return;
        }

        const clientInfo = mcpClientInfoFromBody(req.body);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            const actor = limitActorFromContext();
            sessions.set(id, { transport, server, clientInfo, lastActivityAt: Date.now(), actor });
            logSessionEvent("created", id, actor);
          },
          onsessionclosed: (id) => {
            const closed = sessions.get(id);
            sessions.delete(id);
            logSessionEvent("closed", id, closed?.actor);
          }
        });

        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      },
      existing?.clientInfo,
      sessionId
    );
  });

  // GET (server-to-client SSE stream) and DELETE (terminate session).
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers[SESSION_HEADER] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    session.lastActivityAt = Date.now();

    await withRequestLogging(
      req,
      async () => {
        logMcpRequest(`${req.method} /mcp`, { session: sessionId });

        if (req.method === "GET") {
          const handling = session.transport.handleRequest(req, res);
          setImmediate(() => {
            void session.server.sendToolListChanged();
            logMcpRequest("notifications/tools/list_changed");
          });
          await handling;
          return;
        }

        if (req.method === "DELETE") {
          sessions.delete(sessionId!);
          logSessionEvent("closed", sessionId!, limitActorFromContext());
        }

        await session.transport.handleRequest(req, res);
      },
      session.clientInfo,
      sessionId
    );
  };

  app.get("/mcp", limit, originGuard, authGuard, handleSessionRequest);
  app.delete("/mcp", limit, originGuard, authGuard, handleSessionRequest);

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (
      err &&
      typeof err === "object" &&
      "type" in err &&
      (err as { type: string }).type === "entity.too.large"
    ) {
      logLimitReached({
        limit: "MCP_MAX_BODY_BYTES",
        configured: String(config.maxBodyBytes),
        route: req.originalUrl,
        actor: limitActorFromRequest(req),
        detail: "body_too_large"
      });
      if (req.originalUrl.startsWith("/admin")) {
        res.status(413).json({ ok: false, error: "Request body too large" });
        return;
      }
      res.status(413).json({
        jsonrpc: "2.0",
        error: { code: -32005, message: "Request body too large" },
        id: null
      });
      return;
    }
    next(err);
  });

  await new Promise<void>((resolve) => {
    app.listen(config.httpPort, config.httpHost, () => {
      const authState = config.allowNoAuth ? "UNAUTHENTICATED" : "token auth";
      const adminState = config.adminToken ? "admin API enabled" : "no admin API";
      const backends = [
        config.controllerEnabled ? "controller" : null,
        config.localEnabled ? "local" : null
      ]
        .filter(Boolean)
        .join(", ");
      process.stderr.write(
        `anka-mcp: listening on http://${config.httpHost}:${config.httpPort}/mcp (${authState}; ${adminState}; backends: ${backends})\n`
      );
      logStartupTools(enabledTools().map((tool) => tool.name));
      if (!isLoopbackHost(config.httpHost)) {
        process.stderr.write(
          "anka-mcp: WARNING listening on a non-loopback interface; use TLS termination and firewall rules\n"
        );
      }
      if (config.allowNoAuth) {
        process.stderr.write(
          "anka-mcp: WARNING running without authentication; do not expose this beyond localhost\n"
        );
      }
      resolve();
    });
  });
}
