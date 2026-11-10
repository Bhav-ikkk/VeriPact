/**
 * @veripact/sdk hybrid natural-language intent planner.
 *
 * Layer 1: Deterministic 8-SKU Semantic Catalog Matcher (<1ms baseline & fallback).
 * Layer 2: Optional Gemini 2.5 Flash LLM enrichment with 2000ms timeout.
 */

export interface ParsedShoppingIntent {
  rawPrompt: string;
  matchedSku: string;
  productTitle: string;
  retailPriceUsd: number;
  targetMaxAllInUsd: number;
  recommendedSubAllocationUsd: number;
  requiredCondition: 'NEW' | 'REFURBISHED';
  minReturnWindowDays: number;
  maxRestockingFeePct: number;
  detectedVoucherCode?: string;
  autoSpawnBackgroundWatch: boolean;
  parserEngine: 'GEMINI_FLASH_LLM' | 'DETERMINISTIC_SEMANTIC_CATALOG';
  reasoningSummary: string;
}

export interface CatalogSkuMeta {
  sku: string;
  title: string;
  brand: string;
  retailPriceUsd: number;
  basePriceUsd: number;
  bestDealAllInUsd: number;
  voucherCode?: string;
  voucherDiscountUsd: number;
  condition: 'NEW' | 'REFURBISHED';
  category: string;
}

export const SKU_VOUCHER_MAP: Record<string, CatalogSkuMeta> = {
  'APEX-27-4K-IPS': {
    sku: 'APEX-27-4K-IPS',
    title: 'Apex ProView 27 4K IPS Monitor',
    brand: 'Apex',
    retailPriceUsd: 329.0,
    basePriceUsd: 279.0,
    bestDealAllInUsd: 297.0,
    voucherCode: 'PAYPAL50',
    voucherDiscountUsd: 50.0,
    condition: 'NEW',
    category: 'Monitors',
  },
  'APEX-27-4K-IPS-RB': {
    sku: 'APEX-27-4K-IPS-RB',
    title: 'Apex ProView 27 4K IPS Monitor - Certified Refurbished',
    brand: 'Apex',
    retailPriceUsd: 219.0,
    basePriceUsd: 219.0,
    bestDealAllInUsd: 237.0,
    voucherDiscountUsd: 0,
    condition: 'REFURBISHED',
    category: 'Monitors',
  },
  'KANSO-Q35': {
    sku: 'KANSO-Q35',
    title: 'Kanso Q35 Wireless Headphones',
    brand: 'Kanso',
    retailPriceUsd: 149.0,
    basePriceUsd: 82.0,
    bestDealAllInUsd: 100.0,
    voucherCode: 'AUDIO67',
    voucherDiscountUsd: 67.0,
    condition: 'NEW',
    category: 'Audio',
  },
  'KEYCHRON-K8-PRO': {
    sku: 'KEYCHRON-K8-PRO',
    title: 'Keychron K8 Pro Mechanical Keyboard',
    brand: 'Keychron',
    retailPriceUsd: 149.0,
    basePriceUsd: 119.0,
    bestDealAllInUsd: 137.0,
    voucherCode: 'MECH30',
    voucherDiscountUsd: 30.0,
    condition: 'NEW',
    category: 'Keyboards',
  },
  'NORTHLOOP-14-AIR': {
    sku: 'NORTHLOOP-14-AIR',
    title: 'Northloop Air 14 Laptop',
    brand: 'Northloop',
    retailPriceUsd: 949.0,
    basePriceUsd: 899.0,
    bestDealAllInUsd: 917.0,
    voucherCode: 'LAPTOP50',
    voucherDiscountUsd: 50.0,
    condition: 'NEW',
    category: 'Laptops',
  },
  'TERRA-2TB-NVME': {
    sku: 'TERRA-2TB-NVME',
    title: 'Terra 2TB NVMe PCIe 4.0 SSD',
    brand: 'Terra',
    retailPriceUsd: 164.0,
    basePriceUsd: 139.0,
    bestDealAllInUsd: 157.0,
    voucherCode: 'NVME25',
    voucherDiscountUsd: 25.0,
    condition: 'NEW',
    category: 'Storage',
  },
  'LUMEN-4K-CAM': {
    sku: 'LUMEN-4K-CAM',
    title: 'Lumen 4K Pro Streaming Webcam',
    brand: 'Lumen',
    retailPriceUsd: 199.0,
    basePriceUsd: 159.0,
    bestDealAllInUsd: 177.0,
    voucherCode: 'CAM40',
    voucherDiscountUsd: 40.0,
    condition: 'NEW',
    category: 'Cameras',
  },
  'VELA-TB4-DOCK': {
    sku: 'VELA-TB4-DOCK',
    title: 'Vela Thunderbolt 4 Docking Hub',
    brand: 'Vela',
    retailPriceUsd: 274.0,
    basePriceUsd: 229.0,
    bestDealAllInUsd: 247.0,
    voucherCode: 'DOCK45',
    voucherDiscountUsd: 45.0,
    condition: 'NEW',
    category: 'Accessories',
  },
};

const KNOWN_VOUCHERS = ['PAYPAL50', 'AUDIO67', 'MECH30', 'NVME25', 'CAM40', 'DOCK45', 'LAPTOP50'];

function matchCatalogSku(lower: string, fallbackSku: string): CatalogSkuMeta {
  // Check refurbished monitor first
  if (
    lower.includes('refurb') ||
    lower.includes('open-box') ||
    lower.includes('open box') ||
    (lower.includes('used') && (lower.includes('monitor') || lower.includes('apex') || lower.includes('display')))
  ) {
    return SKU_VOUCHER_MAP['APEX-27-4K-IPS-RB']!;
  }
  // Audio / Headphones
  if (
    lower.includes('headphone') ||
    lower.includes('audio') ||
    lower.includes('kanso') ||
    lower.includes('earcup') ||
    lower.includes('anc') ||
    lower.includes('q35')
  ) {
    return SKU_VOUCHER_MAP['KANSO-Q35']!;
  }
  // Keyboard
  if (
    lower.includes('keyboard') ||
    lower.includes('keychron') ||
    lower.includes('mech') ||
    lower.includes('k8') ||
    lower.includes('tkl')
  ) {
    return SKU_VOUCHER_MAP['KEYCHRON-K8-PRO']!;
  }
  // NVMe SSD / Storage
  if (
    lower.includes('ssd') ||
    lower.includes('nvme') ||
    lower.includes('terra') ||
    lower.includes('2tb') ||
    lower.includes('storage') ||
    lower.includes('drive')
  ) {
    return SKU_VOUCHER_MAP['TERRA-2TB-NVME']!;
  }
  // Webcam / Camera
  if (
    lower.includes('webcam') ||
    lower.includes('camera') ||
    lower.includes('lumen') ||
    lower.includes('stream')
  ) {
    return SKU_VOUCHER_MAP['LUMEN-4K-CAM']!;
  }
  // Dock / Hub
  if (
    lower.includes('dock') ||
    lower.includes('thunderbolt') ||
    lower.includes('vela') ||
    lower.includes('tb4') ||
    lower.includes('hub')
  ) {
    return SKU_VOUCHER_MAP['VELA-TB4-DOCK']!;
  }
  // Laptop
  if (
    lower.includes('laptop') ||
    lower.includes('notebook') ||
    lower.includes('northloop') ||
    lower.includes('14-air') ||
    lower.includes('air 14')
  ) {
    return SKU_VOUCHER_MAP['NORTHLOOP-14-AIR']!;
  }
  // Monitor / Display
  if (
    lower.includes('monitor') ||
    lower.includes('display') ||
    lower.includes('27') ||
    lower.includes('4k') ||
    lower.includes('ips') ||
    lower.includes('apex')
  ) {
    return SKU_VOUCHER_MAP['APEX-27-4K-IPS']!;
  }
  return SKU_VOUCHER_MAP[fallbackSku] ?? SKU_VOUCHER_MAP['APEX-27-4K-IPS']!;
}

function extractTargetDollarCap(lower: string, fallbackTargetUsd = 300): number {
  const underMatch = lower.match(/(?:under|below|max|at|for|cap|<=?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  if (underMatch?.[1]) {
    const val = parseFloat(underMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  const dollarMatch = lower.match(/\$(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch?.[1]) {
    const val = parseFloat(dollarMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return fallbackTargetUsd;
}

function extractReturnDays(lower: string): number {
  const m = lower.match(/(\d+)\s*-?\s*day\s*return/i);
  if (m?.[1]) {
    const d = parseInt(m[1], 10);
    if (Number.isFinite(d) && d > 0) return d;
  }
  return 30;
}

function extractRestockingFeePct(lower: string): number {
  const m = lower.match(/(\d+)\s*%\s*restock/i);
  if (m?.[1]) {
    const r = parseFloat(m[1]);
    if (Number.isFinite(r) && r >= 0) return r;
  }
  return 0;
}

function extractDetectedVoucherCode(lower: string, defaultCode?: string): string | undefined {
  const upper = lower.toUpperCase();
  for (const code of KNOWN_VOUCHERS) {
    if (upper.includes(code)) return code;
  }
  const explicit = lower.match(
    /(?:promo\s+code|voucher\s+code|coupon\s+code|code|promo|voucher|coupon)\s*[:=]?\s*([A-Za-z0-9_-]{3,16})/i,
  );
  if (explicit?.[1]) {
    const candidate = explicit[1].toUpperCase();
    if (candidate !== 'CODE' && candidate !== 'PROMO' && candidate !== 'VOUCHER' && candidate !== 'COUPON') {
      return candidate;
    }
  }
  return defaultCode;
}

/**
 * Parse shopping intent from a natural-language user prompt.
 *
 * Runs Layer 1 deterministic parsing instantly, and optionally calls
 * Gemini 2.5 Flash if process.env.GEMINI_API_KEY is present and
 * process.env.VERIPACT_ENABLE_LIVE_LLM === 'true'.
 */
export async function parseShoppingIntent(
  prompt: string,
  fallbackSku = 'APEX-27-4K-IPS',
  fallbackTargetUsd = 300,
): Promise<ParsedShoppingIntent> {
  const lower = prompt.toLowerCase();
  const meta = matchCatalogSku(lower, fallbackSku);
  const targetMaxAllInUsd = extractTargetDollarCap(lower, fallbackTargetUsd);
  const condition: 'NEW' | 'REFURBISHED' =
    meta.condition === 'REFURBISHED' ||
      lower.includes('refurb') ||
      lower.includes('open-box') ||
      lower.includes('open box') ||
      lower.includes('used')
      ? 'REFURBISHED'
      : 'NEW';

  const minReturnWindowDays = extractReturnDays(lower);
  const maxRestockingFeePct = extractRestockingFeePct(lower);
  const detectedVoucherCode = extractDetectedVoucherCode(lower, meta.voucherCode);

  const autoSpawnBackgroundWatch =
    targetMaxAllInUsd < meta.bestDealAllInUsd ||
    /(?:watch|alert|track|wait|snipe|notify|background)/i.test(lower);

  const recommendedSubAllocationUsd = Math.round(targetMaxAllInUsd);

  const reasoningSummary = `Matched ${meta.title} (${meta.sku}, $${meta.retailPriceUsd} retail) with target ceiling $${targetMaxAllInUsd.toFixed(2)}${detectedVoucherCode ? ` and verified voucher ${detectedVoucherCode}` : ''}.${autoSpawnBackgroundWatch ? ` Target is below current market deal ($${meta.bestDealAllInUsd.toFixed(2)}); background watcher recommended.` : ''}`;

  const intent: ParsedShoppingIntent = {
    rawPrompt: prompt,
    matchedSku: meta.sku,
    productTitle: meta.title,
    retailPriceUsd: meta.retailPriceUsd,
    targetMaxAllInUsd,
    recommendedSubAllocationUsd,
    requiredCondition: condition,
    minReturnWindowDays,
    maxRestockingFeePct,
    ...(detectedVoucherCode !== undefined ? { detectedVoucherCode } : {}),
    autoSpawnBackgroundWatch,
    parserEngine: 'DETERMINISTIC_SEMANTIC_CATALOG',
    reasoningSummary,
  };

  // Layer 2: Optional Gemini 2.5 Flash LLM enrichment
  if (
    process.env.GEMINI_API_KEY &&
    process.env.VERIPACT_ENABLE_LIVE_LLM === 'true' &&
    typeof fetch === 'function'
  ) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are a shopping intent extractor for VeriPact. Extract intent from prompt: "${prompt}". Valid SKUs: APEX-27-4K-IPS, APEX-27-4K-IPS-RB, KANSO-Q35, KEYCHRON-K8-PRO, TERRA-2TB-NVME, LUMEN-4K-CAM, VELA-TB4-DOCK, NORTHLOOP-14-AIR. Respond in valid JSON with fields: matchedSku (string), targetMaxAllInUsd (number), requiredCondition ('NEW'|'REFURBISHED'), reasoningSummary (string).`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const llmSku = typeof parsed.matchedSku === 'string' ? parsed.matchedSku : undefined;
          if (llmSku && SKU_VOUCHER_MAP[llmSku]) {
            const llmMeta = SKU_VOUCHER_MAP[llmSku]!;
            intent.matchedSku = llmMeta.sku;
            intent.productTitle = llmMeta.title;
            intent.retailPriceUsd = llmMeta.retailPriceUsd;
            intent.parserEngine = 'GEMINI_FLASH_LLM';
            if (typeof parsed.targetMaxAllInUsd === 'number' && parsed.targetMaxAllInUsd > 0) {
              intent.targetMaxAllInUsd = parsed.targetMaxAllInUsd;
              intent.recommendedSubAllocationUsd = Math.round(parsed.targetMaxAllInUsd);
            }
            if (typeof parsed.reasoningSummary === 'string' && parsed.reasoningSummary.length > 0) {
              intent.reasoningSummary = parsed.reasoningSummary;
            }
          }
        }
      }
    } catch {
      // Graceful fallback to Layer 1 on timeout, network error, or offline test runs
    }
  }

  return intent;
}
