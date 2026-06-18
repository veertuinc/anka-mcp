import { z } from "zod";
import { controller } from "../../controller.js";
import { defineTool, jsonResult } from "../define-tool.js";

export const controllerTerminateVmTool = defineTool({
  name: "controller_terminate_vm",
  config: {
    title: "Terminate a controller VM",
    description: "Terminate a running controller VM instance by its instance id.",
    inputSchema: {
      instance_id: z.string().min(1).describe("The instance id to terminate.")
    },
    annotations: {
      title: "Terminate a controller VM",
      destructiveHint: true,
      openWorldHint: true
    }
  },
  handler: async ({ instance_id }) => {
    await controller.terminateVm(instance_id);
    return jsonResult({ instance_id, terminated: true });
  }
});
