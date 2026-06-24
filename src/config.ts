import { execFileSync } from "node:child_process";

export interface AnkaMcpConfig {
  // --- HTTP transport + auth ---
  /** Port the HTTP server listens on. */
  httpPort: number;
  /** Host/interface the HTTP server binds to. */
  httpHost: string;
  /** Bearer token clients must present. Empty only when auth is explicitly disabled. */
  authToken: string;
  /** Admin bearer token for /admin/* routes. Empty disables the admin API. */
  adminToken: string;
  /** SQLite database path for client tokens and instance ownership. */
  dbPath: string;
  /** When true, revoking a token terminates its owned controller instances. */
  revokeCleanupEnabled: boolean;
  /** When true, the server runs without authentication (local dev only). */
  allowNoAuth: boolean;
  /** Allowed Origin header values for DNS-rebinding protection. Empty = unrestricted. */
  allowedOrigins: string[];
  /** When false, request/tool/backend logging to stderr is suppressed. */
  logEnabled: boolean;
  /** Optional append-only audit log file path. Empty = stderr only. */
  auditLogPath: string;
  /** Max JSON request body size in bytes. */
  maxBodyBytes: number;
  /** Max requests per client IP per minute (0 = disabled). */
  rateLimitRpm: number;
  /** Idle MCP session eviction threshold in ms. */
  sessionIdleMs: number;
  /** Max concurrent MCP sessions. */
  maxSessions: number;
  /** Max serialized tool response size in characters. */
  maxResponseChars: number;

  // --- Local (anka CLI) backend ---
  /** True when the local anka CLI tool set should be exposed. */
  localEnabled: boolean;
  /** Path to (or name of) the anka CLI binary. */
  ankaBin: string;
  /** Max time in ms a single anka invocation may run before being killed. */
  ankaTimeoutMs: number;
  /** Max number of running VMs the local backend will allow. */
  localMaxVms: number;
  /** Interval between local VM status polls (waiting for an IP), in ms. */
  localPollIntervalMs: number;
  /** Max time to wait for a local VM to obtain an IP after starting, in ms. */
  localIpTimeoutMs: number;

  // --- Controller backend ---
  /** True when the controller tool set should be exposed. */
  controllerEnabled: boolean;
  /** Base URL of the Anka Build Cloud Controller (e.g. http://anka.controller:8090). */
  controllerUrl: string;
  /** Raw value for the Authorization header sent to the controller (optional). */
  controllerAuth: string;
  /** When true, TLS certificate verification against the controller is skipped. */
  controllerTlsInsecure: boolean;
  /** Interval between instance-status polls, in ms. */
  controllerPollIntervalMs: number;
  /** Max time to wait for a requested VM to become SSH-ready, in ms. */
  controllerStartTimeoutMs: number;

  // --- SSH connection details returned to the agent ---
  /** Username the agent should use to SSH into a VM. */
  vmSshUser: string;
  /** Password the agent should use to SSH into a VM. */
  vmSshPassword: string;
  /** Guest port that maps to SSH inside the VM (forwarded on the host). */
  vmSshGuestPort: number;

  // --- Identity ---
  serverName: string;
  serverVersion: string;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = parseIntEnv(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function parseNonNegativeIntEnv(value: string | undefined, fallback: number): number {
  const parsed = parseIntEnv(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

function parseBoolEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseListEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Detect whether the local anka CLI is usable by invoking `<bin> --version`. */
function detectLocalAnka(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve whether the local backend is enabled. `ANKA_LOCAL` may be
 * `auto` (detect the binary), `on`, or `off`. When unset, `defaultMode`
 * applies (`off` when a controller URL is configured, otherwise `auto`).
 */
function resolveLocalEnabled(
  value: string | undefined,
  bin: string,
  defaultMode: "auto" | "off" = "auto"
): boolean {
  const mode = value?.trim().toLowerCase() || defaultMode;
  if (mode === "on" || parseBoolEnv(mode)) return true;
  if (mode === "off" || ["0", "false", "no"].includes(mode)) return false;
  return detectLocalAnka(bin);
}

/** Build the runtime config from environment variables (read once at startup). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AnkaMcpConfig {
  const ankaBin = env.ANKA_BIN?.trim() || "anka";
  const controllerUrl = stripTrailingSlash(env.ANKA_CONTROLLER_URL?.trim() || "");
  const controllerEnabled = controllerUrl.length > 0;
  const defaultLocalMode = controllerEnabled ? "off" : "auto";

  return {
    httpPort: parsePositiveIntEnv(env.MCP_HTTP_PORT, 9111),
    httpHost: env.MCP_HTTP_HOST?.trim() || "127.0.0.1",
    authToken: env.MCP_AUTH_TOKEN?.trim() || "",
    adminToken: env.MCP_ADMIN_TOKEN?.trim() || "",
    dbPath: env.MCP_DB_PATH?.trim() || "./anka-mcp.db",
    revokeCleanupEnabled: !["0", "false", "no", "off"].includes(
      env.MCP_REVOKE_CLEANUP?.trim().toLowerCase() ?? ""
    ),
    allowNoAuth: parseBoolEnv(env.MCP_ALLOW_NO_AUTH),
    allowedOrigins: parseListEnv(env.MCP_ALLOWED_ORIGINS),
    logEnabled: !["0", "false", "no", "off"].includes(env.MCP_LOG?.trim().toLowerCase() ?? ""),
    auditLogPath: env.MCP_AUDIT_LOG?.trim() || "",
    maxBodyBytes: parsePositiveIntEnv(env.MCP_MAX_BODY_BYTES, 1_048_576),
    rateLimitRpm: parseNonNegativeIntEnv(env.MCP_RATE_LIMIT_RPM, 120),
    sessionIdleMs: parsePositiveIntEnv(env.MCP_SESSION_IDLE_MS, 3_600_000),
    maxSessions: parsePositiveIntEnv(env.MCP_MAX_SESSIONS, 50),
    maxResponseChars: parsePositiveIntEnv(env.MCP_MAX_RESPONSE_CHARS, 32_768),

    localEnabled: resolveLocalEnabled(env.ANKA_LOCAL, ankaBin, defaultLocalMode),
    ankaBin,
    ankaTimeoutMs: parsePositiveIntEnv(env.ANKA_TIMEOUT_MS, 300_000),
    localMaxVms: parseNonNegativeIntEnv(env.ANKA_LOCAL_MAX_VMS, 2),
    localPollIntervalMs: parsePositiveIntEnv(env.ANKA_LOCAL_POLL_INTERVAL_MS, 2000),
    localIpTimeoutMs: parsePositiveIntEnv(env.ANKA_LOCAL_IP_TIMEOUT_MS, 120_000),

    controllerEnabled,
    controllerUrl,
    controllerAuth: env.ANKA_CONTROLLER_AUTH?.trim() || "",
    controllerTlsInsecure: parseBoolEnv(env.ANKA_CONTROLLER_TLS_INSECURE),
    controllerPollIntervalMs: parsePositiveIntEnv(env.ANKA_CONTROLLER_POLL_INTERVAL_MS, 3000),
    controllerStartTimeoutMs: parsePositiveIntEnv(env.ANKA_CONTROLLER_START_TIMEOUT_MS, 180_000),

    vmSshUser: env.ANKA_VM_SSH_USER?.trim() || "anka",
    vmSshPassword: env.ANKA_VM_SSH_PASSWORD ?? "admin",
    vmSshGuestPort: parsePositiveIntEnv(env.ANKA_VM_SSH_GUEST_PORT, 22),

    serverName: "anka-mcp",
    serverVersion: "0.1.0"
  };
}

export const config = loadConfig();
