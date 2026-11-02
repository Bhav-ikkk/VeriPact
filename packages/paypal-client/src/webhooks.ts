/**
 * @veripact/paypal-client webhook signature verification.
 *
 * All 7 OpenAPI-required fields (paypal-api-context skill, with spec
 * maxLengths) must be present and well-formed before the call is made;
 * `verified` is true if and only if `verification_status === "SUCCESS"`.
 */
import type { PayPalApi, TransportMode } from './oauth';

/** The 7 required `verify-webhook-signature` fields. */
export interface WebhookVerifyInput {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  webhookEvent: unknown;
}

/** Verification verdict (both transports). */
export interface WebhookVerifyResult {
  transportMode: TransportMode;
  verified: boolean;
  status: 'SUCCESS' | 'FAILURE';
}

const MAX_LENGTHS: Array<{ key: keyof Omit<WebhookVerifyInput, 'webhookEvent'>; max: number }> = [
  { key: 'authAlgo', max: 100 },
  { key: 'certUrl', max: 500 },
  { key: 'transmissionId', max: 50 },
  { key: 'transmissionSig', max: 500 },
  { key: 'transmissionTime', max: 100 },
  { key: 'webhookId', max: 50 },
];

/**
 * Verify a PayPal webhook delivery. Field presence, string shape, and spec
 * maxLengths are enforced pre-transport; the verdict comes strictly from
 * the API's `verification_status`.
 */
export async function verifyPayPalWebhookSignature(
  api: PayPalApi,
  input: WebhookVerifyInput,
): Promise<WebhookVerifyResult> {
  for (const { key, max } of MAX_LENGTHS) {
    const value = input[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`paypal: webhook verification requires non-empty ${key}`);
    }
    if (value.length > max) {
      throw new Error(`paypal: webhook field ${key} exceeds maxLength ${max}`);
    }
  }
  if (input.webhookEvent === null || typeof input.webhookEvent !== 'object') {
    throw new Error('paypal: webhook verification requires a webhook_event object');
  }
  const { data } = await api.request<{ verification_status?: string }>(
    'POST',
    '/v1/notifications/verify-webhook-signature',
    {
      auth_algo: input.authAlgo,
      cert_url: input.certUrl,
      transmission_id: input.transmissionId,
      transmission_sig: input.transmissionSig,
      transmission_time: input.transmissionTime,
      webhook_id: input.webhookId,
      webhook_event: input.webhookEvent,
    },
  );
  const status = data.verification_status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
  return { transportMode: api.transportMode, verified: status === 'SUCCESS', status };
}
