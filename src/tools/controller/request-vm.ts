import { z } from "zod";
import { config } from "../../config.js";
import { controller, extractSshEndpoint, isSshReady, type Instance } from "../../controller.js";
import { optionalBoundedString, uuidLike } from "../../security/schemas.js";
import {
  buildAuthorizedKeysStartupScript,
  buildSshCommand,
  encodeStartupScript,
  generateSshKeypair,
  probeSshAuth
} from "../../ssh-key.js";
import { buildControllerExternalId } from "../../log.js";
import {
  registerControllerInstance
} from "../../tokens/ownership.js";
import { defineTool, jsonResult } from "../define-tool.js";
import { controllerError } from "./results.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Instance states that mean the VM will never become ready. */
const FAILED_STATES = new Set(["Error", "Failed", "Terminated", "Terminating", "Stopped"]);

export const controllerRequestVmTool = defineTool({
  name: "controller_request_vm",
  config: {
    title: "Request a VM from the controller",
    description:
      "Start one VM instance from a template on the Anka Build Cloud Controller, wait " +
      "until it is running and the temporary SSH key authenticates over the forwarded port, " +
      "then return the connection details (host, forwarded SSH port, username, private key path, " +
      "ssh command). A temporary ed25519 key is generated and installed on the VM via the " +
      "controller startup_script. The template must have port forwarding for the SSH guest port " +
      "(default 22), or set addSshPortForward to add it. The agent then opens the SSH connection itself.",
    inputSchema: {
      vmid: uuidLike.describe("UUID of the template to start (from controller_list_templates)."),
      tag: optionalBoundedString.optional().describe("Optional template tag. Defaults to the latest tag."),
      name: optionalBoundedString.optional().describe("Optional name for the instance."),
      externalId: optionalBoundedString
        .optional()
        .describe(
          "Optional extra reference appended to the auto-generated external_id " +
            "(which always records MCP client, IP, user-agent, and session)."
        ),
      addSshPortForward: z
        .boolean()
        .optional()
        .describe(
          "Add an SSH port-forward rule even if the template lacks one. Defaults to true."
        )
    },
    annotations: { title: "Request a VM from the controller", openWorldHint: true }
  },
  handler: async ({ vmid, tag, name, externalId, addSshPortForward = true }) => {
    try {
    const { privateKeyPath, publicKey } = await generateSshKeypair();
    const startupScript = encodeStartupScript(buildAuthorizedKeysStartupScript(publicKey));

    const instanceId = await controller.startVm({
      vmid,
      tag,
      name,
      externalId: buildControllerExternalId(externalId),
      addSshPortForward,
      startupScript
    });
    registerControllerInstance(instanceId);

    const deadline = Date.now() + config.controllerStartTimeoutMs;
    let instance: Instance | undefined;

    while (Date.now() < deadline) {
      instance = await controller.getVm(instanceId);

      if (isSshReady(instance)) {
        const endpoint = extractSshEndpoint(instance.vminfo)!;
        const sshVerified =
          !config.controllerSshProbeEnabled ||
          (await probeSshAuth({
            privateKeyPath,
            host: endpoint.host,
            port: endpoint.port,
            user: endpoint.username
          }));
        if (sshVerified) {
          return jsonResult({
            instance_id: instanceId,
            instance_state: instance.instance_state,
            ssh: {
              ...endpoint,
              private_key_path: privateKeyPath,
              command: buildSshCommand({
                privateKeyPath,
                host: endpoint.host,
                port: endpoint.port,
                user: endpoint.username
              })
            }
          });
        }
      }

      if (instance.instance_state && FAILED_STATES.has(instance.instance_state)) {
        return jsonResult(
          {
            instance_id: instanceId,
            instance_state: instance.instance_state,
            error: `Instance entered terminal state "${instance.instance_state}" before becoming SSH-ready.`
          },
          true
        );
      }

      await sleep(config.controllerPollIntervalMs);
    }

    return jsonResult(
      {
        instance_id: instanceId,
        instance_state: instance?.instance_state,
        error: `Timed out after ${config.controllerStartTimeoutMs}ms waiting for the VM to become SSH-ready. The instance was started; use controller_get_vm to keep checking or controller_terminate_vm to clean up.`
      },
      true
    );
    } catch (error) {
      return jsonResult({ ok: false, error: controllerError(error) }, true);
    }
  }
});
