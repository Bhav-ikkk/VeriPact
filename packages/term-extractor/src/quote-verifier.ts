/**
 * @veripact/term-extractor quote-verifier — substring-verified quote
 * extraction with deterministic value parsing.
 *
 * Anti-hallucination invariant: a candidate quote is accepted if and only
 * if its block exists AND the trimmed quote is an exact substring of the
 * cited visible block. All values parse exclusively from verified quotes.
 */
import type { ObservedCriterion, ObservedTermSheet } from '@veripact/core';
import type { DomScanResult, VisibleTextBlock } from './dom-scanner';

/** One candidate quote pinned to a visible block. */
export interface RawCandidate {
  blockId: string;
  verbatimQuote: string;
}

/** Per-attribute candidate quotes (LLM- or rule-supplied). */
export interface RawCandidateQuotes {
  brandModel?: RawCandidate;
  condition?: RawCandidate;
  basePriceUsd?: RawCandidate;
  shippingUsd?: RawCandidate;
  taxUsd?: RawCandidate;
  returnWindowDays?: RawCandidate;
  restockingFeePct?: RawCandidate;
}

export interface ExtractorOptions {
  llmCandidateProvider?: (visibleBlocks: VisibleTextBlock[]) => Promise<RawCandidateQuotes>;
}

/**
 * Hard substring check: block must exist and the trimmed quote must be an
 * exact character-for-character substring of the block text.
 */
export function verifyQuoteInBlocks(
  blockId: string,
  verbatimQuote: string,
  visibleBlocks: VisibleTextBlock[],
): boolean {
  const block = visibleBlocks.find((b) => b.blockId === blockId);
  if (!block) {
    return false;
  }
  const quote = verbatimQuote.trim();
  return quote.length > 0 && block.text.includes(quote);
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface PriceHit {
  value: number;
  start: number;
  end: number;
}

function priceHits(sentence: string): PriceHit[] {
  const hits: PriceHit[] = [];
  const re = /\$\s?([\d,]+(?:\.\d{2})?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sentence)) !== null) {
    const raw = (match[1] ?? '').replace(/,/g, '');
    const value = Number(raw);
    if (Number.isFinite(value)) {
      hits.push({ value, start: match.index, end: match.index + match[0].length });
    }
  }
  return hits;
}

const SHIP_WORDS = /\b(shipping|delivery|deliver|ships?|freight|postage)\b/i;
const TAX_WORDS = /\b(tax|taxes|vat|gst|duty|duties)\b/i;
const PRICE_WORDS = /\b(price|sale|total|only|now|was|cost|amount)\b/i;
const DISCOUNT_WORDS = /\b(save|savings|discount|off|coupon|rebate|deal)\b/i;

interface ClaimedHit extends PriceHit {
  blockId: string;
  sentIdx: number;
}

function overlapsClaimed(
  blockId: string,
  sentIdx: number,
  start: number,
  end: number,
  claimed: ClaimedHit[],
): boolean {
  return claimed.some(
    (c) => c.blockId === blockId && c.sentIdx === sentIdx && start < c.end && end > c.start,
  );
}

interface AnchoredHit {
  blockId: string;
  sentence: string;
  free: boolean;
}

/** Keyword-anchored money search (shipping/tax): price near the keyword, else free-form. */
function findAnchoredMoney(
  blocks: VisibleTextBlock[],
  keywords: RegExp,
  freePattern: RegExp,
  claimed: ClaimedHit[],
): AnchoredHit | undefined {
  for (const block of blocks) {
    const sentences = sentencesOf(block.text);
    for (let sentIdx = 0; sentIdx < sentences.length; sentIdx += 1) {
      const sentence = sentences[sentIdx] ?? '';
      if (freePattern.test(sentence)) {
        return { blockId: block.blockId, sentence, free: true };
      }
      if (!keywords.test(sentence)) {
        continue;
      }
      for (const hit of priceHits(sentence)) {
        if (!overlapsClaimed(block.blockId, sentIdx, hit.start, hit.end, claimed)) {
          claimed.push({ ...hit, blockId: block.blockId, sentIdx });
          return { blockId: block.blockId, sentence, free: false };
        }
      }
    }
  }
  return undefined;
}

/** Deterministic rule/pattern candidate extractor (no LLM, <5ms). */
export function extractRuleCandidates(blocks: VisibleTextBlock[]): RawCandidateQuotes {
  const out: RawCandidateQuotes = {};
  const claimed: ClaimedHit[] = [];

  const ship = findAnchoredMoney(blocks, SHIP_WORDS, /free\s+shipping/i, claimed);
  if (ship) {
    out.shippingUsd = { blockId: ship.blockId, verbatimQuote: ship.sentence };
  }
  const tax = findAnchoredMoney(blocks, TAX_WORDS, /tax\s+included|incl\.?\s+tax|zero\s+tax/i, claimed);
  if (tax) {
    out.taxUsd = { blockId: tax.blockId, verbatimQuote: tax.sentence };
  }

  const baseOptions: { blockId: string; sentence: string; penalized: boolean }[] = [];
  for (const block of blocks) {
    const sentences = sentencesOf(block.text);
    for (let sentIdx = 0; sentIdx < sentences.length; sentIdx += 1) {
      const sentence = sentences[sentIdx] ?? '';
      for (const hit of priceHits(sentence)) {
        if (!overlapsClaimed(block.blockId, sentIdx, hit.start, hit.end, claimed)) {
          baseOptions.push({
            blockId: block.blockId,
            sentence,
            penalized: DISCOUNT_WORDS.test(sentence) && !PRICE_WORDS.test(sentence),
          });
        }
      }
    }
  }
  baseOptions.sort((a, b) => Number(a.penalized) - Number(b.penalized));
  const base = baseOptions[0];
  if (base) {
    out.basePriceUsd = { blockId: base.blockId, verbatimQuote: base.sentence };
  }

  const titleBlock =
    blocks.find((b) => (b.tag === 'h1' || b.tag === 'h2' || b.tag === 'title') && b.text.length >= 3) ??
    blocks.find((b) => b.text.length >= 4);
  if (titleBlock) {
    out.brandModel = { blockId: titleBlock.blockId, verbatimQuote: titleBlock.text };
  }

  const CONDITION_RE =
    /\b(refurbished|renewed|pre-owned|preowned|open box|used|second-hand|brand new|new in box|new)\b/i;
  outerCondition: for (const block of blocks) {
    for (const sentence of sentencesOf(block.text)) {
      if (CONDITION_RE.test(sentence)) {
        out.condition = { blockId: block.blockId, verbatimQuote: sentence };
        break outerCondition;
      }
    }
  }

  const RETURN_RE = /(\d+)\s*-\s*day/i;
  const FINAL_SALE_RE = /final sale|no returns|non-returnable|all sales final/i;
  let returnHit: { blockId: string; sentence: string } | undefined;
  let finalSaleHit: { blockId: string; sentence: string } | undefined;
  for (const block of blocks) {
    for (const sentence of sentencesOf(block.text)) {
      if (!returnHit && RETURN_RE.test(sentence)) {
        returnHit = { blockId: block.blockId, sentence };
      }
      if (!finalSaleHit && FINAL_SALE_RE.test(sentence)) {
        finalSaleHit = { blockId: block.blockId, sentence };
      }
    }
  }
  const returns = returnHit ?? finalSaleHit;
  if (returns) {
    out.returnWindowDays = { blockId: returns.blockId, verbatimQuote: returns.sentence };
  }

  const RESTOCK_PCT_RE = /(\d+(?:\.\d+)?)\s*%\s*restocking/i;
  const RESTOCK_FREE_RE = /free returns|no restocking|\$0 restocking fee/i;
  outerRestock: for (const block of blocks) {
    for (const sentence of sentencesOf(block.text)) {
      if (RESTOCK_PCT_RE.test(sentence) || RESTOCK_FREE_RE.test(sentence)) {
        out.restockingFeePct = { blockId: block.blockId, verbatimQuote: sentence };
        break outerRestock;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Deterministic value parsers (verified quotes only)                 */
/* ------------------------------------------------------------------ */

/** First `$X.XX` figure in the quote, else undefined. */
export function parsePriceUsd(verbatimQuote: string): number | undefined {
  const match = /\$\s?([\d,]+(?:\.\d{2})?)/.exec(verbatimQuote);
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

/** Shipping dollars: 0 for free shipping, else the quoted figure. */
export function parseShippingUsd(verbatimQuote: string): number | undefined {
  if (/free\s+shipping/i.test(verbatimQuote)) {
    return 0;
  }
  return parsePriceUsd(verbatimQuote);
}

/** Tax dollars: 0 when included, else the quoted figure. */
export function parseTaxUsd(verbatimQuote: string): number | undefined {
  if (/tax\s+included|incl\.?\s+tax|zero\s+tax/i.test(verbatimQuote)) {
    return 0;
  }
  return parsePriceUsd(verbatimQuote);
}

/** Return window days: N from "N-day", 0 for final sale. */
export function parseReturnDays(verbatimQuote: string): number | undefined {
  const match = /(\d+)\s*-\s*day/i.exec(verbatimQuote);
  if (match?.[1]) {
    return Number(match[1]);
  }
  if (/final sale|no returns|non-returnable|all sales final/i.test(verbatimQuote)) {
    return 0;
  }
  return undefined;
}

/** Restocking percent: N from "N% restocking", 0 when free/none. */
export function parseRestockingPct(verbatimQuote: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*%\s*restocking/i.exec(verbatimQuote);
  if (match?.[1]) {
    return Number(match[1]);
  }
  if (/free returns|no restocking|\$0 restocking fee/i.test(verbatimQuote)) {
    return 0;
  }
  return undefined;
}

/** Condition enum from the verified quote. */
export function parseCondition(verbatimQuote: string): 'NEW' | 'REFURBISHED' | 'USED' | undefined {
  if (/\b(refurbished|renewed|pre-owned|preowned)\b/i.test(verbatimQuote)) {
    return 'REFURBISHED';
  }
  if (/\b(open box|used|second-hand)\b/i.test(verbatimQuote)) {
    return 'USED';
  }
  if (/\b(brand new|new in box|new)\b/i.test(verbatimQuote)) {
    return 'NEW';
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Observed-terms assembly                                            */
/* ------------------------------------------------------------------ */

function indeterminate<T>(note: string): ObservedCriterion<T> {
  return { status: 'INDETERMINATE', note };
}

function resolveTextCriterion(
  candidate: RawCandidate | undefined,
  blocks: VisibleTextBlock[],
): ObservedCriterion<string> {
  if (!candidate) {
    return indeterminate('NO_CANDIDATE');
  }
  if (!verifyQuoteInBlocks(candidate.blockId, candidate.verbatimQuote, blocks)) {
    return indeterminate('QUOTE_SUBSTRING_MISMATCH');
  }
  return {
    status: 'DETERMINATE',
    value: candidate.verbatimQuote.trim(),
    blockId: candidate.blockId,
    verbatimQuote: candidate.verbatimQuote.trim(),
  };
}

function resolveNumberCriterion(
  candidate: RawCandidate | undefined,
  blocks: VisibleTextBlock[],
  parse: (quote: string) => number | undefined,
): ObservedCriterion<number> {
  if (!candidate) {
    return indeterminate('NO_CANDIDATE');
  }
  if (!verifyQuoteInBlocks(candidate.blockId, candidate.verbatimQuote, blocks)) {
    return indeterminate('QUOTE_SUBSTRING_MISMATCH');
  }
  const value = parse(candidate.verbatimQuote);
  if (value === undefined) {
    return indeterminate('UNPARSEABLE_VERIFIED_QUOTE');
  }
  return {
    status: 'DETERMINATE',
    value,
    blockId: candidate.blockId,
    verbatimQuote: candidate.verbatimQuote.trim(),
  };
}

function resolveConditionCriterion(
  candidate: RawCandidate | undefined,
  blocks: VisibleTextBlock[],
): ObservedCriterion<string> {
  if (!candidate) {
    return indeterminate('NO_CANDIDATE');
  }
  if (!verifyQuoteInBlocks(candidate.blockId, candidate.verbatimQuote, blocks)) {
    return indeterminate('QUOTE_SUBSTRING_MISMATCH');
  }
  const value = parseCondition(candidate.verbatimQuote);
  if (value === undefined) {
    return indeterminate('UNPARSEABLE_VERIFIED_QUOTE');
  }
  return {
    status: 'DETERMINATE',
    value,
    blockId: candidate.blockId,
    verbatimQuote: candidate.verbatimQuote.trim(),
  };
}

/**
 * Extract observed terms: LLM candidates (when provided) take precedence
 * per attribute with deterministic rules as fallback; every candidate must
 * pass hard substring verification before any value is parsed.
 */
export async function extractObservedTerms(
  scan: DomScanResult,
  options: ExtractorOptions = {},
): Promise<ObservedTermSheet> {
  const blocks = scan.visibleBlocks;
  const llm = options.llmCandidateProvider ? await options.llmCandidateProvider(blocks) : {};
  const rules = extractRuleCandidates(blocks);
  const pick = (key: keyof RawCandidateQuotes): RawCandidate | undefined => llm[key] ?? rules[key];

  const basePriceUsd = resolveNumberCriterion(pick('basePriceUsd'), blocks, parsePriceUsd);
  const shippingUsd = resolveNumberCriterion(pick('shippingUsd'), blocks, parseShippingUsd);
  const taxUsd = resolveNumberCriterion(pick('taxUsd'), blocks, parseTaxUsd);

  let allInTotalUsd: ObservedCriterion<number>;
  if (
    basePriceUsd.status === 'DETERMINATE' &&
    shippingUsd.status === 'DETERMINATE' &&
    taxUsd.status === 'DETERMINATE' &&
    basePriceUsd.value !== undefined &&
    shippingUsd.value !== undefined &&
    taxUsd.value !== undefined
  ) {
    allInTotalUsd = {
      status: 'DETERMINATE',
      value: Math.round((basePriceUsd.value + shippingUsd.value + taxUsd.value) * 100) / 100,
      note: 'DERIVED_SUM',
    };
  } else {
    allInTotalUsd = indeterminate('COMPONENT_INDETERMINATE');
  }

  return {
    itemTitle: resolveTextCriterion(pick('brandModel'), blocks),
    condition: resolveConditionCriterion(pick('condition'), blocks),
    basePriceUsd,
    shippingUsd,
    taxUsd,
    returnWindowDays: resolveNumberCriterion(pick('returnWindowDays'), blocks, parseReturnDays),
    restockingFeePct: resolveNumberCriterion(pick('restockingFeePct'), blocks, parseRestockingPct),
    allInTotalUsd,
    pageIntegrity: scan.adversarialDomDetected ? 'ADVERSARIAL_DOM' : 'CLEAN',
    // The real headroom needs the mandate cap; the sufficiency gate computes
    // it in SufficiencyGateResult. The extractor reports a neutral zero.
    headroomRemainingUsd: 0,
  };
}
