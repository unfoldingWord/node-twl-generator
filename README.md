# TWL Generator

A Node.js library and CLI tool for generating Translation Word Links (TWL) TSV files from Door43 USFM data and Translation Words (TW) metadata.

## Installation

### Global CLI
```bash
npm install -g twl-generator
```

### Library Usage
```bash
npm install twl-generator
```

## Usage

### Command Line
Generate TWL for a specific book:
```bash
generate-twl --book deu --out deuteronomy.twl.tsv
```

Generate TWL for all books:
```bash
generate-twl --all --out-dir ./output
```

Options:
- `--book <code>`: Book code (e.g., gen, deu, mat, etc.)
- `--all`: Generate for all books
- `--out <file>`: Output file path
- `--out-dir <dir>`: Output directory for all books
- `--use-compromise`: Enable advanced verb conjugation matching

### Library Usage
```javascript
import { generateTwlByBook } from 'twl-generator';

const { matchedTsv, noMatchTsv } = await generateTwlByBook('deu');
console.log(matchedTsv); // TSV string with matched Translation Word links
```

## Features

- **Smart Matching**: Multi-stage matching algorithm with word boundaries, case sensitivity, and morphological variants
- **Morphological Support**: Handles plurals, verb conjugations, and irregular forms
- **Variant Detection**: Identifies when terms are matched via substring or truncation
- **Browser Compatible**: Core library works in modern browsers
- **CLI Ready**: Global command-line tool for batch processing

## Matching Algorithm

The TWL generator uses a sophisticated 4-stage matching process:

1. **Case-sensitive word boundary**: Exact matches with word boundaries
2. **Case-insensitive word boundary**: Flexible case matching with boundaries  
3. **Case-sensitive substring**: Exact substring matching
4. **Case-insensitive stripped forms**: Controlled morphological variants

## Data Sources

- **USFM**: Fetched from Door43 repositories (unfoldingWord/hbo_uhb, unfoldingWord/el-x-koine_ugnt)
- **Translation Words**: Local tw_strongs_list.json with Strong's mappings and term lists
- **English Bible**: Uses unfoldingWord/en_ult for GLQuote generation

## Output Format

The generated TSV includes these columns:
- Reference, ID, Tags, OrigWords, Occurrence, TWLink, Strongs, GLQuote, GLOccurrence, Variant of, Disambiguation

## Development

```bash
# Install dependencies
npm install

# Run CLI locally
npm start -- --book gen

# Run browser demo
npm run styleguide

# Build for production
npm run styleguide:build
```

## License

MIT
