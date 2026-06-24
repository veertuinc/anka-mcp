import { controller } from "../../controller.js";
import { SSH_KEY_CLEANUP_INSTRUCTIONS } from "../../ssh-key.js";
import { uuidLike } from "../../security/schemas.js";
import {
  releaseControllerInstance,
  requireControllerInstanceAccess
} from "../../tokens/ownership.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { runControllerTool } from "./results.js";

export const controllerTerminateVmTool = defineTool({
  name: "controller_terminate_vm",
  config: {
    title: "Terminate a controller VM",
    description: "Terminate a running controller VM instance by its instance id.",
    inputSchema: {
      instance_id: uuidLike.describe("The instance id to terminate.")
    },
    annotations: {
      title: "Terminate a controller VM",
      destructiveHint: true,
      openWorldHint: true
    }
  },
  handler: async ({ instance_id }) =>
    runControllerTool(async () => {
      try {
        requireControllerInstanceAccess(instance_id);
      } catch {
        return jsonResult({ ok: false, error: "Instance not owned by this credential" }, true);
      }
      await controller.terminateVm(instance_id);
      releaseControllerInstance(instance_id);
      return jsonResult({
        instance_id,
        terminated: true,
        ssh_key_cleanup: SSH_KEY_CLEANUP_INSTRUCTIONS
      });
    })
});
