import assert from "node:assert/strict";
import { mergeConfig } from "./merge.mjs";

const base = {
  provider: { name: "deepseek", headers: { region: "cn", stable: true } },
  models: ["flash"],
  retries: 2,
};
const override = {
  provider: { headers: { stable: false, tenant: "eval" } },
  models: ["pro"],
};
const baseSnapshot = structuredClone(base);
const overrideSnapshot = structuredClone(override);
const result = mergeConfig(base, override);

assert.deepEqual(result, {
  provider: {
    name: "deepseek",
    headers: { region: "cn", stable: false, tenant: "eval" },
  },
  models: ["pro"],
  retries: 2,
});
assert.notEqual(result, base);
assert.notEqual(result.provider, base.provider);
assert.notEqual(result.models, override.models);
assert.deepEqual(base, baseSnapshot);
assert.deepEqual(override, overrideSnapshot);
