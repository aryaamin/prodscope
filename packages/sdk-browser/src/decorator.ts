import { track } from "./index.js";
import { captureCallSite } from "./callsite.js";

/**
 * Method decorator that auto-tracks a class method.
 *
 * ```ts
 * import { tracked } from "@prodscope/sdk-browser";
 *
 * class CartService {
 *   @tracked
 *   async addToCart(productId: string) {
 *     // automatically tracked
 *   }
 * }
 * ```
 */
export function tracked(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  const original = descriptor.value;
  if (typeof original !== "function") return descriptor;

  const site = captureCallSite(0);
  const name = propertyKey;
  descriptor.value = track(name, original, site?.file ?? "", site?.line ?? 0);

  return descriptor;
}

/**
 * Standalone function wrapper with auto name inference.
 *
 * ```ts
 * import { traced } from "@prodscope/sdk-browser";
 *
 * export const fetchProducts = traced(async () => {
 *   // ...
 * });
 * ```
 */
export function traced<T extends (...args: any[]) => any>(fn: T, name?: string): T {
  const fnName = name ?? fn.name ?? "anonymous";
  return track(fnName, fn);
}
