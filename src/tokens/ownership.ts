import { getRequestContext } from "../log.js";
import { getTokenStore } from "./store.js";

const SKIP_OWNERSHIP_CREDENTIAL_IDS = new Set(["anonymous"]);

/** Require the current MCP credential to own the given controller instance. */
export function requireControllerInstanceAccess(instanceId: string): void {
  const ctx = getRequestContext();
  if (!ctx?.credentialId) {
    throw new Error("Missing credential context");
  }
  if (SKIP_OWNERSHIP_CREDENTIAL_IDS.has(ctx.credentialId)) {
    return;
  }
  getTokenStore().assertInstanceOwned(ctx.credentialId, instanceId);
}

/** Register a newly created controller instance under the current MCP credential. */
export function registerControllerInstance(instanceId: string): void {
  const ctx = getRequestContext();
  if (!ctx?.credentialId || SKIP_OWNERSHIP_CREDENTIAL_IDS.has(ctx.credentialId)) {
    return;
  }
  getTokenStore().registerInstance(ctx.credentialId, instanceId);
}

/** Remove instance ownership after successful termination. */
export function releaseControllerInstance(instanceId: string): void {
  const ctx = getRequestContext();
  if (!ctx?.credentialId || SKIP_OWNERSHIP_CREDENTIAL_IDS.has(ctx.credentialId)) {
    return;
  }
  getTokenStore().releaseInstance(ctx.credentialId, instanceId);
}
