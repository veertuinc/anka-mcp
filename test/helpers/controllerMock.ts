import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockControllerOptions {
  /** Number of GET /api/v1/vm?id= polls before the instance reports SSH-ready. */
  readyAfter?: number;
  /** Terminal state to report instead of becoming ready (e.g. "Error"). */
  failWithState?: string;
}

export interface MockController {
  url: string;
  /** Calls received, for assertions. */
  calls: { method: string; path: string }[];
  /** Parsed JSON bodies from POST /api/v1/vm start requests. */
  startPayloads: Record<string, unknown>[];
  /** Instance ids passed to DELETE /api/v1/vm. */
  terminatedIds: string[];
  close: () => Promise<void>;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/** Start an in-process mock of the Anka Build Cloud Controller API. */
export async function startMockController(options: MockControllerOptions = {}): Promise<MockController> {
  const readyAfter = options.readyAfter ?? 1;
  const calls: { method: string; path: string }[] = [];
  const startPayloads: Record<string, unknown>[] = [];
  const terminatedIds: string[] = [];
  let getCount = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    calls.push({ method: req.method ?? "GET", path: url.pathname });
    const send = (obj: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === "/api/v1/registry/vm" && req.method === "GET") {
      return send({
        status: "OK",
        body: [{ id: "tmpl-1", name: "14.5-arm64", arch: "arm64", size: 123, last_pull: 1, last_push: 2 }]
      });
    }
    if (url.pathname === "/api/v1/vm" && req.method === "POST") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      startPayloads.push(body);
      return send({ status: "OK", body: ["inst-1"] });
    }
    if (url.pathname === "/api/v1/vm" && req.method === "GET") {
      getCount += 1;
      if (options.failWithState) {
        return send({ status: "OK", body: { instance_id: "inst-1", instance_state: options.failWithState, vminfo: { status: "error" } } });
      }
      if (getCount < readyAfter) {
        return send({ status: "OK", body: { instance_id: "inst-1", instance_state: "Scheduling", vminfo: { status: "scheduling" } } });
      }
      return send({
        status: "OK",
        body: {
          instance_id: "inst-1",
          instance_state: "Started",
          vmid: "tmpl-1",
          tag: "vanilla+port-forward-22",
          vminfo: {
            uuid: "vm-uuid",
            name: "mgmtManaged-14.5",
            status: "running",
            host_ip: "10.0.0.5",
            ip: "192.168.69.15",
            cpu_cores: 4,
            ram: "8G",
            port_forwarding: [{ guest_port: 22, host_port: 10005, protocol: "tcp", name: "ssh" }]
          }
        }
      });
    }
    if (url.pathname === "/api/v1/vm" && req.method === "DELETE") {
      const body = (await readJsonBody(req)) as { id?: string } | undefined;
      if (body?.id) terminatedIds.push(body.id);
      return send({ status: "OK", message: "" });
    }
    res.statusCode = 404;
    send({ status: "FAIL", message: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    startPayloads,
    terminatedIds,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
