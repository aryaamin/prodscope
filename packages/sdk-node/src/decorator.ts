import { track } from "./index.js";

/**
 * Method decorator that auto-tracks a class method.
 *
 * ```ts
 * import { tracked } from "@prodscope/sdk-node";
 *
 * class QuizService {
 *   @tracked
 *   async generateQuestion(topic: string) {
 *     // automatically tracked — call count, latency, errors, mapped to this file:line
 *   }
 *
 *   @tracked
 *   async submitAnswer(questionId: string, answer: string) {
 *     // also tracked
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

  // Get the file:line from where the decorator is applied
  const err = new Error();
  const stack = err.stack ?? "";
  const frames = stack.split("\n");
  let file = "";
  let line = 0;

  // Frame 0: Error, Frame 1: tracked(), Frame 2: where @tracked is applied
  for (let i = 2; i < frames.length; i++) {
    const match = frames[i].match(/\(?(.+?):(\d+):(\d+)\)?$/);
    if (match && !match[1].includes("node_modules") && !match[1].includes("node:")) {
      const cwd = process.cwd();
      file = match[1].startsWith(cwd) ? match[1].slice(cwd.length + 1) : match[1];
      line = parseInt(match[2], 10);
      break;
    }
  }

  const name = propertyKey;
  descriptor.value = track(name, original, file, line);

  return descriptor;
}

/**
 * Standalone function wrapper — slightly cleaner than track() for one-off functions.
 *
 * ```ts
 * import { traced } from "@prodscope/sdk-node";
 *
 * export const processPayment = traced(async (orderId: string) => {
 *   // ...
 * });
 * ```
 *
 * The function name is inferred from the variable assignment.
 */
export function traced<T extends (...args: any[]) => any>(fn: T, name?: string): T {
  const fnName = name ?? fn.name ?? "anonymous";
  return track(fnName, fn);
}
