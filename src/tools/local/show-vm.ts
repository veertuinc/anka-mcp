import { runAnka } from "../../anka.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { ankaError, vmNameSchema } from "./vms.js";

interface AnkaShowBody {
  ip?: string;
}

export const localShowVmTool = defineTool({
  name: "local_show_vm",
  config: {
    title: "Show a local VM",
    description: "Get a local VM's IP address by name or uuid. The IP is only present once the VM is running.",
    inputSchema: {
      name: vmNameSchema.describe("Name or uuid of the VM to show.")
    },
    annotations: { title: "Show a local VM", readOnlyHint: true }
  },
  handler: async ({ name }) => {
    const result = await runAnka(["show", name]);
    if (!result.ok) {
      return jsonResult({ ok: false, error: ankaError(result) }, true);
    }
    const body = (result.body ?? {}) as AnkaShowBody;
    return jsonResult({ ok: true, ip: body.ip ?? null });
  }
});
