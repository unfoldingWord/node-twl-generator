/**
 * Universal TWL zipProcessor - Works in both Node.js and Browser environments
 * 
 * For Node.js (CLI): Uses file system caching with article_terms.json
 * For React.js/Browser: Uses localStorage/sessionStorage for persistent caching
 * 
 * Usage in React.js:
 *   import { generateTWTerms } from './utils/zipProcessor.js';
 *   const terms = await generateTWTerms('JHN');
 */

import AdmZip from 'adm-zip';
import { BibleBookData } from '../common/books.js';

// Environment detection
const isNode = typeof process !== 'undefined' && process.versions?.node;
const isBrowser = typeof window !== 'undefined';

const ZIP_URL = 'https://git.door43.org/unfoldingWord/en_tw/archive/master.zip';
const CACHE_KEY = 'twl_article_terms';
const CACHE_VERSION = '1.0';

// In-memory cache for current session
let memoryCache = null;

/**
 * Get Node.js dependencies dynamically
 */
async function getNodeDeps() {
  if (!isNode) return null;

  try {
    const [nodeModule, fsModule, pathModule, urlModule] = await Promise.all([
      import('node-fetch'),
      import('fs'),
      import('path'),
      import('url')
    ]);

    return {
      fetch: nodeModule.default,
      fs: fsModule.default,
      path: pathModule.default,
      fileURLToPath: urlModule.fileURLToPath
    };
  } catch (error) {
    console.error('Failed to load Node.js dependencies:', error);
    return null;
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
  } else if (isNode) {
    // Node.js file system caching
    try {
      const deps = await getNodeDeps();
      if (!deps) return null;

      const { fs, path, fileURLToPath } = deps;
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const CACHE_FILE = path.join(__dirname, '../../article_terms.json');

      if (fs.existsSync(CACHE_FILE)) {
        const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log('Using cached article terms from article_terms.json');
        memoryCache = cachedData;
        return cachedData;
      }
    } catch (error) {
      console.log('File cache corrupted, regenerating...');
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
  } else if (isNode) {
    // Node.js file system caching
    try {
      const deps = await getNodeDeps();
      if (!deps) return;

      const { fs, path, fileURLToPath } = deps;
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const CACHE_FILE = path.join(__dirname, '../../article_terms.json');

      fs.writeFileSync(CACHE_FILE, JSON.stringify(termMap, null, 2), 'utf8');
      console.log('Article terms cached to article_terms.json');
    } catch (error) {
      console.warn('Failed to cache article terms to file:', error.message);
    }
  }
}

export async function generateTWTerms(book) {
  if (!BibleBookData[book]) throw new Error(`Unknown book: ${book}`);

  // Try to get cached terms first
  const cachedTerms = await getCachedTerms();
  if (cachedTerms) {
    return cachedTerms;
  }

  console.log('Downloading TW archive...');

  try {
    // Get appropriate fetch function
    let fetchFn;
    if (isBrowser) {
      fetchFn = window.fetch;
    } else if (isNode) {
      const deps = await getNodeDeps();
      fetchFn = deps?.fetch;
      if (!fetchFn) throw new Error('Failed to load Node.js dependencies');
    }

    const res = await fetchFn(ZIP_URL);
    if (!res.ok) throw new Error(`Failed to download zip: ${res.status} ${res.statusText}`);

    const buffer = await res.arrayBuffer();
    const zip = new AdmZip(Buffer.from(buffer));

    console.log('Processing TW articles...');

    const entries = zip.getEntries().filter(e => e.entryName.match(/^en_tw\/bible\/.*\/.*\.md$/));
    entries.sort((a, b) => a.entryName.localeCompare(b.entryName));

    const termMap = {};

    for (const entry of entries) {
      const content = entry.getData().toString('utf8');
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

    console.log(`Generated ${Object.keys(termMap).length} terms from TW archive`);

    // Cache the results
    await cacheTerms(termMap);

    return termMap;

  } catch (error) {
    console.error('Error generating TW terms:', error);
    throw error;
  }
}

/**
 * Clear cache - useful for forcing refresh in React.js apps
 * @returns {Promise<boolean>} - true if cache was cleared successfully
 */
export async function clearCache() {
  // Clear in-memory cache
  memoryCache = null;

  if (isBrowser) {
    // Clear browser storage
    const storage = getBrowserStorage();
    if (storage) {
      try {
        storage.removeItem(CACHE_KEY);
        console.log('Browser cache cleared');
        return true;
      } catch (error) {
        console.warn('Failed to clear browser cache:', error.message);
        return false;
      }
    }
  } else if (isNode) {
    // Clear Node.js file cache
    try {
      const deps = await getNodeDeps();
      if (deps) {
        const { fs, path, fileURLToPath } = deps;
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const CACHE_FILE = path.join(__dirname, '../../article_terms.json');

        if (fs.existsSync(CACHE_FILE)) {
          fs.unlinkSync(CACHE_FILE);
          console.log('File cache cleared');
          return true;
        }
      }
    } catch (error) {
      console.warn('Failed to clear file cache:', error.message);
      return false;
    }
  }

  console.log('Memory cache cleared');
  return true;
}

/**
 * Get cache information for debugging - useful in React.js development
 * @returns {Object} - cache status and info
 */
export function getCacheInfo() {
  const info = {
    environment: isNode ? 'Node.js' : (isBrowser ? 'Browser' : 'Unknown'),
    hasMemoryCache: !!memoryCache,
    hasPersistentCache: false,
    cacheType: null,
    version: null,
    timestamp: null,
    termCount: 0
  };

  // Memory cache info
  if (memoryCache) {
    info.termCount = Object.keys(memoryCache).length;
  }

  if (isBrowser) {
    // Browser cache info
    const storage = getBrowserStorage();
    if (storage) {
      try {
        const cached = storage.getItem(CACHE_KEY);
        if (cached) {
          const data = JSON.parse(cached);
          info.hasPersistentCache = true;
          info.cacheType = storage === localStorage ? 'localStorage' : 'sessionStorage';
          info.version = data.version;
          info.timestamp = data.timestamp ? new Date(data.timestamp) : null;

          if (!info.termCount && data.terms) {
            info.termCount = Object.keys(data.terms).length;
          }
        }
      } catch (error) {
        // Ignore parse errors
      }
    }
  }

  return info;
}