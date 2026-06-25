import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";

export interface McpClientInfo {
  name?: string;
  version?: string;
}

export interface RequestContext {
  /** Compact label for logs: IP plus optional user-agent. */
  source: string;
  ip: string;
  userAgent?: string;
  sessionId?: string;
  mcpClientName?: string;
  mcpClientVersion?: string;
  credentialId?: string;
  credentialLabel?: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

const SENSITIVE_KEYS = new Set(["password", "private_key", "authorization", "token"]);

function timestamp(): string {
  return new Date().toISOString();
}

function write(line: string): void {
  process.stderr.write(`anka-mcp: ${line}\n`);
  if (config.auditLogPath) {
    appendFileSync(config.auditLogPath, `anka-mcp: ${line}\n`, { encoding: "utf8" });
  }
}

/** Log an auth failure (always written when logging is enabled). */
export function logAuthFailure(source: string, route: string, reason = "invalid token"): void {
  if (!config.logEnabled) return;
  write(`${timestamp()} [${source}] auth failure ${route} (${reason})`);
}

/** Identifies who triggered a limit or security event in logs. */
export interface LimitActor {
  source?: string;
  ip?: string;
  credentialId?: string;
  credentialLabel?: string;
}

function formatActor(actor: LimitActor): string {
  const parts: string[] = [];
  if (actor.source) parts.push(`source=${actor.source}`);
  else if (actor.ip) parts.push(`ip=${actor.ip}`);
  if (actor.credentialId) parts.push(`credential_id=${actor.credentialId}`);
  if (actor.credentialLabel) parts.push(`credential_label=${actor.credentialLabel}`);
  return parts.length > 0 ? parts.join(" ") : "unknown";
}

/** Build actor fields from an Express request (includes credential when auth ran). */
export function limitActorFromRequest(req: {
  ip?: string;
  socket: { remoteAddress?: string | null };
  headers: Record<string, string | string[] | undefined>;
  mcpCredential?: { credentialId: string; credentialLabel?: string };
}): LimitActor {
  return {
    source: clientSourceFromRequest(req),
    ip: req.ip || req.socket.remoteAddress || "unknown",
    credentialId: req.mcpCredential?.credentialId,
    credentialLabel: req.mcpCredential?.credentialLabel
  };
}

/** Build actor fields from the current async request context. */
export function limitActorFromContext(): LimitActor {
  const ctx = getRequestContext();
  if (!ctx) return {};
  return {
    source: ctx.source,
    ip: ctx.ip,
    credentialId: ctx.credentialId,
    credentialLabel: ctx.credentialLabel
  };
}

/**
 * Log that a configured limit was hit. Format:
 * `LIMIT REACHED ANKA_MCP_RATE_LIMIT_RPM=120 by source=… credential_id=… route=/mcp …`
 */
export function logLimitReached(opts: {
  limit: string;
  configured: string;
  route?: string;
  actor?: LimitActor;
  detail?: string;
}): void {
  if (!config.logEnabled) return;
  const route = opts.route ? ` route=${opts.route}` : "";
  const detail = opts.detail ? ` ${opts.detail}` : "";
  write(
    `${timestamp()} LIMIT REACHED ${opts.limit}=${opts.configured} by ${formatActor(opts.actor ?? {})}${route}${detail}`
  );
}

/** Log MCP session lifecycle events. */
export function logSessionEvent(
  event: "created" | "closed",
  sessionId: string,
  actor?: LimitActor
): void {
  if (!config.logEnabled) return;
  const who = actor ? ` by ${formatActor(actor)}` : ` [${getRequestSource()}]`;
  write(`${timestamp()} session ${event} session_id=${sessionId}${who}`);
}

/** Log admin token lifecycle events (never logs plaintext secrets). */
export function logAdminEvent(
  event: "token created" | "token revoked",
  detail: { id: string; label?: string }
): void {
  if (!config.logEnabled) return;
  const label = detail.label ? ` label=${detail.label}` : "";
  write(`${timestamp()} admin ${event} id=${detail.id}${label}`);
}

/** Run `fn` with request-scoped logging context (client source). */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContext.run(context, fn);
}

/** Run async `fn` with request-scoped logging context. */
export async function runWithRequestContextAsync<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContext.run(context, fn);
}

export function getRequestSource(): string {
  return requestContext.getStore()?.source ?? "unknown";
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

const MAX_CONTROLLER_EXTERNAL_ID_LENGTH = 512;

function sanitizeExternalIdPart(value: string): string {
  return value.replace(/[\r\n\t\0]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Build a controller `external_id` that identifies the MCP caller for admins.
 * Always includes client/IP/session context; an optional caller `ref` is appended.
 */
export function buildControllerExternalId(callerExternalId?: string): string {
  const ctx = requestContext.getStore();
  const parts = ["anka-mcp"];

  if (ctx?.mcpClientName) {
    const client = ctx.mcpClientVersion
      ? `${ctx.mcpClientName}/${ctx.mcpClientVersion}`
      : ctx.mcpClientName;
    parts.push(`client=${sanitizeExternalIdPart(client)}`);
  }
  if (ctx?.ip) {
    parts.push(`ip=${sanitizeExternalIdPart(ctx.ip.replace(/^::ffff:/, ""))}`);
  }
  if (ctx?.userAgent) {
    parts.push(`ua=${sanitizeExternalIdPart(ctx.userAgent)}`);
  }
  if (ctx?.sessionId) {
    parts.push(`session=${ctx.sessionId}`);
  }
  if (ctx?.credentialId) {
    parts.push(`credential_id=${sanitizeExternalIdPart(ctx.credentialId)}`);
  }
  if (callerExternalId?.trim()) {
    parts.push(`ref=${sanitizeExternalIdPart(callerExternalId.trim())}`);
  }

  const externalId = parts.join(" ");
  if (externalId.length <= MAX_CONTROLLER_EXTERNAL_ID_LENGTH) return externalId;
  return `${externalId.slice(0, MAX_CONTROLLER_EXTERNAL_ID_LENGTH - 1)}…`;
}

/** Build request-scoped context from an HTTP request and optional MCP client info. */
export function buildRequestContext(
  req: {
    ip?: string;
    socket: { remoteAddress?: string | null };
    headers: Record<string, string | string[] | undefined>;
    mcpCredential?: { credentialId: string; credentialLabel?: string };
  },
  clientInfo?: McpClientInfo,
  sessionId?: string
): RequestContext {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const userAgent =
    typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
  const resolvedSessionId =
    sessionId ??
    (typeof req.headers["mcp-session-id"] === "string" ? req.headers["mcp-session-id"] : undefined);

  return {
    source: clientSourceFromRequest(req),
    ip,
    userAgent,
    sessionId: resolvedSessionId,
    mcpClientName: clientInfo?.name,
    mcpClientVersion: clientInfo?.version,
    credentialId: req.mcpCredential?.credentialId,
    credentialLabel: req.mcpCredential?.credentialLabel
  };
}

/** Extract MCP clientInfo from an initialize JSON-RPC body. */
export function mcpClientInfoFromBody(body: unknown): McpClientInfo | undefined {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!message || typeof message !== "object" || (message as { method?: string }).method !== "initialize") {
      continue;
    }
    const clientInfo = (message as { params?: { clientInfo?: unknown } }).params?.clientInfo;
    if (!clientInfo || typeof clientInfo !== "object") continue;
    return {
      name: typeof (clientInfo as { name?: unknown }).name === "string"
        ? (clientInfo as { name: string }).name
        : undefined,
      version: typeof (clientInfo as { version?: unknown }).version === "string"
        ? (clientInfo as { version: string }).version
        : undefined
    };
  }
  return undefined;
}

/** Build a compact client label from an Express request. */
export function clientSourceFromRequest(req: {
  ip?: string;
  socket: { remoteAddress?: string | null };
  headers: Record<string, string | string[] | undefined>;
}): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const userAgent = req.headers["user-agent"];
  if (typeof userAgent === "string" && userAgent.length > 0) {
    return `${ip} (${userAgent})`;
  }
  return ip;
}

/** Redact known secret fields before logging structured data. */
export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : sanitizeForLog(nested);
    }
    return out;
  }
  return value;
}

function formatPayload(value: unknown, maxLength = 800): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(sanitizeForLog(value), null, 0) ?? "undefined";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function parseToolResultPayload(result: CallToolResult): unknown {
  const block = result.content?.[0];
  if (!block || block.type !== "text") return { isError: result.isError };
  try {
    return JSON.parse(block.text);
  } catch {
    return { isError: result.isError, text: block.text };
  }
}

/** Extract JSON-RPC method name(s) from an MCP POST body. */
export function mcpMethodsFromBody(body: unknown): string[] {
  if (!body) return [];
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .map((message) =>
      message && typeof message === "object" && "method" in message
        ? String((message as { method: unknown }).method)
        : undefined
    )
    .filter((method): method is string => Boolean(method));
}

export function logMcpRequest(method: string, detail?: Record<string, unknown>): void {
  if (!config.logEnabled) return;
  const suffix = detail ? ` ${formatPayload(detail)}` : "";
  write(`${timestamp()} [${getRequestSource()}] mcp ${method}${suffix}`);
}

export function logToolCall(name: string, args: unknown, result: CallToolResult): void {
  if (!config.logEnabled) return;
  const payload = parseToolResultPayload(result);
  write(
    `${timestamp()} [${getRequestSource()}] tool ${name} args=${formatPayload(args)} -> ${formatPayload(payload)}`
  );
}

export function logToolError(name: string, args: unknown, error: unknown): void {
  if (!config.logEnabled) return;
  write(
    `${timestamp()} [${getRequestSource()}] tool ${name} args=${formatPayload(args)} -> error ${String(error)}`
  );
}

export function logAnkaCommand(args: string[], outcome: { ok: boolean; message?: string }): void {
  if (!config.logEnabled) return;
  const cmd = [config.ankaBin, ...args].join(" ");
  const status = outcome.ok ? "ok" : `failed${outcome.message ? `: ${outcome.message}` : ""}`;
  write(`${timestamp()} [${getRequestSource()}] anka ${cmd} -> ${status}`);
}

export function logControllerRequest(
  method: string,
  path: string,
  outcome: { ok: boolean; detail?: string }
): void {
  if (!config.logEnabled) return;
  const status = outcome.ok ? "ok" : `failed${outcome.detail ? `: ${outcome.detail}` : ""}`;
  write(`${timestamp()} [${getRequestSource()}] controller ${method} ${path} -> ${status}`);
}

/** Log the tool names registered at startup (always written, like the listen banner). */
export function logStartupTools(toolNames: string[]): void {
  process.stderr.write(`anka-mcp: tools: ${toolNames.join(", ") || "(none)"}\n`);
}
