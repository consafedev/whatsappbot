import type { Prisma } from "./generated/prisma/client";

export type JsonObjectFailure =
  | "root"
  | "depth"
  | "value"
  | "cycle"
  | "array"
  | "accessor"
  | "prototype"
  | "hidden"
  | "unsafe-key"
  | "serializable"
  | "invalid-json"
  | "size";

export type JsonObjectOptions = Readonly<{
  depthLimit: number;
  byteLimit: number;
  forbiddenKeys: ReadonlySet<string>;
  fail: (reason: JsonObjectFailure) => Error;
}>;

export function normalizeJsonObject(
  value: unknown,
  options: JsonObjectOptions,
): Prisma.InputJsonObject | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw options.fail("root");
  }

  const seen = new WeakSet<object>();
  const visit = (current: unknown, depth: number): void => {
    if (depth > options.depthLimit) throw options.fail("depth");
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current))
    )
      return;
    if (typeof current !== "object") throw options.fail("value");
    if (seen.has(current)) throw options.fail("cycle");
    seen.add(current);

    if (Array.isArray(current)) {
      const keys = Reflect.ownKeys(current);
      if (
        keys.length !== current.length + 1 ||
        keys.some((key) => key !== "length" && typeof key !== "string")
      ) {
        throw options.fail("array");
      }
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(current, index)) throw options.fail("array");
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
          throw options.fail("accessor");
        visit(descriptor.value, depth + 1);
      }
      seen.delete(current);
      return;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw options.fail("prototype");
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw options.fail("hidden");
      }
      if (options.forbiddenKeys.has(key)) throw options.fail("unsafe-key");
      visit(descriptor.value, depth + 1);
    }
    seen.delete(current);
  };

  visit(value, 1);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw options.fail("serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > options.byteLimit) throw options.fail("size");
  let clone: unknown;
  try {
    clone = JSON.parse(serialized) as unknown;
  } catch {
    throw options.fail("invalid-json");
  }
  if (clone === null || typeof clone !== "object" || Array.isArray(clone))
    throw options.fail("root");
  return clone as Prisma.InputJsonObject;
}
