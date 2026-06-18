import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config.js";
import type { ToolDefinition } from "./define-tool.js";
import { controllerTools } from "./controller/index.js";
import { localTools } from "./local/index.js";

export { defineTool, jsonResult } from "./define-tool.js";
export type { ToolDefinition } from "./define-tool.js";

/** Build the list of tools to expose, based on which backends are enabled. */
export function enabledTools(): ToolDefinition<any>[] {
  const tools: ToolDefinition<any>[] = [];
  if (config.controllerEnabled) tools.push(...controllerTools);
  if (config.localEnabled) tools.push(...localTools);
  return tools;
}

/** Register every enabled tool on the given server. */
export function registerTools(server: McpServer): void {
  for (const tool of enabledTools()) {
    tool.register(server);
  }
}
