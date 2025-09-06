#!/usr/bin/env node
import { generateTWLWithUsfm } from './index.js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: generate-twls [options]

Options:
  --book <book>           Specify the Bible book (e.g., rut)
  --usfm <path>          Path to USFM file to process
  --output <path>        Path to output TSV file
  --help                 Show this help message

Examples:
  generate-twls --book rut
  generate-twls --usfm ./41-MAT.usfm --output ./mat_twl.tsv
  generate-twls --usfm ./file.usfm --book rut`);
}

let book = null;
let usfmPath = null;
let outputPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--book' && args[i + 1]) {
    book = args[i + 1].toLowerCase();
    i++;
  } else if (args[i] === '--usfm' && args[i + 1]) {
    usfmPath = args[i + 1];
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[i + 1];
    i++;
  } else if (args[i] === '--help') {
    printHelp();
    process.exit(0);
  }
}

// Validate arguments
if (!book && !usfmPath) {
  console.error('Error: Either --book or --usfm parameter is required');
  printHelp();
  process.exit(1);
}

if (usfmPath && !fs.existsSync(usfmPath)) {
  console.error(`Error: USFM file not found: ${usfmPath}`);
  process.exit(1);
}

(async () => {
  try {
    let usfmContent = null;
    if (usfmPath) {
      usfmContent = fs.readFileSync(usfmPath, 'utf8');
      console.log(`Reading USFM from: ${usfmPath}`);
    }

    const tsv = await generateTWLWithUsfm(book, usfmContent);

    // Determine output filename
    let filename;
    if (outputPath) {
      filename = outputPath;
    } else if (book) {
      filename = `twl_${book.toUpperCase()}.tsv`;
    } else if (usfmPath) {
      const baseName = path.basename(usfmPath, path.extname(usfmPath));
      filename = `${baseName}.tsv`;
    } else {
      filename = 'output.tsv';
    }

    // Save TSV to file
    fs.writeFileSync(filename, tsv, 'utf8');
    console.log(`TSV file saved as ${filename}`);
    console.log(`Found ${tsv.split('\n').length - 1} matches`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
