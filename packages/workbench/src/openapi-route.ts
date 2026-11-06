/**
 * @veripact/workbench OpenAPI 3.1.0 spec for the Partitioned Agentic Wallet.
 *
 * Served at `GET /openapi.json` so ChatGPT Custom GPT Actions and external
 * LLM tool runners can import the wallet surface in one click (scoped
 * Bearer token minted via `mintConnectorToken`). Honesty note: the
 * `/api/wallet/*` paths are LIVE v5 Step-2 routes served by
 * `wallet-routes.ts` alongside the witness/checkout paths below.
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
        'and run 3-rung witnessed checkouts. All paths are live as of ' +
        'v5 Step 2 (wallet routes served by wallet-routes.ts).',
    },
    servers: [{ url: '/', description: 'Workbench origin (same-origin fetch)' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/wallet/partitions': {
        get: {
          operationId: 'getPartitionStatus',
          summary: 'Active buyer-signed partition with live availability (null before pairing)',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Active partition (null before pairing) + session orders',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      partition: {
                        anyOf: [
                          { $ref: '#/components/schemas/PartitionSpec' },
                          { type: 'null' },
                        ],
                      },
                      orders: { type: 'array', items: { type: 'object' } },
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
          summary: 'Dry-run verdict (dryRun) or full partitioned agent payment',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    dryRun: { type: 'boolean', description: 'true = pure verdict, no PayPal calls' },
                    partitionId: { type: 'string' },
                    requestedAmountUsd: { type: 'number' },
                    merchantName: { type: 'string' },
                    hasWitnessedReceipt: { type: 'boolean' },
                    scenarioId: { type: 'string', enum: ['normal', 'surcharge_void', 'adversarial_hidden_dom'] },
                    requestedOverrideUsd: { type: 'number' },
                    agentToken: { type: 'string' },
                    executionMode: { type: 'string', enum: ['replay', 'live', 'auto'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: '{ verdict, partition } dry-run, or full payment outcome + updated partition',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      verdict: { $ref: '#/components/schemas/PartitionSpendCheckVerdict' },
                      partition: { $ref: '#/components/schemas/PartitionSpec' },
                      outcome: {
                        type: 'string',
                        enum: [
                          'CAPTURED',
                          'AUTO_VOIDED_BY_PARTITION_WALL',
                          'AUTO_VOIDED',
                          'BLOCKED_PRE_CHECKOUT',
                          'BLOCKED_BY_PARTITION_WALL',
                          'BLOCKED_PARTITION_FROZEN',
                          'ASK_HUMAN_OVER_THRESHOLD',
                          'AWAITING_BUYER_APPROVAL',
                        ],
                      },
                    },
                  },
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
              description: 'Labeled sync list with summary counts + indexing disclosure',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      records: { type: 'array', items: { $ref: '#/components/schemas/SyncPaymentRecord' } },
                      summary: {
                        type: 'object',
                        properties: {
                          totalCount: { type: 'integer' },
                          protectedCount: { type: 'integer' },
                          legacyUnwitnessedCount: { type: 'integer' },
                        },
                      },
                      indexingDelayDisclosure: { type: 'string' },
                      reportingScopeStatus: {
                        type: 'string',
                        enum: [
                          'LIVE_REPORTING_SEARCH',
                          'FALLBACK_TO_REPLAY_AND_SESSION_ORDERS',
                          'DETERMINISTIC_REPLAY_FIXTURE',
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/wallet/pair/start': {
        post: {
          operationId: 'startPairingCeremony',
          summary: 'Mint a QR pairing session (6-digit code, 15-min TTL)',
          responses: {
            '200': {
              description: 'Pairing session + QR URL + code',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      session: { $ref: '#/components/schemas/PairingSession' },
                      qrPairUrl: { type: 'string' },
                      pairingCode: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/wallet/pair/status': {
        get: {
          operationId: 'getPairingStatus',
          summary: 'Poll a pairing session (desktop UI polls until APPROVED)',
          parameters: [
            {
              name: 'sessionId',
              in: 'query',
              required: true,
              schema: { type: 'string', pattern: '^PAIR-VP-[A-Za-z0-9_-]+$' },
            },
          ],
          responses: {
            '200': {
              description: 'Session + active partition (null until approved)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      session: { $ref: '#/components/schemas/PairingSession' },
                      partition: {
                        anyOf: [
                          { $ref: '#/components/schemas/PartitionSpec' },
                          { type: 'null' },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/wallet/pair/approve': {
        post: {
          operationId: 'approvePairingCeremony',
          summary: 'Approve pairing: vault the payer + initialize the $350 partition',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sessionId'],
                  properties: {
                    sessionId: { type: 'string' },
                    payerEmail: { type: 'string' },
                    executionMode: { type: 'string', enum: ['replay', 'live', 'auto'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Approved session + initialized partition',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      session: { $ref: '#/components/schemas/PairingSession' },
                      partition: { $ref: '#/components/schemas/PartitionSpec' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/wallet/refund': {
        post: {
          operationId: 'refundPartitionPayment',
          summary: 'Refund a wallet capture (defaults to latest) and restore partition availability',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    captureId: { type: 'string' },
                    executionMode: { type: 'string', enum: ['replay', 'live', 'auto'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Refund record + updated partition',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      refund: { type: 'object' },
                      partition: { $ref: '#/components/schemas/PartitionSpec' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/wallet/connectors': {
        post: {
          operationId: 'mintConnectorToken',
          summary: 'Mint a scoped connector token for ChatGPT / Claude / Cursor (raw value returned once)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['platform'],
                  properties: {
                    platform: { type: 'string', enum: ['CHATGPT_ACTION', 'CLAUDE_MCP', 'CURSOR_MCP'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Connector scope + one-time token value',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      connector: { $ref: '#/components/schemas/ConnectorScope' },
                      bearerTokenOnce: { type: 'string' },
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
        PairingSession: {
          type: 'object',
          required: ['sessionId', 'qrPairUrl', 'pairingCode', 'status', 'createdAtUtc', 'expiresAtUtc'],
          properties: {
            sessionId: { type: 'string' },
            qrPairUrl: { type: 'string' },
            pairingCode: { type: 'string' },
            status: { type: 'string', enum: ['PENDING_SCAN', 'APPROVED', 'EXPIRED', 'REVOKED'] },
            payerEmail: { type: 'string' },
            vaultId: { type: 'string' },
            createdAtUtc: { type: 'string' },
            expiresAtUtc: { type: 'string' },
            approvedAtUtc: { type: 'string' },
            transportMode: { type: 'string', enum: ['LIVE_PAYPAL_SANDBOX', 'DETERMINISTIC_SANDBOX_REPLAY'] },
          },
        },
        ConnectorScope: {
          type: 'object',
          required: ['tokenId', 'platform', 'partitionId', 'maskedToken', 'openapiUrl', 'mcpCommand'],
          properties: {
            tokenId: { type: 'string' },
            platform: { type: 'string', enum: ['CHATGPT_ACTION', 'CLAUDE_MCP', 'CURSOR_MCP'] },
            partitionId: { type: 'string' },
            maskedToken: { type: 'string' },
            openapiUrl: { type: 'string' },
            mcpCommand: { type: 'string' },
            createdAtUtc: { type: 'string' },
          },
        },
      },
    },
  };
}
