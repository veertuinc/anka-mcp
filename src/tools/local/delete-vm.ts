import { runAnka } from "../../anka.js";
import { defineTool } from "../define-tool.js";
import { localResult, vmNameSchema } from "./vms.js";

export const localDeleteVmTool = defineTool({
  name: "local_delete_vm",
  config: {
    title: "Delete a local VM",
    description:
      "Delete a single local VM by name or uuid. A name is always required; this tool " +
      "can only delete one specific VM and can never delete all VMs.",
    inputSchema: {
      name: vmNameSchema.describe("Name or uuid of the VM to delete.")
    },
    annotations: { title: "Delete a local VM", destructiveHint: true }
  },
  handler: async ({ name }) => {
    const result = await runAnka(["delete", "--yes", name]);
    return localResult(result, { name, deleted: true });
  }
});
