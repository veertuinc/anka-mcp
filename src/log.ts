import { AsyncLocalStorage } from "node:async_hooks";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";

export interface RequestContext {
  /** Client IP (and optional user-agent) for the active HTTP request. */
  source: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

const SENSITIVE_KEYS = new Set(["password", "private_key", "authorization", "token"]);

function timestamp(): string {
  return new Date().toISOString();
}

function write(line: string): void {
  process.stderr.write(`anka-mcp: ${line}\n`);
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
