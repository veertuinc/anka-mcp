import { execFile } from "node:child_process";
import { config } from "./config.js";

/**
 * The JSON envelope every `anka -j <command>` call returns, e.g.
 * `{"status":"OK","body":[...]}` or `{"status":"ERROR","message":"..."}`.
 */
export interface AnkaEnvelope {
  status: "OK" | "ERROR" | string;
  body?: unknown;
  message?: string;
  code?: number;
  exception_type?: string;
}

export interface RunAnkaOptions {
  /** Prepend `-j` so anka emits its JSON envelope and we parse it. Default true. */
  machineReadable?: boolean;
  /** Override the per-call timeout in ms. */
  timeoutMs?: number;
}

/** Normalized result returned by {@link runAnka}. */
export interface AnkaResult {
  /** True when the process exited 0 and (if parsed) the envelope status was OK. */
  ok: boolean;
  /** Parsed envelope status, when machine-readable output was parsed. */
  status?: string;
  /** Parsed `body` field from the envelope, when present. */
  body?: unknown;
  /** Parsed `message` field from the envelope, when present. */
  message?: string;
  /** Process exit code (0 on success). */
  exitCode: number;
  /** The exact argument vector passed to the anka binary. */
  args: string[];
  /** Raw stdout. */
  stdout: string;
  /** Raw stderr. */
  stderr: string;
}

interface ExecFailure {
  code?: number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  message: string;
}

function isExecFailure(error: unknown): error is ExecFailure {
  return typeof error === "object" && error !== null && "message" in error;
}

function tryParseEnvelope(stdout: string): AnkaEnvelope | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed as AnkaEnvelope;
  } catch {
    // Not JSON (e.g. a non machine-readable command); leave undefined.
  }
  return undefined;
}

/**
 * Run the anka CLI with the given argument vector. Uses execFile (no shell) so
 * arguments are passed verbatim and are not subject to shell injection.
 */
export function runAnka(args: string[], options: RunAnkaOptions = {}): Promise<AnkaResult> {
  const { machineReadable = true, timeoutMs = config.ankaTimeoutMs } = options;
  const finalArgs = machineReadable ? ["-j", ...args] : [...args];

  return new Promise<AnkaResult>((resolve) => {
    execFile(
      config.ankaBin,
      finalArgs,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const envelope = machineReadable ? tryParseEnvelope(stdout) : undefined;

        if (error) {
          const failure: ExecFailure = isExecFailure(error)
            ? error
            : { message: String(error) };
          resolve({
            ok: false,
            status: envelope?.status,
            body: envelope?.body,
            message: envelope?.message ?? failure.message,
            exitCode: typeof failure.code === "number" ? failure.code : 1,
            args: finalArgs,
            stdout,
            stderr
          });
          return;
        }

        const status = envelope?.status;
        resolve({
          ok: status ? status === "OK" : true,
          status,
          body: envelope?.body,
          message: envelope?.message,
          exitCode: 0,
          args: finalArgs,
          stdout,
          stderr
        });
      }
    );
  });
}
