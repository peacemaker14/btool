import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { resolve } from "node:path";
import { createStore } from "./store";
import { createLibraryRoutes } from "./library";
import { createGenerationRoutes } from "./generation";
import { previewFetch } from "./preview";
import { ZodError } from "zod";
import { InputError } from "./validation";
import { networkConfig, requestOriginError } from "./network";
const port = Number(process.env.PORT || 4317);
const previewPort = Number(process.env.PREVIEW_PORT || 4328);
const store = createStore(resolve(process.env.DATA_DIR || ".data"));
const network = networkConfig();
const app = new Hono();
app.use("*", async (c, next) => {
  const error = requestOriginError(c.req.raw, network);
  if (error) return c.json({ error }, 403);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  await next();
});
app.route("/api", createLibraryRoutes(store));
app.route("/api", createGenerationRoutes(store));
app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((error, c) => {
  if (error instanceof InputError)
    return c.json({ error: error.message }, error.status);
  if (error instanceof ZodError) {
    const details = error.issues
      .map((issue) => issue.path.join(".") + ": " + issue.message)
      .join("; ");
    return c.json({ error: details }, 400);
  }
  console.error("Btools request failed:", error.name);
  return c.json(
    {
      error:
        "Request failed unexpectedly. Check the local server and try again.",
    },
    500,
  );
});
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
  maxRequestBodySize: 256 * 1024 * 1024,
  idleTimeout: 120,
});
const previewServer = Bun.serve({
  hostname: "127.0.0.1",
  port: previewPort,
  fetch: previewFetch,
});
console.log("Btools API: http://127.0.0.1:" + server.port);
console.log("Isolated previews: http://127.0.0.1:" + previewServer.port);
function stop() {
  server.stop(true);
  previewServer.stop(true);
  store.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
