#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateTwlByBook } from '../src/index.js';
import { BibleBookData } from '../src/common/books.js';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);

async function readBooksJs() {
  const map = {};
  for (const [code, meta] of Object.entries(BibleBookData)) {
    map[code.toUpperCase()] = { usfm: meta.usfm, testament: meta.testament };
  }
  return map;
}

function parseArgs(argv) {
  const args = { book: '', out: '', outDir: '', all: false, useCompromise: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book' || a === '-b') { args.book = argv[++i] || ''; }
    else if (a === '--out' || a === '-o') { args.out = argv[++i] || ''; }
    else if (a === '--out-dir' || a === '-O') { args.outDir = argv[++i] || ''; }
    else if (a === '--all' || a === '-A') { args.all = true; }
    else if (a === '--use-compromise') { args.useCompromise = true; }
  }
  return args;
}

async function main() {
  const { book, out, outDir, all, useCompromise } = parseArgs(process.argv);
  if (all || (book && book.toLowerCase() === 'all')) {
    const books = await readBooksJs();
    const codes = Object.keys(books);
    const destDir = outDir ? path.resolve(outDir) : path.resolve(THIS_DIR, '..'); // default to twl-generator dir
    await fs.mkdir(destDir, { recursive: true });
    console.error(`Generating TWL for ${codes.length} books to ${destDir} (useCompromise=${useCompromise})`);
    for (const code of codes) {
      try {
        const { matchedTsv, noMatchTsv } = await generateTwlByBook(code, { useCompromise });
        const fname = `${code.toLowerCase()}.twl.tsv`;
        const outPath = path.join(destDir, fname);
        await fs.writeFile(outPath, matchedTsv, 'utf8');
        const nmPath = path.join(destDir, `${code.toLowerCase()}.no-match.twl.tsv`);
        await fs.writeFile(nmPath, noMatchTsv, 'utf8');
        console.error(`  ✓ ${code} -> ${fname}`);
      } catch (err) {
        console.error(`  ✗ ${code} failed:`, err.message || err);
      }
    }
    return;
  }

  if (!book) {
    console.error('Usage: generate-twl --book <code>|all [--out <file.tsv> | --out-dir <dir>] [--use-compromise]');
    process.exit(1);
  }

  const { matchedTsv, noMatchTsv } = await generateTwlByBook(book, { useCompromise });
  if (out) {
    const outPath = path.resolve(out);
    await fs.writeFile(outPath, matchedTsv, 'utf8');
    console.log(`Wrote ${out}`);
    const dir = path.dirname(outPath);
    const base = path.basename(outPath);
    // Derive a sensible no-match filename when --out doesn't follow *.twl.tsv
    let nmFile;
    if (/\.twl\.tsv$/i.test(base)) nmFile = base.replace(/\.twl\.tsv$/i, '.no-match.twl.tsv');
    else if (/\.tsv$/i.test(base)) nmFile = base.replace(/\.tsv$/i, '.no-match.twl.tsv');
    else nmFile = base + '.no-match.twl.tsv';
    const nmPath = path.join(dir, nmFile);
    await fs.writeFile(nmPath, noMatchTsv, 'utf8');
    console.log(`Wrote ${nmPath}`);
  } else if (outDir) {
    const destDir = path.resolve(outDir);
    await fs.mkdir(destDir, { recursive: true });
    const outPath = path.join(destDir, `${book.toLowerCase()}.twl.tsv`);
    await fs.writeFile(outPath, matchedTsv, 'utf8');
    const nmPath = path.join(destDir, `${book.toLowerCase()}.no-match.twl.tsv`);
    await fs.writeFile(nmPath, noMatchTsv, 'utf8');
    console.log(`Wrote ${outPath}`);
    console.log(`Wrote ${nmPath}`);
  } else {
    // When writing to stdout, output only the matched TSV to avoid mixing tables
    process.stdout.write(matchedTsv);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
