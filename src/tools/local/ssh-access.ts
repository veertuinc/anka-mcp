import { z } from "zod";
import { runAnka } from "../../anka.js";
import { config } from "../../config.js";
import {
  buildAuthorizedKeysStartupScript,
  decodeSshPublicKeyBase64,
  SSH_PUBLIC_KEY_INSTRUCTIONS
} from "../../ssh-key.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { ankaError, showVm, vmNameSchema, waitForVmIp } from "./vms.js";

export const localSshAccessTool = defineTool({
  name: "local_ssh_access",
  config: {
    title: "Prepare SSH access to a local VM",
    description:
      "Install an SSH public key into a running local VM's authorized_keys (via anka run) " +
      "and return the VM's SSH endpoint. Requires ssh_public_key_base64. Connect with " +
      "the matching private key you generated locally.",
    inputSchema: {
      name: vmNameSchema.describe("Name or uuid of the running VM to access."),
      ssh_public_key_base64: z
        .string()
        .trim()
        .min(1)
        .max(8192)
        .optional()
        .describe(
          "Base64-encoded OpenSSH public key line to install on the VM (for example " +
            "base64 -w0 < ./anka_vm_key.pub). Required."
        )
    },
    annotations: { title: "Prepare SSH access to a local VM" }
  },
  handler: async ({ name, ssh_public_key_base64 }) => {
    const shown = await showVm(name);
    if (!shown.ok) {
      return jsonResult({ ok: false, error: shown.error }, true);
    }
    if (shown.info.status !== "running") {
      return jsonResult({ ok: false, error: `VM "${name}" is not running; start it first.` }, true);
    }

    if (!ssh_public_key_base64) {
      return jsonResult(
        {
          ok: false,
          error:
            "ssh_public_key_base64 is required. Generate an SSH keypair on the agent, " +
            "base64-encode the public key line, and pass it to local_ssh_access.",
          ssh_key_instructions: SSH_PUBLIC_KEY_INSTRUCTIONS
        },
        true
      );
    }

    let publicKeyLine: string;
    try {
      publicKeyLine = decodeSshPublicKeyBase64(ssh_public_key_base64);
    } catch (error) {
      return jsonResult(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        true
      );
    }

    let ip = shown.info.ip;
    if (!ip) {
      const waited = await waitForVmIp(name);
      if (!waited.found) {
        return jsonResult({ ok: false, error: waited.error }, true);
      }
      ip = waited.ip;
    }

    const installScript = buildAuthorizedKeysStartupScript(publicKeyLine);
    const install = await runAnka(["run", name, "sh", "-c", installScript], {
      machineReadable: false
    });
    if (!install.ok) {
      return jsonResult({ ok: false, error: `Installing the key failed: ${ankaError(install)}` }, true);
    }

    return jsonResult({
      ok: true,
      ip,
      port: config.vmSshGuestPort,
      user: config.vmSshUser
    });
  }
});
