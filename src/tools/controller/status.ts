import {
  controllerStatusPollMessage,
  extractSshEndpoint,
  isPendingControllerState,
  isSshReady,
  type Instance
} from "../../controller.js";

/** Instance states that mean the VM will never become ready. */
export const FAILED_CONTROLLER_STATES = new Set([
  "Error",
  "Failed",
  "Terminated",
  "Terminating",
  "Stopped"
]);

export function isFailedControllerState(state: string | undefined): boolean {
  return !!state && FAILED_CONTROLLER_STATES.has(state);
}

/** Build the narrow tool payload while a controller VM is still provisioning. */
export function pendingControllerVmResult(instanceId: string, instance: Instance) {
  return {
    instance_id: instanceId,
    instance_state: instance.instance_state,
    vm_status: instance.vminfo?.status ?? null,
    ssh: null,
    status: "pending" as const,
    message: controllerStatusPollMessage(instance.instance_state)
  };
}

/** Add pending polling guidance when SSH is not yet available. */
export function controllerVmStatusFields(instanceId: string, instance: Instance) {
  const ssh = extractSshEndpoint(instance.vminfo) ?? null;
  const fields: Record<string, unknown> = {
    instance_id: instanceId,
    instance_state: instance.instance_state,
    vm_status: instance.vminfo?.status ?? null,
    ssh
  };

  if (isSshReady(instance)) {
    fields.status = "ready";
  } else if (!isFailedControllerState(instance.instance_state)) {
    fields.status = "pending";
    fields.message = controllerStatusPollMessage(instance.instance_state);
  }

  return fields;
}

export { isPendingControllerState, isSshReady };
