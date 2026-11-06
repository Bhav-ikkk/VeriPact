/**
 * @veripact/paypal-client Vault v3: setup tokens + buyer-absent payment tokens.
 *
 * The v5 QR pairing ceremony vaults the payer once (phone approval), then
 * every agentic partition spend charges the vaulted token — no browser
 * popup per payment. Live shapes follow PayPal's public Vault REST
 * surface (`/v3/vault/setup-tokens`, `/v3/vault/payment-tokens`); the
 * deterministic replay engine mirrors them with `SETUP-VP-…` /
 * `PM-VP-VAULT-…` ids. Tests exercise replay; live vaulting needs a
 * sandbox buyer approval and stays founder-verified.
 */
import type { PayPalApi, TransportMode } from './oauth';

/** Input for a vault setup token (starts the phone-approval ceremony). */
export interface VaultSetupInput {
  payerEmail: string;
  returnUrl: string;
  cancelUrl: string;
  requestId?: string;
}

/** Setup token record (both transports). */
export interface VaultSetupRecord {
  transportMode: TransportMode;
  setupTokenId: string;
  payerEmail: string;
  status: string;
  approveUrl?: string;
}

/** Input for converting an approved setup token into a payment token. */
export interface VaultApproveInput {
  setupTokenId: string;
  payerEmail: string;
  requestId?: string;
}

/** Vaulted payment token (both transports). */
export interface VaultTokenRecord {
  transportMode: TransportMode;
  vaultId: string;
  setupTokenId: string;
  payerEmail: string;
  status: 'VAULTED';
}

interface RawSetupTokenJson {
  id: string;
  status?: string;
  links?: Array<{ rel?: string; href?: string }>;
}

interface RawPaymentTokenJson {
  id: string;
  customer?: { id?: string };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertSetupInput(input: VaultSetupInput): void {
  if (!EMAIL_RE.test(input.payerEmail)) {
    throw new Error('paypal: payerEmail must be a valid email address');
  }
  for (const [label, value] of [
    ['returnUrl', input.returnUrl],
    ['cancelUrl', input.cancelUrl],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
      throw new Error(`paypal: ${label} must be a 1..500 char URL`);
    }
  }
}

/**
 * Create a vault setup token for `payerEmail`. The phone ceremony approves
 * it out-of-band; `approveVaultPaymentToken` then mints the chargeable id.
 */
export async function createVaultSetupToken(
  api: PayPalApi,
  input: VaultSetupInput,
): Promise<VaultSetupRecord> {
  assertSetupInput(input);
  const { data } = await api.request<RawSetupTokenJson>(
    'POST',
    '/v3/vault/setup-tokens',
    {
      payment_source: {
        paypal: {
          description: 'VeriPact agentic partition vaulting',
          // Payer binding for the pairing ceremony. The replay engine
          // reads this verbatim; the live shape is sandbox-verified in
          // v5 Step 3 (live vaulting needs a buyer approval regardless).
          email_address: input.payerEmail,
          experience_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
    { requestId: input.requestId },
  );
  const approveUrl = data.links?.find((l) => l.rel === 'approve')?.href;
  return {
    transportMode: api.transportMode,
    setupTokenId: data.id,
    payerEmail: input.payerEmail,
    status: data.status ?? 'CREATED',
    approveUrl,
  };
}

/**
 * Convert an approved setup token into a vaulted payment token id
 * (`vaultId`) that future partition charges reference. The setup token
 * must exist (replay) or be buyer-approved (live).
 */
export async function approveVaultPaymentToken(
  api: PayPalApi,
  input: VaultApproveInput,
): Promise<VaultTokenRecord> {
  if (typeof input.setupTokenId !== 'string' || input.setupTokenId.length === 0) {
    throw new Error('paypal: setupTokenId is required');
  }
  if (!EMAIL_RE.test(input.payerEmail)) {
    throw new Error('paypal: payerEmail must be a valid email address');
  }
  const { data } = await api.request<RawPaymentTokenJson>(
    'POST',
    '/v3/vault/payment-tokens',
    {
      payment_source: {
        token: { id: input.setupTokenId, type: 'SETUP_TOKEN' },
      },
    },
    { requestId: input.requestId },
  );
  return {
    transportMode: api.transportMode,
    vaultId: data.id,
    setupTokenId: input.setupTokenId,
    payerEmail: input.payerEmail,
    status: 'VAULTED',
  };
}
