import { z } from "zod";
import { runAnka } from "../../anka.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { ankaError, assertRunningCapacity, vmNameSchema, waitForVmIp } from "./vms.js";

export const localStartVmTool = defineTool({
  name: "local_start_vm",
  config: {
    title: "Start a local VM",
    description:
      "Start (or resume) a local VM by name or uuid. Refused if the number of running " +
      "VMs already meets the configured limit (ANKA_LOCAL_MAX_VMS). By default this waits " +
      "for the VM to boot and obtain an IP, then returns it, so you do not need to poll.",
    inputSchema: {
      name: vmNameSchema.describe("Name or uuid of the VM to start."),
      wait: z
        .boolean()
        .optional()
        .describe("Wait for the VM to obtain an IP before returning. Defaults to true."),
      timeoutSeconds: z
        .number()
        .positive()
        .optional()
        .describe("Override how long to wait for the IP, in seconds.")
    },
    annotations: { title: "Start a local VM" }
  },
  handler: async ({ name, wait, timeoutSeconds }) => {
    await assertRunningCapacity("start a VM");

    const result = await runAnka(["start", name]);
    if (!result.ok) {
      return jsonResult({ ok: false, error: ankaError(result) }, true);
    }

    if (wait === false) {
      return jsonResult({ ok: true, name });
    }

    const waited = await waitForVmIp(
      name,
      timeoutSeconds ? { timeoutMs: timeoutSeconds * 1000 } : {}
    );
    if (!waited.found) {
      return jsonResult({ ok: false, name, error: waited.error }, true);
    }
    return jsonResult({ ok: true, name, ip: waited.ip });
  }
});
