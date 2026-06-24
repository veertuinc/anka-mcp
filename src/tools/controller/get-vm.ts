import { controller } from "../../controller.js";
import { uuidLike } from "../../security/schemas.js";
import { requireControllerInstanceAccess } from "../../tokens/ownership.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { controllerVmStatusFields } from "./status.js";
import { runControllerTool } from "./results.js";

export const controllerGetVmTool = defineTool({
  name: "controller_get_vm",
  config: {
    title: "Get controller VM status",
    description:
      "Get the current state of a controller VM instance. When SSH-ready, returns " +
      "host, forwarded port, username, and ssh_connect_hint. Do not SSH until status " +
      "is ready; wait ~20s after ready before connecting (startup_script installs " +
      "your public key at boot). While provisioning, returns status pending with " +
      "guidance to poll every 30 seconds.",
    inputSchema: {
      instance_id: uuidLike.describe("The instance id returned by controller_request_vm.")
    },
    annotations: { title: "Get controller VM status", readOnlyHint: true, openWorldHint: true }
  },
  handler: async ({ instance_id }) =>
    runControllerTool(async () => {
      try {
        requireControllerInstanceAccess(instance_id);
      } catch {
        return jsonResult({ ok: false, error: "Instance not owned by this credential" }, true);
      }
      const instance = await controller.getVm(instance_id);
      return jsonResult(controllerVmStatusFields(instance_id, instance));
    })
});
