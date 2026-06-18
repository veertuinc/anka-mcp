import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

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
      server.registerTool(this.name, this.config, this.handler);
    }
  };
}

/** Serialize a value into a CallToolResult with a single JSON text block. */
export function jsonResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError
  };
}
