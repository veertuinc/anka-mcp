import express, { type Application } from "express";
import { getPackageVersion } from "../version.js";

/** Unauthenticated health/status route for load balancers and probes. */
export function registerStatusRoute(app: Application): void {
  app.get("/status", (_req, res) => {
    res.json({ version: getPackageVersion() });
  });
}
