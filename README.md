# TWL Generator

A Node.js library and CLI tool for generating Translation Word Links (TWL) TSV files from Door43 (DCS) data. For a given Bible book it downloads the unfoldingWord Literal Text (en_ult) and the Translation Words (en_tw) articles, then scans the English text for the headword terms (and their morphological variants) defined by each TW article, linking every match back to its article. Works in both Node.js (CLI) and browser/React environments.

## Installation

### Global CLI Installation
```bash
npm install -g twl-generator
```

### Library Installation
```bash
npm install twl-generator
```

## Usage

### Command Line Interface

Generate TWL for a specific book:
```bash
twl-generator --book rut --out rut.twl.tsv
# Writes: rut.twl.tsv and rut.no-match.twl.tsv
```

Generate TWL for all 66 books into a directory:
```bash
twl-generator --all --out-dir ./output
```

Write a single book into a directory (filename derived from the book code):
```bash
twl-generator --book mat --out-dir ./output
```

Use a different DCS host:
```bash
twl-generator --book rut --dcs https://qa.door43.org
```

If neither `--out` nor `--out-dir` is given, the matched TSV is written to stdout.

#### CLI Options
- `--book <code>` / `-b`: Book code (e.g. `gen`, `exo`, `mat`, `jhn`). Pass `all` here as an alternative to `--all`.
- `--all` / `-A`: Generate TWL files for all biblical books.
- `--out <file>` / `-o`: Output file path (a matching `*.no-match.twl.tsv` is written alongside it).
- `--out-dir <dir>` / `-O`: Output directory; files are named `<code>.twl.tsv`.
- `--dcs <host>`: DCS base host. Default: `https://git.door43.org`.
- `--use-compromise`: Accepted for backwards compatibility but currently has no effect (see [How It Works](#how-it-works)).

### Library Usage

The package exports a single function, `generateTwlByBook`:

```javascript
import { generateTwlByBook } from 'twl-generator';

const { matchedTsv, noMatchTsv } = await generateTwlByBook('rut');
console.log(matchedTsv);   // Main TWL output (TSV string)
```

#### Options

```javascript
const result = await generateTwlByBook('jhn', {
  dcsHost: 'https://git.door43.org', // DCS host to fetch en_ult and en_tw from
  quiet: true,                        // suppress logging from tsv-quote-converters
});
```

#### Saving to files

```javascript
import fs from 'fs/promises';
import { generateTwlByBook } from 'twl-generator';

const { matchedTsv } = await generateTwlByBook('jhn');
await fs.writeFile('jhn.twl.tsv', matchedTsv);
```

## How It Works

The generator is **English-first**: rather than starting from original-language Strong's numbers, it matches the headword terms of each Translation Words article directly against the English ULT text.

> **Note:** Earlier versions matched via Strong's numbers. That approach has been removed from the active code path — generation no longer reads any Strong's data. (Some unused Strong's-era helper functions still linger in `src/index.js` and a `--use-compromise` flag is still accepted, but neither affects output.)

### 1. Data Sources (all fetched live from DCS)
- **Translation Words** (`unfoldingWord/en_tw`): the article archive. The first heading line (`# ...`) of each `bible/**/*.md` article lists that article's terms.
- **English Bible** (`unfoldingWord/en_ult`): the unfoldingWord Literal Text USFM for the requested book.

Nothing is cached or vendored locally; a network connection to the DCS host is required for every run.

### 2. Processing Pipeline

#### Stage 1: Build the term → article map
The `en_tw` archive is downloaded and unzipped in memory. For each article, the terms in its heading line are normalized and mapped to the article path (e.g. `kt/grace`, `names/ruth`, `other/reap`):
- Trailing parentheticals are stripped: `Joseph (OT)` → `Joseph`.
- Leading articles, demonstratives, and possessives are removed: `the temple` → `temple`.

A single term may map to multiple articles (used later for disambiguation).

#### Stage 2: Build a matching trie with morphological variants
Terms are inserted into a case-insensitive prefix trie. Each **single-word** term is expanded into morphological variants so inflected forms in the text still match:
- Pluralization (`dog` → `dogs`, `city` → `cities`, `church` → `churches`)
- Regular and doubled-consonant verb forms (`stop` → `stopped`/`stopping`, `love` → `loved`/`loving`)

Multi-word terms are inserted as-is (not expanded) to avoid combinatorial blow-up.

#### Stage 3: Fetch and clean the ULT text
The book's en_ult USFM is downloaded, word-alignment markup and most USFM markers are removed, and the result is parsed into chapters and verses. Chapter front matter (`\d` superscriptions, e.g. in Psalms) is preserved and emitted as a `<chapter>:front` reference.

Supplied words/morphemes the ULT wraps in curly braces (e.g. `creature{s}`) are kept. The matcher sees through the braces (so `creature{s}` matches the term `creatures`) but retains them in the output `OrigWords`, which is what the quote aligner needs.

#### Stage 4: Scan each verse
Each verse is walked left to right; at every position the longest, highest-priority trie match wins. Occurrences are counted per exact matched text within the verse. For the term **god**, capitalization disambiguates `kt/god` (capital "God") from `kt/falsegod` (lowercase "god").

#### Stage 5: Align quotes and finalize columns
The matched English spans are run through [`tsv-quote-converters`](https://www.npmjs.com/package/tsv-quote-converters) to align them back to the original-language quotes and to populate the `GLQuote`/`GLOccurrence` columns. These calls degrade gracefully: if the network is unavailable, the generator falls back to the unaligned output rather than failing.

### 3. Output Format

The generated TSV contains these columns:

| Column | Description |
|--------|-------------|
| Reference | Chapter:verse (e.g. `1:1`), or `<chapter>:front` for chapter front matter |
| ID | Random 4-character ID starting with a letter |
| Tags | `keyterm`, `name`, or empty, based on the article category (`kt/`, `names/`, other) |
| OrigWords | The original-language word(s) for the match |
| Occurrence | Which occurrence of this word in the verse |
| TWLink | Link to the Translation Words article (`rc://*/tw/dict/bible/...`) |
| GLQuote | The matched English text from the ULT |
| GLOccurrence | Occurrence number in the English text |
| Variant of | The article's term, set only when the match differs by more than a simple plural/`-ed`/`-ing` inflection |
| Disambiguation | Other candidate articles when the matched term maps to more than one |

A companion `*.no-match.twl.tsv` file is also produced. (It currently contains only a header row; unmatched-entry reporting is a planned enhancement.)

## Development

### Prerequisites
- Node.js 18+ (uses native `fetch`)
- Network access to a DCS host (default `https://git.door43.org`)

### Setup
```bash
git clone https://github.com/unfoldingWord/node-twl-generator.git
cd node-twl-generator
npm install
```

### Running locally
```bash
# Generate a small book and inspect the output
node src/cli.js --book rut --out rut.twl.tsv

# Library smoke test
node -e "import('./src/index.js').then(m => m.generateTwlByBook('rut').then(r => console.log(r.matchedTsv)))"
```

There is no separate test framework, linter, or build step. `npm test` simply runs the CLI on Ruth. Verify changes by regenerating a book and diffing the resulting TSV — `rut` (Ruth) and `phm` (Philemon) are the quickest to iterate on.

### Project Structure
```
src/
├── cli.js                          # Command line interface (the bin entry point)
├── index.js                        # Library export: generateTwlByBook (the orchestrator)
├── common/
│   └── books.js                    # BibleBookData: book code -> { usfm, testament, chapters, ... }
└── utils/
    ├── zipProcessor.js             # Downloads en_tw, builds the term -> article map
    ├── twl-matcher.js              # Prefix trie + morphological variants + verse scanning
    └── usfm-alignment-remover.js   # Fetches en_ult, strips alignment markup, parses verses
```

## Browser Compatibility

The core functionality is designed to run in modern browsers as well as Node.js (it relies only on `fetch` and `JSZip`):

```javascript
import { generateTwlByBook } from 'twl-generator';

const MyComponent = () => {
  const [tsvData, setTsvData] = useState(null);

  const generateTWL = async () => {
    try {
      const { matchedTsv } = await generateTwlByBook('mat');
      setTsvData(matchedTsv);
    } catch (error) {
      console.error('TWL generation failed:', error);
    }
  };

  return (
    <div>
      <button onClick={generateTWL}>Generate TWL for Matthew</button>
      {tsvData && <pre>{tsvData}</pre>}
    </div>
  );
};
```

## Performance

Processing time is dominated by downloading the `en_tw` archive and the book's USFM, plus the quote-alignment step. Short books (Philemon, Ruth) complete in a handful of seconds; large books (Psalms, Matthew) take longer. Times vary mostly with network speed.

## Contributing

We welcome contributions! Particularly useful:
- **Missing matches**: legitimate biblical terms that aren't being matched.
- **False positives**: non-terms being incorrectly matched.
- **Better morphological variants**: improving `generateVariants` in `src/utils/twl-matcher.js`.
- **Unmatched reporting**: populating the currently header-only `*.no-match.twl.tsv` output.

### Workflow
1. Fork the repository and create a feature branch.
2. Make your changes.
3. Regenerate a book or two and diff the TSV to confirm the effect.
4. Submit a pull request with a clear description.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: https://github.com/unfoldingWord/node-twl-generator/issues
- **Discussions**: https://github.com/unfoldingWord/node-twl-generator/discussions

## Related Projects

- [tsv-quote-converters](https://www.npmjs.com/package/tsv-quote-converters) - GLQuote/original-language quote alignment
- [usfm-alignment-remover](https://www.npmjs.com/package/usfm-alignment-remover) - USFM alignment stripping
- [Door43 Content](https://git.door43.org/unfoldingWord) - Source biblical texts and resources
