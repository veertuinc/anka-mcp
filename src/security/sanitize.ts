const MAX_ERROR_LENGTH = 200;
const PATH_PATTERN = /(?:\/[\w.-]+)+/g;
const URL_PATTERN = /https?:\/\/[^\s]+/gi;

/** Strip file paths and URLs from CLI stderr before returning to agents. */
export function sanitizeCliError(text: string): string {
  let cleaned = text.replace(URL_PATTERN, "[url]").replace(PATH_PATTERN, "[path]");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_ERROR_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

/** Map internal controller errors to agent-safe messages (no URLs or raw HTTP bodies). */
export function sanitizeControllerError(message: string): string {
  if (/failed to reach controller/i.test(message)) {
    return "Could not reach the Anka controller";
  }
  if (/controller request failed/i.test(message)) {
    const httpMatch = message.match(/HTTP (\d{3})/);
    if (httpMatch) {
      return `Controller rejected the request (HTTP ${httpMatch[1]})`;
    }
    return "Controller rejected the request";
  }
  return "Controller operation failed";
}

/** Normalize unknown thrown values into a safe error string. */
export function sanitizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeControllerError(error.message);
  }
  return "Operation failed";
}
