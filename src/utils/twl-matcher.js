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
 * Optimized PrefixTrie for fast term matching with case insensitivity
 */
class PrefixTrie {
  constructor() {
    this.root = {}; // For case-insensitive matches
  }

  insert(term, originalTerm, articles, isOriginal = true) {
    // Insert into case-insensitive trie (always lowercase)
    this._insertIntoTree(this.root, term.toLowerCase(), originalTerm, articles, isOriginal);
  }

  _insertIntoTree(root, term, originalTerm, articles, isOriginal) {
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
      priority: isOriginal ? 0 : 1
    });
  }

  findMatches(text, startPos) {
    // Always use case-insensitive matching
    return this._findMatchesInTree(this.root, text.toLowerCase(), startPos, text);
  }

  _findMatchesInTree(root, searchText, startPos, originalText) {
    const matches = [];
    let node = root;
    let currentPos = startPos;

    // Try to match as long as possible
    while (currentPos < searchText.length) {
      const char = searchText[currentPos];

      // Curly braces wrap "supplied" words/morphemes in the ULT (e.g.
      // "creature{s}"). Match through them transparently (they never appear in
      // a trie term) so "creature{s}" matches the term "creatures"; the braces
      // are re-included when the matched span is extracted below.
      if ((char === '{' || char === '}') && currentPos > startPos) {
        currentPos++;
        continue;
      }

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

        // Extend match backwards to include possessive forms (but not dash-connected words)
        let extendedStartPos = startPos;

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

        // Extend match forwards to include possessive forms (but not dash-connected words)
        let extendedEndPos = currentPos;

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

        // Balance curly braces so a brace split across the match boundary keeps
        // its partner. Matching "creature{s}" through the brace stops the span
        // at "creature{s" (open '{' with no '}'); pull in the trailing '}' so
        // OrigWords becomes "creature{s}". Symmetric for a leading '{'.
        let open = 0, close = 0;
        for (const ch of originalText.substring(extendedStartPos, extendedEndPos)) {
          if (ch === '{') open++;
          else if (ch === '}') close++;
        }
        while (open > close && extendedEndPos < originalText.length && originalText[extendedEndPos] === '}') {
          extendedEndPos++; close++;
        }
        while (close > open && extendedStartPos > 0 && originalText[extendedStartPos - 1] === '{') {
          extendedStartPos--; open++;
        }
        if (extendedStartPos < startPos || extendedEndPos > currentPos) {
          originalMatchedText = originalText.substring(extendedStartPos, extendedEndPos);
        }

        // Check if this is a valid word boundary match (both start and end).
        // Skip past any braces when locating the neighbouring character so a
        // supplied-word brace does not act as a false word boundary: the
        // brace-free reading ("creatures") must be treated as one word, so a
        // bare "creature" before the "{s}" is correctly rejected.
        let beforePos = extendedStartPos - 1;
        while (beforePos >= 0 && (originalText[beforePos] === '{' || originalText[beforePos] === '}')) beforePos--;
        let afterPos = extendedEndPos;
        while (afterPos < originalText.length && (originalText[afterPos] === '{' || originalText[afterPos] === '}')) afterPos++;

        const isStartBoundary = beforePos < 0 ||
          /[\s\p{P}]/u.test(originalText[beforePos]) ||
          !/[\w]/.test(originalText[beforePos]);

        const isEndBoundary = afterPos >= originalText.length ||
          /[\s\p{P}]/u.test(originalText[afterPos]) ||
          !/[\w]/.test(originalText[afterPos]);

        const isWordBoundary = isStartBoundary && isEndBoundary;

        if (isWordBoundary) {
          for (const termData of node._terms) {
            matches.push({
              term: termData.term,
              articles: termData.articles,
              matchedText: originalMatchedText, // Use the extended matched text
              length: originalMatchedText.length, // Use extended length
              originalLength: matchLength, // Keep track of original match length for advancement
              priority: termData.priority
            });
          }
        }
      }
    }

    // Sort by length (longer first), then by priority
    return matches.sort((a, b) => {
      if (b.length !== a.length) {
        return b.length - a.length;
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
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
    // But collect all articles from matches of the same length and priority
    if (candidateMatches.length > 0) {
      bestMatch = candidateMatches[0];

      // Collect all articles from matches with the same length and priority as the best match
      const allArticles = new Set();
      for (const match of candidateMatches) {
        if (match.length === bestMatch.length && match.priority === bestMatch.priority) {
          match.articles.forEach(article => allArticles.add(article));
        }
      }
      bestMatch.articles = Array.from(allArticles);

      // Special case for "god" - prefer the appropriate article based on capitalization
      // but keep all articles for disambiguation
      if (bestMatch.matchedText.toLowerCase() === 'god' && bestMatch.articles.length > 1) {
        const originalMatchedText = normalizedText.substring(currentPos, currentPos + bestMatch.length);
        const hasGodArticle = bestMatch.articles.includes('kt/god');
        const hasFalseGodArticle = bestMatch.articles.includes('kt/falsegod');

        if (hasGodArticle && hasFalseGodArticle) {
          // Check capitalization in original text
          if (originalMatchedText === 'God' || originalMatchedText.charAt(0) === 'G') {
            // Prefer kt/god for capitalized "God"
            bestMatch.preferredArticle = 'kt/god';
          } else {
            // Prefer kt/falsegod for lowercase "god"
            bestMatch.preferredArticle = 'kt/falsegod';
          }
        }
      }
    }

    if (bestMatch) {
      // Create context with brackets
      const matchedText = bestMatch.matchedText;
      const context = processedText + '[' + matchedText + ']' + normalizedText.substring(currentPos + bestMatch.length);

      matches.push({
        term: bestMatch.term,
        articles: bestMatch.articles,
        preferredArticle: bestMatch.preferredArticle,
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

// Expose lightweight building and scanning APIs for reuse
export function buildTermTrie(twTerms) {
  return createOptimizedTermMap(twTerms);
}

export function scanVerseMatches(verseText, termTrie) {
  return findMatches(verseText, termTrie);
}
