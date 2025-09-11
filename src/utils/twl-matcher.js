/**
 * Generate morphological variants of a term
 */
function generateVariants(term, isName = false) {
  const variants = new Set([term]);

  const isNoun = ['horn', 'mare', 'steed', 'horse', 'doe', 'deer', 'father', 'Father', 'cross', 'well'].includes(term) || isName;
  const doNotPluralize = ['doe'].includes(term);
  const doNotDepluralize = ['kids'].includes(term) || isName;

  // Handle pluralization - simple 's' removal (but not for words ending in 'ss')
  if (term.endsWith('s') && term.length > 2 && !term.endsWith('ss') && !term.endsWith('es') && !doNotDepluralize) {
    variants.add(term.slice(0, -1)); // dogs -> dog (but not does -> doe)
  } else if (!doNotPluralize) {
    variants.add(term + 's'); // dog -> dogs
  }

  // Handle 'es' endings - but only for legitimate plural patterns
  if (term.endsWith('es') && term.length > 4 && !doNotDepluralize) {
    const base = term.slice(0, -2);
    // Only if the base word would naturally take 'es' plural
    if (/[sxz]$|[cs]h$/.test(base)) {
      variants.add(base); // horses -> horse, churches -> church
    }
  } else if (term.endsWith('e') && !doNotPluralize) {
    variants.add(term + 's'); // horse -> horses
  } else if (/[sxz]$|[cs]h$/.test(term) && !doNotPluralize) {
    variants.add(term + 'es'); // church -> churches
  }

  // Handle 'ies' endings for words ending in 'y'
  if (term.endsWith('ies') && term.length > 4 && !doNotDepluralize) {
    variants.add(term.slice(0, -3) + 'y'); // cities -> city
  } else if (term.endsWith('y') && term.length > 2 && !/[aeiou]y$/.test(term) && !doNotPluralize) {
    variants.add(term.slice(0, -1) + 'ies'); // city -> cities
  }

  // // Handle possessive forms -- // Commented out since we use curly quotes
  // variants.add(term + "'s");
  // variants.add(term + "'");
  // if (term.endsWith('s')) {
  //   variants.add(term + "'");
  // }

  // if (!isNoun) {
  //   // Handle -ed forms - but only for legitimate verb patterns
  //   if (term.endsWith('ed') && term.length > 4) {
  //     const base = term.slice(0, -2);
  //     // Only create base form if it looks like a legitimate verb stem
  //     if (base.length > 2) {
  //       variants.add(base); // walked -> walk
  //     }
  //   }

  // // Handle -ing forms
  // if (term.endsWith('ing') && term.length > 5) {
  //   const base = term.slice(0, -3);
  //   if (base.length > 2) {
  //     variants.add(base); // walking -> walk
  //   }
  // }


  if (!isNoun) {
    // Double consonant handling for -ed/-ing
    if (/[bcdfghjklmnpqrstvwxyz][aeiou][bcdfghjklmnpqrstvwxyz]$/.test(term)) {
      variants.add(term + term.slice(-1) + 'ed'); // stop -> stopped
      variants.add(term + term.slice(-1) + 'ing'); // stop -> stopping
    }

    // Regular -ed/-ing addition
    if (!term.endsWith('e')) {
      variants.add(term + 'ed');
      variants.add(term + 'ing');
    } else {
      variants.add(term.slice(0, -1) + 'ed'); // love -> loved
      variants.add(term.slice(0, -1) + 'ing'); // love -> loving
    }
  }

  for (const variant of Array.from(variants)) {
    if (variant.length > 0 && variant[0] === variant[0].toLowerCase() && /[a-z]/.test(variant[0])) {
      variants.add(variant[0].toUpperCase() + variant.slice(1));
    }
  }

  return Array.from(variants);
}

/**
 * Optimized PrefixTrie for fast term matching with case sensitivity
 */
class PrefixTrie {
  constructor() {
    this.exactCaseRoot = {}; // For exact case matches
    this.lowerCaseRoot = {}; // For case-insensitive fallback
  }

  insert(term, originalTerm, articles, isOriginal = true) {
    // Insert into exact case trie
    this._insertIntoTree(this.exactCaseRoot, term, originalTerm, articles, isOriginal, true);

    // // Also insert into lowercase trie for fallback - removed, too many falses
    // this._insertIntoTree(this.lowerCaseRoot, term.toLowerCase(), originalTerm, articles, isOriginal, false);
  }

  _insertIntoTree(root, term, originalTerm, articles, isOriginal, isExactCase) {
    let node = root;

    for (const char of term) {
      if (!node[char]) {
        node[char] = {};
      }
      node = node[char];
    }

    // Store term data at the end node
    if (!node._terms) {
      node._terms = [];
    }

    node._terms.push({
      term: originalTerm,
      articles,
      matchedText: term,
      priority: isOriginal ? 0 : 1,
      isExactCase
    });
  }

  findMatches(text, startPos) {
    // First try exact case matches
    let matches = this._findMatchesInTree(this.exactCaseRoot, text, startPos, true, text);

    // If no exact case matches, try case-insensitive
    if (matches.length === 0) {
      matches = this._findMatchesInTree(this.lowerCaseRoot, text.toLowerCase(), startPos, false, text);
    }

    return matches;
  }

  _findMatchesInTree(root, searchText, startPos, isExactCase, originalText) {
    const matches = [];
    let node = root;
    let currentPos = startPos;

    // Try to match as long as possible
    while (currentPos < searchText.length) {
      const char = searchText[currentPos];

      if (!node[char]) {
        break; // No more matches possible
      }

      node = node[char];
      currentPos++;

      // If we found terms at this position, collect them
      if (node._terms) {
        const matchLength = currentPos - startPos;
        // Always extract from the original text to preserve case
        let originalMatchedText = originalText.substring(startPos, currentPos);

        // Extend match backwards to include dash-connected words and possessive forms
        let extendedStartPos = startPos;

        // Check backwards for dash preceded by word characters (no space between)
        if (extendedStartPos > 0 && originalText[extendedStartPos - 1] === '-') {
          let dashPos = extendedStartPos - 1;
          dashPos--; // Move before the dash
          // Check if there are word characters immediately before the dash
          if (dashPos >= 0 && /[\w]/.test(originalText[dashPos])) {
            // Find the start of the word before the dash
            while (dashPos >= 0 && /[\w]/.test(originalText[dashPos])) {
              dashPos--;
            }
            extendedStartPos = dashPos + 1;
          }
        }

        // Check backwards for apostrophe (straight or curly) preceded by text
        if (extendedStartPos > 0 && /['']/.test(originalText[extendedStartPos - 1])) {
          let apostrophePos = extendedStartPos - 1;
          apostrophePos--; // Move before the apostrophe
          // Check if there are word characters immediately before the apostrophe
          if (apostrophePos >= 0 && /[\w]/.test(originalText[apostrophePos])) {
            // Find the start of the text before the apostrophe
            while (apostrophePos >= 0 && /[\w]/.test(originalText[apostrophePos])) {
              apostrophePos--;
            }
            extendedStartPos = apostrophePos + 1;
          }
        }

        // Extend match forwards to include dash-connected words and possessive forms
        let extendedEndPos = currentPos;

        // Check for dash followed by word characters (no space between)
        if (extendedEndPos < originalText.length && originalText[extendedEndPos] === '-') {
          let dashPos = extendedEndPos;
          dashPos++; // Move past the dash
          // Check if there are word characters immediately after the dash
          if (dashPos < originalText.length && /[\w]/.test(originalText[dashPos])) {
            // Find the end of the word after the dash
            while (dashPos < originalText.length && /[\w]/.test(originalText[dashPos])) {
              dashPos++;
            }
            extendedEndPos = dashPos;
          }
        }

        // Check for apostrophe (straight or curly) followed by text
        if (extendedEndPos < originalText.length && /['']/.test(originalText[extendedEndPos])) {
          let apostrophePos = extendedEndPos;
          apostrophePos++; // Move past the apostrophe
          // Check if there are word characters immediately after the apostrophe
          if (apostrophePos < originalText.length && /[\w]/.test(originalText[apostrophePos])) {
            // Find the end of the text after the apostrophe
            while (apostrophePos < originalText.length && /[\w]/.test(originalText[apostrophePos])) {
              apostrophePos++;
            }
            extendedEndPos = apostrophePos;
          } else {
            // Include the apostrophe even if no text follows (for possessives ending in s)
            extendedEndPos = apostrophePos;
          }
        }

        // Update the matched text if we extended it
        if (extendedStartPos < startPos || extendedEndPos > currentPos) {
          originalMatchedText = originalText.substring(extendedStartPos, extendedEndPos);
        }

        // Check if this is a valid word boundary match (both start and end)
        const isStartBoundary = extendedStartPos === 0 ||
          /[\s\p{P}]/.test(originalText[extendedStartPos - 1]) ||
          !/[\w]/.test(originalText[extendedStartPos - 1]);

        const isEndBoundary = extendedEndPos >= originalText.length ||
          /[\s\p{P}]/.test(originalText[extendedEndPos]) ||
          !/[\w]/.test(originalText[extendedEndPos]);

        const isWordBoundary = isStartBoundary && isEndBoundary;

        if (isWordBoundary) {
          for (const termData of node._terms) {
            matches.push({
              term: termData.term,
              articles: termData.articles,
              matchedText: originalMatchedText, // Use the extended matched text
              length: originalMatchedText.length, // Use extended length
              originalLength: matchLength, // Keep track of original match length for advancement
              priority: termData.priority,
              isExactCase: isExactCase
            });
          }
        }
      }
    }

    // Sort by length (longer first), then by priority, then by case match preference
    return matches.sort((a, b) => {
      if (b.length !== a.length) {
        return b.length - a.length;
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Prefer exact case matches
      if (a.isExactCase !== b.isExactCase) {
        return a.isExactCase ? -1 : 1;
      }
      return 0;
    });
  }
}

/**
 * Create optimized term map using PrefixTrie
 */
function createOptimizedTermMap(twTerms) {
  const trie = new PrefixTrie();
  let termCount = 0;

  console.log('Building optimized term map...');

  for (const [originalTerm, articles] of Object.entries(twTerms)) {
    // Add original term
    trie.insert(originalTerm, originalTerm, articles, true);
    termCount++;

    // Generate and add variants for single words only to avoid exponential explosion
    if (!originalTerm.includes(' ')) {
      let variants = new Set([originalTerm]);
      const isName = articles[0].startsWith('names/') || articles[1]?.startsWith('names/')
      variants = generateVariants(originalTerm, isName);
      console.log(variants)
      for (const variant of variants) {
        if (variant !== originalTerm) {
          trie.insert(variant, originalTerm, articles, false);
          termCount++;
        }
      }
    }
  }

  console.log(`Term map built with ${termCount} terms and variants`);
  return trie;
}

/**
 * Fast matching using optimized algorithm
 */
function findMatches(verseText, termTrie) {
  const matches = [];
  let currentPos = 0;
  let processedText = '';

  // Normalize text
  const normalizedText = verseText
    .replace(/[–—―]/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'");

  while (currentPos < normalizedText.length) {
    // Skip leading whitespace and punctuation (but keep apostrophes for words like don't)
    while (currentPos < normalizedText.length && /[\s\p{P}]/u.test(normalizedText[currentPos]) && !/['']/.test(normalizedText[currentPos])) {
      processedText += normalizedText[currentPos];
      currentPos++;
    }

    if (currentPos >= normalizedText.length) break;

    // Try to find matches starting at current position
    const candidateMatches = termTrie.findMatches(normalizedText, currentPos);
    let bestMatch = null;

    // Pick the best match (longest, then by priority)
    if (candidateMatches.length > 0) {
      bestMatch = candidateMatches[0];
    }

    if (bestMatch) {
      // Create context with brackets
      const matchedText = bestMatch.matchedText;
      const context = processedText + '[' + matchedText + ']' + normalizedText.substring(currentPos + bestMatch.length);

      matches.push({
        term: bestMatch.term,
        articles: bestMatch.articles,
        matchedText: matchedText,
        context: context,
        priority: bestMatch.priority
      });

      // Move past only the original matched text (not the extended part)
      // This allows finding additional matches within the extended portion
      const advanceBy = bestMatch.originalLength || bestMatch.length;
      processedText += normalizedText.substring(currentPos, currentPos + advanceBy);
      currentPos += advanceBy;
    } else {
      // No match found, move to next character/word boundary
      const nextWordBoundary = normalizedText.substring(currentPos).search(/[\s\p{P}]/u);
      const moveDistance = nextWordBoundary === -1 ? 1 : Math.max(1, nextWordBoundary);

      processedText += normalizedText.substring(currentPos, currentPos + moveDistance);
      currentPos += moveDistance;
    }
  }

  return matches;
}

/**
 * Generate a 4-character ID starting with a letter
 */
function generateId() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const lettersAndDigits = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 3; i++) {
    id += lettersAndDigits[Math.floor(Math.random() * lettersAndDigits.length)];
  }
  return id;
}

/**
 * Get article category for Tags column
 */
function getArticleCategory(articlePath) {
  if (articlePath.startsWith('kt/')) return 'keyterm';
  if (articlePath.startsWith('names/')) return 'name';
  return '';
}

/**
 * Create TWLink from article path
 */
function createTWLink(articlePath) {
  return `rc://*/tw/dict/bible/${articlePath.replace('.md', '')}`;
}

/**
 * Create disambiguation string
 */
function createDisambiguation(articles) {
  if (articles.length <= 1) return '';
  const paths = articles.map(path => path.replace('.md', '')).sort();
  return `(${paths.join(', ')})`;
}

/**
 * Process verses and generate TWL matches using the optimized algorithm
 */
export function generateTWLMatches(twTerms, verses) {
  // Use the optimized trie-based approach
  const termTrie = createOptimizedTermMap(twTerms);
  const tsvRows = [];

  // Add TSV header
  tsvRows.push('Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\tDisambiguation\tContext');

  let totalVerses = 0;
  let processedVerses = 0;

  // Count total verses for progress
  for (const chapter of Object.values(verses)) {
    totalVerses += Object.keys(chapter).length;
  }

  console.log(`Processing ${totalVerses} verses...`);

  for (const [chapterNum, chapter] of Object.entries(verses)) {
    for (const [verseNum, verseText] of Object.entries(chapter)) {
      const reference = `${chapterNum}:${verseNum}`;
      const matches = findMatches(verseText, termTrie);

      // Count occurrences for each unique match term
      const occurrenceCounts = new Map();

      // Collect all rows for this verse
      const verseRows = [];

      for (const match of matches) {
        // Count occurrences based on the exact matched text (case-sensitive with punctuation)
        const exactMatchKey = match.matchedText;
        occurrenceCounts.set(exactMatchKey, (occurrenceCounts.get(exactMatchKey) || 0) + 1);

        const id = generateId();
        const tags = getArticleCategory(match.articles[0]);
        const origWords = match.matchedText;
        const occurrence = occurrenceCounts.get(exactMatchKey);
        const twLink = createTWLink(match.articles[0]);
        const disambiguation = createDisambiguation(match.articles);
        const context = match.context;

        verseRows.push({
          reference,
          id,
          tags,
          origWords,
          occurrence,
          twLink,
          disambiguation,
          context,
          bracketPosition: context.indexOf('[')
        });
      }

      // Sort by bracket position within this verse (as before)
      verseRows.sort((a, b) => {
        if (a.bracketPosition === -1 && b.bracketPosition === -1) return 0;
        if (a.bracketPosition === -1) return 1;
        if (b.bracketPosition === -1) return -1;
        return a.bracketPosition - b.bracketPosition;
      });

      // Add sorted rows to TSV
      for (const row of verseRows) {
        tsvRows.push([
          row.reference,
          row.id,
          row.tags,
          row.origWords,
          row.occurrence,
          row.twLink,
          row.disambiguation,
          row.context
        ].join('\t'));
      }

      // Progress indicator
      processedVerses++;
      if (processedVerses % 100 === 0 || processedVerses === totalVerses) {
        console.log(`Progress: ${processedVerses}/${totalVerses} verses (${Math.round(processedVerses / totalVerses * 100)}%)`);
      }
    }
  }

  return tsvRows.join('\n');
}

// Expose lightweight building and scanning APIs for reuse
export function buildTermTrie(twTerms) {
  return createOptimizedTermMap(twTerms);
}

export function scanVerseMatches(verseText, termTrie) {
  return findMatches(verseText, termTrie);
}
