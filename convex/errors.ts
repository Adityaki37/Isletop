import { ConvexError } from "convex/values";
export function fail(message: string, status = 400): never {
  throw new ConvexError({ message, status });
}
