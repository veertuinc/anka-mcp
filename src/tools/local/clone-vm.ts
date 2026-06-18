import { runAnka } from "../../anka.js";
import { defineTool } from "../define-tool.js";
import { assertRunningCapacity, localResult, vmNameSchema } from "./vms.js";

export const localCloneVmTool = defineTool({
  name: "local_clone_vm",
  config: {
    title: "Clone a local VM",
    description:
      "Clone a local template (or VM) into a new VM. Use local_list_templates to find " +
      "the source. Subject to the configured running-VM limit.",
    inputSchema: {
      template: vmNameSchema.describe("Name or uuid of the template/VM to clone from."),
      name: vmNameSchema.describe("Name for the new VM.")
    },
    annotations: { title: "Clone a local VM" }
  },
  handler: async ({ template, name }) => {
    await assertRunningCapacity("clone a VM");
    const result = await runAnka(["clone", template, name]);
    return localResult(result, { name });
  }
});
