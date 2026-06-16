# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`twl-generator` is a Node.js library + CLI (also browser-safe) that generates Translation Word Links (TWL) TSV files for Bible books. For a given book it downloads source data live from a Door43 Content Service (DCS) host, scans the English text for terms that map to Translation Words (TW) articles, and emits a `.twl.tsv` file. The only public API is `generateTwlByBook(bookCode, options)` exported from `src/index.js`.

## Commands

```bash
npm install

# Generate for one book (writes <code>.twl.tsv + <code>.no-match.twl.tsv)
node src/cli.js --book rut --out rut.twl.tsv
node src/cli.js --book mat --out-dir ./output

# All 66 books into a directory
node src/cli.js --all --out-dir ./output

# Point at a different DCS host (default https://git.door43.org)
node src/cli.js --book rut --dcs https://qa.door43.org

# Library smoke test
node -e "import('./src/index.js').then(m => m.generateTwlByBook('rut').then(r => console.log(r.matchedTsv)))"
```

There is **no test framework, linter, or build step**. `npm test` just runs the CLI on Ruth. There is no single-test runner — verify changes by regenerating a book and diffing the TSV. Ruth (`rut`) is the fastest real book to iterate on; Philemon (`phm`) is also tiny. Network access to the DCS host is required for any run — everything is fetched live, nothing is cached or vendored.

## Architecture

The pipeline is **English-first and trie-based**. `generateTwlByBook` (the only export of `src/index.js`) orchestrates it:

1. **Terms** — `utils/zipProcessor.js` `generateTWTerms(dcsHost)` downloads `en_tw/archive/master.zip`, reads the first `#` heading line of every `bible/**/*.md` article, and builds a `term -> [articlePath]` map. Terms are normalized: trailing parentheticals stripped (`Joseph (OT)` → `Joseph`), and leading articles/demonstratives/possessives removed.
2. **Trie** — `utils/twl-matcher.js` `buildTermTrie` builds a case-insensitive `PrefixTrie`, expanding each single-word term into morphological variants (plural, `-ed`, `-ing`, etc. via `generateVariants`). Multi-word terms are not expanded.
3. **Text** — `utils/usfm-alignment-remover.js` `processUsfmForBook` fetches the `en_ult` USFM for the book, strips word-alignment markup (delegating to the `usfm-alignment-remover` npm package) and most USFM markers, then parses into a `{ chapter: { verse: text } }` object. Chapter front matter (`\d` superscriptions) is preserved as a `front` pseudo-verse, emitted as `<chapter>:front`.
4. **Scan** — `scanVerseMatches` walks each verse, picking the longest/highest-priority trie match at each position, counting occurrences per exact matched text.
5. **TSV + quote conversion** — rows are assembled, then `tsv-quote-converters` (`convertGLQuotes2OLQuotes` then `addGLQuoteCols`) aligns the English matches back to original-language quotes and adds GLQuote columns. Both calls are wrapped in try/catch with fallbacks so a network failure degrades gracefully rather than throwing.

Output columns: `Reference, ID, Tags, OrigWords, Occurrence, TWLink, GLQuote, GLOccurrence, Variant of, Disambiguation`. `Variant of` is set only when the match differs from the term by more than a simple plural/`-ed`/`-ing` inflection (`allowNoVariant`).

### Curly-brace ("supplied word") handling — read before touching matcher/USFM code
The ULT wraps supplied words/morphemes in `{ }` (e.g. `creature{s}`). These braces are deliberately **preserved** through alignment removal (`usfm-alignment-remover.js`) and matched **transparently** in the trie (`twl-matcher.js` `findMatches` / `_findMatchesInTree`): the matcher matches the brace-free reading (`creatures`) but keeps the braces in `OrigWords` (`creature{s}`), which is what `tsv-quote-converters` needs. There is dedicated brace-balancing and word-boundary logic around the match span — the inline comments explain the invariants. Do not strip braces or treat them as word boundaries.

## Important discrepancies (the README is partly stale)

- **The README's "How It Works" section describes a Strong's-number-based pipeline that is NOT the active code path.** That Strong's logic still exists in `src/index.js` as large unused functions (`pivotByStrong`, `parseWTokens`, `buildInitialTsv`, `prioritizeArticles`, `findMatchingArticles`, `chooseArticleByGlQuote`, etc.) but nothing calls them — `generateTwlByBook` uses the English-first trie path above. The README also calls `utils/twl-matcher.js`, `zipProcessor.js`, and `usfm-alignment-remover.js` "legacy"; they are in fact the **live** path.
- **`--use-compromise` is effectively a no-op.** `cli.js` parses it and passes `useCompromise` into `generateTwlByBook`, but the active path ignores that option (only the dead Strong's code reads it). The `compromise` and `en-inflectors` morphology hooks live in the unused functions.
- **`src/cli-english-first.js` is orphaned/broken** — it imports `generateTWLWithUsfm`, which `index.js` does not export. It is not wired into `bin` or the published `files`. The real CLI entry point is `src/cli.js`.

When fixing bugs in matching or output, work in `twl-matcher.js`, `usfm-alignment-remover.js`, `zipProcessor.js`, and the bottom of `index.js` (`generateTwlByBook` and its local helpers, ~line 817+). The Strong's functions above it can usually be ignored.

## Conventions

- ESM throughout (`"type": "module"`); Node 18+ for native `fetch`. Utility modules detect browser vs. Node (`isBrowser` / `isNode`) and avoid Node-only APIs in shared paths, since the package is meant to also run in React/browser.
- `src/common/books.js` (`BibleBookData`) is the canonical book registry: lowercase code → `{ usfm, testament, chapters, ... }`. The `usfm` field (e.g. `08-RUT`) is the DCS filename; book lookups are case-insensitive.
- The `files` array in `package.json` controls what gets published to npm — update it if you add a module that needs to ship.
