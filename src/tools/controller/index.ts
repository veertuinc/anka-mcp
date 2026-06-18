import type { ToolDefinition } from "../define-tool.js";
import { controllerListTemplatesTool } from "./list-templates.js";
import { controllerRequestVmTool } from "./request-vm.js";
import { controllerGetVmTool } from "./get-vm.js";
import { controllerTerminateVmTool } from "./terminate-vm.js";

/** Tools exposed when the controller backend is enabled. */
export const controllerTools: ToolDefinition<any>[] = [
  controllerListTemplatesTool,
  controllerRequestVmTool,
  controllerGetVmTool,
  controllerTerminateVmTool
];
