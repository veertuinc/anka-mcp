#!/usr/bin/env node
import { startHttp } from "./transports/http.js";

startHttp().catch((error) => {
  process.stderr.write(`anka-mcp: fatal error: ${String(error)}\n`);
  process.exit(1);
});
