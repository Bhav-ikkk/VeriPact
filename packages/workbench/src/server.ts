/**
 * @veripact/workbench single-process HTTP server (agent 04).
 * Thin listener over `handleWorkbenchRequest` — all routing lives in
 * `routes.ts` so tests can drive it without binding sockets.
 */
import { createServer, type Server } from 'node:http';
import { handleWorkbenchRequest } from './routes';

/** Build the workbench server wired to `handleWorkbenchRequest`. */
export function createWorkbenchServer(): Server {
  return createServer((req, res) => {
    handleWorkbenchRequest(req, res).catch((e: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'internal error' }));
    });
  });
}

/** Listen on a port (used by the `render.yaml` start command and local dev). */
export function startWorkbenchServer(port: number): Server {
  const server = createWorkbenchServer();
  server.listen(port);
  return server;
}
