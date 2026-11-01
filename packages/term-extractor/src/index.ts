/**
 * @veripact/term-extractor — visible-quote extraction and the sufficiency gate.
 *
 * Pure helpers (`looksHidden`, `containsAdversarialPhrase`,
 * `isExactSubstring`, `SufficiencyGate`) are real and tested. DOM/LLM
 * networked implementations land in later prompts.
 */
import type {
  GateDecision,
  ObservedCriterion,
  Referee,
  VerifiedQuote,
} from '@veripact/core';
import { NotImplementedError } from '@veripact/core';

export { NotImplementedError };

/** CSS heuristics that mark an element as hidden from a human reader. */
const HIDDEN_STYLE_RES = [
  /display\s*:\s*none/i,
  /visibility\s*:\s*hidden/i,
  /opacity\s*:\s*0(\.0*[0-4])?/i,
  /font-size\s*:\s*0(px)?\b/i,
  /font-size\s*:\s*1px/i,
  /left\s*:\s*-\d{3,}px/i,
  /top\s*:\s*-\d{3,}px/i,
];

/**
 * True when an inline style attribute (plus optional aria-hidden flag)
 * matches a hidden-node heuristic.
 */
export function looksHidden(styleAttr: string, ariaHidden = false): boolean {
  if (ariaHidden) {
    return true;
  }
  return HIDDEN_STYLE_RES.some((re) => re.test(styleAttr));
}

/** Known prompt-injection / payment-redirection phrases. */
const ADVERSARIAL_PHRASE_RE =
  /ignore\s+previous|system\s+prompt|send\s+to|paypal\.me\/|merchant_id\s*=|override\s+price/i;

/** True when text contains a known adversarial phrase. */
export function containsAdversarialPhrase(text: string): boolean {
  return ADVERSARIAL_PHRASE_RE.test(text);
}

/**
 * Deterministic anti-hallucination check: the LLM's verbatim quote must be
 * a non-empty exact substring of the cited visible block's text.
 */
export function isExactSubstring(blockText: string, quote: string): boolean {
  return quote.length > 0 && blockText.includes(quote);
}

/** One hidden node found by the pre-LLM scanner. */
export interface HiddenNodeFinding {
  selector: string;
  reason: string;
  text: string;
}

/** Pre-LLM deterministic DOM scanner contract. */
export interface IDomScanner {
  readonly name: string;
  scan(html: string): HiddenNodeFinding[];
}

/** Quote extractor contract (LLM + substring verifier in later prompts). */
export interface IQuoteExtractor {
  readonly name: string;
  extract(blocks: Array<{ blockId: string; selector: string; text: string }>): VerifiedQuote[];
}

/** Foundation stub: throws until the DOM/LLM wiring lands. */
export class DomScannerStub implements IDomScanner {
  readonly name = 'dom-scanner-stub';

  scan(_html: string): HiddenNodeFinding[] {
    throw new NotImplementedError('DomScanner.scan');
  }
}

/**
 * Deterministic 3-state gate over per-criterion statuses:
 * ADVERSARIAL_DOM or CONFLICT → BLOCK; any INDETERMINATE → ASK_HUMAN_DELTA;
 * all DETERMINATE → PROCEED.
 */
export class SufficiencyGate implements Referee<Array<ObservedCriterion<unknown>>, GateDecision> {
  readonly name = 'sufficiency-gate';

  decide(statuses: Array<ObservedCriterion<unknown>>): GateDecision {
    let sawIndeterminate = false;
    for (const criterion of statuses) {
      if (criterion.status === 'ADVERSARIAL_DOM' || criterion.status === 'CONFLICT') {
        return 'BLOCK';
      }
      if (criterion.status === 'INDETERMINATE') {
        sawIndeterminate = true;
      }
    }
    return sawIndeterminate ? 'ASK_HUMAN_DELTA' : 'PROCEED';
  }
}
