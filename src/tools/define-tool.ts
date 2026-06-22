import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { config } from "../config.js";
import { limitActorFromContext, logLimitReached, logToolCall, logToolError } from "../log.js";

interface ToolConfig<InputArgs extends ZodRawShape> {
  title?: string;
  description: string;
  inputSchema?: InputArgs;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** A self-contained, registrable MCP tool. */
export interface ToolDefinition<InputArgs extends ZodRawShape = ZodRawShape> {
  name: string;
  config: ToolConfig<InputArgs>;
  handler: ToolCallback<InputArgs>;
  register(server: McpServer): void;
}

/**
 * Declare an MCP tool in one place. Add the returned object to the `tools`
 * array in `tools/index.ts` and it is wired up automatically.
 */
export function defineTool<InputArgs extends ZodRawShape>(spec: {
  name: string;
  config: ToolConfig<InputArgs>;
  handler: ToolCallback<InputArgs>;
}): ToolDefinition<InputArgs> {
  return {
    ...spec,
    register(server: McpServer) {
      const handler = this.handler;
      const name = this.name;
      server.registerTool(this.name, this.config, (async (args, extra) => {
        try {
          const result = await handler(args, extra);
          logToolCall(name, args, result);
          return result;
        } catch (error) {
          logToolError(name, args, error);
          throw error;
        }
      }) as ToolCallback<InputArgs>);
    }
  };
}

/** Serialize a value into a CallToolResult with a single JSON text block. */
export function jsonResult(value: unknown, isError = false): CallToolResult {
  let text = JSON.stringify(value, null, 2);
  const originalLength = text.length;
  if (text.length > config.maxResponseChars) {
    logLimitReached({
      limit: "MCP_MAX_RESPONSE_CHARS",
      configured: String(config.maxResponseChars),
      actor: limitActorFromContext(),
      detail: `response_chars=${originalLength}`
    });
    text = JSON.stringify(
      {
        truncated: true,
        preview: text.slice(0, Math.max(0, config.maxResponseChars - 64))
      },
      null,
      2
    );
    if (text.length > config.maxResponseChars) {
      text = `${text.slice(0, config.maxResponseChars - 1)}…`;
    }
  }
  return {
    content: [{ type: "text", text }],
    isError
  };
}
