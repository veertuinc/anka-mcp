import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runAnka } from "../../anka.js";
import { timeoutSecondsSchema } from "../../security/schemas.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { ankaError, assertRunningCapacity, vmNameSchema, waitForVmIp } from "./vms.js";

export const localStartVmTool = defineTool({
  name: "local_start_vm",
  config: {
    title: "Start a local VM from a template",
    description:
      "Clone the given template into a fresh, disposable VM and start it. The original " +
      "template is never started or modified. Use local_list_templates to find a template. " +
      "Refused if the running-VM limit (ANKA_LOCAL_MAX_VMS) is already met. By default this " +
      "waits for the new VM to boot and obtain an IP, then returns its name and IP so you do " +
      "not need to poll. Delete the VM with local_delete_vm when finished.",
    inputSchema: {
      template: vmNameSchema.describe("Name or uuid of the template to clone from."),
      name: vmNameSchema
        .optional()
        .describe("Optional name for the new VM. Defaults to an auto-generated name."),
      wait: z
        .boolean()
        .optional()
        .describe("Wait for the VM to obtain an IP before returning. Defaults to true."),
      timeoutSeconds: timeoutSecondsSchema
        .optional()
        .describe("Override how long to wait for the IP, in seconds.")
    },
    annotations: { title: "Start a local VM from a template" }
  },
  handler: async ({ template, name, wait, timeoutSeconds }) => {
    await assertRunningCapacity("start a VM");

    const vmName = name ?? `mcp-${randomUUID().slice(0, 8)}`;

    const cloned = await runAnka(["clone", template, vmName]);
    if (!cloned.ok) {
      return jsonResult({ ok: false, error: `Clone failed: ${ankaError(cloned)}` }, true);
    }

    const started = await runAnka(["start", vmName]);
    if (!started.ok) {
      return jsonResult({ ok: false, name: vmName, error: ankaError(started) }, true);
    }

    if (wait === false) {
      return jsonResult({ ok: true, name: vmName, source: template });
    }

    const waited = await waitForVmIp(
      vmName,
      timeoutSeconds ? { timeoutMs: timeoutSeconds * 1000 } : {}
    );
    if (!waited.found) {
      return jsonResult({ ok: false, name: vmName, source: template, error: waited.error }, true);
    }
    return jsonResult({ ok: true, name: vmName, source: template, ip: waited.ip });
  }
});
