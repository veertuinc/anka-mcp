import { defineTool, jsonResult } from "../define-tool.js";
import { listVms } from "./vms.js";

export const localListTemplatesTool = defineTool({
  name: "local_list_templates",
  config: {
    title: "List local VMs and templates",
    description:
      "List the local Anka VM library (templates and clones) with their name, uuid, " +
      "and status. Use this to find the template to clone from.",
    inputSchema: {},
    annotations: { title: "List local VMs and templates", readOnlyHint: true }
  },
  handler: async () => {
    const vms = await listVms();
    return jsonResult({ vms: vms.map((vm) => ({ name: vm.name, uuid: vm.uuid })) });
  }
});
