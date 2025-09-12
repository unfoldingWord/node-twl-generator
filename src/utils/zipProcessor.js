/**
 * Universal TWL zipProcessor - Works in both Node.js and Browser environments
 * 
 * Downloads and processes en_tw ZIP files on-demand (no caching per user request)
 * 
 * Usage in React.js:
 *   import { generateTWTerms } from './utils/zipProcessor.js';
 *   const terms = await generateTWTerms('https://git.door43.org');
 */
import JSZip from "jszip";

// Environment detection
const isNode = typeof process !== 'undefined' && process.versions?.node;
const isBrowser = typeof window !== 'undefined';

/**
 * Process ZIP buffer and extract term mappings
 */
async function processZipBuffer(zipBuffer) {
  const zip = new JSZip();
  const zipData = await zip.loadAsync(zipBuffer);

  const entries = [];
  zipData.forEach((relativePath, file) => {
    if (relativePath.match(/^en_tw\/bible\/.*\/.*\.md$/) && !file.dir) {
      entries.push({
        entryName: relativePath,
        getData: () => file.async('string') // Return promise for string content
      });
    }
  });

  entries.sort((a, b) => a.entryName.localeCompare(b.entryName));

  const termMap = {};

  for (const entry of entries) {
    const content = await entry.getData(); // Await the async string content
    const firstLine = content.split('\n')[0];
    const terms = firstLine.replace(/^#/, '').trim().split(',').map(t => t.trim()).filter(Boolean);
    const truncated = entry.entryName.replace('en_tw/bible/', '');

    for (const term of terms) {
      // Normalize terms by removing parentheses and spaces before them
      // e.g., "Joseph (OT)" -> "Joseph", "Mary (sister of Martha)" -> "Mary"
      const normalizedTerm = term.replace(/\s+\([^)]*\)$/, '').trim();

      if (!termMap[normalizedTerm]) {
        termMap[normalizedTerm] = [];
      }
      termMap[normalizedTerm].push(truncated);
    }
  }

  // Sort article arrays for consistent output
  for (const term in termMap) {
    termMap[term].sort();
  }

  return termMap;
}

export async function generateTWTerms(dcsHost = 'https://git.door43.org') {
  // Always download fresh ZIP (no caching per user request)
  const zipUrl = `${dcsHost}/unfoldingWord/en_tw/archive/master.zip`;
  console.log(`Downloading TW archive from ${zipUrl}...`);

  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`Failed to download ZIP: ${res.status} ${res.statusText}`);

  const zipBuffer = await res.arrayBuffer();

  // Process ZIP to extract terms
  console.log('Processing TW articles...');
  const termMap = await processZipBuffer(zipBuffer);

  console.log(`Generated ${Object.keys(termMap).length} terms from TW archive`);

  return termMap;
}

/**
 * Get information about the current environment for debugging
 */
export function getEnvironmentInfo() {
  return {
    environment: isNode ? 'Node.js' : (isBrowser ? 'Browser' : 'Unknown'),
    hasFetch: typeof fetch !== 'undefined',
    hasJSZip: typeof JSZip !== 'undefined'
  };
}