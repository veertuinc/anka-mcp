import { describe, it, expect } from "vitest";
import {
  controllerStatusPollMessage,
  isPendingControllerState
} from "../../src/controller.js";
import {
  controllerVmStatusFields,
  pendingControllerVmResult
} from "../../src/tools/controller/status.js";

describe("controller pending states", () => {
  it("detects pulling and related provisioning states", () => {
    expect(isPendingControllerState("Pulling")).toBe(true);
    expect(isPendingControllerState("Scheduling")).toBe(true);
    expect(isPendingControllerState("Started")).toBe(false);
  });

  it("builds a 30-second polling message for pulling", () => {
    expect(controllerStatusPollMessage("Pulling")).toMatch(/being pulled/i);
    expect(controllerStatusPollMessage("Pulling")).toMatch(/every 30 seconds/i);
    expect(controllerStatusPollMessage("Pulling")).toMatch(/controller_get_vm/i);
    expect(controllerStatusPollMessage("Pulling")).toMatch(/Do not attempt SSH/i);
  });

  it("returns pending fields for a pulling instance", () => {
    expect(
      pendingControllerVmResult("inst-1", {
        instance_state: "Pulling",
        vminfo: { status: "pulling" }
      })
    ).toEqual({
      instance_id: "inst-1",
      instance_state: "Pulling",
      vm_status: "pulling",
      ssh: null,
      status: "pending",
      message: controllerStatusPollMessage("Pulling")
    });
  });

  it("adds pending guidance to get_vm while SSH is unavailable", () => {
    expect(
      controllerVmStatusFields("inst-1", {
        instance_state: "Pulling",
        vminfo: { status: "pulling" }
      })
    ).toMatchObject({
      status: "pending",
      ssh: null,
      message: controllerStatusPollMessage("Pulling")
    });
  });

  it("omits pending guidance once SSH is ready", () => {
    expect(
      controllerVmStatusFields("inst-1", {
        instance_state: "Started",
        vminfo: {
          status: "running",
          host_ip: "10.0.0.5",
          port_forwarding: [{ guest_port: 22, host_port: 10005 }]
        }
      })
    ).toEqual({
      instance_id: "inst-1",
      instance_state: "Started",
      vm_status: "running",
      status: "ready",
      ssh: { host: "10.0.0.5", port: 10005, username: "anka" },
      ssh_connect_hint: expect.stringMatching(/Wait ~20 seconds/i)
    });
  });
});
