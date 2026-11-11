/**
 * Vercel Serverless entrypoint for the VeriPact workbench.
 *
 * `handleWorkbenchRequest` already accepts raw Node `IncomingMessage` /
 * `ServerResponse` objects (it streams the body itself when `bodyText` is
 * absent), so the Vercel `(req, res)` pair passes straight through with
 * zero adaptation. All dynamic paths rewrite here via `vercel.json`;
 * wallet/fleet state mirrors resolve into `os.tmpdir()` in production
 * because `/var/task` is read-only (see the VERCEL guards in
 * `resolveWalletStateFile` / `resolveFleetStateFile`).
 */
import { handleWorkbenchRequest } from '../packages/workbench/dist/index.js';

export default async function handler(req, res) {
  return handleWorkbenchRequest(req, res);
}
