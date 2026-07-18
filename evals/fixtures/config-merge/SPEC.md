# Configuration merge specification

Implement `mergeConfig(base, override)` with these rules:

- Return a new value and never mutate either input.
- Recursively merge plain objects.
- Arrays replace the previous array; they are not concatenated or merged.
- Primitive values from `override` replace values from `base`.
- Keys present only in either input remain in the result.
