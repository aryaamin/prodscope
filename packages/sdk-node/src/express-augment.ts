export {};

declare global {
  namespace Express {
    interface Request {
      /** Trace id set by `@prodscope/sdk-node` Express middleware for downstream handlers. */
      prodscopeTraceId?: string;
    }
  }
}
