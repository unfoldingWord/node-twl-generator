/**
 * Universal TWL zipProcessor - Works in both Node.js and Browser environments
 * 
 * Caches the raw ZIP file and processes term headers on-demand
 * 
 * Usage in React.js:
 *   import { generateTWTerms } from './utils/zipProcessor.js';
 *   const terms = await generateTWTerms();
 */
import JSZip from "jszip";

// Environment detection
const isNode = typeof process !== 'undefined' && process.versions?.node;
const isBrowser = typeof window !== 'undefined';

const ZIP_URL = 'https://git.door43.org/unfoldingWord/en_tw/archive/master.zip';
const CACHE_KEY = 'twl_zip_cache';
const CACHE_VERSION = '1.0';

// In-memory cache for processed terms (per session)
let processedTermsCache = null;

async function getCachedZip() {
  if (isBrowser) {
    // Browser: Use localStorage for ZIP cache
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        // Only use cache if version matches and cache is less than 5 minutes old
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (
          data.version === CACHE_VERSION &&
          data.timestamp &&
          (Date.now() - data.timestamp) < FIVE_MINUTES
        ) {
          console.log('Using cached ZIP from browser storage');
          return new Uint8Array(data.zipData);
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch (error) {
      console.log('Browser ZIP cache corrupted, re-downloading...');
      try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
    }
  }
  // Note: In Node.js we could cache to filesystem, but fresh download is fine for CLI usage

  return null;
}

/**
 * Cache ZIP data in appropriate storage  
 */
async function cacheZip(zipBuffer) {
  if (isBrowser) {
    try {
      const cacheData = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        zipData: Array.from(new Uint8Array(zipBuffer))
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      console.log('ZIP cached in browser storage');
    } catch (error) {
      console.warn('Failed to cache ZIP in browser:', error.message);
    }
  }
}

/**
 * Get browser storage (localStorage or sessionStorage)
 */
function getBrowserStorage() {
  if (!isBrowser) return null;

  try {
    return localStorage || sessionStorage || null;
  } catch (e) {
    console.warn('Browser storage not available:', e.message);
    return null;
  }
}

/**
 * Get cached terms from appropriate storage
 */
async function getCachedTerms() {
  // Check in-memory cache first (fastest)
  if (memoryCache) {
    console.log('Using in-memory cached article terms');
    return memoryCache;
  }

  if (isBrowser) {
    // Browser caching with localStorage/sessionStorage
    const storage = getBrowserStorage();
    if (storage) {
      try {
        const cached = storage.getItem(CACHE_KEY);
        if (cached) {
          const data = JSON.parse(cached);
          if (data.version === CACHE_VERSION) {
            console.log('Using browser cached article terms');
            memoryCache = data.terms;
            return data.terms;
          } else {
            console.log('Browser cache version mismatch, regenerating...');
            storage.removeItem(CACHE_KEY);
          }
        }
      } catch (error) {
        console.log('Browser cache corrupted, regenerating...');
        try {
          storage.removeItem(CACHE_KEY);
        } catch (e) { /* ignore cleanup errors */ }
      }
    }
  }

  return null;
}

/**
 * Cache terms in appropriate storage
 */
async function cacheTerms(termMap) {
  // Always cache in memory for this session
  memoryCache = termMap;

  if (isBrowser) {
    // Browser caching
    const storage = getBrowserStorage();
    if (storage) {
      try {
        const cacheData = {
          version: CACHE_VERSION,
          timestamp: Date.now(),
          terms: termMap
        };
        storage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        console.log('Article terms cached in browser storage');
      } catch (error) {
        console.warn('Failed to cache in browser storage:', error.message);
      }
    }
  }
}

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

export async function generateTWTerms() {
  // Check if we already processed terms this session
  if (processedTermsCache) {
    console.log('Using in-memory processed terms');
    return processedTermsCache;
  }

  // Try to get cached ZIP first
  let zipBuffer = await getCachedZip();

  if (!zipBuffer) {
    // Download fresh ZIP
    console.log('Downloading TW archive...');

    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error(`Failed to download ZIP: ${res.status} ${res.statusText}`);

    zipBuffer = await res.arrayBuffer();

    // Cache the ZIP for next time
    await cacheZip(zipBuffer);
  }

  // Process ZIP to extract terms
  console.log('Processing TW articles...');
  const termMap = await processZipBuffer(zipBuffer);

  console.log(`Generated ${Object.keys(termMap).length} terms from TW archive`);

  // Cache processed terms for this session
  processedTermsCache = termMap;

  return termMap;
}

/**
 * Clear cache - useful for forcing refresh
 */
export async function clearCache() {
  // Clear in-memory cache
  processedTermsCache = null;

  if (isBrowser) {
    try {
      localStorage.removeItem(CACHE_KEY);
      console.log('Browser ZIP cache cleared');
      return true;
    } catch (error) {
      console.warn('Failed to clear browser cache:', error.message);
      return false;
    }
  }

  console.log('Memory cache cleared');
  return true;
}

/**
 * Get cache information for debugging
 */
export function getCacheInfo() {
  const info = {
    environment: isNode ? 'Node.js' : (isBrowser ? 'Browser' : 'Unknown'),
    hasProcessedTerms: !!processedTermsCache,
    hasZipCache: false,
    termCount: 0,
    cacheVersion: CACHE_VERSION
  };

  // Check processed terms
  if (processedTermsCache) {
    info.termCount = Object.keys(processedTermsCache).length;
  }

  // Check ZIP cache in browser
  if (isBrowser) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        info.hasZipCache = true;
        info.timestamp = data.timestamp ? new Date(data.timestamp) : null;
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  return info;
}