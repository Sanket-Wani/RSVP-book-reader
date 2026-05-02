/**
 * RSVPEngine.ts
 *
 * Faithful TypeScript port of src/reader/ReadingLoop.cpp and its helper
 * functions from the RSVP Nano firmware. Every constant, threshold, and
 * algorithm is preserved with exact numeric fidelity.
 *
 * Key differences from C++:
 *  - JS strings are UTF-16; character classification operates on individual
 *    code units (char codes) which is correct for ASCII/Latin-1 text that
 *    has already been normalized to NFC by the importer.
 *  - Arduino `String` → JS `string`. `uint32_t` → `number` (safe up to 2^53).
 */

// ───────────────────── Constants (from ReadingLoop.cpp) ─────────────────────

const MIN_WPM = 100;
const MAX_WPM = 1000;
const WPM_STEP = 25;

const LONG_WORD_AFTER_CHARS = 6;
const LONG_WORD_PERCENT_PER_CHAR = 6;
const VERY_LONG_WORD_AFTER_CHARS = 10;
const VERY_LONG_WORD_PERCENT_PER_CHAR = 9;
const ULTRA_LONG_WORD_AFTER_CHARS = 14;
const ULTRA_LONG_WORD_PERCENT_PER_CHAR = 12;
const LONG_WORD_MAX_PERCENT = 170;

const COMPOUND_JOINER_PERCENT = 14;
const LONG_COMPOUND_WORD_PERCENT = 18;
const TECHNICAL_CONNECTOR_PERCENT = 8;

const SYLLABLE_BONUS_AFTER_COUNT = 2;
const SYLLABLE_BONUS_PERCENT_PER_GROUP = 10;
const SYLLABLE_BONUS_MAX_PERCENT = 50;

const ALL_CAPS_COMPLEXITY_PERCENT = 14;
const MIXED_TOKEN_COMPLEXITY_PERCENT = 22;
const NUMERIC_TOKEN_COMPLEXITY_PERCENT = 10;
const DENSE_CONNECTOR_COMPLEXITY_PERCENT = 12;
const COMPLEX_WORD_MAX_PERCENT = 85;

const COMMA_PAUSE_PERCENT = 45;
const DASH_PAUSE_PERCENT = 60;
const CLAUSE_PAUSE_PERCENT = 80;
const ELLIPSIS_PAUSE_PERCENT = 110;
const SENTENCE_PAUSE_PERCENT = 135;
const STRONG_SENTENCE_PAUSE_PERCENT = 150;

const MAX_CATCH_UP_WORDS = 4;
const MAX_PACING_DELAY_MS = 600;

// ───────────────── Character Classification (from LatinText.h) ──────────────

function isLetterChar(c: string): boolean {
  const code = c.charCodeAt(0);
  // A-Z, a-z, or Latin-1 supplement letters (À-Ö, Ø-ö, ø-ÿ)
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 0xc0 && code <= 0xd6) ||
    (code >= 0xd8 && code <= 0xf6) ||
    (code >= 0xf8 && code <= 0xff)
  );
}

function isDigitChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isWordChar(c: string): boolean {
  return isLetterChar(c) || isDigitChar(c);
}

function isUppercaseChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 0xc0 && code <= 0xd6) ||
    (code >= 0xd8 && code <= 0xde)
  );
}

function isLowercaseChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return (
    (code >= 97 && code <= 122) ||
    code === 0xdf ||
    (code >= 0xe0 && code <= 0xf6) ||
    (code >= 0xf8 && code <= 0xff)
  );
}

function isVowelChar(c: string): boolean {
  const lowered = c.toLowerCase();
  return 'aeiouy'.includes(lowered) ||
    'àáâãäåæèéêëìíîïòóôõöøùúûüýÿ'.includes(lowered);
}

function isSegmentSeparator(c: string): boolean {
  return c === '-' || c === '/' || c === '_';
}

function isTechnicalConnector(c: string): boolean {
  return c === '-' || c === '/' || c === '_' || c === '.' || c === '+' || c === '\\';
}

function isIgnoredTrailingChar(c: string): boolean {
  return c === '"' || c === "'" || c === ')' || c === ']' || c === '}';
}

// ──────────────────── Word Analysis Functions ───────────────────────────────

function letterCharCount(word: string): number {
  let count = 0;
  for (const c of word) {
    if (isLetterChar(c)) count++;
  }
  return count;
}

function digitCharCount(word: string): number {
  let count = 0;
  for (const c of word) {
    if (isDigitChar(c)) count++;
  }
  return count;
}

function uppercaseLetterCount(word: string): number {
  let count = 0;
  for (const c of word) {
    if (isUppercaseChar(c)) count++;
  }
  return count;
}

function readableCharCount(word: string): number {
  let count = 0;
  for (const c of word) {
    if (isWordChar(c)) count++;
  }
  return count;
}

function approximateSyllableGroupCount(word: string): number {
  let groups = 0;
  let letterCount = 0;
  let previousWasVowel = false;
  let lettersOnly = '';

  for (const c of word) {
    if (!isLetterChar(c)) {
      previousWasVowel = false;
      continue;
    }
    letterCount++;
    const lowered = c.toLowerCase();
    lettersOnly += lowered;

    const vowel = isVowelChar(lowered);
    if (vowel && !previousWasVowel) {
      groups++;
    }
    previousWasVowel = vowel;
  }

  // Silent-e deduction (matches C++ logic exactly)
  if (
    groups > 1 &&
    letterCount > 3 &&
    lettersOnly.endsWith('e') &&
    !lettersOnly.endsWith('le') &&
    !lettersOnly.endsWith('ye')
  ) {
    groups--;
  }

  if (groups === 0 && letterCount > 0) {
    groups = 1;
  }

  return groups;
}

function compoundJoinerCount(word: string): number {
  let count = 0;
  for (let i = 1; i + 1 < word.length; i++) {
    if (!isSegmentSeparator(word[i])) continue;
    if (!isWordChar(word[i - 1]) || !isWordChar(word[i + 1])) continue;
    count++;
  }
  return count;
}

function technicalConnectorCount(word: string): number {
  let count = 0;
  for (let i = 1; i + 1 < word.length; i++) {
    if (!isTechnicalConnector(word[i])) continue;
    if (!isWordChar(word[i - 1]) || !isWordChar(word[i + 1])) continue;
    count++;
  }
  return count;
}

function lastMeaningfulCharIndex(word: string): number {
  for (let i = word.length - 1; i >= 0; i--) {
    if (!isIgnoredTrailingChar(word[i])) return i;
  }
  return -1;
}

function trailingRhythmChar(word: string): string {
  const idx = lastMeaningfulCharIndex(word);
  return idx >= 0 ? word[idx] : '';
}

function trailingRepeatedCharCount(word: string, target: string): number {
  let count = 0;
  for (let i = lastMeaningfulCharIndex(word); i >= 0; i--) {
    if (word[i] !== target) break;
    count++;
  }
  return count;
}

function endsWithEllipsis(word: string): boolean {
  return trailingRepeatedCharCount(word, '.') >= 3;
}

function startsWithLowercaseLetter(word: string): boolean {
  for (const c of word) {
    if (isLowercaseChar(c)) return true;
    if (isLetterChar(c)) return false;
  }
  return false;
}

function isDottedInitialism(word: string): boolean {
  const end = lastMeaningfulCharIndex(word);
  if (end <= 0) return false;

  let letterCt = 0;
  let expectLetter = true;
  for (let i = 0; i <= end; i++) {
    if (expectLetter) {
      if (!isLetterChar(word[i])) return false;
      letterCt++;
      expectLetter = false;
    } else if (word[i] === '.') {
      expectLetter = true;
    } else {
      return false;
    }
  }
  return expectLetter && letterCt >= 2;
}

const KNOWN_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.',
  'vs.', 'etc.', 'e.g.', 'i.e.', 'cf.', 'no.', 'fig.', 'eq.',
  'inc.', 'ltd.', 'co.', 'dept.', 'mt.', 'ft.',
]);

function looksLikeAbbreviation(word: string, nextWordStartsLower: boolean): boolean {
  const lowered = word.toLowerCase();

  if (KNOWN_ABBREVIATIONS.has(lowered)) return true;
  if (!lowered.endsWith('.')) return false;
  if (isDottedInitialism(word)) return true;
  if (readableCharCount(lowered) <= 2) return true;
  if (nextWordStartsLower && readableCharCount(lowered) <= 4) return true;

  return false;
}

// ──────────────────── Pacing Delay Calculation ──────────────────────────────

function clampPacingDelayMs(delayMs: number): number {
  return Math.min(delayMs, MAX_PACING_DELAY_MS);
}

function clampScalePercent(percent: number): number {
  return Math.max(25, percent);
}

function scaledPercent(basePercent: number, scalePercent: number): number {
  return Math.floor((basePercent * clampScalePercent(scalePercent)) / 100);
}

function scaledDelayMs(bonusPercent: number, delayMs: number): number {
  return Math.floor((bonusPercent * clampPacingDelayMs(delayMs)) / 100);
}

function lengthBonusPercent(word: string): number {
  const readable = readableCharCount(word);
  if (readable === 0) return 0;

  let bonus = 0;
  if (readable > LONG_WORD_AFTER_CHARS) {
    bonus += (readable - LONG_WORD_AFTER_CHARS) * LONG_WORD_PERCENT_PER_CHAR;
  }
  if (readable > VERY_LONG_WORD_AFTER_CHARS) {
    bonus += (readable - VERY_LONG_WORD_AFTER_CHARS) * VERY_LONG_WORD_PERCENT_PER_CHAR;
  }
  if (readable > ULTRA_LONG_WORD_AFTER_CHARS) {
    bonus += (readable - ULTRA_LONG_WORD_AFTER_CHARS) * ULTRA_LONG_WORD_PERCENT_PER_CHAR;
  }

  const joiners = compoundJoinerCount(word);
  if (joiners > 0) {
    bonus += joiners * COMPOUND_JOINER_PERCENT;
    if (readable >= VERY_LONG_WORD_AFTER_CHARS) {
      bonus += LONG_COMPOUND_WORD_PERCENT;
    }
  }

  const techCount = technicalConnectorCount(word);
  if (techCount > joiners) {
    bonus += (techCount - joiners) * TECHNICAL_CONNECTOR_PERCENT;
  }

  return Math.min(LONG_WORD_MAX_PERCENT, bonus);
}

function complexityBonusPercent(word: string): number {
  let bonus = 0;
  const syllables = approximateSyllableGroupCount(word);
  if (syllables > SYLLABLE_BONUS_AFTER_COUNT) {
    const extra = syllables - SYLLABLE_BONUS_AFTER_COUNT;
    bonus += Math.min(SYLLABLE_BONUS_MAX_PERCENT, extra * SYLLABLE_BONUS_PERCENT_PER_GROUP);
  }

  const letters = letterCharCount(word);
  const digits = digitCharCount(word);
  const uppercase = uppercaseLetterCount(word);

  if (letters > 0 && digits > 0) {
    bonus += MIXED_TOKEN_COMPLEXITY_PERCENT;
  } else if (digits >= 3) {
    bonus += NUMERIC_TOKEN_COMPLEXITY_PERCENT;
  }

  if (uppercase >= 2 && uppercase === letters) {
    bonus += ALL_CAPS_COMPLEXITY_PERCENT;
  }

  const techCount = technicalConnectorCount(word);
  if (techCount >= 2) {
    bonus += (techCount - 1) * DENSE_CONNECTOR_COMPLEXITY_PERCENT;
  }

  return Math.min(COMPLEX_WORD_MAX_PERCENT, bonus);
}

function punctuationPausePercent(word: string, nextWordStartsLower: boolean): number {
  if (endsWithEllipsis(word)) return ELLIPSIS_PAUSE_PERCENT;

  const trailing = trailingRhythmChar(word);
  switch (trailing) {
    case ',': return COMMA_PAUSE_PERCENT;
    case '-': return DASH_PAUSE_PERCENT;
    case ';':
    case ':': return CLAUSE_PAUSE_PERCENT;
    case '.':
      return looksLikeAbbreviation(word, nextWordStartsLower) ? 0 : SENTENCE_PAUSE_PERCENT;
    case '!':
    case '?': return STRONG_SENTENCE_PAUSE_PERCENT;
    default: return 0;
  }
}

// ──────────────────── Public Pacing Config ───────────────────────────────────

export interface PacingConfig {
  longWordDelayMs: number;
  complexWordDelayMs: number;
  punctuationDelayMs: number;
  longWordScalePercent: number;
  complexWordScalePercent: number;
  punctuationScalePercent: number;
}

export const DEFAULT_PACING_CONFIG: PacingConfig = {
  longWordDelayMs: 200,
  complexWordDelayMs: 200,
  punctuationDelayMs: 200,
  longWordScalePercent: 100,
  complexWordScalePercent: 100,
  punctuationScalePercent: 100,
};

// ──────────────────── Duration Calculation ───────────────────────────────────

export function durationForWord(
  word: string,
  nextWordStartsLower: boolean,
  baseIntervalMs: number,
  config: PacingConfig,
): number {
  if (!word || baseIntervalMs === 0) return baseIntervalMs;

  let totalBonusMs = 0;
  totalBonusMs += scaledDelayMs(
    scaledPercent(lengthBonusPercent(word), config.longWordScalePercent),
    config.longWordDelayMs,
  );
  totalBonusMs += scaledDelayMs(
    scaledPercent(complexityBonusPercent(word), config.complexWordScalePercent),
    config.complexWordDelayMs,
  );
  totalBonusMs += scaledDelayMs(
    scaledPercent(punctuationPausePercent(word, nextWordStartsLower), config.punctuationScalePercent),
    config.punctuationDelayMs,
  );

  return baseIntervalMs + totalBonusMs;
}

// ──────────────────── Anchor Calculation ─────────────────────────────────────

/**
 * Calculate the focus letter index for anchor alignment.
 * Matches the firmware's approach: ~35% through the readable characters.
 */
export function focusLetterIndex(word: string): number {
  if (!word) return 0;
  
  // Collect indices of all letter/digit characters
  const alphabetIndices: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (isWordChar(word[i])) {
      alphabetIndices.push(i);
    }
  }

  if (alphabetIndices.length === 0) {
    // Fallback if no letters exist (e.g. "!!!")
    return Math.floor((word.length - 1) / 2);
  }

  // Calculate the center index within the alphabet list
  // Odd  (e.g. 3) -> floor((3-1)/2) = 1
  // Even (e.g. 4) -> floor((4-1)/2) = 1
  const alphabetCenterIdx = Math.floor((alphabetIndices.length - 1) / 2);
  
  // Return the original index in the word string
  return alphabetIndices[alphabetCenterIdx];
}

// ──────────────────── Sentence Detection ────────────────────────────────────

export function wordEndsSentence(word: string, nextWord: string | null): boolean {
  if (!word) return false;
  const nextLower = nextWord ? startsWithLowercaseLetter(nextWord) : false;
  const trailing = trailingRhythmChar(word);
  switch (trailing) {
    case '!':
    case '?':
      return true;
    case '.':
      return !looksLikeAbbreviation(word, nextLower);
    default:
      return false;
  }
}

// ──────────────────── BookContent Model ──────────────────────────────────────

export interface ChapterMarker {
  title: string;
  wordIndex: number;
}

export interface BookContent {
  title: string;
  author: string;
  words: string[];
  chapters: ChapterMarker[];
  paragraphStarts: number[];
}

// ──────────────────── ReadingLoop Controller ────────────────────────────────

export class RSVPController {
  private words: string[] = [];
  private currentIdx = 0;
  private wpmValue = 300;
  private pacing: PacingConfig = { ...DEFAULT_PACING_CONFIG };
  private lastAdvanceMs = 0;

  get currentIndex(): number { return this.currentIdx; }
  get currentWord(): string { return this.words[this.currentIdx] ?? ''; }
  get wpm(): number { return this.wpmValue; }
  get wordCount(): number { return this.words.length; }
  get atEnd(): boolean { return this.words.length === 0 || this.currentIdx + 1 >= this.words.length; }
  get pacingConfig(): PacingConfig { return { ...this.pacing }; }

  get baseIntervalMs(): number {
    return Math.floor(60000 / this.wpmValue);
  }

  setWords(words: string[]): void {
    this.words = words;
    this.currentIdx = 0;
  }

  setWpm(wpm: number): void {
    this.wpmValue = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));
  }

  adjustWpm(delta: number): void {
    if (delta === 0) return;
    const next = this.wpmValue + (delta > 0 ? WPM_STEP : -WPM_STEP);
    this.wpmValue = Math.max(MIN_WPM, Math.min(MAX_WPM, next));
  }

  setPacingConfig(config: Partial<PacingConfig>): void {
    if (config.longWordDelayMs != null)
      this.pacing.longWordDelayMs = clampPacingDelayMs(config.longWordDelayMs);
    if (config.complexWordDelayMs != null)
      this.pacing.complexWordDelayMs = clampPacingDelayMs(config.complexWordDelayMs);
    if (config.punctuationDelayMs != null)
      this.pacing.punctuationDelayMs = clampPacingDelayMs(config.punctuationDelayMs);
    if (config.longWordScalePercent != null)
      this.pacing.longWordScalePercent = clampScalePercent(config.longWordScalePercent);
    if (config.complexWordScalePercent != null)
      this.pacing.complexWordScalePercent = clampScalePercent(config.complexWordScalePercent);
    if (config.punctuationScalePercent != null)
      this.pacing.punctuationScalePercent = clampScalePercent(config.punctuationScalePercent);
  }

  currentWordDurationMs(): number {
    const nextLower = this.currentIdx + 1 < this.words.length
      ? startsWithLowercaseLetter(this.words[this.currentIdx + 1])
      : false;
    return durationForWord(this.currentWord, nextLower, this.baseIntervalMs, this.pacing);
  }

  currentWordEndsSentence(): boolean {
    const nextWord = this.currentIdx + 1 < this.words.length
      ? this.words[this.currentIdx + 1]
      : null;
    return wordEndsSentence(this.currentWord, nextWord);
  }

  seekTo(index: number): void {
    if (this.words.length === 0) return;
    this.currentIdx = Math.max(0, Math.min(index, this.words.length - 1));
  }

  scrub(steps: number): void {
    if (this.words.length === 0) return;
    let next = this.currentIdx + steps;
    next = Math.max(0, Math.min(next, this.words.length - 1));
    this.currentIdx = next;
  }

  /**
   * Start the playback timer reference.
   */
  start(nowMs: number): void {
    this.lastAdvanceMs = nowMs;
  }

  /**
   * Called on each tick. Returns true if the word changed.
   * Implements the catch-up logic from the firmware.
   */
  update(nowMs: number, allowCatchUp = true): boolean {
    let changed = false;
    const maxCatchUp = allowCatchUp ? MAX_CATCH_UP_WORDS : 1;

    for (let catchUp = 0; catchUp < maxCatchUp; catchUp++) {
      const dur = this.currentWordDurationMs();
      if (dur === 0 || nowMs - this.lastAdvanceMs < dur) break;

      this.lastAdvanceMs += dur;
      if (!this.advance()) break;
      changed = true;
    }

    return changed;
  }

  /**
   * Get the word before the current one (for phantom display).
   */
  previousWord(): string {
    return this.currentIdx > 0 ? this.words[this.currentIdx - 1] : '';
  }

  /**
   * Get the word after the current one (for phantom display).
   */
  nextWord(): string {
    return this.currentIdx + 1 < this.words.length ? this.words[this.currentIdx + 1] : '';
  }

  private advance(): boolean {
    if (this.words.length === 0) return false;
    const maxIdx = this.words.length - 1;
    if (this.currentIdx >= maxIdx) return false;
    this.currentIdx++;
    return true;
  }
}

export { MIN_WPM, MAX_WPM, WPM_STEP };
