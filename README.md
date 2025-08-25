# twl-generator

Generate term-to-article lists from unfoldingWord en_tw archive for Bible books. Works in both Node.js (CLI) and React.js (browser) environments with intelligent caching.

## Features

- ✅ **Universal**: Works in Node.js and browser environments
- ✅ **Smart Caching**: File system (Node.js) or localStorage/sessionStorage (browser)
- ✅ **Performance**: Optimized matching with PrefixTrie algorithm
- ✅ **Case Sensitivity**: Proper God/god distinction (God→kt/god, god→kt/falsegod)
- ✅ **Morphological Variants**: Handles plurals, possessives, verb forms
- ✅ **Parentheses Normalization**: "Joseph (OT)" → "Joseph" for better coverage

---

## Usage

### CLI

Install globally:

```bash
npm install -g twl-generator
```

Generate a TWL TSV for a Bible book (downloads USFM from Door43):

```bash
twl-generator --book rut
```

Generate a TWL TSV from a local USFM file:

```bash
twl-generator --usfm ./myfile.usfm
```

Specify output file:

```bash
twl-generator --usfm ./myfile.usfm --output ./output.tsv
```

You can also combine `--book` and `--usfm` (book is used for output filename and context):

```bash
twl-generator --usfm ./myfile.usfm --book rut
```

---

### As a Library (Node.js/ESM/React)

Install as a dependency:

```bash
npm install twl-generator
```

#### Example: Generate TWL TSV from USFM string

```js
import { generateTWLWithUsfm } from 'twl-generator';

// USFM string (can be loaded from file, API, etc.)
const usfmContent = `
\\id MAT
\\c 1
\\v 1 In the beginning...
`;

const book = 'mat'; // Book code (optional if USFM contains book info)

const tsv = await generateTWLWithUsfm(book, usfmContent);
// tsv is a string in TSV format, ready to save or process
console.log(tsv);
```

#### Example: Generate TWL TSV by fetching USFM for a book

```js
import { generateTWLWithUsfm } from 'twl-generator';

const book = 'rut'; // Book code

const tsv = await generateTWLWithUsfm(book);
// This will fetch the USFM for the book from Door43 and return the TSV string
console.log(tsv);
```

---

### API Reference

#### `generateTWLWithUsfm(book, usfmContent?)`

- `book`: (string) Book code (e.g., 'mat', 'rut'). Required if `usfmContent` is not provided.
- `usfmContent`: (string, optional) USFM file content. If provided, this is used instead of fetching from Door43.
- **Returns:** `Promise<string>` — TSV string of TWL matches.

---

## License

MIT
