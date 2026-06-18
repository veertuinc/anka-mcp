import { controller } from "../../controller.js";
import { defineTool, jsonResult } from "../define-tool.js";

export const controllerListTemplatesTool = defineTool({
  name: "controller_list_templates",
  config: {
    title: "List controller templates",
    description:
      "List the VM templates available in the Anka Build Cloud registry. Use this " +
      "to find the template `vmid` (and optionally a tag) to pass to " +
      "controller_request_vm.",
    inputSchema: {},
    annotations: { title: "List controller templates", readOnlyHint: true, openWorldHint: true }
  },
  handler: async () => {
    const templates = await controller.listTemplates();
    return jsonResult({
      templates: templates.map((t) => ({ id: t.id, name: t.name, arch: t.arch }))
    });
  }
});
