/**
 * Bun annotate server: drafts follow the file (annotate-draft.ts). The
 * scenarios live in annotate-draft.scenarios.ts.
 */
import { defineAnnotateDraftScenarios } from "./annotate-draft.scenarios";
import { startAnnotateServer } from "./annotate";

defineAnnotateDraftScenarios("bun", async (options) => {
  const server = await startAnnotateServer({
    ...options,
    htmlContent: "<html><body>Plannotator</body></html>",
  });
  return { url: server.url, stop: server.stop };
});
