/**
 * Secret-pattern detection — docs/spec/04-rules-radar.md §4.8.
 *
 * Deterministic pattern matching, nothing else. No semantic classification, no
 * entropy heuristic, no model: a fixed list of shapes that are unambiguously
 * credentials. False positives are cheap here (a warning you can dismiss);
 * false negatives are not.
 *
 * The matched text is never returned to a caller that transmits it, never
 * logged, and never included in a signal's facts. `Match.preview` is a redacted
 * span deliberately — the rule has to be able to say *where* without saying
 * *what*.
 */

export type SecretMatch = {
  readonly patternId: string;
  /** Offsets into the scanned text, so the UI can offer to remove the span. */
  readonly start: number;
  readonly end: number;
  /** Redacted. First four characters, then a mask — never the secret itself. */
  readonly preview: string;
};

type Pattern = { readonly id: string; readonly regex: RegExp };

/**
 * Anchored on shape, not on the word "secret". Each entry is a credential
 * format with a published prefix or structure, so a match is a fact rather than
 * a guess.
 */
const PATTERNS: readonly Pattern[] = [
  { id: 'PEM_PRIVATE_KEY', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'BEARER_JWT', regex: /Bearer\s+ey[A-Za-z0-9._-]{20,}/g },
  { id: 'JWT', regex: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'AWS_ACCESS_KEY', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'GOOGLE_API_KEY', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'SLACK_TOKEN', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g },
  { id: 'GITHUB_TOKEN', regex: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g },
  {
    id: 'ASSIGNED_SECRET',
    regex: /\b(?:password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*\S{8,}/gi,
  },
  { id: 'CONNECTION_STRING', regex: /[;\s][Pp]assword=[^;\s]{4,}/g },
];

/** Four characters of context, then a mask. Enough to find it, not to use it. */
function redact(matched: string): string {
  const head = matched.slice(0, 4);
  return `${head}${'•'.repeat(Math.min(12, Math.max(3, matched.length - 4)))}`;
}

export function scanForSecrets(text: string | undefined): SecretMatch[] {
  if (!text) return [];

  const matches: SecretMatch[] = [];
  for (const { id, regex } of PATTERNS) {
    // A fresh instance per scan: a shared global regex carries `lastIndex`
    // between calls, which makes results depend on call order — exactly the
    // non-determinism this package forbids.
    const scanner = new RegExp(regex.source, regex.flags);
    let found: RegExpExecArray | null;
    while ((found = scanner.exec(text)) !== null) {
      matches.push({
        patternId: id,
        start: found.index,
        end: found.index + found[0].length,
        preview: redact(found[0]),
      });
      // A zero-length match would loop forever.
      if (found[0].length === 0) scanner.lastIndex += 1;
    }
  }

  return matches.sort((a, b) => a.start - b.start || a.patternId.localeCompare(b.patternId));
}

export function hasSecret(text: string | undefined): boolean {
  return scanForSecrets(text).length > 0;
}

/** Every pattern id, so the settings screen and the tests can enumerate them. */
export const SECRET_PATTERN_IDS: readonly string[] = PATTERNS.map((p) => p.id);
