import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { registerTools } from "./tools/index.js";

/** Build a fresh MCP server instance with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  });

  registerTools(server);

  return server;
}
