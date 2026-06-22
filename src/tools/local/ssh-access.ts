import { randomUUID } from "node:crypto";
import { runAnka } from "../../anka.js";
import { config } from "../../config.js";
import { buildSshCommand, generateSshKeypair } from "../../ssh-key.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { ankaError, showVm, vmNameSchema, waitForVmIp } from "./vms.js";

export const localSshAccessTool = defineTool({
  name: "local_ssh_access",
  config: {
    title: "Prepare SSH access to a local VM",
    description:
      "Provision SSH access to a running local VM: generates a temporary SSH key, " +
      "installs the public key into the VM's authorized_keys (via anka cp + anka run), " +
      "and returns the private key path plus a ready-to-use ssh command. The VM must be " +
      "running and have Remote Login (sshd) enabled in its template.",
    inputSchema: {
      name: vmNameSchema.describe("Name or uuid of the running VM to access.")
    },
    annotations: { title: "Prepare SSH access to a local VM" }
  },
  handler: async ({ name }) => {
    const shown = await showVm(name);
    if (!shown.ok) {
      return jsonResult({ ok: false, error: shown.error }, true);
    }
    if (shown.info.status !== "running") {
      return jsonResult({ ok: false, error: `VM "${name}" is not running; start it first.` }, true);
    }

    // The VM is up but its IP may still be coming online; wait it out.
    let ip = shown.info.ip;
    if (!ip) {
      const waited = await waitForVmIp(name);
      if (!waited.found) {
        return jsonResult({ ok: false, error: waited.error }, true);
      }
      ip = waited.ip;
    }

    const { privateKeyPath } = await generateSshKeypair();

    // Copy the public key into the VM, then install it into authorized_keys.
    const remotePubPath = `/tmp/anka-mcp-${randomUUID()}.pub`;
    const copyIn = await runAnka(["cp", `${privateKeyPath}.pub`, `${name}:${remotePubPath}`], {
      machineReadable: false
    });
    if (!copyIn.ok) {
      return jsonResult({ ok: false, error: `anka cp failed: ${ankaError(copyIn)}` }, true);
    }

    const installScript =
      `set -e; mkdir -p ~/.ssh; chmod 700 ~/.ssh; ` +
      `cat ${remotePubPath} >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; ` +
      `rm -f ${remotePubPath}`;
    const install = await runAnka(["run", name, "sh", "-c", installScript], {
      machineReadable: false
    });
    if (!install.ok) {
      return jsonResult({ ok: false, error: `Installing the key failed: ${ankaError(install)}` }, true);
    }

    const port = config.vmSshGuestPort;
    const user = config.vmSshUser;
    const command = buildSshCommand({ privateKeyPath, host: ip, port, user });

    return jsonResult({
      ok: true,
      ip,
      port,
      user,
      private_key_path: privateKeyPath,
      command
    });
  }
});
