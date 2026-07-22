import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  applyManagedPolicy,
  ManagedPolicySchema,
  validateManagedRuntimeChange,
} from "./ManagedPolicy.js";

describe("managed policy", () => {
  it("applies non-bypassable provider, model, permission, tool, and budget limits", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.mode = "auto";
    config.permissions.requireApprovalForWrite = false;
    config.permissions.requireApprovalForBash = false;
    config.permissions.protectedPaths = [".git"];
    config.budgetLimit = 100;
    config.agent.maxIterations = 50;
    const policy = ManagedPolicySchema.parse({
      schemaVersion: 1,
      allowedProviders: ["deepseek-openai"],
      allowedModels: ["deepseek-v4-pro"],
      minimumPermissionMode: "strict",
      disableWebSearch: true,
      disableMcp: true,
      maxBudgetUsd: 2,
      maxIterations: 4,
      protectedPaths: ["secrets/**"],
    });

    const result = applyManagedPolicy(config, policy);

    expect(Object.keys(result.providers)).toEqual(["deepseek-openai"]);
    expect(result.models.default).toBe("deepseek-v4-pro");
    expect(result.permissions).toMatchObject({
      mode: "strict",
      requireApprovalForWrite: true,
      requireApprovalForBash: true,
    });
    expect(result.permissions.protectedPaths).toEqual([".git", "secrets/**"]);
    expect(result.tools.webSearch.enabled).toBe(false);
    expect(result.tools.mcp.enabled).toBe(false);
    expect(result.budgetLimit).toBe(2);
    expect(result.agent.maxIterations).toBe(4);
    expect(
      validateManagedRuntimeChange(result, { permissionMode: "auto" }),
    ).toContain("requires strict");
    expect(
      validateManagedRuntimeChange(result, { model: "unapproved-model" }),
    ).toContain("does not allow model");
    expect(
      validateManagedRuntimeChange(result, { webSearchEnabled: true }),
    ).toContain("disables web search");
    expect(
      validateManagedRuntimeChange(result, {
        model: "deepseek-v4-pro",
        permissionMode: "plan",
      }),
    ).toBeUndefined();
  });

  it("fails closed when no configured provider is permitted", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const policy = ManagedPolicySchema.parse({
      schemaVersion: 1,
      allowedProviders: ["missing-provider"],
    });

    expect(() => applyManagedPolicy(config, policy)).toThrow(
      "does not allow any configured model provider",
    );
  });
});
