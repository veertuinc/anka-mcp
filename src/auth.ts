import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { getTokenStore, LEGACY_CREDENTIAL_ID } from "./tokens/store.js";

export interface ResolvedMcpCredential {
  credentialId: string;
  credentialLabel?: string;
}

/** Constant-time string comparison that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Resolve a bearer token to an MCP client credential identity, or null when invalid. */
export function resolveMcpCredential(bearerToken: string): ResolvedMcpCredential | null {
  if (config.allowNoAuth) {
    return { credentialId: "anonymous" };
  }

  if (!bearerToken) return null;

  if (config.authToken && safeEqual(bearerToken, config.authToken)) {
    return { credentialId: LEGACY_CREDENTIAL_ID, credentialLabel: "legacy" };
  }

  const validated = getTokenStore().validateToken(bearerToken);
  if (validated) {
    return { credentialId: validated.id, credentialLabel: validated.label || undefined };
  }

  return null;
}

/** Whether the server has any configured MCP client authentication path. */
export function isMcpAuthConfigured(): boolean {
  if (config.allowNoAuth) return true;
  if (config.authToken) return true;
  if (config.adminToken) return true;
  try {
    return getTokenStore().hasActiveTokens();
  } catch {
    return false;
  }
}
