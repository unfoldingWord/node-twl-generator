# twl-generator

Generate term-to-article lists from unfoldingWord en_tw archive for Bible books. Works in both Node.js (CLI) and React.js (browser) environments with intelligent caching.

## Features

- ✅ **Universal**: Works in Node.js and browser environments
- ✅ **Smart Caching**: File system (Node.js) or localStorage/sessionStorage (browser)
- ✅ **Performance**: Optimized matching with PrefixTrie algorithm
- ✅ **Case Sensitivity**: Proper God/god distinction (God→kt/god, god→kt/falsegod)
- ✅ **Morphological Variants**: Handles plurals, possessives, verb forms
- ✅ **Parentheses Normalization**: "Joseph (OT)" → "Joseph" for better coverage

## Usage

### CLI (Node.js)

```bash
# Install globally
npm install -g twl-generator

# Generate TSV for a Bible book
twl-generator --book JHN --output john.tsv

# Process local USFM file
twl-generator --usfm my-file.usfm --output results.tsv
```

### React.js / Browser

```jsx
import { generateTWTerms, getCacheInfo, clearCache } from 'twl-generator/src/utils/zipProcessor.js';

function MyTWLComponent() {
  const [terms, setTerms] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadTerms = async (book) => {
    setLoading(true);
    try {
      // First load: Downloads and processes (~3-4 seconds)
      // Subsequent loads: Uses browser cache (~instant)
      const termData = await generateTWTerms(book);
      setTerms(termData);

      // Debug cache info
      console.log('Cache info:', getCacheInfo());
    } catch (error) {
      console.error('Failed to load terms:', error);
    }
    setLoading(false);
  };

  const handleClearCache = async () => {
    await clearCache();
    console.log('Cache cleared - next load will download fresh data');
  };

  return (
    <div>
      {loading && <p>Loading translation words...</p>}
      <button onClick={() => loadTerms('JHN')}>Load John</button>
      <button onClick={() => loadTerms('RUT')}>Load Ruth</button>
      <button onClick={handleClearCache}>Clear Cache</button>
      {terms && <p>Loaded {Object.keys(terms).length} terms</p>}
    </div>
  );
}
```

### Node.js Module

```js
import { generateTWL } from 'twl-generator';

const result = await generateTWL('RUT');
console.log(result);
```

## Browser Caching Strategy

The package uses a multi-tier caching approach for optimal performance in React.js:

1. **Memory Cache**: Fastest access during current session
2. **localStorage**: Persistent across browser sessions
3. **sessionStorage**: Fallback for private browsing mode
4. **Auto-regeneration**: Downloads fresh data when cache is invalid

### Cache Performance

- **Cold start** (no cache): ~3-4 seconds
- **Warm start** (browser cache): ~50-100ms
- **Hot start** (memory cache): ~1-5ms

## API Reference

### `generateTWTerms(book)`

Generate terms for a Bible book with caching.

- **book**: Bible book code (e.g., 'JHN', 'RUT', 'GEN')
- **Returns**: Promise<Object> - Term mapping object

### `clearCache()`

Clear all caches and force fresh download on next call.

- **Returns**: Promise<boolean> - Success status

### `getCacheInfo()`

Get cache status for debugging.

- **Returns**: Object with cache details

## Installation

```bash
# Global installation (for CLI usage)
npm install -g twl-generator

# Local installation (for React.js projects)
npm install twl-generator
```

## Supported Bible Books

All standard Bible book abbreviations are supported:

**Old Testament**: GEN, EXO, LEV, NUM, DEU, JOS, JDG, RUT, 1SA, 2SA, 1KI, 2KI, 1CH, 2CH, EZR, NEH, EST, JOB, PSA, PRO, ECC, SNG, ISA, JER, LAM, EZK, DAN, HOS, JOL, AMO, OBA, JON, MIC, NAH, HAB, ZEP, HAG, ZEC, MAL

**New Testament**: MAT, MRK, LUK, JHN, ACT, ROM, 1CO, 2CO, GAL, EPH, PHP, COL, 1TH, 2TH, 1TI, 2TI, TIT, PHM, HEB, JAS, 1PE, 2PE, 1JN, 2JN, 3JN, JUD, REV

## Output Format

The generated TSV contains these columns:

- **Reference**: Chapter:verse (e.g., "1:1")
- **ID**: Unique 4-character hex identifier
- **Tags**: Article category ("keyterm", "name", or empty)
- **OrigWords**: The matched text from the source
- **Occurrence**: Occurrence number for this term in this verse
- **TWLink**: Link to the translation words article
- **Disambiguation**: Multiple article options (if applicable)
- **Context**: Verse text with [matched term] in brackets

## Requirements

- **Node.js**: >=16.0.0
- **Browser**: Modern browser with ES6 modules support
- **React.js**: >=16.8.0 (for React usage)

## License

MIT License - see LICENSE file for details.
