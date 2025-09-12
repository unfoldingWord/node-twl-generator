/* eslint-disable no-async-promise-executor, no-throw-literal */

import { BibleBookData } from '../common/books.js';

// Environment detection
const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node;

// Get appropriate fetch implementation
async function getFetch() {
  // Both Node.js 18+ and browsers have native fetch
  return globalThis.fetch;
}

// Get appropriate base64 decoder
function decodeBase64(base64String) {
  if (isNode) {
    return Buffer.from(base64String, 'base64').toString('utf-8');
  }
  // Browser implementation
  return atob(base64String);
}

// Note: This version doesn't use usfm-js to avoid external dependencies
// It implements a simple USFM alignment remover for the specific case

export const removeAllTagsExceptChapterVerse = (usfmContent) => {
  if (!usfmContent) return '';

  let cleanContent = usfmContent;

  // Remove word-level alignment markers like \w word|lemma="lemma" strong="H1234"\w*
  cleanContent = cleanContent.replace(/\\w\s+([^|\\]+)\|[^\\]*\\w\*/g, '$1');

  // Remove milestone markers like \zaln-s | \zaln-e\*
  cleanContent = cleanContent.replace(/\\zaln-[se][^\\]*\\?\*?/g, '');

  // Remove other alignment-related markers
  cleanContent = cleanContent.replace(/\\k-[se][^\\]*\\?\*?/g, '');

  // Remove empty lines that might result from marker removal
  cleanContent = cleanContent.replace(/\n\s*\n\s*\n/g, '\n\n');

  // Clean up any remaining alignment syntax patterns
  cleanContent = cleanContent.replace(/\|[^\\]*(?=\\)/g, '');

  cleanContent = cleanContent.replace(/\n/g, ' ');
  cleanContent = cleanContent.replace(/ +\\v +/g, '\n\\v ');
  cleanContent = cleanContent.replace(/ +\\c +/g, '\n\\c ');
  cleanContent = cleanContent.replace(/ *(\\q\d*|\\p|\\ts\\\*) */g, ' ');
  cleanContent = cleanContent.replace(/\\[ds].*?(\\|\n)/g, '$1');
  cleanContent = cleanContent.replace(/ +/g, ' ');
  cleanContent = cleanContent.replace(/^ +$/g, '');
  cleanContent = cleanContent.replace(/\\f .*?\\f\*/g, ' ');
  cleanContent = cleanContent.replace(/[\{\}]/g, ''); // Remove any curly braces

  // Remove all lines before the first \c marker, keeping the \c line
  const lines = cleanContent.split('\n');
  const firstCIndex = lines.findIndex(line => line.includes('\\c'));
  if (firstCIndex > 0) {
    cleanContent = lines.slice(firstCIndex).join('\n');
  }

  return cleanContent.trim();
};

/**
 * Download and process USFM file for a given book
 * @param {string} book - The book identifier
 * @return {Promise<Object>} - Object with chapters and verses
 */
export async function processUsfmForBook(book, dcsHost = 'https://git.door43.org') {
  // Normalize book key to lowercase to match BibleBookData keys
  const key = String(book || '').toLowerCase();
  if (!BibleBookData[key]) throw new Error(`Unknown book: ${book}`);

  const fetch = await getFetch();
  const usfmUrl = `${dcsHost}/api/v1/repos/unfoldingWord/en_ult/contents/${BibleBookData[key].usfm}.usfm?ref=master`;
  const usfmRes = await fetch(usfmUrl);
  if (!usfmRes.ok) throw new Error(`Failed to download USFM file for ${book}`);
  const usfmData = await usfmRes.json();
  const usfmContent = decodeBase64(usfmData.content);

  // Remove alignments from USFM
  const cleanUsfm = removeAllTagsExceptChapterVerse(usfmContent);

  // Parse USFM into chapters and verses
  return parseUsfmToVerses(cleanUsfm);
}

/**
 * Parse clean USFM content into a chapters/verses object
 * @param {string} usfm - Clean USFM content
 * @return {Object} - Object keyed by chapter number, then verse number
 */
export function parseUsfmToVerses(usfm) {
  const versesObj = {};
  let currentChapter = 1;

  // Split by chapters and verses
  const parts = usfm.split(/\\([cv])\s*(\d+)/);

  for (let i = 1; i < parts.length; i += 3) {
    const tag = parts[i]; // 'c' or 'v'
    const number = parseInt(parts[i + 1]);
    const text = parts[i + 2] || '';

    if (tag === 'c') {
      currentChapter = number;
      if (!versesObj[currentChapter]) {
        versesObj[currentChapter] = {};
      }
    } else if (tag === 'v') {
      if (!versesObj[currentChapter]) {
        versesObj[currentChapter] = {};
      }
      // Clean up the text: remove extra whitespace and newlines
      const cleanText = text.replace(/\s+/g, ' ').trim();
      if (cleanText) {
        versesObj[currentChapter][number] = cleanText;
      }
    }
  }

  return versesObj;
}
