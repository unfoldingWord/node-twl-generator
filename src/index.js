// Main module for twl-generator
import { generateTWTerms } from './utils/zipProcessor.js';
import { processUsfmForBook, parseUsfmToVerses } from './utils/usfm-alignment-remover.js';
import { generateTWLMatches } from './utils/twl-matcher.js';

export { generateTWTerms, processUsfmForBook };

/**
 * Main function that processes both TW articles and USFM file
 * @param {string} book - The book identifier (optional if usfmContent is provided)
 * @param {string} usfmContent - Optional USFM content to process instead of fetching
 * @return {Promise<string>} - TSV string
 */
export async function generateTWLWithUsfm(book, usfmContent = null) {
  // Generate TW terms (with caching)
  const terms = await generateTWTerms();

  let verses;
  if (usfmContent) {
    // Parse provided USFM content
    verses = parseUsfmToVerses(usfmContent);
  } else {
    // Fetch USFM from git.door43.org
    if (!book) throw new Error('Book parameter required when no USFM content provided');
    verses = await processUsfmForBook(book);
  }

  // Generate TWL matches and return TSV
  const tsv = generateTWLMatches(terms, verses);
  return tsv;
}
