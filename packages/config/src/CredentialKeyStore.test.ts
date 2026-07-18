import { describe, expect, it, vi } from "vitest";
import { MacOSKeychainKeyStore } from "./CredentialKeyStore.js";

describe("MacOSKeychainKeyStore", () => {
  it("uses bounded security CLI arguments without exposing output", () => {
    const key = Buffer.alloc(32, 9);
    const run = vi.fn().mockReturnValue(`${key.toString("base64")}\n`);
    const store = new MacOSKeychainKeyStore({ run });

    expect(store.load()).toEqual(key);
    store.store(key);
    store.delete();

    expect(run.mock.calls[0]?.[0]).toBe("security");
    expect(run.mock.calls[0]?.[1]).toEqual([
      "find-generic-password",
      "-a",
      "master-key",
      "-s",
      "dev.hephaestus.orbit.credentials",
      "-w",
    ]);
    expect(run.mock.calls[1]?.[1]).toContain("add-generic-password");
    expect(run.mock.calls[2]?.[1]).toContain("delete-generic-password");
  });

  it("treats a missing item as an idempotent result", () => {
    const missing = Object.assign(new Error("missing"), { status: 44 });
    const run = vi.fn().mockImplementation(() => {
      throw missing;
    });
    const store = new MacOSKeychainKeyStore({ run });

    expect(store.load()).toBeNull();
    expect(() => store.delete()).not.toThrow();
  });

  it("does not hide unexpected Keychain failures", () => {
    const store = new MacOSKeychainKeyStore({
      run: () => {
        throw Object.assign(new Error("locked"), { status: 1 });
      },
    });

    expect(() => store.load()).toThrow("Unable to read");
    expect(() => store.delete()).toThrow("Unable to remove");
  });
});
