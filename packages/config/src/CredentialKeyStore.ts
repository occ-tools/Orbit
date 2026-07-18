import { execFileSync } from "child_process";
import { z } from "zod";

const EncodedCredentialKeySchema = z
  .string()
  .trim()
  .refine((value) => Buffer.from(value, "base64").length === 32);

export interface CredentialKeyStore {
  load(): Buffer | null;
  store(key: Buffer): void;
  delete(): void;
}

export type KeychainCommandRunner = (
  executable: string,
  args: string[],
) => string;

export interface MacOSKeychainKeyStoreOptions {
  service?: string;
  account?: string;
  run?: KeychainCommandRunner;
}

/** Store Orbit's encryption key in the current user's macOS Keychain. */
export class MacOSKeychainKeyStore implements CredentialKeyStore {
  private readonly service: string;
  private readonly account: string;
  private readonly run: KeychainCommandRunner;

  constructor(options: MacOSKeychainKeyStoreOptions = {}) {
    this.service = options.service ?? "dev.hephaestus.orbit.credentials";
    this.account = options.account ?? "master-key";
    this.run = options.run ?? runSecurityCommand;
  }

  public load(): Buffer | null {
    try {
      const encoded = EncodedCredentialKeySchema.parse(
        this.run("security", [
          "find-generic-password",
          "-a",
          this.account,
          "-s",
          this.service,
          "-w",
        ]),
      );
      return Buffer.from(encoded, "base64");
    } catch (error) {
      if (isMissingKeychainItem(error)) return null;
      throw new Error("Unable to read the Orbit credential key from Keychain.");
    }
  }

  public store(key: Buffer): void {
    if (key.length !== 32) {
      throw new Error("Credential key must contain exactly 32 bytes.");
    }
    this.run("security", [
      "add-generic-password",
      "-U",
      "-a",
      this.account,
      "-s",
      this.service,
      "-w",
      key.toString("base64"),
    ]);
  }

  public delete(): void {
    try {
      this.run("security", [
        "delete-generic-password",
        "-a",
        this.account,
        "-s",
        this.service,
      ]);
    } catch (error) {
      if (!isMissingKeychainItem(error)) {
        throw new Error(
          "Unable to remove the Orbit credential key from Keychain.",
        );
      }
    }
  }
}

function runSecurityCommand(executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function isMissingKeychainItem(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("status" in error && error.status === 44) ||
      ("code" in error && error.code === "ENOENT"))
  );
}
