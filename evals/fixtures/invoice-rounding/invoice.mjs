export function calculateInvoiceTotal(lines, taxRate) {
  return lines.reduce(
    (total, line) =>
      total + Math.round(line.unitCents * line.quantity * (1 + taxRate)),
    0,
  );
}
