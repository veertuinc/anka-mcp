import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | undefined;

/** Read the package version from package.json (cached after first call). */
export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  cachedVersion = packageJson.version;
  return cachedVersion;
}
