import type { ToolDefinition } from "../define-tool.js";
import { localListTemplatesTool } from "./list-templates.js";
import { localCloneVmTool } from "./clone-vm.js";
import { localStartVmTool } from "./start-vm.js";
import { localShowVmTool } from "./show-vm.js";
import { localDeleteVmTool } from "./delete-vm.js";
import { localSshAccessTool } from "./ssh-access.js";

/** Tools exposed when the local anka CLI backend is enabled. */
export const localTools: ToolDefinition<any>[] = [
  localListTemplatesTool,
  localCloneVmTool,
  localStartVmTool,
  localShowVmTool,
  localDeleteVmTool,
  localSshAccessTool
];
