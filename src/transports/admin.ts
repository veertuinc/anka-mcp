import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import { config } from "../config.js";
import { clientSourceFromRequest, logAdminEvent, logAuthFailure } from "../log.js";
import { cleanupCredentialInstances } from "../tokens/cleanup.js";
import { getTokenStore } from "../tokens/store.js";

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token || !safeEqual(token, config.adminToken)) {
    logAuthFailure(clientSourceFromRequest(req), "/admin");
    res
      .status(401)
      .set("WWW-Authenticate", "Bearer")
      .json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
}

/** Register admin routes for client token lifecycle management. */
export function registerAdminRoutes(
  app: express.Application,
  rateLimit: (req: Request, res: Response, next: NextFunction) => void
): void {
  if (!config.adminToken) return;

  const router = Router();
  router.use(express.json({ limit: config.maxBodyBytes }));
  router.use(rateLimit);
  router.use(adminGuard);

  router.post("/tokens", (req: Request, res: Response) => {
    const label = typeof req.body?.label === "string" ? req.body.label : "";
    const created = getTokenStore().createToken(label);
    logAdminEvent("token created", { id: created.id, label: created.label });
    res.status(201).json({ ok: true, id: created.id, label: created.label, token: created.token });
  });

  router.get("/tokens", (_req: Request, res: Response) => {
    const tokens = getTokenStore().listTokens();
    res.json({ tokens });
  });

  router.delete("/tokens/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const existing = getTokenStore().getTokenById(id);
    if (!existing) {
      res.status(404).json({ ok: false, error: `Token not found: ${id}` });
      return;
    }
    if (existing.revoked) {
      res.status(400).json({ ok: false, error: `Token already revoked: ${id}` });
      return;
    }

    let instanceIds: string[] = [];
    try {
      ({ instanceIds } = getTokenStore().revokeToken(id));
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
      return;
    }

    logAdminEvent("token revoked", { id, label: existing.label });
    const cleanup = await cleanupCredentialInstances(id, instanceIds);
    res.json({ ok: true, id, revoked: true, cleanup });
  });

  app.use("/admin", router);
}
