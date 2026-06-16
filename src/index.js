import { BibleBookData } from './common/books.js';
import { addGLQuoteCols, convertGLQuotes2OLQuotes } from 'tsv-quote-converters';
import { Inflectors } from 'en-inflectors';

async function readBooks() {
  // Build a simple CODE -> { usfm, testament } map from the local BibleBookData
  const map = {};
  for (const [code, meta] of Object.entries(BibleBookData)) {
    map[code.toUpperCase()] = { usfm: meta.usfm, testament: meta.testament };
  }
  return map;
}

function findBookMeta(bookMap, code) {
  const key = Object.keys(bookMap).find(k => k.toLowerCase() === code.toLowerCase());
  if (!key) return null;
  const meta = bookMap[key];
  if (!meta || !meta.usfm || !meta.testament) return null;
  return { key, ...meta };
}

async function loadTermsFromEnTw(dcsHost = 'https://git.door43.org') {
  // Use the updated zipProcessor that accepts dcsHost
  const { generateTWTerms } = await import('./utils/zipProcessor.js');
  return await generateTWTerms(dcsHost);
}

export async function generateTwlByBook(bookCode, options = {}) {
  // Extract dcsHost option with default
  const dcsHost = options.dcsHost || 'https://git.door43.org';
  const quiet = !!options.quiet;

  // Load terms from en_tw zip file instead of local tw_strongs_list.json
  const termToArticles = await loadTermsFromEnTw(dcsHost);

  // Build trie for fast scanning
  const { buildTermTrie, scanVerseMatches } = await import('./utils/twl-matcher.js');
  const trie = buildTermTrie(termToArticles);

  // Fetch and parse ULT USFM into verses
  const { processUsfmForBook } = await import('./utils/usfm-alignment-remover.js');
  const bibleData = await readBooks();
  const meta = findBookMeta(bibleData, bookCode);
  if (!meta) throw new Error(`Unknown book code: ${bookCode}`);
  const versesByChapter = await processUsfmForBook(meta.key, dcsHost);

  const header = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'Variant of', 'Disambiguation'];
  const outRows = [header.join('\t')];

  // ID generator
  const usedIds = new Set();
  const genId = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789';
    while (true) {
      const first = letters[Math.floor(Math.random() * letters.length)];
      let rest = '';
      for (let i = 0; i < 3; i++) rest += alnum[Math.floor(Math.random() * alnum.length)];
      const id = first + rest;
      if (!usedIds.has(id)) { usedIds.add(id); return id; }
    }
  };

  // Helpers for Variant of decision (allow only plural/-ed/-ing without marking variant)
  const pluralizeWord = (w) => {
    if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
    if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
    if (/f$/i.test(w) && !/(roof|belief|chief|proof)$/i.test(w)) return w.replace(/f$/i, 'ves');
    if (/fe$/i.test(w)) return w.replace(/fe$/i, 'ves');
    if (/o$/i.test(w)) return w + 'es';
    return w + 's';
  };
  const isVowel = (ch) => /[aeiou]/i.test(ch);
  const isConsonant = (ch) => /[a-z]/i.test(ch) && !isVowel(ch);
  const endsWithCVC = (w) => w.length >= 3 && isConsonant(w[w.length - 3]) && isVowel(w[w.length - 2]) && isConsonant(w[w.length - 1]) && !/[wxy]/i.test(w[w.length - 1]);
  const edForm = (w) => {
    if (/e$/i.test(w)) return w + 'd';
    if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ied');
    // Do not double the final consonant for words ending in "er" (e.g., gather -> gathered)
    const lastCh = w[w.length - 1];
    if (endsWithCVC(w) && !/(?:er|en|or|on|al)$/i.test(w)) return w + lastCh + 'ed';
    return w + 'ed';
  };
  const ingForm = (w) => {
    if (/ie$/i.test(w)) return w.replace(/ie$/i, 'ying');
    if (/ee$/i.test(w)) return w + 'ing';
    if (/e$/i.test(w)) return w.replace(/e$/i, 'ing');
    const lastCh = w[w.length - 1];
    if (endsWithCVC(w) && !/(?:er|en|or|on|al)$/i.test(w)) return w + lastCh + 'ing';
    return w + 'ing';
  };

  const allowNoVariant = (base, match) => {
    const b = String(base || '');
    const m = String(match || '');
    if (!b || !m) return true;
    if (b.toLowerCase() === m.toLowerCase()) return true;
    const parts = b.trim().split(/\s+/);
    const head = parts.length > 1 ? parts.slice(0, -1).join(' ') + ' ' : '';
    const last = parts[parts.length - 1];
    const allowed = new Set([
      head + pluralizeWord(last),
      head + new Inflectors(last).toPlural(),
      head + new Inflectors(last).toSingular(),
      head + edForm(last),
      head + new Inflectors(last).toPast(),
      head + ingForm(last),
      head + new Inflectors(last).toGerund(),
    ].map(x => x.toLowerCase()));
    return allowed.has(m.toLowerCase());
  };

  // Walk through verses in order
  const chapterNums = Object.keys(versesByChapter).map(n => parseInt(n, 10)).sort((a, b) => a - b);
  for (const c of chapterNums) {
    const verses = versesByChapter[c] || {};
    const verseNums = Object.keys(verses).filter(k => k !== 'front').map(n => parseInt(n, 10)).sort((a, b) => a - b);
    // Chapter front matter (\d) is emitted as `${c}:front`, ordered before verse 1.
    const orderedKeys = verses.front ? ['front', ...verseNums] : verseNums;
    for (const v of orderedKeys) {
      const text = verses[v] || '';
      const matches = scanVerseMatches(text, trie);
      // Count occurrences per exact matchedText (case-sensitive)
      const occMap = new Map();
      for (const m of matches) {
        const glq = m.matchedText;
        const occ = (occMap.get(glq) || 0) + 1;
        occMap.set(glq, occ);

        const ref = `${c}:${v}`;
        const id = genId();
        const primaryArticle = m.preferredArticle || (m.articles && m.articles[0]) || '';
        let tag = '';
        if (primaryArticle.startsWith('kt/')) tag = 'keyterm';
        else if (primaryArticle.startsWith('names/')) tag = 'name';
        const twLink = primaryArticle ? `rc://*/tw/dict/bible/${primaryArticle}` : '';

        // Variant of: only if beyond plural/-ed/-ing differences. Compare on the
        // brace-free reading so a supplied-morpheme brace (e.g. "creature{s}")
        // isn't itself counted as a difference from the term.
        const variantOf = allowNoVariant(m.term, glq.replace(/[{}]/g, '')) ? '' : m.term;
        // Disambiguation: list all candidate articles for this match
        const disamb = (m.articles && m.articles.length > 1) ? `(${m.articles.join(', ')})` : '';

        // Set OrigWords/Occurrence equal to GLQuote/GLOccurrence for English-first output
        outRows.push([
          ref,
          id,
          tag,
          glq,
          String(occ),
          twLink,
          variantOf,
          disamb,
        ].join('\t'));
      }
    }
  }

  // Build TSV and convert GL OrigWords back to OL using tsv-quote-converters
  let matchedTsv = outRows.join('\n');
  try {
    const conv = await convertGLQuotes2OLQuotes({
      bibleLink: 'unfoldingWord/en_ult/master',
      bookCode: String(meta.key || bookCode).toLowerCase(),
      tsvContent: matchedTsv,
      trySeparatorsAndOccurrences: true,
      quiet,
    });
    if (conv && typeof conv.output === 'string' && conv.output.length) {
      matchedTsv = conv.output;
    }
  } catch (e) {
    // If conversion fails (e.g., no network), fall back to unconverted TSV
  }

  // Now add the actual GLQuote/GLOccurrence by calling addGLQuoteCols
  try {
    const result = await addGLQuoteCols({
      bibleLinks: ['unfoldingWord/en_ult/master'],
      bookCode: String(meta.key || bookCode).toLowerCase(),
      tsvContent: matchedTsv,
      trySeparatorsAndOccurrences: true,
      usePreviousGLQuotes: true,
      quiet,
    });
    if (result && typeof result.output === 'string' && result.output.length) {
      matchedTsv = result.output;
      // Reorder columns: move cols[5] and cols[6] to after cols[7] for every line
      try {
        const lines = String(matchedTsv || '').split('\n');
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          // require at least 8 columns so cols[7] exists
          if (cols.length >= 8) {
            const removed = cols.splice(5, 2); // remove cols[5] and cols[6]
            // after removal, original cols[7] is at index 5, so insert after it at index 6
            const insertIndex = Math.min(6, cols.length);
            cols.splice(insertIndex, 0, ...removed);
            lines[i] = cols.join('\t');
          }
        }
        matchedTsv = lines.join('\n');
      } catch (err) {
        // leave matchedTsv unchanged on error
      }
    }
  } catch (e) {
    try {
      const lines = String(matchedTsv || '').split('\n');
      if (lines.length > 0) {
        lines[0] = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'GLQuote', 'GLOccurrence', 'Variant of', 'Disambiguation'].join('\t');
        const out = [lines[0]];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          const g = (idx) => (cols[idx] !== undefined ? cols[idx] : '');
          const newRow = [
            g(0), // Reference
            g(1), // ID
            g(2), // Tags
            g(3), // OrigWords
            g(4), // Occurrence
            g(5), // TWLink
            g(3), // GLQuote (copy of OrigWords)
            g(4), // GLOccurrence (copy of Occurrence)
            g(6), // Variant of
            g(7), // Disambiguation
          ].join('\t');
          out.push(newRow);
        }
        matchedTsv = out.join('\n');
      }
    } catch (err) {
      // leave matchedTsv unchanged on any transformation error
    }
  }

  const noMatchHeader = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'GLQuote', 'GLOccurrence', 'Disambiguation'];
  const noMatchTsv = [noMatchHeader.join('\t')].join('\n');
  return { matchedTsv, noMatchTsv };
}
