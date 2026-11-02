/**
 * @veripact/workbench — single-process Node HTTP server (agent 04).
 * Route modules keep Rule 2 key boundaries: buyer (SELF), witness (WIT),
 * merchant (SIGN). Serves the Sequoia 2-view UI + AG Studio desk.
 */
import { startWorkbenchServer } from './server';

export { createWorkbenchServer, startWorkbenchServer } from './server';
export {
  handleWorkbenchRequest,
  MAX_BODY_BYTES,
  readRungKey,
  resetDemoState,
  ROUTES,
  securityHeaders,
  WORKBENCH_VERSION,
  type HealthPayload,
  type WorkbenchRequest,
  type WorkbenchResponse,
} from './routes';
export { renderIndexPage } from './ui-template';
export { renderStorefront } from './storefront-template';

const entrypoint = process.argv[1] ?? '';
if (entrypoint.endsWith('index.js')) {
  const port = Number(process.env['PORT'] ?? 3000);
  startWorkbenchServer(port);
  process.stdout.write(`veripact-workbench listening on :${port}\n`);
}
