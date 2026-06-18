import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(HERE, "../../src/index.ts");
const FAKE_ANKA = resolve(HERE, "../fixtures/fake-anka.mjs");

export { FAKE_ANKA };

/** Find an available TCP port. */
export async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolvePort(port));
    });
  });
}

export interface RunningServer {
  baseUrl: string;
  port: number;
  stop: () => void;
  stderr: () => string;
}

/**
 * Spawn the MCP server (from source via tsx) with the given env and wait until
 * it is listening. Throws with captured stderr if it exits first.
 */
export async function startServer(env: Record<string, string>): Promise<RunningServer> {
  const port = await getFreePort();
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
    env: { ...process.env, MCP_HTTP_PORT: String(port), MCP_HTTP_HOST: "127.0.0.1", ...env },
    stdio: ["ignore", "ignore", "pipe"]
  });

  let buf = "";
  child.stderr?.on("data", (d) => {
    buf += d.toString();
  });

  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in time:\n${buf}`)), 15_000);
    child.stderr?.on("data", () => {
      if (/listening on/.test(buf)) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}):\n${buf}`));
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    stop: () => child.kill(),
    stderr: () => buf
  };
}

/** Try to start a server expecting it to fail; returns the captured stderr. */
export async function expectStartFailure(env: Record<string, string>): Promise<string> {
  try {
    const srv = await startServer(env);
    srv.stop();
    throw new Error("server started but was expected to fail");
  } catch (error) {
    return String(error);
  }
}

function parseBody(contentType: string | null, text: string): any {
  if ((contentType ?? "").includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

export interface ToolResult {
  isError: boolean;
  data: any;
}

export interface McpClient {
  status: number;
  listTools: () => Promise<string[]>;
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

/** A raw POST to /mcp (used to assert auth behavior). */
export async function rawInitialize(baseUrl: string, token?: string): Promise<number> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }
    })
  });
  await res.text();
  return res.status;
}

/** Open an MCP session over HTTP and return helpers to list/call tools. */
export async function connect(baseUrl: string, token?: string): Promise<McpClient> {
  const headersBase: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  if (token) headersBase.Authorization = `Bearer ${token}`;

  let sessionId: string | undefined;
  const rpc = async (payload: Record<string, unknown>) => {
    const headers = { ...headersBase };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(payload) });
    const text = await res.text();
    sessionId = res.headers.get("mcp-session-id") ?? sessionId;
    if (payload.method === "notifications/initialized") return { status: res.status, body: null };
    return { status: res.status, body: parseBody(res.headers.get("content-type"), text) };
  };

  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }
  });
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

  return {
    status: init.status,
    listTools: async () => {
      const r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      return r.body.result.tools.map((t: { name: string }) => t.name);
    },
    call: async (name, args) => {
      const r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });
      // Invalid params surface as a JSON-RPC error rather than a tool result.
      if (r.body.error) {
        return { isError: true, data: { error: r.body.error.message } };
      }
      const content = r.body.result;
      const text = content.content[0].text;
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
      return { isError: Boolean(content.isError), data };
    }
  };
}
