#!/usr/bin/env node
// A fake `anka` CLI used by the test suite so the local backend can be exercised
// without a real Anka install. Behavior is tuned via env vars:
//   FAKE_ANKA_LOG          - append each invocation's argv (JSON) to this file
//   FAKE_ANKA_RUNNING      - number of extra "running" VMs reported by `list`
//   FAKE_ANKA_RUNNING_VM   - name that `show` reports as running (with an IP)
//   FAKE_ANKA_FAIL         - command name that should exit non-zero with an error
//   FAKE_ANKA_IP_AFTER     - number of `show` polls reporting running-without-IP
//                            before the IP appears (requires FAKE_ANKA_COUNT_FILE)
//   FAKE_ANKA_COUNT_FILE   - file used to persist the `show` poll counter
import fs from "node:fs";

const argv = process.argv.slice(2);

if (process.env.FAKE_ANKA_LOG) {
  fs.appendFileSync(process.env.FAKE_ANKA_LOG, JSON.stringify(argv) + "\n");
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj));
const ok = (body) => {
  emit({ status: "OK", message: "", body });
  process.exit(0);
};
const fail = (message, code = 1) => {
  emit({ status: "ERROR", message });
  process.exit(code);
};

if (argv[0] === "--version") {
  process.stdout.write("Anka fake 1.0\n");
  process.exit(0);
}

let args = argv;
if (args[0] === "-j") args = args.slice(1);
const cmd = args[0];

if (process.env.FAKE_ANKA_FAIL && process.env.FAKE_ANKA_FAIL === cmd) {
  fail(`simulated failure for ${cmd}`);
}

switch (cmd) {
  case "list": {
    const running = Number.parseInt(process.env.FAKE_ANKA_RUNNING || "0", 10);
    const vms = [
      { name: "base-template", uuid: "uuid-base", status: "stopped" },
      { name: "other", uuid: "uuid-other", version: "v1", status: "stopped" }
    ];
    for (let i = 0; i < running; i += 1) {
      vms.push({ name: `running-${i}`, uuid: `uuid-run-${i}`, status: "running" });
    }
    ok(vms);
    break;
  }
  case "show": {
    const name = args[1];
    if (name === "missing") fail(`VM ${name} not found`);
    if (name === process.env.FAKE_ANKA_RUNNING_VM) {
      const ipAfter = Number.parseInt(process.env.FAKE_ANKA_IP_AFTER || "0", 10);
      if (ipAfter > 0 && process.env.FAKE_ANKA_COUNT_FILE) {
        let count = 0;
        try {
          count = Number.parseInt(fs.readFileSync(process.env.FAKE_ANKA_COUNT_FILE, "utf8"), 10) || 0;
        } catch {
          count = 0;
        }
        count += 1;
        fs.writeFileSync(process.env.FAKE_ANKA_COUNT_FILE, String(count));
        if (count <= ipAfter) {
          ok({ uuid: "uuid-x", name, status: "running", port_forwarding: [] });
        }
      }
      ok({ uuid: "uuid-x", name, status: "running", ip: "192.168.64.50", port_forwarding: [] });
    }
    ok({ uuid: "uuid-x", name, status: "stopped" });
    break;
  }
  case "clone":
    ok({ uuid: "uuid-clone", name: args[2] });
    break;
  case "start":
    ok({});
    break;
  case "delete": // delete --yes <name>
    ok({});
    break;
  case "cp":
    process.exit(0);
    break;
  case "run":
    process.exit(0);
    break;
  default:
    fail(`unknown command: ${cmd}`);
}
