import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by `apiKeyAuth` after validating the API key. */
    projectId?: string;
    projectName?: string;
  }
}
