import { z } from "zod";
import { config } from "../../config.js";
import { controller, isSshReady, type Instance } from "../../controller.js";
import { optionalBoundedString, uuidLike } from "../../security/schemas.js";
import {
  buildAuthorizedKeysStartupScript,
  decodeSshPublicKeyBase64,
  encodeStartupScript,
  SSH_PUBLIC_KEY_INSTRUCTIONS
} from "../../ssh-key.js";
import { buildControllerExternalId } from "../../log.js";
import { registerControllerInstance } from "../../tokens/ownership.js";
import { defineTool, jsonResult } from "../define-tool.js";
import {
  controllerVmStatusFields,
  isFailedControllerState,
  pendingControllerVmResult
} from "./status.js";
import { shouldReturnPendingFromRequest } from "../../controller.js";
import { controllerError } from "./results.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const controllerRequestVmTool = defineTool({
  name: "controller_request_vm",
  config: {
    title: "Request a VM from the controller",
    description:
      "Start one VM instance from a template on the Anka Build Cloud Controller. " +
      "Requires ssh_public_key_base64: a base64-encoded OpenSSH public key line " +
      "(ssh-ed25519 AAAA...). The key is installed on the VM via startup_script. " +
      "When SSH-ready, returns host, forwarded port, username, and ssh_connect_hint — " +
      "use that response directly; do not call controller_get_vm. " +
      "Do not SSH until status is ready; wait ~20s after ready before connecting. " +
      "If the template is still being pulled, returns status pending; then poll controller_get_vm every 30 seconds.",
    inputSchema: {
      vmid: uuidLike.describe("UUID of the template to start (from controller_list_templates)."),
      ssh_public_key_base64: z
        .string()
        .trim()
        .min(1)
        .max(8192)
        .optional()
        .describe(
          "Base64-encoded OpenSSH public key line to install on the VM (for example " +
            "base64 -w0 < ./anka_vm_key.pub). Required to start a VM."
        ),
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
  handler: async ({
    vmid,
    ssh_public_key_base64,
    tag,
    name,
    externalId,
    addSshPortForward = true
  }) => {
    try {
      if (!ssh_public_key_base64) {
        return jsonResult(
          {
            ok: false,
            error:
              "ssh_public_key_base64 is required. Generate an SSH keypair on the agent, " +
              "base64-encode the public key line, and pass it to controller_request_vm.",
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

      const startupScript = encodeStartupScript(buildAuthorizedKeysStartupScript(publicKeyLine));

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

        if (shouldReturnPendingFromRequest(instance.instance_state)) {
          return jsonResult(pendingControllerVmResult(instanceId, instance));
        }

        if (isSshReady(instance)) {
          return jsonResult(controllerVmStatusFields(instanceId, instance));
        }

        if (isFailedControllerState(instance.instance_state)) {
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

      if (instance) {
        if (isFailedControllerState(instance.instance_state)) {
          return jsonResult(
            {
              instance_id: instanceId,
              instance_state: instance.instance_state,
              error: `Instance entered terminal state "${instance.instance_state}" before becoming SSH-ready.`
            },
            true
          );
        }

        if (shouldReturnPendingFromRequest(instance.instance_state) || !isSshReady(instance)) {
          return jsonResult(pendingControllerVmResult(instanceId, instance));
        }

        return jsonResult(
          {
            instance_id: instanceId,
            instance_state: instance.instance_state,
            error: `Timed out after ${config.controllerStartTimeoutMs}ms waiting for the VM to become SSH-ready. Call controller_get_vm to keep checking or controller_terminate_vm to clean up.`
          },
          true
        );
      }

      return jsonResult(
        {
          instance_id: instanceId,
          error:
            "Timed out waiting for the VM to report its initial state. " +
            "Call controller_get_vm every 30 seconds or controller_terminate_vm to clean up."
        },
        true
      );
    } catch (error) {
      return jsonResult({ ok: false, error: controllerError(error) }, true);
    }
  }
});
