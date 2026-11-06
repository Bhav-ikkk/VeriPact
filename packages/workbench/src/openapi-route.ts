/**
 * @veripact/workbench OpenAPI 3.1.0 spec for the Partitioned Agentic Wallet.
 *
 * Served at `GET /openapi.json` so ChatGPT Custom GPT Actions and external
 * LLM tool runners can import the wallet surface in one click (scoped
 * Bearer token minted via `mintConnectorToken`). Honesty note: the
 * `/api/wallet/*` paths are the FROZEN Step-2 contract — the route module
 * lands in v5 Step 2; the witness/checkout paths below already exist.
 * The spec itself is static data (no secrets, no key material).
 */
import { WORKBENCH_VERSION } from './routes';

/** Build the OpenAPI 3.1.0 document (fresh object per call). */
export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'VeriPact Partitioned Agentic Wallet',
      version: WORKBENCH_VERSION,
      description:
        'Witnessed clearing for agentic commerce: pair a wallet over QR, ' +
        'partition a hard sub-balance, sync legacy vs protected payments, ' +
        'and run 3-rung witnessed checkouts. Wallet paths are the frozen ' +
        'v5 Step-2 contract; witness/checkout paths are live in Step 1.',
    },
    servers: [{ url: '/', description: 'Workbench origin (same-origin fetch)' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/wallet/partitions': {
        get: {
          operationId: 'listPartitions',
          summary: 'List buyer-signed agentic partitions with live availability',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Partitions with recomputed availableUsd',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      partitions: { type: 'array', items: { $ref: '#/components/schemas/PartitionSpec' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createPartition',
          summary: 'Create or update a partition (buyer-signed at the server)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['label', 'totalAllocatedUsd', 'maxPerOrderUsd', 'askHumanAboveUsd'],
                  properties: {
                    label: { type: 'string' },
                    totalAllocatedUsd: { type: 'number' },
                    maxPerOrderUsd: { type: 'number' },
                    askHumanAboveUsd: { type: 'number' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Signed partition with live availability',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PartitionSpec' },
                },
              },
            },
          },
        },
      },
      '/api/wallet/spend-check': {
        post: {
          operationId: 'partitionSpendCheck',
          summary: 'Deterministic pre-authorization spend check against a partition',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['partitionId', 'requestedAmountUsd', 'hasWitnessedReceipt'],
                  properties: {
                    partitionId: { type: 'string' },
                    requestedAmountUsd: { type: 'number' },
                    merchantName: { type: 'string' },
                    hasWitnessedReceipt: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Spend verdict (ALLOW / ASK_HUMAN / BLOCK_*)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PartitionSpendCheckVerdict' },
                },
              },
            },
          },
        },
      },
      '/api/wallet/sync': {
        get: {
          operationId: 'syncWalletPayments',
          summary: 'Sync payments labeled VERIPACT_PROTECTED vs LEGACY_UNWITNESSED',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Labeled sync list with counts',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      records: { type: 'array', items: { $ref: '#/components/schemas/SyncPaymentRecord' } },
                      protectedCount: { type: 'integer' },
                      legacyCount: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/witness/snapshot': {
        post: {
          operationId: 'witnessSnapshot',
          summary: 'Witness a scenario storefront (zero PayPal calls)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { scenario: { type: 'string', enum: ['normal', 'surcharge_void', 'adversarial_hidden_dom'] } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Witness snapshot with VP1 commitment',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/merchant/checkout': {
        post: {
          operationId: 'guardedCheckout',
          summary: 'Run a bilateral witnessed checkout (CAPTURED | AUTO_VOIDED | BLOCKED)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    scenario: { type: 'string', enum: ['normal', 'surcharge_void', 'adversarial_hidden_dom'] },
                    executionMode: { type: 'string', enum: ['replay', 'live', 'auto'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Checkout result with transportMode + demoKeys labels',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'VeriPact connector token (vp_…)' },
      },
      schemas: {
        PartitionSpec: {
          type: 'object',
          required: ['partitionId', 'label', 'totalAllocatedUsd', 'availableUsd', 'status'],
          properties: {
            partitionId: { type: 'string' },
            label: { type: 'string' },
            totalAllocatedUsd: { type: 'number' },
            maxPerOrderUsd: { type: 'number' },
            askHumanAboveUsd: { type: 'number' },
            authorizedUsd: { type: 'number' },
            capturedUsd: { type: 'number' },
            voidedUsd: { type: 'number' },
            refundedUsd: { type: 'number' },
            availableUsd: { type: 'number' },
            status: { type: 'string', enum: ['ACTIVE', 'EXHAUSTED', 'FROZEN'] },
            buyerSignatureHex: { type: 'string' },
            buyerPublicKeyHex: { type: 'string' },
          },
        },
        PartitionSpendCheckVerdict: {
          type: 'object',
          required: ['allowed', 'decision', 'availableBeforeUsd', 'availableAfterUsd', 'reason'],
          properties: {
            allowed: { type: 'boolean' },
            decision: {
              type: 'string',
              enum: [
                'ALLOW_AUTONOMOUS',
                'ASK_HUMAN_OVER_THRESHOLD',
                'BLOCK_PARTITION_EXCEEDED',
                'BLOCK_PER_ORDER_CAP',
                'BLOCK_UNWITNESSED_MERCHANT',
                'BLOCK_PARTITION_FROZEN',
              ],
            },
            availableBeforeUsd: { type: 'number' },
            availableAfterUsd: { type: 'number' },
            reason: { type: 'string' },
          },
        },
        SyncPaymentRecord: {
          type: 'object',
          required: ['transactionId', 'orderId', 'amountUsd', 'protectionClass', 'driftRiskNote', 'transportMode'],
          properties: {
            transactionId: { type: 'string' },
            orderId: { type: 'string' },
            captureId: { type: 'string' },
            merchantName: { type: 'string' },
            itemSummary: { type: 'string' },
            amountUsd: { type: 'number' },
            status: { type: 'string', enum: ['CAPTURED', 'CREATED', 'VOIDED', 'REFUNDED'] },
            protectionClass: { type: 'string', enum: ['VERIPACT_PROTECTED', 'LEGACY_UNWITNESSED'] },
            commitment: { type: 'string' },
            driftRiskNote: { type: 'string' },
            transportMode: { type: 'string', enum: ['LIVE_PAYPAL_SANDBOX', 'DETERMINISTIC_SANDBOX_REPLAY'] },
          },
        },
      },
    },
  };
}
