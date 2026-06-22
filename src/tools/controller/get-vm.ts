import { z } from "zod";
import { controller, extractSshEndpoint } from "../../controller.js";
import { requireControllerInstanceAccess } from "../../tokens/ownership.js";
import { defineTool, jsonResult } from "../define-tool.js";

export const controllerGetVmTool = defineTool({
  name: "controller_get_vm",
  config: {
    title: "Get controller VM status",
    description:
      "Get the current state of a controller VM instance, including SSH endpoint " +
      "details (host, forwarded port, username) once it is reachable. Use the private " +
      "key returned by controller_request_vm to connect.",
    inputSchema: {
      instance_id: z.string().min(1).describe("The instance id returned by controller_request_vm.")
    },
    annotations: { title: "Get controller VM status", readOnlyHint: true, openWorldHint: true }
  },
  handler: async ({ instance_id }) => {
    try {
      requireControllerInstanceAccess(instance_id);
    } catch {
      return jsonResult({ ok: false, error: "Instance not owned by this credential" }, true);
    }
    const instance = await controller.getVm(instance_id);
    return jsonResult({
      instance_id,
      instance_state: instance.instance_state,
      vm_status: instance.vminfo?.status ?? null,
      ssh: extractSshEndpoint(instance.vminfo) ?? null
    });
  }
});
