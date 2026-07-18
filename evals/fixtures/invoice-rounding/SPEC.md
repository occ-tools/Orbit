# Invoice total specification

`calculateInvoiceTotal(lines, taxRate)` returns the integer number of cents to
charge. Each line contains integer `unitCents` and `quantity` values. Sum the
line subtotals first, calculate tax on that subtotal, round tax to the nearest
cent once, and then add it to the subtotal. Inputs must not be mutated.
