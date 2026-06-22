import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { limitActorFromRequest, logLimitReached } from "../log.js";

/** In-memory sliding-window rate limiter keyed by client identifier (typically IP). */
export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly hits = new Map<string, number[]>();

  constructor(maxRequestsPerMinute: number) {
    this.windowMs = 60_000;
    this.maxRequests = maxRequestsPerMinute;
  }

  /** Returns whether the request is allowed and the current window count after the decision. */
  allow(key: string): { allowed: boolean; count: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps);
      return { allowed: false, count: timestamps.length };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, count: timestamps.length };
  }

  get maxPerWindow(): number {
    return this.maxRequests;
  }

  /** Drop stale entries (call periodically to limit memory growth). */
  prune(): void {
    const windowStart = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const fresh = timestamps.filter((t) => t > windowStart);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }
}

/** Express middleware that enforces per-IP RPM when `MCP_RATE_LIMIT_RPM` > 0. */
export function rateLimitMiddleware(limiter: SlidingWindowRateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.rateLimitRpm <= 0) {
      next();
      return;
    }
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const { allowed, count } = limiter.allow(key);
    if (allowed) {
      next();
      return;
    }
    logLimitReached({
      limit: "MCP_RATE_LIMIT_RPM",
      configured: String(config.rateLimitRpm),
      route: req.originalUrl,
      actor: limitActorFromRequest(req),
      detail: `requests_in_window=${count}`
    });
    if (req.originalUrl.startsWith("/admin")) {
      res.status(429).json({ ok: false, error: "Too many requests" });
      return;
    }
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32003, message: "Too many requests" },
      id: null
    });
  };
}
