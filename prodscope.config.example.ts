export default {
  projectId: "your-project-id",
  apiKey: process.env.PRODSCOPE_API_KEY,
  ingestUrl: "https://ingest.prodscope.dev",
  apiUrl: "https://api.prodscope.dev",
  capture: {
    clicks: true,
    fetches: true,
    errors: true,
    dbQueries: true,
    functions: true,
  },
};
