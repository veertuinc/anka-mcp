import { z } from "zod";
import { controller, extractSsh } from "../../controller.js";
import { defineTool, jsonResult } from "../define-tool.js";

export const controllerGetVmTool = defineTool({
  name: "controller_get_vm",
  config: {
    title: "Get controller VM status",
    description:
      "Get the current state of a controller VM instance, including SSH connection " +
      "details (host, forwarded port, username, password) once it is reachable.",
    inputSchema: {
      instance_id: z.string().min(1).describe("The instance id returned by controller_request_vm.")
    },
    annotations: { title: "Get controller VM status", readOnlyHint: true, openWorldHint: true }
  },
  handler: async ({ instance_id }) => {
    const instance = await controller.getVm(instance_id);
    return jsonResult({
      instance_id,
      instance_state: instance.instance_state,
      vm_status: instance.vminfo?.status ?? null,
      ssh: extractSsh(instance.vminfo) ?? null
    });
  }
});
