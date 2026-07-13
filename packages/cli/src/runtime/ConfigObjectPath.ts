function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const blockedSegments = new Set(["__proto__", "prototype", "constructor"]);

function parsePath(path: string): string[] | null {
  const parts = path.split(".");
  if (parts.some((part) => part.length === 0 || blockedSegments.has(part))) {
    return null;
  }
  return parts;
}

/** Reads a dot-delimited property without throwing on missing intermediate data. */
export function getNestedProperty(root: unknown, path: string): unknown {
  const parts = parsePath(path);
  if (!parts) return undefined;
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

/** Writes a dot-delimited property, creating missing object containers. */
export function setNestedProperty(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = parsePath(path);
  if (!parts) throw new Error(`Unsafe configuration path: ${path}`);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isRecord(child)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1) ?? path] = value;
}
