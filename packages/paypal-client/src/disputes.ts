/**
 * @veripact/paypal-client Disputes v1 HATEOAS action engine.
 *
 * Client rule from the paypal-api-context skill: the `links[]` ARE the
 * state machine — every action first re-reads the dispute and throws
 * `DisputeActionNotPermittedByHateoasError` unless its `rel` is advertised.
 * Action responses are intentionally ignored: each method re-GETs the
 * dispute afterwards, so live and replay transports share one code path
 * regardless of action-response body shapes.
 */
import type { PayPalApi, TransportMode } from './oauth';

/** One HATEOAS link from a PayPal dispute response. */
export interface DisputeLink {
  rel: string;
  href: string;
  method: string;
}

/** Action map keyed by link rel (e.g. `escalate`, `provide-evidence`). */
export type HateoasActionMap = Record<string, DisputeLink>;

/** Index dispute HATEOAS links by rel for gated action buttons. */
export function toHateoasActionMap(links: DisputeLink[]): HateoasActionMap {
  const map: HateoasActionMap = {};
  for (const link of links) {
    map[link.rel] = link;
  }
  return map;
}

/** Thrown when an action's `rel` is absent from the live dispute record. */
export class DisputeActionNotPermittedByHateoasError extends Error {
  readonly disputeId: string;
  readonly rel: string;

  constructor(disputeId: string, rel: string) {
    super(`paypal: dispute ${disputeId} does not advertise action '${rel}'`);
    this.name = 'DisputeActionNotPermittedByHateoasError';
    this.disputeId = disputeId;
    this.rel = rel;
  }
}

/** Normalized dispute view (both transports). */
export interface DisputeRecord {
  transportMode: TransportMode;
  disputeId: string;
  status: string;
  disputeState: string;
  lifeCycleStage: string;
  reason?: string;
  amountUsd?: number;
  outcome?: string;
  evidenceCount: number;
  allowedActions: string[];
  links: DisputeLink[];
  updateTimeIso: string;
}

/** Raw dispute JSON subset we parse (live shape and replay shape). */
interface RawDisputeJson {
  dispute_id: string;
  status?: string;
  dispute_state?: string;
  dispute_life_cycle_stage?: string;
  reason?: string;
  dispute_amount?: { value?: string };
  outcome?: string;
  evidence?: Array<unknown>;
  links?: DisputeLink[];
  update_time?: string;
}

/** Parse live/replay dispute JSON, deriving `allowedActions` from links. */
export function parseDisputeRecord(mode: TransportMode, json: RawDisputeJson): DisputeRecord {
  const links = json.links ?? [];
  return {
    transportMode: mode,
    disputeId: json.dispute_id,
    status: json.status ?? '',
    disputeState: json.dispute_state ?? '',
    lifeCycleStage: json.dispute_life_cycle_stage ?? '',
    reason: json.reason,
    amountUsd: json.dispute_amount?.value !== undefined ? Number(json.dispute_amount.value) : undefined,
    outcome: json.outcome,
    evidenceCount: json.evidence?.length ?? 0,
    allowedActions: links.map((l) => l.rel),
    links,
    updateTimeIso: json.update_time ?? '',
  };
}

/** List disputes (`GET /v1/customer/disputes` → `{ items: [...] }`). */
export async function listDisputes(api: PayPalApi): Promise<DisputeRecord[]> {
  const { data } = await api.request<{ items?: RawDisputeJson[] }>(
    'GET',
    '/v1/customer/disputes',
  );
  return (data.items ?? []).map((item) => parseDisputeRecord(api.transportMode, item));
}

/** Read one dispute with its current HATEOAS action set. */
export async function getDispute(api: PayPalApi, disputeId: string): Promise<DisputeRecord> {
  const { data } = await api.request<RawDisputeJson>('GET', `/v1/customer/disputes/${disputeId}`);
  return parseDisputeRecord(api.transportMode, data);
}

function requireRel(record: DisputeRecord, rel: string): void {
  if (!record.allowedActions.includes(rel)) {
    throw new DisputeActionNotPermittedByHateoasError(record.disputeId, rel);
  }
}

async function act(api: PayPalApi, disputeId: string): Promise<DisputeRecord> {
  return getDispute(api, disputeId);
}

/** Who must submit evidence next (`BUYER_EVIDENCE` | `SELLER_EVIDENCE`). */
export type RequireEvidenceAction = 'BUYER_EVIDENCE' | 'SELLER_EVIDENCE';

/** Request evidence from one side (HATEOAS-gated). */
export async function requireDisputeEvidence(
  api: PayPalApi,
  disputeId: string,
  action: RequireEvidenceAction,
): Promise<DisputeRecord> {
  requireRel(await getDispute(api, disputeId), 'require-evidence');
  if (action !== 'BUYER_EVIDENCE' && action !== 'SELLER_EVIDENCE') {
    throw new Error('paypal: require-evidence action must be BUYER_EVIDENCE or SELLER_EVIDENCE');
  }
  await api.request<unknown>('POST', `/v1/customer/disputes/${disputeId}/require-evidence`, {
    action,
  });
  return act(api, disputeId);
}

/** Escalate an INQUIRY to a CHARGEBACK claim (HATEOAS-gated). */
export async function escalateDisputeToClaim(
  api: PayPalApi,
  disputeId: string,
  note?: string,
): Promise<DisputeRecord> {
  requireRel(await getDispute(api, disputeId), 'escalate');
  if (note !== undefined && note.length > 2000) {
    throw new Error('paypal: escalate note must be <= 2000 chars');
  }
  await api.request<unknown>(
    'POST',
    `/v1/customer/disputes/${disputeId}/escalate`,
    note === undefined ? {} : { note },
  );
  return act(api, disputeId);
}

/** Evidence submission (sandbox tests mandate `evidence_type: "OTHER"`). */
export interface ProvideEvidenceInput {
  disputeId: string;
  evidenceType: string;
  /** Structured forensic notes, ≤ 2000 chars (spec maxLength). */
  notes: string;
}

/** Submit evidence (HATEOAS-gated; limits enforced pre-transport). */
export async function provideDisputeEvidence(
  api: PayPalApi,
  input: ProvideEvidenceInput,
): Promise<DisputeRecord> {
  requireRel(await getDispute(api, input.disputeId), 'provide-evidence');
  if (!/^[0-9A-Z_]+$/.test(input.evidenceType) || input.evidenceType.length > 255) {
    throw new Error('paypal: evidence_type must match ^[0-9A-Z_]+$ and be <= 255 chars');
  }
  if (input.notes.length > 2000) {
    throw new Error('paypal: evidence notes must be <= 2000 chars');
  }
  await api.request<unknown>('POST', `/v1/customer/disputes/${input.disputeId}/provide-evidence`, {
    evidence_type: input.evidenceType,
    notes: input.notes,
  });
  return act(api, input.disputeId);
}

/** Seller accepts the claim (buyer wins; HATEOAS-gated). */
export async function acceptDisputeClaim(
  api: PayPalApi,
  disputeId: string,
): Promise<DisputeRecord> {
  requireRel(await getDispute(api, disputeId), 'accept-claim');
  await api.request<unknown>('POST', `/v1/customer/disputes/${disputeId}/accept-claim`, {});
  return act(api, disputeId);
}

/** Sandbox-only adjudication outcome. */
export type AdjudicationOutcome = 'BUYER_FAVOR' | 'SELLER_FAVOR';

/** Sandbox-only adjudication (HATEOAS-gated; never valid on live PayPal). */
export async function adjudicateDisputeSandbox(
  api: PayPalApi,
  disputeId: string,
  outcome: AdjudicationOutcome,
): Promise<DisputeRecord> {
  requireRel(await getDispute(api, disputeId), 'adjudicate');
  if (outcome !== 'BUYER_FAVOR' && outcome !== 'SELLER_FAVOR') {
    throw new Error('paypal: adjudication_outcome must be BUYER_FAVOR or SELLER_FAVOR');
  }
  await api.request<unknown>('POST', `/v1/customer/disputes/${disputeId}/adjudicate`, {
    adjudication_outcome: outcome,
  });
  return act(api, disputeId);
}
