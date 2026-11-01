---
name: paypal-api-context
description: Verified PayPal REST API request/response schemas, enums, and limits for VeriPact. Use when building Orders v2, Payments v2, Disputes v1, or webhook-verification calls.
---

# PayPal API Context (spec-verified)

Source: `paypal/paypal-rest-api-specifications`, `openapi/` @ `main`,
fetched 2026-11-01 via Python proxy fetch (run 01b). Files:
`checkout_orders_v2.json` (8 paths, 210 schemas),
`payments_payment_v2.json` (8 paths, 66 schemas),
`customer_disputes_v1.json` (14 paths, 128 schemas),
`notifications_webhooks_v1.json` (11 paths, 47 schemas).
Note: the webhooks file is named `notifications_webhooks_v1.json`
(there is no `webhooks_v1.json`).

## Orders v2 — `POST /v2/checkout/orders`

- Required: `intent`, `purchase_units`. `intent` enum: `CAPTURE`, `AUTHORIZE`.
- Headers: `PayPal-Request-Id` (idempotency key), `PayPal-Partner-Attribution-Id`,
  `Prefer`. Responses: `200/201/202/400/401/403/422/500`.
- `purchase_unit_request`: required `amount`.
  - `reference_id`: string, maxLength 256. Single-unit orders use `"default"`.
  - `custom_id`: string, maxLength **255**. "API caller-provided external ID.
    Used to reconcile client transactions with PayPal transactions."
    Our 68-char `VP1:` commitment fits with room.
  - `invoice_id`: string, maxLength **127**. Also fits a 68-char hash.
  - `description`: maxLength 3000 (only ~127 chars visible to payer).
- `money`: required `currency_code` + `value` (string, numeric pattern, maxLength 32).

## Orders v2 — PATCH + status + authorize

- `PATCH /v2/checkout/orders/{id}`: `patch` schema, required `op`.
  `op` enum: `add`, `remove`, `replace`, `move`, `copy`, `test`.
  `path` is an RFC 6901 JSON Pointer. Our amount patch:
  `/purchase_units/@reference_id=='default'/amount`.
- `order_status` enum: `CREATED`, `SAVED`, `APPROVED`, `VOIDED`,
  `COMPLETED`, `PAYER_ACTION_REQUIRED`.
- `POST .../orders/{id}/authorize`: body `order_authorize_request`
  (`payment_source`). Authorize-then-capture/void is the VeriPact flow;
  the order-level `.../capture` endpoint exists but we use Payments v2.

## Payments v2 — capture

- `POST /v2/payments/authorizations/{authorization_id}/capture`.
  Body `capture_request` (no required fields):
  - `amount` (money), `invoice_id` (maxLength 127),
    `final_capture` (boolean — `true`: no further captures),
    `note_to_payer` (maxLength 255), `soft_descriptor` (maxLength 22),
    `payment_instruction`.
- **Verified correction: capture has NO `custom_id` field.**
  Carry the capture-addendum hash in `invoice_id` (127 chars is enough),
  never in a capture `custom_id`. `note_to_payer` exists — our
  "VeriPact Verified Capture" note is valid.
- Documented header on this op: `Prefer`.

## Payments v2 — void + authorization status

- `POST /v2/payments/authorizations/{authorization_id}/void`.
  No request body. Success includes `204`; errors include `404/409/422`.
- `authorization_status.status` enum: `CREATED`, `CAPTURED`, `DENIED`,
  `PARTIALLY_CAPTURED`, `VOIDED`, `PENDING`.

## Disputes v1 — paths (14)

`GET /v1/customer/disputes`, `GET/PATCH /v1/customer/disputes/{id}`,
and POST actions: `accept-claim`, `accept-offer`, `acknowledge-return-item`,
`adjudicate`, `appeal`, `deny-offer`, `escalate`, `make-offer`,
`provide-evidence`, `provide-supporting-info`, `require-evidence`,
`send-message`.

## Disputes v1 — lifecycle enums

- `dispute_lifecycle_stage`: `INQUIRY`, `CHARGEBACK`, `PRE_ARBITRATION`,
  `ARBITRATION`.
- `dispute_state`: `OPEN_INQUIRIES`, `REQUIRED_ACTION`,
  `REQUIRED_OTHER_PARTY_ACTION`, `UNDER_PAYPAL_REVIEW`, `APPEALABLE`,
  `RESOLVED`.
- Cross-ref: the `WAITING_FOR_SELLER_RESPONSE` /
  `WAITING_FOR_BUYER_RESPONSE` evidence gates come from the developer
  guides (run-01 audit); drive them via `require-evidence` below.

## Disputes v1 — evidence actions

- `POST .../require-evidence`: required `action` enum
  `BUYER_EVIDENCE` | `SELLER_EVIDENCE`. Sets who may submit evidence.
- `POST .../provide-evidence`: `evidence` object.
  `evidence_type`: ~80-value enum including `OTHER`
  (pattern `^[0-9A-Z_]+$`, maxLength 255). `notes`: maxLength 2000.
  `documents`, `source` enum (`SUBMITTED_BY_BUYER`, `SUBMITTED_BY_SELLER`, …),
  `dispute_life_cycle_stage`. Sandbox tests mandate `OTHER`.
- `POST .../escalate`: optional `note` (maxLength 2000) +
  `buyer_escalation_reason`. Moves `INQUIRY` → `CHARGEBACK`.
- `POST .../adjudicate` (sandbox-only): required `adjudication_outcome`
  enum `BUYER_FAVOR` | `SELLER_FAVOR`. JSON and multipart bodies accepted.
- `POST .../accept-claim`: `multipart/form-data` with an optional binary
  evidence document field.

## HATEOAS rules (all four specs)

Every spec defines `link_description` schemas: responses carry `links[]`
with `rel`/`href`/`method`. Client rule: **only render an action button
when its `rel` is present** (`escalate`, `provide-evidence`, `adjudicate`,
`accept-claim`, …). Never hardcode the action sequence — the links ARE
the state machine.

## Webhooks — verify signature

- `POST /v1/notifications/verify-webhook-signature`. Required body fields:
  `auth_algo` (maxLength 100), `cert_url` (maxLength 500),
  `transmission_id` (maxLength 50), `transmission_sig` (maxLength 500),
  `transmission_time` (maxLength 100), `webhook_id` (maxLength 50),
  `webhook_event` (object).
- Response: `verification_status` enum `SUCCESS` | `FAILURE`.
- Related paths (11 total): webhooks CRUD, `webhooks-event-types`,
  `webhooks-events`, per-event `resend`, `webhooks-lookup`.
