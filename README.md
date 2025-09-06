# TWL Generator

A Node.js library and CLI tool for generating Translation Word Links (TWL) TSV files from Door43 USFM data and Translation Words (TW) metadata. This tool intelligently matches biblical terms with their corresponding Translation Words articles using Strong's numbers, morphological analysis, and contextual matching.

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
twl-generator --book rut
# Creates: rut.twl.tsv and rut.no-match.twl.tsv
```

Generate TWL for all books:
```bash
twl-generator --all --out-dir ./output
# Creates TWL files for all 66 biblical books
```

Specify custom output location:
```bash
twl-generator --book mat --out matthew.twl.tsv
```

Enable advanced verb conjugation matching:
```bash
twl-generator --book jhn --use-compromise
# Uses compromise.js for better verb form detection
```

#### CLI Options
- `--book <code>`: Book code (e.g., gen, exo, mat, mrk, jhn, etc.)
- `--all`: Generate TWL files for all biblical books
- `--out <file>`: Specify output file path
- `--out-dir <dir>`: Output directory (for --all option)
- `--use-compromise`: Enable advanced morphological analysis using compromise.js

### Library Usage

#### Basic Usage
```javascript
import { generateTwlByBook } from 'twl-generator';

// Generate TWL for Ruth
const result = await generateTwlByBook('rut');
console.log(result.matchedTsv);    // Main TWL output
console.log(result.noMatchTsv);    // Unmatched entries for analysis
```

#### With Advanced Options
```javascript
import { generateTwlByBook } from 'twl-generator';

// Use advanced morphological analysis
const result = await generateTwlByBook('jhn', { 
  useCompromise: true  // Enable compromise.js for better verb matching
});

// Save to files
import fs from 'fs/promises';
await fs.writeFile('john.twl.tsv', result.matchedTsv);
await fs.writeFile('john.no-match.tsv', result.noMatchTsv);
```

#### Integration Example
```javascript
import { generateTwlByBook } from 'twl-generator';

async function processBibleBook(bookCode) {
  try {
    const { matchedTsv, noMatchTsv } = await generateTwlByBook(bookCode);
    
    // Process the TSV data
    const lines = matchedTsv.split('\n');
    const header = lines[0];
    const rows = lines.slice(1).filter(Boolean);
    
    console.log(`Generated ${rows.length} TWL entries for ${bookCode.toUpperCase()}`);
    
    // Further processing...
    return { success: true, entries: rows.length };
  } catch (error) {
    console.error(`Failed to process ${bookCode}:`, error);
    return { success: false, error: error.message };
  }
}
```

## How It Works

The TWL Generator uses a sophisticated multi-stage process to create Translation Word Links:

### 1. **Data Sources**
- **Original Language USFM**: Hebrew (hbo_uhb) and Greek (el-x-koine_ugnt) texts from Door43
- **English Bible**: unfoldingWord Literal Text (en_ult) for context matching  
- **Translation Words**: Local `tw_strongs_list.json` containing Strong's mappings and term definitions
- **Strong's Numbers**: Links between original language words and semantic concepts

### 2. **Processing Pipeline**

#### Stage 1: Extract Strong's Data
- Parses USFM `\w` tags to extract Strong's numbers from original language texts
- Builds initial TSV with Reference, Strong's ID, and surface words
- Handles multi-word phrases that share Strong's number sequences

#### Stage 2: Generate English Context
- Uses `tsv-quote-converters` to find corresponding English text (GLQuote) in ULT
- Adds GLQuote and GLOccurrence columns for contextual matching
- Converts to OrigWords/Occurrence format for processing

#### Stage 3: Intelligent Article Selection  
For each Strong's number and its English context, the system:

1. **Prioritizes candidate articles** based on:
   - Articles whose slug appears in the GLQuote text
   - Article type preference: kt/ (key terms) → names/ → other/
   - Alphabetical sorting within each category

2. **Performs 4-stage matching** (best match wins):
   - **Stage 1**: Case-sensitive word boundary matching
   - **Stage 2**: Case-insensitive word boundary matching  
   - **Stage 3**: Case-sensitive substring matching
   - **Stage 4**: Case-insensitive morphological variants

3. **Morphological analysis** includes:
   - Pluralization (dog → dogs, man → men)
   - Verb conjugation (-ing, -ed forms)
   - Irregular verb forms (go → went, see → saw)
   - Optional advanced analysis with compromise.js

#### Stage 4: Quality Assurance
- Generates disambiguation info when multiple articles could match
- Marks entries as "Variant of" when morphological variants are used
- Creates separate files for matched and unmatched entries
- Provides detailed statistics and sample unmatched entries

### 3. **Output Format**

The generated TSV contains these columns:

| Column | Description |
|--------|-------------|
| Reference | Chapter:verse (e.g., "1:1") |
| ID | Random 4-character ID starting with letter |
| Tags | "keyterm", "name", or empty based on article type |
| OrigWords | The matched word(s) from the text |
| Occurrence | Which occurrence of this word in the verse |
| TWLink | Link to Translation Words article (rc://*/tw/dict/bible/...) |
| GLQuote | English text context from ULT |  
| GLOccurrence | Occurrence number in English context |
| Strongs | Original Strong's number |
| Variant of | Original term if morphological variant was used |
| Disambiguation | List of other possible articles |

### 4. **Matching Examples**

```
Reference   OrigWords   GLQuote              TWLink                      Variant of
1:17        grace       grace and truth      rc://*/tw/dict/bible/kt/grace
1:17        gracious    gracious God         rc://*/tw/dict/bible/kt/grace   grace
2:3         men         wise men came        rc://*/tw/dict/bible/other/man
2:3         wisdom      with great wisdom    rc://*/tw/dict/bible/kt/wise    wise
```

## Development

### Prerequisites
- Node.js 18+ (uses native fetch)
- Git access to Door43 repositories

### Setup
```bash
git clone https://github.com/unfoldingWord/node-twl-generator.git
cd node-twl-generator
npm install
```

### Testing
```bash
# Test single book generation
npm test

# Test specific book
npm run cli -- --book rut

# Test with advanced morphology
npm run cli -- --book jhn --use-compromise
```

### Local Development
```bash
# Run CLI locally
node src/cli.js --book gen --out test-output.tsv

# Test library integration
node -e "import('./src/index.js').then(m => m.generateTwlByBook('rut').then(console.log))"
```

### Project Structure
```
src/
├── cli.js                    # Command line interface
├── index.js                  # Main library exports
├── common/
│   └── books.js             # Bible book metadata
└── utils/
    ├── twl-matcher.js       # Term matching algorithms (legacy)
    ├── zipProcessor.js      # TW archive processing (legacy)
    └── usfm-alignment-remover.js  # USFM parsing (legacy)
tw_strongs_list.json         # Translation Words database
```

## Data Files

### `tw_strongs_list.json`
This file contains the core mapping between Strong's numbers and Translation Words articles:

```json
{
  "kt/god": {
    "article": {
      "terms": ["God", "god", "deity", "divine"]
    },
    "strongs": [
      ["H430"],     // Single Strong's number
      ["H410"],
      ["G2316", "G2318"]  // Multiple Strong's for compound concepts
    ]
  }
}
```

## Contributing

We welcome contributions! Here's how you can help:

### Reporting Issues
- **Missing matches**: If legitimate biblical terms aren't being matched
- **False positives**: If non-terms are being incorrectly matched  
- **Performance issues**: Slow processing or memory problems
- **Data quality**: Incorrect Strong's mappings or term definitions

### Enhancement Ideas
- **Better morphological analysis**: Improve verb conjugation and irregular forms
- **Multi-language support**: Extend beyond English GLQuotes
- **Contextual disambiguation**: Use surrounding words for better article selection
- **Performance optimization**: Faster processing for large corpora

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes with tests
4. Run the test suite: `npm test`
5. Submit a pull request with detailed description

### Testing Your Changes
```bash
# Test various scenarios
npm run cli -- --book psa --use-compromise  # Large book with advanced features
npm run cli -- --book phm                   # Short book for quick testing
npm run cli -- --book rev                   # Symbolic language testing
```

## Browser Compatibility

While primarily designed for Node.js, core functionality works in modern browsers:

```javascript
// React/Browser usage example
import { generateTwlByBook } from 'twl-generator';

const MyComponent = () => {
  const [tsvData, setTsvData] = useState(null);
  
  const generateTWL = async () => {
    try {
      const result = await generateTwlByBook('mat');
      setTsvData(result.matchedTsv);
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

Typical processing times:
- **Short books** (Philemon, 2-3 John): < 5 seconds
- **Medium books** (Ruth, Ephesians): 5-15 seconds  
- **Large books** (Psalms, Matthew): 30-60 seconds
- **All books**: 15-30 minutes depending on network speed

Memory usage scales with book size, typically 50-200MB peak.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: https://github.com/unfoldingWord/node-twl-generator/issues
- **Discussions**: https://github.com/unfoldingWord/node-twl-generator/discussions  
- **Documentation**: https://github.com/unfoldingWord/node-twl-generator/wiki

## Related Projects

- [tsv-quote-converters](https://www.npmjs.com/package/tsv-quote-converters) - GLQuote generation
- [compromise](https://www.npmjs.com/package/compromise) - Advanced morphological analysis
- [Door43 Content](https://git.door43.org/unfoldingWord) - Source biblical texts and resources