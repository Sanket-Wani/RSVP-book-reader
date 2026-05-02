/**
 * ImportService.ts
 *
 * Ported from web/library.js — handles document picking, EPUB parsing,
 * TXT/HTML/Markdown conversion, and Unicode normalization.
 *
 * Uses expo-file-system v19 new File class API and expo-document-picker
 * for file selection, and JSZip for EPUB extraction.
 * All conversion happens in-memory; no server roundtrips.
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import JSZip from 'jszip';
import type { BookContent, ChapterMarker } from '../engine/RSVPEngine';

// ──────────────────── Constants ─────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = [
  'application/epub+zip',
  'text/plain',
  'text/html',
  'text/markdown',
  'application/xhtml+xml',
];

// Unicode normalization map (from library.js)
const ASCII_REPLACEMENTS: Record<string, string> = {
  '\u00A0': ' ', '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
  '\u00AB': '"', '\u00BB': '"', '\u2039': "'", '\u203A': "'",
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-',
  '\u2014': '-', '\u2015': '-', '\u2043': '-', '\u2212': '-',
  '\u2026': '...', '\u2022': '*', '\u00B7': '*',
  '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl',
  '\uFFFD': '',
};

const SPACE_LIKE_RE = /[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\r\n\t]/g;

// ──────────────────── Public API ────────────────────────────────────────────

/**
 * Opens a document picker, lets the user select an EPUB or text file,
 * then parses it into a BookContent structure ready for the RSVP engine.
 */
export async function pickAndImportBook(): Promise<BookContent | null> {
  let result: DocumentPicker.DocumentPickerResult;

  try {
    result = await DocumentPicker.getDocumentAsync({
      type: SUPPORTED_MIME_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch (err) {
    throw new ImportError('File picker was cancelled or denied access.', err);
  }

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null; // User cancelled
  }

  const asset = result.assets[0];
  const uri = asset.uri;
  const name = asset.name ?? 'unknown';
  const ext = extensionOf(name);

  try {
    switch (ext) {
      case '.epub':
        return await parseEpub(asset);
      case '.txt':
      case '.md':
      case '.markdown':
        return await parsePlainText(asset);
      case '.html':
      case '.htm':
      case '.xhtml':
        return await parseHtmlFile(asset);
      default:
        throw new ImportError(`Unsupported file type: ${ext}`);
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(`Failed to parse "${name}": ${err instanceof Error ? err.message : String(err)}`, err);
  }
}

// ──────────────────── EPUB Parser ───────────────────────────────────────────

async function parseEpub(asset: DocumentPicker.DocumentPickerAsset): Promise<BookContent> {
  let data: any;

  if (Platform.OS === 'web' && asset.file) {
    // Standard browser File API
    data = await asset.file.arrayBuffer();
  } else {
    // Expo File System v19 API
    const file = new ExpoFile(asset.uri);
    data = await file.base64();
  }

  const zip = await JSZip.loadAsync(data, { base64: Platform.OS !== 'web' });

  // 1. Find OPF path from container.xml
  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const opfPath = extractOpfPath(containerXml);

  // 2. Parse the OPF package
  const packageXml = await readZipText(zip, opfPath);
  const { title, author, spinePaths } = parseOPFPackage(packageXml, opfPath);

  // 3. Walk the spine and extract text events
  const words: string[] = [];
  const chapters: ChapterMarker[] = [];
  const paragraphStarts: number[] = [];

  for (let i = 0; i < spinePaths.length; i++) {
    const chapterMarkup = await readZipText(zip, spinePaths[i]);
    const events = extractHtmlEvents(chapterMarkup);

    // If no chapter heading found in this spine item, create a fallback
    const hasChapter = events.some(([kind]) => kind === 'chapter');
    if (!hasChapter) {
      const fallbackTitle = fallbackChapterName(spinePaths[i], i + 1);
      events.unshift(['chapter', fallbackTitle]);
    }

    for (const [kind, value] of events) {
      if (kind === 'chapter') {
        chapters.push({ title: value, wordIndex: words.length });
      } else if (kind === 'text') {
        paragraphStarts.push(words.length);
        const cleaned = cleanText(value);
        const tokens = splitIntoWords(cleaned);
        words.push(...tokens);
      }
    }
  }

  if (words.length === 0) {
    throw new ImportError('EPUB contains no readable text content.');
  }

  return {
    title: cleanText(title) || stripExt(asset.name),
    author: cleanText(author),
    words,
    chapters,
    paragraphStarts,
  };
}

// ──────────────────── Plain Text Parser ─────────────────────────────────────

async function parsePlainText(asset: DocumentPicker.DocumentPickerAsset): Promise<BookContent> {
  let raw: string;

  if (Platform.OS === 'web' && asset.file) {
    raw = await asset.file.text();
  } else {
    const file = new ExpoFile(asset.uri);
    raw = await file.text();
  }

  const words: string[] = [];
  const chapters: ChapterMarker[] = [];
  const paragraphStarts: number[] = [];
  let paragraphParts: string[] = [];

  const flushParagraph = () => {
    if (paragraphParts.length === 0) return;
    const text = cleanText(paragraphParts.join(' '));
    paragraphParts = [];
    if (!text) return;
    paragraphStarts.push(words.length);
    words.push(...splitIntoWords(text));
  };

  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();

    const chapterTitle = detectChapterLine(line);
    if (chapterTitle) {
      flushParagraph();
      chapters.push({ title: chapterTitle, wordIndex: words.length });
      continue;
    }

    if (!line) {
      flushParagraph();
      continue;
    }

    paragraphParts.push(line);
  }

  flushParagraph();

  if (words.length === 0) {
    throw new ImportError('Text file contains no readable words.');
  }

  // Ensure at least one chapter
  if (chapters.length === 0) {
    chapters.push({ title: stripExt(asset.name), wordIndex: 0 });
  }

  return {
    title: stripExt(asset.name),
    author: '',
    words,
    chapters,
    paragraphStarts,
  };
}

// ──────────────────── HTML File Parser ──────────────────────────────────────

async function parseHtmlFile(asset: DocumentPicker.DocumentPickerAsset): Promise<BookContent> {
  let raw: string;

  if (Platform.OS === 'web' && asset.file) {
    raw = await asset.file.text();
  } else {
    const file = new ExpoFile(asset.uri);
    raw = await file.text();
  }

  const events = extractHtmlEvents(raw);
  const words: string[] = [];
  const chapters: ChapterMarker[] = [];
  const paragraphStarts: number[] = [];

  for (const [kind, value] of events) {
    if (kind === 'chapter') {
      chapters.push({ title: value, wordIndex: words.length });
    } else if (kind === 'text') {
      paragraphStarts.push(words.length);
      words.push(...splitIntoWords(cleanText(value)));
    }
  }

  if (words.length === 0) {
    throw new ImportError('HTML file contains no readable text.');
  }

  if (chapters.length === 0) {
    chapters.push({ title: stripExt(asset.name), wordIndex: 0 });
  }

  return {
    title: stripExt(asset.name),
    author: '',
    words,
    chapters,
    paragraphStarts,
  };
}

// ──────────────────── HTML Event Extraction ─────────────────────────────────

type TextEvent = ['chapter' | 'text', string];

/**
 * Lightweight HTML-to-events parser using regex-based tag stripping.
 * React Native doesn't have DOMParser, so we use a simple state machine.
 */
function extractHtmlEvents(markup: string): TextEvent[] {
  const events: TextEvent[] = [];

  // Strip everything inside <head>, <script>, <style>, <nav>, <svg>, <math>
  let cleaned = markup;
  for (const tag of ['head', 'script', 'style', 'nav', 'svg', 'math']) {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    cleaned = cleaned.replace(re, '');
  }

  // Extract headings as chapter markers
  const headingRe = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

  // Pass 1: extract headings
  let match: RegExpExecArray | null;
  const headingPositions: Array<{ index: number; title: string }> = [];

  headingRe.lastIndex = 0;
  while ((match = headingRe.exec(cleaned)) !== null) {
    const title = cleanText(stripAllTags(match[1]));
    if (title) {
      headingPositions.push({ index: match.index, title });
    }
  }

  // Remove headings from content so they don't appear as text
  let contentOnly = cleaned.replace(headingRe, '\n');

  // Pass 2: split on block boundaries, then extract text
  contentOnly = contentOnly.replace(/<br\s*\/?>/gi, '\n');
  contentOnly = contentOnly.replace(/<\/?(p|div|li|td|th|dd|dt|blockquote|article|section|figcaption|pre|ul|ol|table|tbody|thead|tfoot|tr|header|footer|aside|figure|hr|dl|address|main|body)[^>]*>/gi, '\n');

  // Strip remaining tags
  contentOnly = stripAllTags(contentOnly);

  // Split into paragraphs by double newlines or single newlines
  const paragraphs = contentOnly.split(/\n\s*\n|\n/).map(p => cleanText(p)).filter(Boolean);

  // Insert chapter markers
  for (const hp of headingPositions) {
    events.push(['chapter', hp.title]);
  }

  for (const para of paragraphs) {
    if (para) {
      events.push(['text', para]);
    }
  }

  return events;
}

// ──────────────────── OPF / Container Parsing ───────────────────────────────

function extractOpfPath(containerXml: string): string {
  const match = containerXml.match(/full-path\s*=\s*"([^"]+)"/i)
    ?? containerXml.match(/full-path\s*=\s*'([^']+)'/i);
  if (!match) {
    throw new ImportError('EPUB container.xml does not name an OPF package file.');
  }
  return normalizeZipPath(match[1]);
}

interface OPFResult {
  title: string;
  author: string;
  spinePaths: string[];
}

function parseOPFPackage(xml: string, opfPath: string): OPFResult {
  // Extract title
  const titleMatch = xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)
    ?? xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripAllTags(titleMatch[1]).trim() : '';

  // Extract author
  const authorMatch = xml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)
    ?? xml.match(/<creator[^>]*>([\s\S]*?)<\/creator>/i);
  const author = authorMatch ? stripAllTags(authorMatch[1]).trim() : '';

  // Build manifest: id -> { path, mediaType }
  const manifest = new Map<string, { path: string; mediaType: string }>();
  const itemRe = /<item\s+([^>]*)\/?\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const attrs = m[1];
    const id = extractAttr(attrs, 'id');
    const href = extractAttr(attrs, 'href');
    const mediaType = extractAttr(attrs, 'media-type') ?? '';
    if (id && href) {
      const resolved = zipJoin(opfPath, href);
      manifest.set(id, { path: resolved, mediaType });
    }
  }

  // Build spine order
  const spinePaths: string[] = [];
  const itemrefRe = /<itemref\s+([^>]*)\/?\s*>/gi;
  while ((m = itemrefRe.exec(xml)) !== null) {
    const idref = extractAttr(m[1], 'idref');
    if (idref && manifest.has(idref)) {
      const item = manifest.get(idref)!;
      if (isContentDoc(item.path, item.mediaType)) {
        spinePaths.push(item.path);
      }
    }
  }

  // Fallback: if spine is empty, use manifest content docs in order
  if (spinePaths.length === 0) {
    for (const [, item] of manifest) {
      if (isContentDoc(item.path, item.mediaType)) {
        spinePaths.push(item.path);
      }
    }
  }

  if (spinePaths.length === 0) {
    throw new ImportError('EPUB spine does not contain readable XHTML/HTML documents.');
  }

  return { title, author, spinePaths };
}

// ──────────────────── Zip Helpers ────────────────────────────────────────────

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const normalized = normalizeZipPath(path);
  let entry = zip.file(normalized);

  if (!entry) {
    // Case-insensitive fallback
    const lowered = normalized.toLowerCase();
    const found = Object.values(zip.files).find(
      (f) => normalizeZipPath(f.name).toLowerCase() === lowered,
    );
    entry = found ?? null;
  }

  if (!entry) {
    throw new ImportError(`Missing EPUB member: ${path}`);
  }

  return entry.async('string');
}

function normalizeZipPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function zipJoin(base: string, href: string): string {
  let decoded = href.split('#')[0].split('?')[0];
  try { decoded = decodeURIComponent(decoded); } catch { /* keep as is */ }

  if (decoded.startsWith('/')) {
    decoded = decoded.replace(/^\/+/, '');
  } else {
    const dir = zipDirname(base);
    decoded = dir + decoded;
  }

  return collapseZipPath(decoded);
}

function zipDirname(p: string): string {
  const norm = normalizeZipPath(p);
  const slash = norm.lastIndexOf('/');
  return slash < 0 ? '' : norm.slice(0, slash + 1);
}

function collapseZipPath(p: string): string {
  const parts: string[] = [];
  for (const seg of normalizeZipPath(p).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

// ──────────────────── Text Utilities ────────────────────────────────────────

function cleanText(text: string): string {
  let v = (text ?? '').replace(SPACE_LIKE_RE, ' ').replace(/\uFFFD/g, '');
  // Apply ASCII replacements for common Unicode punctuation
  v = Array.from(v, (ch) => ASCII_REPLACEMENTS[ch] ?? ch).join('');
  // NFC normalize
  v = v.normalize('NFC');
  return v.replace(/\s+/g, ' ').trim();
}

function splitIntoWords(text: string): string[] {
  if (!text) return [];
  return text.split(/\s+/).filter((t) => t && /[\p{L}\p{N}]/u.test(t));
}

function stripAllTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function stripExt(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function extractAttr(attrString: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = attrString.match(re);
  return m ? m[1] : null;
}

function isContentDoc(path: string, mediaType: string): boolean {
  const lp = path.toLowerCase();
  const lt = mediaType.toLowerCase();
  return (
    lt === 'application/xhtml+xml' || lt === 'text/html' ||
    lp.endsWith('.xhtml') || lp.endsWith('.html') || lp.endsWith('.htm')
  );
}

function fallbackChapterName(path: string, index: number): string {
  const base = stripExt(path.split('/').pop() ?? `chapter-${index}`);
  const cleaned = cleanText(base.replace(/[_-]+/g, ' '));
  return cleaned || `Chapter ${index}`;
}

function detectChapterLine(line: string): string | null {
  const trimmed = cleanText(line);
  if (!trimmed || trimmed.length > 64) return null;

  if (trimmed.startsWith('#')) {
    const title = cleanText(trimmed.replace(/^#+/, '').trim());
    return title || null;
  }

  if (/^(chapter|part|book)\b/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

// ──────────────────── Error Type ─────────────────────────────────────────────

export class ImportError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ImportError';
    this.cause = cause;
  }
}
