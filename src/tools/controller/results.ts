import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ControllerError } from "../../controller.js";
import { sanitizeControllerError, sanitizeUnknownError } from "../../security/sanitize.js";
import { jsonResult } from "../define-tool.js";

/** Extract an agent-safe error string from a controller failure. */
export function controllerError(error: unknown): string {
  if (error instanceof ControllerError) {
    return sanitizeControllerError(error.message);
  }
  if (error instanceof Error) {
    return sanitizeControllerError(error.message);
  }
  return sanitizeUnknownError(error);
}

/** Run an async controller operation and return a narrow tool result on failure. */
export async function runControllerTool(
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return jsonResult({ ok: false, error: controllerError(error) }, true);
  }
}
