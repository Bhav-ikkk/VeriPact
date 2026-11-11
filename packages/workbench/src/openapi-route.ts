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
      '/api/wallet/sniper': {
        post: {
          operationId: 'runDealSniper',
          summary: 'Hunt six voucher candidates and capture only a witness-clean deal under the target',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sku: { type: 'string', description: 'Channel3 product id. Default APEX-27-4K-IPS' },
                    targetMaxAllInUsd: { type: 'number', minimum: 1, maximum: 10000 },
                    customVoucherCode: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'DealSniperReport. A timestamp proves the page hash existed at time T, not that the voucher is true.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DealSniperReport' },
                },
              },
            },
          },
        },
      },
      '/api/agents/web-hunt': {
        post: {
          summary: 'Live web coupon & wild-URL hunt',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    queryOrUrl: { type: 'string', maxLength: 512 },
                    targetMaxAllInUsd: { type: 'number', minimum: 1, maximum: 10000 },
                  },
                  required: ['queryOrUrl'],
                },
              },
            },
          },
          responses: {
            200: { description: 'Signed VP1 web-hunt report' },
            400: { description: 'Bad input or refused SSRF target' },
            502: { description: 'Wild-URL fetch failed' },
          },
        },
      },
      '/api/catalog': {
        get: {
          operationId: 'getChannel3Catalog',
          summary: 'Channel3 replay catalog (benchmark cache, labeled REPLAY — not live evidence)',
          responses: {
            '200': {
              description: 'Catalog products used by the witness oracle',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      source: { type: 'string' },
                      products: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            productId: { type: 'string' },
                            title: { type: 'string' },
                            condition: { type: 'string' },
                            priceUsd: { type: 'number' },
                          },
                        },
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
      '/api/onboarding/state': {
        get: {
          operationId: 'getOnboardingState',
          summary: 'Retrieve onboarding user session and autonomous sub-agent fleet state',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description:
                'FleetStateSnapshot containing storage engine, user session, master partition, sub-agents, and background events',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FleetStateSnapshot' },
                },
              },
            },
          },
        },
      },
      '/api/onboarding/complete': {
        post: {
          operationId: 'completeOnboarding',
          summary:
            'Connect user session, link PayPal Vault, initialize master partition, and provision sub-agents',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'displayName', 'authProvider'],
                  properties: {
                    email: { type: 'string' },
                    displayName: { type: 'string' },
                    authProvider: {
                      type: 'string',
                      enum: ['CLERK_GOOGLE_OAUTH', 'CLERK_SESSION', 'DEMO_PASSKEY'],
                    },
                    clerkToken: { type: 'string' },
                    paypalPayerEmail: { type: 'string' },
                    masterPartitionUsd: { type: 'number' },
                    initialAgents: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['name', 'sku', 'targetMaxAllInUsd', 'subAllocationUsd'],
                        properties: {
                          name: { type: 'string' },
                          sku: { type: 'string' },
                          targetMaxAllInUsd: { type: 'number' },
                          subAllocationUsd: { type: 'number' },
                          autoBuyEnabled: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated FleetStateSnapshot',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FleetStateSnapshot' },
                },
              },
            },
          },
        },
      },
      '/api/agents/spawn': {
        post: {
          operationId: 'spawnSubAgent',
          summary:
            'Spawn an autonomous sub-agent with a dedicated sub-allocation under the master partition',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'sku', 'targetMaxAllInUsd', 'subAllocationUsd'],
                  properties: {
                    name: { type: 'string' },
                    sku: { type: 'string' },
                    targetMaxAllInUsd: { type: 'number' },
                    subAllocationUsd: { type: 'number' },
                    autoBuyEnabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Created AutonomousSubAgent and updated FleetStateSnapshot',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      agent: { $ref: '#/components/schemas/AutonomousSubAgent' },
                      fleet: { $ref: '#/components/schemas/FleetStateSnapshot' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/agents/webhook/price-drop': {
        post: {
          operationId: 'triggerPriceDropWebhook',
          summary:
            'Trigger background price-drop webhook, wake matching sub-agents, and execute autonomous 3-rung settlement',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sku'],
                  properties: {
                    sku: { type: 'string' },
                    newBasePriceUsd: { type: 'number' },
                    voucherCode: { type: 'string' },
                    triggerType: {
                      type: 'string',
                      enum: ['CHANNEL3_PRICE_DROP_WEBHOOK', 'WATCHDOG_POLL_TICK'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Triggered sub-agents and updated fleet snapshot',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      triggeredAgents: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/AutonomousSubAgent' },
                      },
                      fleet: { $ref: '#/components/schemas/FleetStateSnapshot' },
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
        SniperCandidateEvaluation: {
          type: 'object',
          required: [
            'candidateId',
            'merchantName',
            'merchantUrl',
            'sku',
            'retailPriceUsd',
            'voucherDiscountUsd',
            'netBasePriceUsd',
            'shippingUsd',
            'taxUsd',
            'allInTotalUsd',
            'observedCondition',
            'observedReturnDays',
            'observedRestockingFeePct',
            'pageIntegrity',
            'verdict',
            'reason',
            'paypalApiCalls',
          ],
          properties: {
            candidateId: { type: 'string' },
            merchantName: { type: 'string' },
            merchantUrl: { type: 'string' },
            sku: { type: 'string' },
            retailPriceUsd: { type: 'number' },
            voucherCode: { type: 'string' },
            voucherDiscountUsd: { type: 'number' },
            netBasePriceUsd: { type: 'number' },
            shippingUsd: { type: 'number' },
            taxUsd: { type: 'number' },
            allInTotalUsd: { type: 'number' },
            observedCondition: { type: 'string', enum: ['NEW', 'REFURBISHED', 'UNKNOWN'] },
            observedReturnDays: { type: 'number' },
            observedRestockingFeePct: { type: 'number' },
            pageIntegrity: { type: 'string', enum: ['CLEAN', 'ADVERSARIAL_DOM'] },
            verdict: {
              type: 'string',
              enum: [
                'REJECTED_ADVERSARIAL_DOM',
                'REJECTED_CONDITION_CONFLICT',
                'REJECTED_VOUCHER_VOIDS_RETURNS',
                'REJECTED_OVER_TARGET_CAP',
                'REJECTED_CALLBACK_SURCHARGE_VOIDED',
                'AUTO_VOIDED_BY_PARTITION_WALL',
                'VERIFIED_VOUCHER_CAPTURED',
              ],
            },
            reason: { type: 'string' },
            paypalApiCalls: { type: 'integer' },
            commitment: { type: 'string' },
            orderId: { type: 'string' },
            authorizationId: { type: 'string' },
            captureId: { type: 'string' },
          },
        },
        DealSniperReport: {
          type: 'object',
          required: [
            'sniperRunId',
            'sku',
            'productTitle',
            'retailBaselineUsd',
            'targetMaxAllInUsd',
            'candidatesEvaluated',
            'trapsRejectedCount',
            'outcome',
            'winningCandidate',
            'evaluations',
            'totalSavedUsd',
            'partitionAfter',
            'completedAtUtc',
          ],
          properties: {
            sniperRunId: { type: 'string' },
            sku: { type: 'string' },
            productTitle: { type: 'string' },
            retailBaselineUsd: { type: 'number' },
            targetMaxAllInUsd: { type: 'number' },
            candidatesEvaluated: { type: 'integer' },
            trapsRejectedCount: { type: 'integer' },
            outcome: {
              type: 'string',
              enum: ['DEAL_CAPTURED', 'BLOCKED_BY_PARTITION_WALL', 'NO_COMPLIANT_DEAL_UNDER_TARGET'],
            },
            winningCandidate: {
              anyOf: [{ $ref: '#/components/schemas/SniperCandidateEvaluation' }, { type: 'null' }],
            },
            evaluations: {
              type: 'array',
              items: { $ref: '#/components/schemas/SniperCandidateEvaluation' },
            },
            totalSavedUsd: { type: 'number' },
            partitionAfter: {
              anyOf: [{ $ref: '#/components/schemas/PartitionSpec' }, { type: 'null' }],
            },
            completedAtUtc: { type: 'string' },
          },
        },
        OnboardingUserSession: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            email: { type: 'string' },
            displayName: { type: 'string' },
            avatarUrl: { type: 'string' },
            authProvider: {
              type: 'string',
              enum: ['CLERK_GOOGLE_OAUTH', 'CLERK_SESSION', 'DEMO_PASSKEY'],
            },
            clerkSessionId: { type: 'string' },
            paypalConnected: { type: 'boolean' },
            paypalPayerEmail: { type: 'string' },
            paypalVaultTokenId: { type: 'string' },
            masterPartitionUsd: { type: 'number' },
            onboardingCompletedAtUtc: { type: 'string' },
          },
        },
        AutonomousSubAgent: {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            name: { type: 'string' },
            sku: { type: 'string' },
            productTitle: { type: 'string' },
            retailPriceUsd: { type: 'number' },
            targetMaxAllInUsd: { type: 'number' },
            subAllocationUsd: { type: 'number' },
            spentUsd: { type: 'number' },
            remainingSubAllocationUsd: { type: 'number' },
            autoBuyEnabled: { type: 'boolean' },
            status: {
              type: 'string',
              enum: [
                'ARMED_WATCHING',
                'EXECUTING',
                'GOAL_CAPTURED',
                'BLOCKED_TRAP',
                'BLOCKED_SUB_ALLOCATION_WALL',
              ],
            },
            lastEventSummary: { type: 'string' },
            capturedOrderId: { type: 'string' },
            capturedAmountUsd: { type: 'number' },
            savedUsd: { type: 'number' },
            commitment: { type: 'string' },
            createdAtUtc: { type: 'string' },
            updatedAtUtc: { type: 'string' },
          },
        },
        FleetStateSnapshot: {
          type: 'object',
          properties: {
            storageEngine: {
              type: 'string',
              enum: ['NEON_SERVERLESS_POSTGRES', 'LOCAL_HERMETIC_MIRROR'],
            },
            clerkConfigured: { type: 'boolean' },
            neonConfigured: { type: 'boolean' },
            user: {
              anyOf: [
                { $ref: '#/components/schemas/OnboardingUserSession' },
                { type: 'null' },
              ],
            },
            masterPartitionUsd: { type: 'number' },
            totalSubAllocatedUsd: { type: 'number' },
            unallocatedMasterUsd: { type: 'number' },
            agents: {
              type: 'array',
              items: { $ref: '#/components/schemas/AutonomousSubAgent' },
            },
            recentBackgroundEvents: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  };
}
