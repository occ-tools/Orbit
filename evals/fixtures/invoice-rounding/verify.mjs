import assert from "node:assert/strict";
import { calculateInvoiceTotal } from "./invoice.mjs";

const lines = [
  { unitCents: 5, quantity: 1 },
  { unitCents: 5, quantity: 1 },
];
const snapshot = structuredClone(lines);
assert.equal(calculateInvoiceTotal(lines, 0.05), 11);
assert.equal(
  calculateInvoiceTotal(
    [
      { unitCents: 199, quantity: 2 },
      { unitCents: 51, quantity: 3 },
    ],
    0.0825,
  ),
  596,
);
assert.deepEqual(lines, snapshot);
