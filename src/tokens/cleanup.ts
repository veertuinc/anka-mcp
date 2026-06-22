import { config } from "../config.js";
import { controller } from "../controller.js";
import { getTokenStore } from "./store.js";

export interface CleanupResult {
  terminated: string[];
  failed: { instance_id: string; error: string }[];
  skipped?: string;
}

/** Best-effort terminate all controller instances owned by a revoked credential. */
export async function cleanupCredentialInstances(
  credentialId: string,
  instanceIds: string[]
): Promise<CleanupResult> {
  if (!config.revokeCleanupEnabled) {
    return { terminated: [], failed: [] };
  }

  if (!config.controllerEnabled) {
    getTokenStore().deleteInstancesForCredential(credentialId);
    return { terminated: [], failed: [], skipped: "controller disabled" };
  }

  const terminated: string[] = [];
  const failed: { instance_id: string; error: string }[] = [];
  const store = getTokenStore();

  for (const instanceId of instanceIds) {
    try {
      await controller.terminateVm(instanceId);
      store.releaseInstance(credentialId, instanceId);
      terminated.push(instanceId);
    } catch (error) {
      failed.push({ instance_id: instanceId, error: String(error) });
    }
  }

  return { terminated, failed };
}
