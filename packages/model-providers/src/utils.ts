function withDescription(schema: any, json: any): any {
  const description = schema?.description || schema?._def?.description;
  return description ? { ...json, description } : json;
}

function numberSchemaToJson(schema: any, def: any): any {
  const checks = Array.isArray(def.checks) ? def.checks : [];
  const json: Record<string, unknown> = {
    type: checks.some((check: any) => check.kind === "int")
      ? "integer"
      : "number",
  };

  for (const check of checks) {
    if (check.kind === "min") {
      json.minimum = check.value;
    } else if (check.kind === "max") {
      json.maximum = check.value;
    }
  }

  return withDescription(schema, json);
}

function stringSchemaToJson(schema: any, def: any): any {
  const checks = Array.isArray(def.checks) ? def.checks : [];
  const json: Record<string, unknown> = { type: "string" };

  for (const check of checks) {
    if (check.kind === "min") {
      json.minLength = check.value;
    } else if (check.kind === "max") {
      json.maxLength = check.value;
    }
  }

  return withDescription(schema, json);
}

function isOptionalLike(schema: any): boolean {
  let current = schema;
  while (current?._def) {
    const typeName = current._def.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
      return true;
    }
    current = current._def.innerType || current._def.schema;
  }
  return false;
}

export function zodToJsonSchema(schema: any): any {
  if (!schema || !schema._def) return { type: "object" };
  const def = schema._def;
  const typeName = def.typeName;

  switch (typeName) {
    case "ZodObject": {
      const shape = def.shape();
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const key of Object.keys(shape)) {
        const propertySchema = shape[key];
        properties[key] = zodToJsonSchema(propertySchema);

        if (!isOptionalLike(propertySchema)) {
          required.push(key);
        }
      }

      return withDescription(schema, {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      });
    }
    case "ZodString":
      return stringSchemaToJson(schema, def);
    case "ZodNumber":
      return numberSchemaToJson(schema, def);
    case "ZodBoolean":
      return withDescription(schema, { type: "boolean" });
    case "ZodEnum":
      return withDescription(schema, { type: "string", enum: def.values });
    case "ZodNativeEnum": {
      const values = Object.values(def.values).filter(
        (value) => typeof value === "string" || typeof value === "number",
      );
      return withDescription(schema, {
        type: values.every((value) => typeof value === "number")
          ? "number"
          : "string",
        enum: values,
      });
    }
    case "ZodLiteral":
      return withDescription(schema, {
        type: typeof def.value,
        enum: [def.value],
      });
    case "ZodArray":
      return withDescription(schema, {
        type: "array",
        items: zodToJsonSchema(def.type),
      });
    case "ZodRecord":
      return withDescription(schema, {
        type: "object",
        additionalProperties: zodToJsonSchema(def.valueType),
      });
    case "ZodUnion":
      return withDescription(schema, {
        anyOf: def.options.map((option: any) => zodToJsonSchema(option)),
      });
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return withDescription(schema, zodToJsonSchema(def.innerType));
    case "ZodEffects":
      return withDescription(schema, zodToJsonSchema(def.schema));
    default:
      return withDescription(schema, { type: "string" });
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeout?: number },
  maxRetries = 3,
): Promise<Response> {
  const timeoutMs = init.timeout ?? 60000;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const signal = controller.signal;
    let retryResponse: Response | undefined;

    let externalSignalAborted = false;
    const onExternalAbort = () => {
      externalSignalAborted = true;
      controller.abort();
    };

    if (init.signal) {
      if (init.signal.aborted) {
        throw (
          init.signal.reason ||
          new DOMException("The user aborted a request.", "AbortError")
        );
      }
      init.signal.addEventListener("abort", onExternalAbort);
    }

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeoutId.unref?.();

    try {
      const response = await fetch(url, {
        ...init,
        signal,
      });

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const isTransient = status === 429 || (status >= 500 && status <= 504);
      if (!isTransient || attempt >= maxRetries) {
        return response;
      }
      retryResponse = response;
      await response.body?.cancel();
    } catch (err: any) {
      const isExternalAbort = externalSignalAborted || init.signal?.aborted;
      if (isExternalAbort) {
        throw err;
      }

      const isTimeout = err.name === "AbortError" && !isExternalAbort;
      if (isTimeout) {
        if (attempt >= maxRetries) {
          throw new DOMException("Request timed out", "TimeoutError");
        }
      } else {
        if (attempt >= maxRetries) {
          throw err;
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (init.signal) {
        init.signal.removeEventListener("abort", onExternalAbort);
      }
    }

    attempt++;
    const delay = getRetryDelayMs(retryResponse, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

const MAX_RETRY_AFTER_MS = 10000;

function getRetryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = parseRetryAfterMs(response?.headers.get("retry-after"));
  if (retryAfter !== undefined) {
    return Math.min(MAX_RETRY_AFTER_MS, retryAfter);
  }

  return Math.min(3000, Math.pow(2, attempt) * 250 + Math.random() * 250);
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}
