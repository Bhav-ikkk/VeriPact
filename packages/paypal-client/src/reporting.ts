/**
 * @veripact/paypal-client Reporting: Transaction Search reconciliation.
 *
 * Transaction Search is ASYNC RECONCILIATION ONLY — never the real-time
 * partition balance (that is the VeriPact Clearing Ledger, enforced
 * deterministically at spend-check time). PayPal's own constraints shape
 * this module: RFC 3339 window, 31-day max range, paginated results, and
 * an indexing delay of up to 3 hours, all disclosed on every result.
 *
 * Honesty wiring: live calls that hit a missing `reporting-search-read`
 * scope (403) or any transport failure fall back to replay + session
 * orders and SAY SO via `reportingScopeStatus` — the UI must render that
 * status verbatim next to synced rows.
 */
import type { PayPalApi, TransportMode } from './oauth';
import type { SandboxReplayEngine } from './sandbox-replay';

/** Thrown when the requested reporting window exceeds 31 days. */
export class ReportingRangeExceededError extends Error {
  readonly startDateIso: string;
  readonly endDateIso: string;

  constructor(startDateIso: string, endDateIso: string) {
    super(
      `paypal: reporting window exceeds 31 days (${startDateIso} → ${endDateIso})`,
    );
    this.name = 'ReportingRangeExceededError';
    this.startDateIso = startDateIso;
    this.endDateIso = endDateIso;
  }
}

/** PayPal `transaction_status` codes mapped by this module (D/P/S/V). */
export type ReportingStatusCode = 'D' | 'P' | 'S' | 'V';

/** Normalized reporting record (both transports). */
export interface ReportingRecord {
  transactionId: string;
  amountUsd: number;
  currencyCode: string;
  statusCode: ReportingStatusCode;
  /** VeriPact-normalized status for the sync grid. */
  status: 'CAPTURED' | 'CREATED' | 'VOIDED' | 'DENIED';
  createdAtIso: string;
}

/** Where the records came from — rendered verbatim by sync surfaces. */
export type ReportingScopeStatus =
  | 'LIVE_REPORTING_SEARCH'
  | 'FALLBACK_TO_REPLAY_AND_SESSION_ORDERS'
  | 'DETERMINISTIC_REPLAY_FIXTURE';

/** Honest indexing-delay disclosure, attached to every search result. */
export const REPORTING_INDEXING_DELAY_DISCLOSURE =
  'PayPal Transaction Search has up to a 3-hour indexing delay; real-time partition balance is enforced by the VeriPact Clearing Ledger.';

/** Input for a transaction search (validated before any transport call). */
export interface TransactionSearchInput {
  startDateIso: string;
  endDateIso: string;
  /** 1..500, default 100 (PayPal page_size limits). */
  pageSize?: number;
}

/** Normalized transaction search result (both transports). */
export interface TransactionSearchResult {
  transportMode: TransportMode;
  records: ReportingRecord[];
  reportingScopeStatus: ReportingScopeStatus;
  indexingDelayDisclosure: string;
}

const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export interface ValidatedSearchWindow {
  startDateIso: string;
  endDateIso: string;
  pageSize: number;
}

/**
 * Validate the Reporting API constraints (GAP-06): RFC 3339 timestamps,
 * end after start, window ≤ 31 days, pageSize 1..500. Throws before any
 * transport call, so invalid windows never touch PayPal.
 */
export function validateSearchWindow(input: TransactionSearchInput): ValidatedSearchWindow {
  for (const [label, value] of [
    ['startDateIso', input.startDateIso],
    ['endDateIso', input.endDateIso],
  ] as const) {
    if (typeof value !== 'string' || !RFC3339_RE.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error(`paypal: ${label} must be an RFC 3339 timestamp (got ${String(value)})`);
    }
  }
  const startMs = Date.parse(input.startDateIso);
  const endMs = Date.parse(input.endDateIso);
  if (endMs <= startMs) {
    throw new Error('paypal: endDateIso must be after startDateIso');
  }
  if (endMs - startMs > MAX_RANGE_MS) {
    throw new ReportingRangeExceededError(input.startDateIso, input.endDateIso);
  }
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`paypal: pageSize must be an integer 1..${MAX_PAGE_SIZE} (got ${String(input.pageSize)})`);
  }
  return { startDateIso: input.startDateIso, endDateIso: input.endDateIso, pageSize };
}

/**
 * Map a PayPal `transaction_status` code to a VeriPact sync status:
 * S → CAPTURED, P → CREATED, V → VOIDED, D → DENIED. Unknown codes throw
 * (fail closed — never guess a money status).
 */
export function mapReportingStatusCode(code: string): ReportingRecord['status'] {
  switch (code) {
    case 'S':
      return 'CAPTURED';
    case 'P':
      return 'CREATED';
    case 'V':
      return 'VOIDED';
    case 'D':
      return 'DENIED';
    default:
      throw new Error(`paypal: unmapped reporting transaction_status code: ${code}`);
  }
}

function assertStatusCode(code: string): asserts code is ReportingStatusCode {
  if (code !== 'S' && code !== 'P' && code !== 'V' && code !== 'D') {
    throw new Error(`paypal: unmapped reporting transaction_status code: ${code}`);
  }
}

interface RawTransactionDetailJson {
  transaction_info?: {
    transaction_id?: string;
    transaction_status?: string;
    transaction_amount?: { currency_code?: string; value?: string };
    transaction_initiation_date?: string;
  };
}

interface RawSearchJson {
  transaction_details?: RawTransactionDetailJson[];
}

function parseReportingRecord(detail: RawTransactionDetailJson): ReportingRecord {
  const info = detail.transaction_info ?? {};
  const transactionId = info.transaction_id ?? '';
  const statusCode = info.transaction_status ?? '';
  if (transactionId.length === 0) {
    throw new Error('paypal: reporting record is missing transaction_id');
  }
  assertStatusCode(statusCode);
  return {
    transactionId,
    amountUsd: Number(info.transaction_amount?.value ?? '0'),
    currencyCode: info.transaction_amount?.currency_code ?? 'USD',
    statusCode,
    status: mapReportingStatusCode(statusCode),
    createdAtIso: info.transaction_initiation_date ?? '',
  };
}

/**
 * Build the honest live-failure fallback: replay + session-order records
 * labeled `FALLBACK_TO_REPLAY_AND_SESSION_ORDERS` with replay transport.
 * Used ONLY after a live reporting call fails (missing scope or dead
 * transport) — validation errors are thrown before any request and never
 * reach this path.
 */
export function buildReportingFallback(
  engine: SandboxReplayEngine,
  window: ValidatedSearchWindow,
): TransactionSearchResult {
  const { transaction_details } = engine.searchReportingTransactions({
    startIso: window.startDateIso,
    endIso: window.endDateIso,
    pageSize: window.pageSize,
  });
  return {
    transportMode: 'DETERMINISTIC_SANDBOX_REPLAY',
    records: transaction_details.map(parseReportingRecord),
    reportingScopeStatus: 'FALLBACK_TO_REPLAY_AND_SESSION_ORDERS',
    indexingDelayDisclosure: REPORTING_INDEXING_DELAY_DISCLOSURE,
  };
}

/**
 * Search transactions through the `PayPalApi` seam: live mode calls
 * `GET /v1/reporting/transactions`, replay mode serves the engine's
 * session-order view. Scope/transport fallback lives in the client's
 * `searchTransactions` method (it owns the replay engine for fallback
 * records); this function is the pure validated request + parse path.
 */
export async function searchTransactions(
  api: PayPalApi,
  input: TransactionSearchInput,
): Promise<TransactionSearchResult> {
  const window = validateSearchWindow(input);
  const params = new URLSearchParams({
    start_date: window.startDateIso,
    end_date: window.endDateIso,
    page_size: String(window.pageSize),
    page: '1',
    fields: 'all',
  });
  const { data } = await api.request<RawSearchJson>(
    'GET',
    `/v1/reporting/transactions?${params.toString()}`,
  );
  return {
    transportMode: api.transportMode,
    records: (data.transaction_details ?? []).map(parseReportingRecord),
    reportingScopeStatus:
      api.transportMode === 'LIVE_PAYPAL_SANDBOX'
        ? 'LIVE_REPORTING_SEARCH'
        : 'DETERMINISTIC_REPLAY_FIXTURE',
    indexingDelayDisclosure: REPORTING_INDEXING_DELAY_DISCLOSURE,
  };
}
