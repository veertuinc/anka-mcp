import { config } from "./config.js";
import { logControllerRequest } from "./log.js";

/** Standard response envelope returned by the Controller API. */
interface ControllerEnvelope<T> {
  status: string;
  message?: string;
  body?: T;
}

export interface PortForwardingRule {
  guest_port: number;
  host_port?: number;
  protocol?: string;
  name?: string;
}

/** Subset of the `vminfo` object we rely on (other fields are passed through). */
export interface VmInfo {
  uuid?: string;
  name?: string;
  status?: string;
  host_ip?: string;
  ip?: string;
  vnc_port?: number;
  port_forwarding?: PortForwardingRule[];
  [key: string]: unknown;
}

/** A controller VM instance as returned by GET /api/v1/vm?id=. */
export interface Instance {
  instance_id?: string;
  instance_state?: string;
  vmid?: string;
  tag?: string;
  vminfo?: VmInfo;
  [key: string]: unknown;
}

export interface RegistryTemplate {
  id: string;
  name: string;
  arch?: string;
  [key: string]: unknown;
}

export interface SshEndpoint {
  host: string;
  port: number;
  username: string;
}

export interface StartVmRequest {
  vmid: string;
  tag?: string;
  name?: string;
  externalId?: string;
  /** When true, attach an SSH port-forward rule even if the template lacks one. */
  addSshPortForward?: boolean;
  /** Base64-encoded startup script (controller `startup_script` field). */
  startupScript?: string;
}

/** Raised when the controller responds with a non-OK status or a transport error. */
export class ControllerError extends Error {}

export class ControllerClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(baseUrl: string = config.controllerUrl, authHeader: string = config.controllerAuth) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = authHeader;
    // Global fetch (undici) has no per-request TLS toggle; opt out process-wide.
    if (config.controllerTlsInsecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authHeader) headers.Authorization = this.authHeader;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      const detail = String(error);
      logControllerRequest(method, path, { ok: false, detail });
      throw new ControllerError(`Failed to reach controller at ${this.baseUrl}: ${detail}`);
    }

    const text = await response.text();
    let envelope: ControllerEnvelope<T> | undefined;
    if (text.trim()) {
      try {
        envelope = JSON.parse(text) as ControllerEnvelope<T>;
      } catch {
        // Fall through to the HTTP-status check below.
      }
    }

    if (!response.ok) {
      const detail = envelope?.message || text || `HTTP ${response.status}`;
      logControllerRequest(method, path, { ok: false, detail });
      throw new ControllerError(`Controller request failed (${method} ${path}): ${detail}`);
    }
    if (envelope && envelope.status && envelope.status !== "OK") {
      const detail = envelope.message || envelope.status;
      logControllerRequest(method, path, { ok: false, detail });
      throw new ControllerError(`Controller request failed (${method} ${path}): ${detail}`);
    }

    logControllerRequest(method, path, { ok: true });
    return (envelope ? envelope.body : undefined) as T;
  }

  /** List registry templates so a caller can find the vmid/tag to start from. */
  async listTemplates(): Promise<RegistryTemplate[]> {
    const body = await this.request<RegistryTemplate[]>("GET", "/api/v1/registry/vm");
    return body ?? [];
  }

  /** Start a single VM instance from a template; returns the new instance id. */
  async startVm(req: StartVmRequest): Promise<string> {
    const payload: Record<string, unknown> = { vmid: req.vmid, count: 1 };
    if (req.tag) payload.tag = req.tag;
    if (req.name) payload.name = req.name;
    if (req.externalId) payload.external_id = req.externalId;
    if (req.addSshPortForward) {
      payload.port_forwarding_override = [
        { name: "ssh", guest_port: String(config.vmSshGuestPort) }
      ];
    }
    if (req.startupScript) {
      payload.startup_script = req.startupScript;
      // 1 = run immediately (before networking); installs the SSH key as early as possible.
      payload.startup_script_condition = 1;
    }

    const body = await this.request<string[]>("POST", "/api/v1/vm", payload);
    const instanceId = body?.[0];
    if (!instanceId) {
      throw new ControllerError("Controller did not return an instance id for the started VM");
    }
    return instanceId;
  }

  /** Fetch a single instance's full record. */
  async getVm(instanceId: string): Promise<Instance> {
    const body = await this.request<Instance>(
      "GET",
      `/api/v1/vm?id=${encodeURIComponent(instanceId)}`
    );
    if (!body) {
      throw new ControllerError(`Instance ${instanceId} not found`);
    }
    return body;
  }

  /** Terminate a running instance. */
  async terminateVm(instanceId: string): Promise<void> {
    await this.request<unknown>("DELETE", "/api/v1/vm", { id: instanceId });
  }
}

/**
 * Pull SSH endpoint details out of a vminfo object: forwarded host port for the
 * SSH guest port plus the configured username. Returns undefined when the VM is
 * not yet reachable over SSH.
 */
export function extractSshEndpoint(vminfo: VmInfo | undefined): SshEndpoint | undefined {
  if (!vminfo?.host_ip) return undefined;
  const rule = vminfo.port_forwarding?.find(
    (entry) => entry.guest_port === config.vmSshGuestPort && entry.host_port
  );
  if (!rule?.host_port) return undefined;
  return {
    host: vminfo.host_ip,
    port: rule.host_port,
    username: config.vmSshUser
  };
}

/** True once the controller reports a started VM with a forwarded SSH port. */
export function isSshReady(instance: Instance): boolean {
  return (
    instance.instance_state === "Started" &&
    instance.vminfo?.status === "running" &&
    extractSshEndpoint(instance.vminfo) !== undefined
  );
}

export const controller = new ControllerClient();
