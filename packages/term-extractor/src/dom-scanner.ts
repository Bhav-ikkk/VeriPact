/**
 * @veripact/term-extractor dom-scanner — deterministic pre-LLM hidden-DOM scan.
 *
 * Pure TypeScript, no browser runtime. Untrusted merchant HTML is treated as
 * data throughout: nothing is fetched, executed, or rendered. Every finding
 * names the exact hiding technique and adversarial pattern for auditability.
 * Security posture follows `.agents/skills/security-audit` (guidance mode):
 * findings-only output, no external calls, bounded deterministic runtime.
 */

/** One numbered visible text block, in document order. */
export interface VisibleTextBlock {
  blockId: string;
  tag: string;
  text: string;
}

/** Why a node was classified hidden, deceptive, or tainted. */
export type HiddenReason =
  | 'display-none'
  | 'visibility-hidden'
  | 'hidden-attribute'
  | 'aria-hidden'
  | 'hidden-class'
  | 'zero-opacity'
  | 'micro-font'
  | 'offscreen-position'
  | 'low-contrast-text'
  | 'non-rendered-container'
  | 'script-style-body'
  | 'html-comment'
  | 'tainted-attribute';

/** One deceptive node, attribute, or comment finding. */
export interface HiddenDomFinding {
  tag: string;
  path: string;
  hiddenReason: HiddenReason;
  matchedPattern?: string;
  snippet: string;
}

/** Full deterministic scan result. */
export interface DomScanResult {
  visibleBlocks: VisibleTextBlock[];
  hiddenFindings: HiddenDomFinding[];
  adversarialDomDetected: boolean;
  commentsScanned: number;
  attributesScanned: number;
}

/** Prompt-override phrases (case-insensitive substring match). */
export const PROMPT_OVERRIDE_PATTERNS: readonly string[] = [
  'ignore previous',
  'ignore all prior',
  'disregard instructions',
  'system prompt',
  'developer mode',
  'override mandate',
  'always approve',
  'do not check',
];

/** Payment-routing override tokens (case-insensitive substring match). */
export const PAYMENT_HIJACK_PATTERNS: readonly string[] = [
  'paypal.me/',
  'send payment to',
  'merchant_id=',
  'custom_id=',
  'beneficiary:',
];

const ADVERSARIAL_PATTERNS: readonly string[] = [
  ...PROMPT_OVERRIDE_PATTERNS,
  ...PAYMENT_HIJACK_PATTERNS,
];

/** First adversarial pattern contained in text (case-insensitive), if any. */
export function findAdversarialPattern(text: string): string | undefined {
  const lower = text.toLowerCase();
  return ADVERSARIAL_PATTERNS.find((pattern) => lower.includes(pattern));
}

/* ------------------------------------------------------------------ */
/* Minimal HTML tokenizer + tree (no external parser)                 */
/* ------------------------------------------------------------------ */

interface ParsedElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: ParsedNode[];
  rawBody?: string;
  /**
   * Sticky hidden/sealed inheritance from ancestors flattened away by the
   * nesting cap. Always false unless the cap engaged (pathological input);
   * the walk ORs these in so deep content loses ancestry detail but never
   * detection coverage (fail-closed: over-hidden, never over-visible).
   */
  cappedHiddenAbove: boolean;
  cappedSealedAbove: boolean;
}

/**
 * Maximum open-element nesting tracked exactly. Real pages nest dozens
 * deep at most; beyond this the parser flattens ancestry (keeping every
 * node visitable) so hostile deeply-nested input cannot turn the walk,
 * path strings, or subtree re-scans quadratic.
 */
const MAX_NESTING_DEPTH = 256;

interface ParsedText {
  kind: 'text';
  text: string;
}

interface ParsedComment {
  kind: 'comment';
  text: string;
}

type ParsedNode = ParsedElement | ParsedText | ParsedComment;

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const NON_RENDERED_ELEMENTS = new Set(['script', 'style', 'template', 'noscript']);

function parseAttributes(
  source: string,
  start: number,
): { attrs: Record<string, string>; end: number; selfClosing: boolean } {
  const attrs: Record<string, string> = {};
  let i = start;
  const n = source.length;
  while (i < n) {
    while (i < n && /\s/.test(source[i] ?? '')) {
      i += 1;
    }
    if (i >= n) {
      break;
    }
    if (source[i] === '/' && source[i + 1] === '>') {
      return { attrs, end: i + 2, selfClosing: true };
    }
    if (source[i] === '>') {
      return { attrs, end: i + 1, selfClosing: false };
    }
    const nameMatch = /^[^\s=/>]+/.exec(source.slice(i));
    if (!nameMatch) {
      i += 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    i += nameMatch[0].length;
    while (i < n && /\s/.test(source[i] ?? '')) {
      i += 1;
    }
    let value = '';
    if (source[i] === '=') {
      i += 1;
      while (i < n && /\s/.test(source[i] ?? '')) {
        i += 1;
      }
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1);
        if (close === -1) {
          value = source.slice(i + 1);
          i = n;
        } else {
          value = source.slice(i + 1, close);
          i = close + 1;
        }
      } else {
        const valueMatch = /^[^\s>]+/.exec(source.slice(i));
        if (valueMatch) {
          value = valueMatch[0];
          i += valueMatch[0].length;
        }
      }
    }
    attrs[name] = value;
  }
  return { attrs, end: i, selfClosing: false };
}

function parseHtml(html: string): ParsedElement {
  const root: ParsedElement = {
    kind: 'element',
    tag: '#root',
    attrs: {},
    children: [],
    cappedHiddenAbove: false,
    cappedSealedAbove: false,
  };
  const stack: ParsedElement[] = [root];
  let cappedHiddenSticky = false;
  let cappedSealedSticky = false;
  const current = (): ParsedElement => stack[stack.length - 1] ?? root;
  const pushText = (text: string): void => {
    if (text.length > 0) {
      current().children.push({ kind: 'text', text });
    }
  };
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) {
      pushText(html.slice(i, lt));
    }
    const rest = html.slice(lt);
    if (rest.startsWith('<!--')) {
      const end = html.indexOf('-->', lt + 4);
      const text = end === -1 ? html.slice(lt + 4) : html.slice(lt + 4, end);
      current().children.push({ kind: 'comment', text });
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (/^<![^>]*>/.test(rest) || /^<\?[^?]*\?>/.test(rest)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const closeMatch = /^<\/\s*([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(rest);
    if (closeMatch?.[1]) {
      const tag = closeMatch[1].toLowerCase();
      let idx = stack.length - 1;
      while (idx > 0 && stack[idx]?.tag !== tag) {
        idx -= 1;
      }
      stack.length = Math.max(1, idx);
      i = lt + closeMatch[0].length;
      continue;
    }
    const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)\b/.exec(rest);
    if (!openMatch?.[1]) {
      pushText('<');
      i = lt + 1;
      continue;
    }
    const tag = openMatch[1].toLowerCase();
    const parsed = parseAttributes(html, lt + openMatch[0].length);
    const el: ParsedElement = {
      kind: 'element',
      tag,
      attrs: parsed.attrs,
      children: [],
      cappedHiddenAbove: cappedHiddenSticky,
      cappedSealedAbove: cappedSealedSticky,
    };
    current().children.push(el);
    i = parsed.end;
    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const tail = html.slice(i);
      const tailMatch = new RegExp(`</\\s*${tag}\\s*>`, 'i').exec(tail);
      if (tailMatch) {
        el.rawBody = tail.slice(0, tailMatch.index);
        i += tailMatch.index + tailMatch[0].length;
      } else {
        el.rawBody = tail;
        i = n;
      }
      continue;
    }
    if (!parsed.selfClosing && !VOID_ELEMENTS.has(tag)) {
      stack.push(el);
      while (stack.length > MAX_NESTING_DEPTH + 1) {
        const popped = stack.pop();
        if (popped && popped.tag !== '#root') {
          if (popped.cappedHiddenAbove || ownHiddenReason(popped) !== undefined) {
            cappedHiddenSticky = true;
          }
          if (popped.cappedSealedAbove || NON_RENDERED_ELEMENTS.has(popped.tag)) {
            cappedSealedSticky = true;
          }
        }
      }
    }
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* Hiding-technique detection                                         */
/* ------------------------------------------------------------------ */

function parseStyleDeclarations(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const prop = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim().toLowerCase();
    if (prop) {
      out[prop] = val;
    }
  }
  return out;
}

const HIDDEN_CLASS_TOKENS = new Set([
  'hidden',
  'invisible',
  'd-none',
  'sr-only',
  'visually-hidden',
  'screen-reader-only',
]);

function fontSizePx(value: string): number | undefined {
  const match = /^([0-9.]+)\s*(px|pt|rem|em|%)?$/.exec(value.trim());
  if (!match?.[1]) {
    return undefined;
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num)) {
    return undefined;
  }
  const unit = match[2];
  if (unit === undefined) {
    return num === 0 ? 0 : undefined;
  }
  if (unit === 'px') {
    return num;
  }
  if (unit === 'pt') {
    return (num * 96) / 72;
  }
  if (unit === 'rem' || unit === 'em') {
    return num * 16;
  }
  return (num / 100) * 16;
}

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  snow: '#fffafa',
  ivory: '#fffff0',
  whitesmoke: '#f5f5f5',
  ghostwhite: '#f8f8ff',
  floralwhite: '#fffaf0',
  black: '#000000',
};

function normalizeColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (NAMED_COLORS[v]) {
    return NAMED_COLORS[v];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!hex?.[1]) {
    return undefined;
  }
  const h = hex[1];
  return h.length === 3
    ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    : `#${h}`;
}

const NEAR_WHITE = new Set(['#ffffff', '#fffafa', '#fffff0', '#f5f5f5', '#f8f8ff', '#fffaf0']);

function ownHiddenReason(el: ParsedElement): HiddenReason | undefined {
  if ('hidden' in el.attrs) {
    return 'hidden-attribute';
  }
  if ((el.attrs['aria-hidden'] ?? '').toLowerCase() === 'true') {
    return 'aria-hidden';
  }
  const style = parseStyleDeclarations(el.attrs['style'] ?? '');
  if (style['display'] === 'none') {
    return 'display-none';
  }
  if (style['visibility'] === 'hidden' || style['visibility'] === 'collapse') {
    return 'visibility-hidden';
  }
  const classes = (el.attrs['class'] ?? '').toLowerCase().split(/\s+/);
  if (classes.some((c) => HIDDEN_CLASS_TOKENS.has(c))) {
    return 'hidden-class';
  }
  if (style['opacity'] !== undefined) {
    const opacity = Number(style['opacity']);
    if (Number.isFinite(opacity) && opacity < 0.05) {
      return 'zero-opacity';
    }
  }
  if (style['font-size'] !== undefined) {
    const px = fontSizePx(style['font-size']);
    if (px !== undefined && px < 2) {
      return 'micro-font';
    }
  }
  for (const prop of ['left', 'top', 'text-indent']) {
    const raw = style[prop];
    if (raw !== undefined) {
      const offscreen = /^(-?[0-9.]+)\s*px$/.exec(raw);
      if (offscreen?.[1] && Number(offscreen[1]) <= -100) {
        return 'offscreen-position';
      }
    }
  }
  if (style['clip'] !== undefined && /rect\s*\(\s*0/.test(style['clip'])) {
    return 'offscreen-position';
  }
  const fg = style['color'] ? normalizeColor(style['color']) : undefined;
  const bgRaw = style['background-color'] ?? style['background'];
  const bg = bgRaw ? normalizeColor(bgRaw.split(/\s+/)[0] ?? '') : undefined;
  if (fg && bg && (fg === bg || (NEAR_WHITE.has(fg) && NEAR_WHITE.has(bg)))) {
    return 'low-contrast-text';
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Scan                                                               */
/* ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'dt',
  'dd',
  'title',
  'button',
  'label',
]);

const INLINE_TAGS = new Set([
  'span',
  'a',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'abbr',
  'cite',
  'q',
  'samp',
  'var',
]);

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function snippetOf(text: string): string {
  return normalizeText(text).slice(0, 120);
}

interface WalkFrame {
  el: ParsedElement;
  path: string;
  hiddenAbove: boolean;
  sealedAbove: boolean;
}

interface ElementState {
  hidden: boolean;
  sealed: boolean;
  path: string;
  directText: string;
}

/**
 * Scan merchant HTML: partition visible blocks from hidden/deceptive nodes,
 * flag adversarial prompt-injection and payment-hijack content.
 * Deterministic, synchronous, offline — safe for unit tests and replays.
 */
export function scanMerchantHtml(html: string): DomScanResult {
  if (typeof html !== 'string') {
    throw new Error('scanMerchantHtml: html must be a string');
  }
  const root = parseHtml(html);
  const findings: HiddenDomFinding[] = [];
  const state = new Map<ParsedElement, ElementState>();
  const ordered: ParsedElement[] = [];
  let commentsScanned = 0;
  let attributesScanned = 0;

  const stack: WalkFrame[] = [{ el: root, path: '', hiddenAbove: false, sealedAbove: false }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const { el, path, hiddenAbove, sealedAbove } = frame;
    const isRoot = el.tag === '#root';
    const ownReason = isRoot ? undefined : ownHiddenReason(el);
    const inheritedHidden = hiddenAbove || el.cappedHiddenAbove;
    const inheritedSealed = sealedAbove || el.cappedSealedAbove;
    const hidden = inheritedHidden || ownReason !== undefined;
    const sealedHere = inheritedSealed || NON_RENDERED_ELEMENTS.has(el.tag);
    const directText = el.children
      .map((c) => (c.kind === 'text' ? c.text : ''))
      .join(' ');
    if (!isRoot) {
      state.set(el, { hidden, sealed: sealedHere, path, directText });
      ordered.push(el);
    }

    for (const [name, value] of Object.entries(el.attrs)) {
      attributesScanned += 1;
      const matched = findAdversarialPattern(`${name}=${value}`);
      if (matched) {
        findings.push({
          tag: el.tag,
          path,
          hiddenReason: 'tainted-attribute',
          matchedPattern: matched,
          snippet: snippetOf(`${name}="${value}"`),
        });
      }
    }

    if (el.rawBody !== undefined) {
      const matched = findAdversarialPattern(el.rawBody);
      if (matched) {
        findings.push({
          tag: el.tag,
          path,
          hiddenReason: 'script-style-body',
          matchedPattern: matched,
          snippet: snippetOf(el.rawBody),
        });
      }
    }

    if (!isRoot && ownReason !== undefined) {
      const subtree = subtreeText(el, state, true);
      findings.push({
        tag: el.tag,
        path,
        hiddenReason: ownReason,
        matchedPattern: findAdversarialPattern(subtree),
        snippet: snippetOf(subtree || Object.entries(el.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')),
      });
    }

    const elementKids: ParsedElement[] = [];
    for (const child of el.children) {
      if (child.kind === 'comment') {
        commentsScanned += 1;
        const matched = findAdversarialPattern(child.text);
        if (matched) {
          findings.push({
            tag: '#comment',
            path: path ? `${path} > #comment` : '#comment',
            hiddenReason: 'html-comment',
            matchedPattern: matched,
            snippet: snippetOf(child.text),
          });
        }
      } else if (child.kind === 'element') {
        elementKids.push(child);
      }
    }
    for (let k = elementKids.length - 1; k >= 0; k -= 1) {
      const child = elementKids[k] as ParsedElement;
      const childPath = path ? `${path} > ${child.tag}[${k}]` : `${child.tag}[${k}]`;
      stack.push({ el: child, path: childPath, hiddenAbove: hidden, sealedAbove: sealedHere });
    }
  }

  // Sealed-container (template/noscript) findings for elements with direct text.
  for (const el of ordered) {
    const st = state.get(el);
    if (st && st.sealed && !NON_RENDERED_ELEMENTS.has(el.tag) && normalizeText(st.directText)) {
      findings.push({
        tag: el.tag,
        path: st.path,
        hiddenReason: 'non-rendered-container',
        matchedPattern: findAdversarialPattern(st.directText),
        snippet: snippetOf(st.directText),
      });
    }
  }

  const visibleBlocks = emitVisibleBlocks(root, state);
  return {
    visibleBlocks,
    hiddenFindings: findings,
    adversarialDomDetected: findings.some((f) => f.matchedPattern !== undefined),
    commentsScanned,
    attributesScanned,
  };
}

function subtreeText(
  el: ParsedElement,
  state: Map<ParsedElement, ElementState>,
  includeConcealed: boolean,
): string {
  const parts: string[] = [];
  const stack: ParsedElement[] = [el];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      break;
    }
    for (const child of node.children) {
      if (child.kind === 'text') {
        parts.push(child.text);
      } else if (child.kind === 'element') {
        const st = state.get(child);
        // Findings must see through nested concealment (an injection one
        // level down is still an injection); visible emission keeps the
        // strict filter so hidden text never leaks into quotes.
        if (includeConcealed || !st || (!st.hidden && !st.sealed)) {
          stack.push(child);
        }
      }
    }
  }
  return parts.join(' ');
}

function emitVisibleBlocks(
  root: ParsedElement,
  state: Map<ParsedElement, ElementState>,
): VisibleTextBlock[] {
  const blocks: VisibleTextBlock[] = [];
  const covered = new Set<ParsedElement>();
  let counter = 0;
  const emit = (tag: string, text: string): void => {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }
    counter += 1;
    blocks.push({ blockId: `B${String(counter).padStart(3, '0')}`, tag, text: normalized });
  };
  const markCovered = (el: ParsedElement): void => {
    const stack: ParsedElement[] = [el];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || covered.has(node)) {
        continue;
      }
      covered.add(node);
      for (const child of node.children) {
        if (child.kind === 'element') {
          stack.push(child);
        }
      }
    }
  };
  const walk: ParsedElement[] = [root];
  while (walk.length > 0) {
    const el = walk.pop();
    if (!el || covered.has(el)) {
      continue;
    }
    const st = el.tag === '#root' ? undefined : state.get(el);
    const visible = el.tag === '#root' || (st !== undefined && !st.hidden && !st.sealed);
    if (!visible) {
      continue;
    }
    if (BLOCK_TAGS.has(el.tag)) {
      const text = subtreeText(el, state, false);
      if (normalizeText(text)) {
        emit(el.tag, text);
        markCovered(el);
        continue;
      }
    }
    if (el.tag !== '#root' && (INLINE_TAGS.has(el.tag) || el.tag === 'body' || el.tag === 'html')) {
      const direct = st ? st.directText : '';
      if (normalizeText(direct)) {
        emit(el.tag, direct);
      }
    }
    for (let k = el.children.length - 1; k >= 0; k -= 1) {
      const child = el.children[k];
      if (child?.kind === 'element') {
        walk.push(child);
      } else if (child?.kind === 'text' && (el.tag === 'body' || el.tag === '#root')) {
        if (normalizeText(child.text)) {
          emit('body', child.text);
        }
      }
    }
  }
  return blocks;
}

/** Pre-LLM deterministic DOM scanner contract. */
export interface IDomScanner {
  readonly name: string;
  scan(html: string): { selector: string; reason: string; text: string }[];
}

/**
 * Deterministic DOM scanner: adapts `scanMerchantHtml` findings to the
 * legacy `{ selector, reason, text }` shape (selector = element path).
 */
export class DomScanner implements IDomScanner {
  readonly name = 'dom-scanner';

  scan(html: string): { selector: string; reason: string; text: string }[] {
    return scanMerchantHtml(html).hiddenFindings.map((f) => ({
      selector: f.path,
      reason: f.hiddenReason,
      text: f.snippet,
    }));
  }
}
