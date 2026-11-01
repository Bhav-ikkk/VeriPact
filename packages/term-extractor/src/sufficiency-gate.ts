/**
 * @veripact/term-extractor sufficiency-gate — mandate-aware 3-state decision.
 *
 * Red (BLOCK): adversarial page, mandate conflicts, or unresolvable unknowns.
 * Yellow (ASK_HUMAN_DELTA): core terms clean but shipping/tax indeterminate
 * (resolvable later via the PayPal shipping callback). Green (PROCEED): every
 * dimension determinate, compliant, and within the mandate cap.
 */
import type {
  GateDecision,
  MandateSpec,
  ObservedCriterion,
  ObservedTermSheet,
  TermReceipt,
} from '@veripact/core';

/** Mandate-aware gate outcome with human-readable rationale. */
export interface SufficiencyGateResult {
  decision: GateDecision;
  reasons: string[];
  /** Mandate cap minus base price (2dp); 0 when base is indeterminate. */
  headroomUsd: number;
  deltaPrompt?: string;
  allInTotalUsd?: number;
}

/** Resolved post-approval totals from the PayPal shipping callback. */
export interface PostApprovalResolvedTotals {
  itemTotalUsd: number;
  shippingUsd: number;
  taxUsd: number;
  finalTotalUsd: number;
}

/** Post-approval capture/void instruction. */
export interface PostApprovalRegateResult {
  action: 'CAPTURE' | 'VOID';
  reason: string;
  headroomRemainingUsd: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const usd = (n: number): string => `$${n.toFixed(2)}`;

function determinateValue<T>(criterion: ObservedCriterion<T>): T | undefined {
  return criterion.status === 'DETERMINATE' && criterion.value !== undefined
    ? criterion.value
    : undefined;
}

/**
 * Evaluate the 3-state sufficiency gate of observed terms against the
 * buyer mandate. Pure and deterministic.
 */
export function evaluateSufficiencyGate(
  mandate: MandateSpec,
  observed: ObservedTermSheet,
): SufficiencyGateResult {
  const cap = mandate.constraints.maxAllInPriceUsd;

  if (observed.pageIntegrity === 'ADVERSARIAL_DOM') {
    return {
      decision: 'BLOCK',
      reasons: ['page integrity ADVERSARIAL_DOM: hidden prompt-injection or payment-hijack content'],
      headroomUsd: 0,
    };
  }

  const title = determinateValue(observed.itemTitle);
  const condition = determinateValue(observed.condition);
  const base = determinateValue(observed.basePriceUsd);
  const ship = determinateValue(observed.shippingUsd);
  const tax = determinateValue(observed.taxUsd);
  const returns = determinateValue(observed.returnWindowDays);
  const restocking = determinateValue(observed.restockingFeePct);
  const allIn = determinateValue(observed.allInTotalUsd);

  const missingCore: string[] = [];
  if (title === undefined) {
    missingCore.push('brand_model');
  }
  if (condition === undefined) {
    missingCore.push('condition');
  }
  if (base === undefined) {
    missingCore.push('base_price_usd');
  }
  if (returns === undefined) {
    missingCore.push('return_window_days');
  }
  if (missingCore.length > 0) {
    return {
      decision: 'BLOCK',
      reasons: [`core terms indeterminate: ${missingCore.join(', ')}`],
      headroomUsd: 0,
    };
  }

  const required = mandate.constraints.requiredCondition.toUpperCase();
  if (condition !== undefined && condition.toUpperCase() !== required) {
    return {
      decision: 'BLOCK',
      reasons: [`condition conflict: observed ${condition} but mandate requires ${required}`],
      headroomUsd: 0,
    };
  }
  if (base !== undefined && base > cap) {
    return {
      decision: 'BLOCK',
      reasons: [`base price ${usd(base)} exceeds mandate cap ${usd(cap)}`],
      headroomUsd: round2(cap - base),
    };
  }
  if (allIn !== undefined && allIn > cap) {
    return {
      decision: 'BLOCK',
      reasons: [`all-in total ${usd(allIn)} exceeds mandate cap ${usd(cap)}`],
      headroomUsd: round2(cap - allIn),
    };
  }
  if (returns !== undefined && returns < mandate.constraints.minReturnWindowDays) {
    return {
      decision: 'BLOCK',
      reasons: [
        `return window ${returns}d below mandate minimum ${mandate.constraints.minReturnWindowDays}d`,
      ],
      headroomUsd: base !== undefined ? round2(cap - base) : 0,
    };
  }
  if (restocking !== undefined && restocking > mandate.constraints.maxRestockingFeePct) {
    return {
      decision: 'BLOCK',
      reasons: [
        `restocking fee ${restocking}% above mandate maximum ${mandate.constraints.maxRestockingFeePct}%`,
      ],
      headroomUsd: base !== undefined ? round2(cap - base) : 0,
    };
  }
  if (restocking === undefined) {
    // Spec-gap resolution (documented): restocking is a mandate-constrained
    // dimension that — unlike shipping/tax — never resolves post-approval,
    // so an unknown restocking fee can never become compliant: BLOCK.
    return {
      decision: 'BLOCK',
      reasons: ['restocking_fee_pct indeterminate: cannot verify the free-returns promise'],
      headroomUsd: base !== undefined ? round2(cap - base) : 0,
    };
  }

  const indeterminatePostApproval: string[] = [];
  if (ship === undefined) {
    indeterminatePostApproval.push('shipping_usd');
  }
  if (tax === undefined) {
    indeterminatePostApproval.push('tax_usd');
  }
  const headroomUsd = base !== undefined ? round2(cap - base) : 0;
  if (indeterminatePostApproval.length > 0) {
    const fields = indeterminatePostApproval.join(' and ');
    return {
      decision: 'ASK_HUMAN_DELTA',
      reasons: [`post-approval delta pending: ${fields} indeterminate (calculated at checkout)`],
      headroomUsd,
      deltaPrompt:
        `Core terms are clean and within mandate, but ${fields} will only resolve ` +
        `after the shipping address is known. Base ${usd(base ?? 0)} vs ${usd(cap)} cap ` +
        `leaves ${usd(headroomUsd)} headroom. Approve the delta to proceed.`,
      allInTotalUsd: allIn,
    };
  }

  if (allIn === undefined) {
    return {
      decision: 'BLOCK',
      reasons: ['malformed sheet: determinate components but indeterminate all-in total'],
      headroomUsd,
    };
  }
  if (allIn > cap) {
    return {
      decision: 'BLOCK',
      reasons: [`all-in total ${usd(allIn)} exceeds mandate cap ${usd(cap)}`],
      headroomUsd: round2(cap - allIn),
    };
  }
  return {
    decision: 'PROCEED',
    reasons: ['all dimensions determinate, compliant, and within mandate cap'],
    headroomUsd,
    allInTotalUsd: allIn,
  };
}

/**
 * Post-approval re-gate: after PayPal resolves final shipping/tax, decide
 * CAPTURE vs VOID deterministically from the mandate cap.
 */
export function evaluatePostApprovalReGate(
  mandate: MandateSpec,
  receipt: TermReceipt,
  resolved: PostApprovalResolvedTotals,
): PostApprovalRegateResult {
  const cap = mandate.constraints.maxAllInPriceUsd;
  const expected = round2(resolved.itemTotalUsd + resolved.shippingUsd + resolved.taxUsd);
  const headroomRemainingUsd = round2(cap - resolved.finalTotalUsd);
  if (Math.abs(expected - resolved.finalTotalUsd) > 0.01) {
    return {
      action: 'VOID',
      reason:
        `resolved totals inconsistent for ${receipt.listingUrl}: components sum ` +
        `${usd(expected)} but PayPal final is ${usd(resolved.finalTotalUsd)}`,
      headroomRemainingUsd,
    };
  }
  if (resolved.finalTotalUsd > cap) {
    return {
      action: 'VOID',
      reason:
        `final total ${usd(resolved.finalTotalUsd)} exceeds ${usd(cap)} cap ` +
        `(item ${usd(resolved.itemTotalUsd)} + shipping ${usd(resolved.shippingUsd)} + ` +
        `tax ${usd(resolved.taxUsd)}) at ${receipt.listingUrl}`,
      headroomRemainingUsd,
    };
  }
  return {
    action: 'CAPTURE',
    reason:
      `final total ${usd(resolved.finalTotalUsd)} within ${usd(cap)} cap; ` +
      `${usd(headroomRemainingUsd)} headroom remains`,
    headroomRemainingUsd,
  };
}
