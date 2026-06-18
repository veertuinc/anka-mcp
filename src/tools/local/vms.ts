import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runAnka, type AnkaResult } from "../../anka.js";
import { config } from "../../config.js";
import { jsonResult } from "../define-tool.js";

/**
 * A VM/template identifier. Rejects empty values and anything starting with
 * "-" so a name can never be reinterpreted as a CLI flag (e.g. "--all").
 */
export const vmNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^-]/, 'must not start with "-"');

/** A row from `anka -j list`. */
export interface AnkaVm {
  name?: string;
  uuid?: string;
  status?: string;
  version?: string;
  [key: string]: unknown;
}

/** Return the local VM library as parsed by `anka -j list`. */
export async function listVms(): Promise<AnkaVm[]> {
  const result = await runAnka(["list"]);
  if (!result.ok) {
    throw new Error(result.message || "Failed to list local VMs");
  }
  return Array.isArray(result.body) ? (result.body as AnkaVm[]) : [];
}

/** Extract a concise error string from a failed anka invocation. */
export function ankaError(result: AnkaResult): string {
  return result.message || result.stderr.trim() || `anka exited with code ${result.exitCode}`;
}

/**
 * Turn an anka result into a narrow tool result: a clean error on failure, or
 * the provided success fields on success. Keeps verbose CLI output (stdout,
 * args, exit codes) out of the agent's context.
 */
export function localResult(result: AnkaResult, success: Record<string, unknown>): CallToolResult {
  if (!result.ok) {
    return jsonResult({ ok: false, error: ankaError(result) }, true);
  }
  return jsonResult({ ok: true, ...success });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The two fields of `anka -j show` the local backend relies on. */
export interface VmShowInfo {
  status?: string;
  ip?: string;
}

/** Run `anka -j show <name>` and return its parsed body. */
export async function showVm(name: string): Promise<{ ok: true; info: VmShowInfo } | { ok: false; error: string }> {
  const result = await runAnka(["show", name]);
  if (!result.ok) return { ok: false, error: ankaError(result) };
  return { ok: true, info: (result.body ?? {}) as VmShowInfo };
}

export type WaitForIpResult = { found: true; ip: string } | { found: false; error: string };

/**
 * Poll `anka show` until the VM is running and has an IP, so callers can wait
 * out VM boot in a single tool call instead of re-checking repeatedly. Fails
 * fast on a hard CLI error (e.g. unknown VM) and gives up after the timeout.
 */
export async function waitForVmIp(
  name: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<WaitForIpResult> {
  const timeoutMs = opts.timeoutMs ?? config.localIpTimeoutMs;
  const intervalMs = opts.intervalMs ?? config.localPollIntervalMs;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | undefined;

  for (;;) {
    const shown = await showVm(name);
    if (!shown.ok) return { found: false, error: shown.error };
    lastStatus = shown.info.status;
    if (shown.info.status === "running" && shown.info.ip) {
      return { found: true, ip: shown.info.ip };
    }
    if (Date.now() >= deadline) {
      return {
        found: false,
        error: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for an IP (last status: ${lastStatus ?? "unknown"}).`
      };
    }
    await sleep(intervalMs);
  }
}

/** Count VMs currently in the "running" state. */
export async function countRunningVms(): Promise<number> {
  const vms = await listVms();
  return vms.filter((vm) => vm.status === "running").length;
}

/**
 * Throw if starting another VM would exceed the configured running-VM limit.
 * Anka's local (non-Build) license permits a small number of concurrent VMs,
 * so this keeps the agent from blowing past it.
 */
export async function assertRunningCapacity(action: string): Promise<void> {
  const running = await countRunningVms();
  if (running >= config.localMaxVms) {
    throw new Error(
      `Cannot ${action}: ${running} VM(s) already running, which meets the limit of ` +
        `${config.localMaxVms} (ANKA_LOCAL_MAX_VMS). Stop or delete a VM first.`
    );
  }
}
