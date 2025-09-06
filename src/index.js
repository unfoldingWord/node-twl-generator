import { BibleBookData } from './common/books.js';

const isBrowser = typeof window !== 'undefined';
const TW_JSON_URL = new URL('../tw_strongs_list.json', import.meta.url);

async function readBooks() {
  // Build a simple CODE -> { usfm, testament } map from the local BibleBookData
  const map = {};
  for (const [code, meta] of Object.entries(BibleBookData)) {
    map[code.toUpperCase()] = { usfm: meta.usfm, testament: meta.testament };
  }
  return map;
}

function findBookMeta(bookMap, code) {
  const key = Object.keys(bookMap).find(k => k.toLowerCase() === code.toLowerCase());
  if (!key) return null;
  const meta = bookMap[key];
  if (!meta || !meta.usfm || !meta.testament) return null;
  return { key, ...meta };
}

async function fetchUsfm(usfmCode, testament) {
  const repo = testament === 'old' ? 'hbo_uhb' : 'el-x-koine_ugnt';
  const url = `https://git.door43.org/api/v1/repos/unfoldingWord/${repo}/contents/${usfmCode}.usfm`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch USFM: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const b64 = json.content || '';

  if (isBrowser) {
    // Browser: use atob and TextDecoder
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } else {
    // Node.js: use Buffer
    const { Buffer } = await import('node:buffer');
    const buf = Buffer.from(b64, 'base64');
    return buf.toString('utf8');
  }
}

function pivotByStrong(twMap) {
  // Build two structures:
  // 1) singles: strong -> Set(articles) including base (strip letter suffix)
  // 2) seqFirst: base-first-strong -> [{ article, seqBase, len }] preserving order in twMap
  const singles = new Map();
  const seqFirst = new Map();
  const toBase = (sid) => {
    const m = String(sid || '').match(/^([HG])(\d+)([a-f])?$/i);
    if (!m) return '';
    return `${m[1].toUpperCase()}${m[2]}`;
  };

  for (const [article, val] of Object.entries(twMap)) {
    const list = Array.isArray(val && val.strongs ? val.strongs : undefined) ? val.strongs : [];
    for (const arr of list) {
      const seq = Array.isArray(arr) ? arr.filter(Boolean) : [];
      if (!seq.length) continue;
      // map each sid to article for singles (also its base form)
      for (const sid of seq) {
        const add = (s) => {
          if (!s) return;
          if (!singles.has(s)) singles.set(s, new Set());
          singles.get(s).add(article);
        };
        add(sid);
        add(toBase(sid));
      }
      // record multi-strong sequences by their base first sid
      if (seq.length > 1) {
        const firstBase = toBase(seq[0]);
        if (firstBase) {
          if (!seqFirst.has(firstBase)) seqFirst.set(firstBase, []);
          seqFirst.get(firstBase).push({ article, seqBase: seq.map(toBase), len: seq.length });
        }
      }
    }
  }
  // convert to plain objects/arrays
  const singlesObj = {};
  for (const [k, v] of singles.entries()) singlesObj[k] = Array.from(v);
  const seqFirstObj = {};
  for (const [k, v] of seqFirst.entries()) seqFirstObj[k] = v.slice().sort((a, b) => b.len - a.len);
  // expose legacy mapping for strong -> articles, and an extra property for sequences
  return Object.assign(singlesObj, { __seqFirst: seqFirstObj });
}

function parseWTokens(usfm) {
  // return array of { c, v, surface, attrs }
  const out = [];
  let curC = 0, curV = 0;
  const cRe = /\\c\s+(\d+)/g;
  let m;
  // We'll iterate once and collect tokens with current chapter/verse; cheaper: do a global walk
  const re = /(\\c\s+(\d+))|(\\v\s+(\d+))|\\w\s+([^|\s][^|]*?)\|([^\\]*?)\\w\*/g;
  while ((m = re.exec(usfm))) {
    if (m[2]) { curC = parseInt(m[2], 10); continue; }
    if (m[4]) { curV = parseInt(m[4], 10); continue; }
    if (m[5]) {
      out.push({ c: curC, v: curV, surface: m[5], attrs: m[6] || '' });
    }
  }
  return out;
}

function extractStrongIds(attrText) {
  const sm = attrText.match(/(?:x-)?strong="([^"]+)"/);
  if (!sm) return [];
  const parts = sm[1].split(/[\s|]+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let p of parts) {
    const core = p.split(':').pop().trim();
    const m = core.match(/^([HG])(\d+)([a-f]?)$/i);
    if (!m) continue;
    out.push(`${m[1].toUpperCase()}${m[2]}${(m[3] || '').toLowerCase()}`);
  }
  return out;
}

function buildInitialTsv(usfm, strongPivot, bookCode) {
  const tokens = parseWTokens(usfm).map(t => ({ ...t, sids: extractStrongIds(t.attrs) }));
  const rows = [];
  // map of `${c}:${v}` -> Map(phrase -> count)
  const occMap = new Map();
  const getArts = (sid) => {
    let arts = strongPivot[sid];
    if ((!arts || !arts.length) && /^(H|G)\d+[a-f]$/.test(sid)) {
      const base = sid.slice(0, -1);
      arts = strongPivot[base];
    }
    return arts;
  };
  const toBase = (sid) => {
    const m = String(sid || '').match(/^([HG])(\d+)([a-f])?$/i);
    if (!m) return '';
    return `${m[1].toUpperCase()}${m[2]}`;
  };
  const tokenHasSid = (tok, sidBase) => {
    if (!sidBase) return false;
    return (tok.sids || []).some(s => toBase(s) === sidBase);
  };
  const seqFirst = strongPivot.__seqFirst || {};

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.c || !t.v) { i++; continue; }
    const keyCv = `${t.c}:${t.v}`;
    if (!occMap.has(keyCv)) occMap.set(keyCv, new Map());
    const cvMap = occMap.get(keyCv);

    // Try to match the longest multi-Strong's sequence starting at this token (within the same verse)
    let bestSeq = null;
    const startBases = (t.sids || []).map(toBase).filter(Boolean);
    for (const firstBase of startBases) {
      const candidates = seqFirst[firstBase] || [];
      for (const cand of candidates) {
        // Ensure all subsequent sids match in order within the same verse
        let ok = true;
        for (let k = 0; k < cand.seqBase.length; k++) {
          const pos = i + k;
          const tt = tokens[pos];
          if (!tt || tt.c !== t.c || tt.v !== t.v) { ok = false; break; }
          if (!tokenHasSid(tt, cand.seqBase[k])) { ok = false; break; }
        }
        if (ok) {
          if (!bestSeq || cand.len > bestSeq.len) bestSeq = { ...cand };
        }
      }
    }

    if (bestSeq) {
      // Build combined surface phrase and count occurrence within the verse
      const len = bestSeq.len;
      const phrase = tokens.slice(i, i + len).map(x => x.surface.trim()).join(' ');
      const cur = (cvMap.get(phrase) || 0) + 1;
      cvMap.set(phrase, cur);
      // Assign ID as the first strong in the sequence; TWLink prefers the sequence's article
      const firstSid = (t.sids && t.sids[0]) ? t.sids[0] : bestSeq.seqBase[0];
      const art = bestSeq.article;
      const tag = art.startsWith('kt/') ? 'kt' : (art.startsWith('names/') ? 'names' : '');
      const twLink = `rc://*/tw/dict/bible/${art}`;
      rows.push([`${t.c}:${t.v}`, firstSid, tag, phrase, String(cur), twLink]);
      i += len; // skip consumed tokens
      continue;
    }

    // Fallback: single-token behavior
    const normSurface = t.surface.trim();
    const cur = (cvMap.get(normSurface) || 0) + 1;
    cvMap.set(normSurface, cur);
    const sidList = t.sids || [];
    if (!sidList.length) { i++; continue; }
    for (const sid of sidList) {
      const arts = getArts(sid);
      if (!arts || !arts.length) continue;
      const first = arts[0];
      const tag = first.startsWith('kt/') ? 'kt' : (first.startsWith('names/') ? 'names' : '');
      const twLink = `rc://*/tw/dict/bible/${first}`;
      rows.push([`${t.c}:${t.v}`, sid, tag, normSurface, String(cur), twLink]);
    }
    i++;
  }

  const header = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink'];
  const tsv = [header.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
  return tsv;
}

async function loadTwJsonLocal() {
  if (isBrowser) {
    // In browser, try to fetch from public path
    const url = '/tw_strongs_list.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch tw_strongs_list.json: ${res.status}`);
    return await res.json();
  } else {
    // In Node.js, read from file system
    const fs = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const filePath = fileURLToPath(TW_JSON_URL);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
}

function buildArticleTermMap(twMap) {
  // Normalize helper: remove only trailing parenthetical notes and collapse whitespace
  const stripParensTrim = (s) => String(s || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  const out = new Map(); // article -> ordered unique terms as { orig, lower }
  for (const [k, v] of Object.entries(twMap)) {
    const terms = (v && v.article && typeof v.article === 'object' && Array.isArray(v.article.terms)) ? v.article.terms : [];
    const ordered = [];
    for (const t of terms) {
      const orig = stripParensTrim(t);
      if (!orig) continue;
      ordered.push({ orig, lower: orig.toLowerCase() });
    }
    // de-dupe by lower, preserve order
    const seen = new Set();
    const uniq = [];
    for (const obj of ordered) {
      if (seen.has(obj.lower)) continue;
      seen.add(obj.lower);
      uniq.push(obj);
    }
    // sort longest to shortest; for ties, preserve original order (stable by adding index)
    const withOrd = uniq.map((o, i) => ({ ...o, ord: i }));
    withOrd.sort((a, b) => {
      const dl = b.orig.length - a.orig.length;
      if (dl !== 0) return dl;
      return a.ord - b.ord;
    });
    out.set(k, withOrd);
  }
  return out;
}

// Build prioritized candidate list for a given strongId and GLQuote
function prioritizeArticles(glq, strongId, strongPivot) {
  let candidates = (strongPivot[strongId] || []).slice();
  if ((!candidates || !candidates.length) && /^(H|G)\d+[a-f]$/.test(strongId)) {
    const base = strongId.slice(0, -1);
    candidates = (strongPivot[base] || []).slice();
  }
  if (!candidates.length) return [];
  const text = String(glq || '').toLowerCase();

  const slugOf = (art) => (art.includes('/') ? art.split('/').pop() : art).toLowerCase();
  // 1) Articles whose slug appears in GLQuote, ordered by longer slug first
  const slugMatched = candidates
    .filter((a) => text.includes(slugOf(a)))
    .sort((a, b) => slugOf(b).length - slugOf(a).length);
  const inSlug = new Set(slugMatched);

  // 2) Remaining articles grouped kt/ then names/ then other; each group sorted by slug alphabetically
  const rest = candidates.filter(a => !inSlug.has(a));
  const groupRank = (a) => (a.startsWith('kt/') ? 0 : (a.startsWith('names/') ? 1 : 2));
  const restSorted = rest.sort((a, b) => {
    const ga = groupRank(a), gb = groupRank(b);
    if (ga !== gb) return ga - gb;
    const sa = slugOf(a), sb = slugOf(b);
    return sa.localeCompare(sb);
  });

  return slugMatched.concat(restSorted);
}

function chooseArticleByGlQuote(glq, strongId, strongPivot, termMap, opts = {}) {
  const useCompromise = !!opts.useCompromise;
  const nlp = opts.nlp;
  const prioritized = prioritizeArticles(glq, strongId, strongPivot);
  if (!prioritized.length) return null;
  const textOrig = String(glq || '');
  const textLower = textOrig.toLowerCase();
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Utility: split a term into head (all but last word) and last word.
  // head has no trailing space, last has no leading space. Rejoin with (head ? head+" " : "") + last
  const splitHeadLast = (term) => {
    const parts = String(term || '').trim().split(/\s+/);
    if (parts.length <= 1) return { head: '', last: parts[0] || '' };
    const last = parts.pop();
    return { head: parts.join(' '), last };
  };

  // Basic pluralization helper for English terms. Handles common endings and a few irregulars.
  const pluralizeTerm = (term) => {
    const out = new Set();
    const add = (s) => { const v = s.trim(); if (v) out.add(v); };
    const irregular = {
      man: 'men', woman: 'women', person: 'people', child: 'children',
      foot: 'feet', tooth: 'teeth', goose: 'geese', mouse: 'mice', ox: 'oxen',
    };
    const pluralizeWord = (w) => {
      const lw = w.toLowerCase();
      if (irregular[lw]) return irregular[lw];
      // endings
      if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
      if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
      if (/f$/i.test(w) && !/(roof|belief|chief|proof)$/i.test(w)) return w.replace(/f$/i, 'ves');
      if (/fe$/i.test(w)) return w.replace(/fe$/i, 'ves');
      if (/o$/i.test(w)) return w + 'es';
      return w + 's';
    };
    const parts = term.split(/\s+/);
    if (parts.length === 1) {
      add(pluralizeWord(term));
    } else {
      const last = parts.pop();
      const pl = pluralizeWord(last);
      add([...parts, pl].join(' '));
    }
    // also the simple +s as fallback
    add(term + 's');
    return Array.from(out);
  };

  // Helpers to form -ing and -ed variants for a single word
  const isVowel = (ch) => /[aeiou]/i.test(ch);
  const isConsonant = (ch) => /[a-z]/i.test(ch) && !isVowel(ch);
  const endsWithCVC = (w) => {
    if (w.length < 3) return false;
    const a = w[w.length - 3], b = w[w.length - 2], c = w[w.length - 1];
    if (!isConsonant(a) || !isVowel(b) || !isConsonant(c)) return false;
    // don't double for w, x, y
    if (/[wxy]/i.test(c)) return false;
    return true;
  };
  const presentParticipleWord = (w) => {
    if (/ie$/i.test(w)) return w.replace(/ie$/i, 'ying'); // tie -> tying
    if (/ee$/i.test(w)) return w + 'ing'; // see -> seeing
    if (/e$/i.test(w)) return w.replace(/e$/i, 'ing'); // make -> making
    if (endsWithCVC(w)) return w + w[w.length - 1] + 'ing'; // run -> running
    return w + 'ing';
  };
  const pastTenseWord = (w) => {
    if (/e$/i.test(w)) return w + 'd'; // move -> moved
    if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ied'); // carry -> carried
    if (endsWithCVC(w)) return w + w[w.length - 1] + 'ed'; // stop -> stopped
    return w + 'ed';
  };
  const ingEdFormsForTerm = (term) => {
    const forms = new Set();
    const parts = term.split(/\s+/);
    if (parts.length === 1) {
      forms.add(presentParticipleWord(term));
      forms.add(pastTenseWord(term));
    } else {
      const last = parts.pop();
      const base = parts.join(' ');
      forms.add((base ? base + ' ' : '') + presentParticipleWord(last));
      forms.add((base ? base + ' ' : '') + pastTenseWord(last));
    }
    return Array.from(forms);
  };

  // Irregular verb support: small curated map plus reverse lookup
  const irregularVerbMap = {
    be: ['am', 'is', 'are', 'was', 'were', 'been', 'being', 'be'],
    do: ['did', 'done', 'doing', 'does'],
    go: ['went', 'gone', 'going', 'goes'],
    have: ['had', 'having', 'has'],
    say: ['said', 'saying', 'says'],
    see: ['saw', 'seen', 'seeing', 'sees'],
    get: ['got', 'gotten', 'getting', 'gets'],
    make: ['made', 'making', 'makes'],
    take: ['took', 'taken', 'taking', 'takes'],
    come: ['came', 'coming', 'comes'],
    know: ['knew', 'known', 'knowing', 'knows'],
    give: ['gave', 'given', 'giving', 'gives'],
    find: ['found', 'finding', 'finds'],
    think: ['thought', 'thinking', 'thinks'],
    tell: ['told', 'telling', 'tells'],
    become: ['became', 'become', 'becoming', 'becomes'],
    show: ['showed', 'shown', 'showing', 'shows'],
    leave: ['left', 'leaving', 'leaves'],
    feel: ['felt', 'feeling', 'feels'],
    put: ['put', 'putting', 'puts'],
    bring: ['brought', 'bringing', 'brings'],
    begin: ['began', 'begun', 'beginning', 'begins'],
    keep: ['kept', 'keeping', 'keeps'],
    hold: ['held', 'holding', 'holds'],
    write: ['wrote', 'written', 'writing', 'writes'],
    stand: ['stood', 'standing', 'stands'],
    hear: ['heard', 'hearing', 'hears'],
    let: ['let', 'letting', 'lets'],
    mean: ['meant', 'meaning', 'means'],
    set: ['set', 'setting', 'sets'],
    meet: ['met', 'meeting', 'meets'],
    run: ['ran', 'running', 'runs'],
    pay: ['paid', 'paying', 'pays'],
    sit: ['sat', 'sitting', 'sits'],
    speak: ['spoke', 'spoken', 'speaking', 'speaks'],
    lie: ['lay', 'lain', 'lying', 'lies'],
    lead: ['led', 'leading', 'leads'],
    read: ['read', 'reading', 'reads'],
    grow: ['grew', 'grown', 'growing', 'grows'],
    fall: ['fell', 'fallen', 'falling', 'falls'],
    send: ['sent', 'sending', 'sends'],
    build: ['built', 'building', 'builds'],
    understand: ['understood', 'understanding', 'understands'],
    draw: ['drew', 'drawn', 'drawing', 'draws'],
    break: ['broke', 'broken', 'breaking', 'breaks'],
    spend: ['spent', 'spending', 'spends'],
    cut: ['cut', 'cutting', 'cuts'],
    rise: ['rose', 'risen', 'rising', 'rises'],
    drive: ['drove', 'driven', 'driving', 'drives'],
    buy: ['bought', 'buying', 'buys'],
    wear: ['wore', 'worn', 'wearing', 'wears'],
    swear: ['swore', 'sworn', 'swearing', 'swears'],
    drink: ['drank', 'drunk', 'drinking', 'drinks'],
    eat: ['ate', 'eaten', 'eating', 'eats'],
    choose: ['chose', 'chosen', 'choosing', 'chooses'],
  };
  const irregularReverse = (() => {
    const m = new Map();
    for (const [base, forms] of Object.entries(irregularVerbMap)) {
      m.set(base.toLowerCase(), base);
      for (const f of forms) m.set(String(f).toLowerCase(), base);
    }
    return m;
  })();
  // Return full-term variants where only the last word is replaced by its irregular forms set
  const irregularFormsForTerm = (term) => {
    const { head, last } = splitHeadLast(term);
    const baseKey = irregularReverse.get(String(last).toLowerCase());
    const acc = new Set();
    if (baseKey) {
      const prefix = head ? head + ' ' : '';
      acc.add(prefix + baseKey);
      for (const f of irregularVerbMap[baseKey] || []) acc.add(prefix + f);
    }
    return Array.from(acc);
  };

  // Use compromise to get conjugations for potential verbs
  const conjugationsForTerm = (term) => {
    // mutate only the last word; return full-term variants
    const { head, last } = splitHeadLast(term);
    const forms = new Set();
    if (!useCompromise || !nlp) return Array.from(forms);
    const doc = nlp(last);
    const verbs = doc.verbs();
    if (!verbs.found) return Array.from(forms);
    const conj = verbs.conjugate();
    const prefix = head ? head + ' ' : '';
    for (const c of conj || []) {
      for (const k of ['PastTense', 'PresentTense', 'Infinitive', 'Gerund', 'Participle']) {
        const v = c[k];
        if (Array.isArray(v)) v.forEach(x => x && forms.add(prefix + String(x)));
        else if (v) forms.add(prefix + String(v));
      }
    }
    return Array.from(forms);
  };

  // Compute earliest stage match per article, then choose best stage overall with priority tie-breaker
  const perArticleMatches = [];

  for (const art of prioritized) {
    const terms = termMap.get(art) || [];
    let stage = 0;
    let termHit = '';
    let truncated = false;

    // Stage 1: case-sensitive, word-boundary
    if (stage === 0) {
      for (const tobj of terms) {
        const termOrig = tobj.orig;
        const alts = new Set([termOrig]);
        for (const a of pluralizeTerm(termOrig)) alts.add(a);
        // add irregular forms for last word; and conjugations when enabled
        for (const a of irregularFormsForTerm(termOrig)) alts.add(a);
        for (const a of conjugationsForTerm(termOrig)) alts.add(a);
        for (const alt of alts) {
          const re1 = new RegExp(`\\b${escapeRegExp(alt)}\\b`);
          if (re1.test(textOrig)) { stage = 1; termHit = termOrig; break; }
        }
        if (stage === 1) break;
      }
    }
    // Stage 2: case-insensitive, word-boundary
    if (stage === 0) {
      for (const tobj of terms) {
        const termOrig = tobj.orig;
        const alts = new Set([termOrig]);
        for (const a of pluralizeTerm(termOrig)) alts.add(a);
        for (const a of irregularFormsForTerm(termOrig)) alts.add(a);
        for (const a of conjugationsForTerm(termOrig)) alts.add(a);
        for (const alt of alts) {
          const re2 = new RegExp(`\\b${escapeRegExp(alt)}\\b`, 'i');
          if (re2.test(textOrig)) { stage = 2; termHit = termOrig; break; }
        }
        if (stage === 2) break;
      }
    }
    // Stage 3: case-sensitive, substring (no word-boundary)
    if (stage === 0) {
      for (const tobj of terms) {
        const termOrig = tobj.orig;
        if (termOrig && textOrig.includes(termOrig)) { stage = 3; termHit = termOrig; break; }
      }
    }
    // Stage 4: case-insensitive, substring on derived stripped forms (no iterative truncation),
    // mutating only the last word for multi-word terms
    if (stage === 0) {
      const strippedForms = (base) => {
        const { head, last } = splitHeadLast(base);
        const prefix = head ? head + ' ' : '';
        const forms = new Set();
        const addIf = (s) => {
          const v = String(s || '').trim().toLowerCase();
          if (v && v.length >= 3) forms.add(v);
        };
        const addFromLast = (w) => {
          const lw = String(w || '').toLowerCase();
          if (!lw) return;
          const full = prefix + lw;
          addIf(full);
          const addVar = (x) => addIf(prefix + x);
          if (/y$/i.test(lw)) addVar(lw.slice(0, -1));
          if (/e$/i.test(lw)) addVar(lw.slice(0, -1));
          if (/ing$/i.test(lw)) addVar(lw.slice(0, -3));
          if (/ed$/i.test(lw)) addVar(lw.slice(0, -2));
          if (/es$/i.test(lw)) addVar(lw.slice(0, -2));
          if (/s$/i.test(lw) && !/ss$/i.test(lw)) addVar(lw.slice(0, -1));
        };
        const addYEOnlyFromLast = (w) => {
          const lw = String(w || '').toLowerCase();
          if (!lw) return;
          const full = prefix + lw;
          addIf(full);
          const addVar = (x) => addIf(prefix + x);
          if (/y$/i.test(lw)) addVar(lw.slice(0, -1));
          if (/e$/i.test(lw)) addVar(lw.slice(0, -1));
        };
        // base last word and its stripped variants
        addFromLast(last);
        // For conjugations/irregulars of the last word, only drop final y/e
        for (const x of conjugationsForTerm(base)) {
          const { head: h2, last: l2 } = splitHeadLast(x);
          // ensure we only consider variants that kept the same head
          if ((h2 || '') === (head || '')) addYEOnlyFromLast(l2);
        }
        for (const x of irregularFormsForTerm(base)) {
          const { head: h2, last: l2 } = splitHeadLast(x);
          if ((h2 || '') === (head || '')) addYEOnlyFromLast(l2);
        }
        return Array.from(forms);
      };
      outerStrip:
      for (const tobj of terms) {
        const termOrig = tobj.orig;
        const forms = strippedForms(termOrig);
        for (const f of forms) {
          if (!f) continue;
          if (textLower.includes(f)) { stage = 4; termHit = termOrig; truncated = false; break outerStrip; }
        }
      }
    }

    if (stage > 0) {
      perArticleMatches.push({ art, stage, termHit, truncated });
    }
  }

  if (!perArticleMatches.length) return null;

  // Determine best stage among all matches
  const bestStage = Math.min(...perArticleMatches.map(m => m.stage));
  const bestMatches = perArticleMatches.filter(m => m.stage === bestStage);
  // Among best matches, pick the one that appears earliest in prioritized list
  const artIndex = new Map(prioritized.map((a, i) => [a, i]));
  bestMatches.sort((a, b) => artIndex.get(a.art) - artIndex.get(b.art));
  const chosenMatch = bestMatches[0];

  // Disambiguation: list all matched articles
  const matchesList = perArticleMatches.map(m => m.art);
  const disamb = matchesList.length > 1 ? `(${matchesList.join(', ')})` : '';

  const isVariant = (chosenMatch.stage >= 3) || chosenMatch.truncated;
  let variantTerm = isVariant ? chosenMatch.termHit : '';
  // If marked variant due to non-word-boundary/truncation, but ANY term from the chosen
  // article matches on word-boundaries case-insensitively, then do NOT mark as variant.
  if (variantTerm) {
    const termObjs = termMap.get(chosenMatch.art) || [];
    const hasWordBoundMatch = termObjs.some(tobj => {
      const termOrig = tobj.orig;
      if (!termOrig) return false;
      const re = new RegExp(`\\b${escapeRegExp(termOrig)}\\b`, 'i');
      return re.test(textOrig);
    });
    if (hasWordBoundMatch) {
      variantTerm = '';
    } else {
      // Also suppress if a proper plural of any term matches with word boundaries
      const hasPluralBoundMatch = termObjs.some(tobj => {
        const termOrig = tobj.orig;
        if (!termOrig) return false;
        const plurals = pluralizeTerm(termOrig);
        return plurals.some(p => new RegExp(`\\b${escapeRegExp(p)}\\b`, 'i').test(textOrig));
      });
      if (hasPluralBoundMatch) {
        variantTerm = '';
      } else {
        // Finally, if the matched term inflects (-ing, -ed) OR has irregular forms that match, suppress variant
        const base = chosenMatch.termHit || '';
        const infl = new Set(ingEdFormsForTerm(base));
        for (const f of irregularFormsForTerm(base)) infl.add(f);
        const hasInflBoundMatch = Array.from(infl).some(p => new RegExp(`\\b${escapeRegExp(p)}\\b`, 'i').test(textOrig));
        if (hasInflBoundMatch) variantTerm = '';
      }
    }
  }

  return { article: chosenMatch.art, disamb, variantTerm };
}

export async function generateTwlByBook(bookCode, options = {}) {
  // Import Node-specific modules conditionally
  const { addGLQuoteCols, convertGLQuotes2OLQuotes } = await import('tsv-quote-converters');

  const useCompromise = !!options.useCompromise;
  let nlp = null;
  if (useCompromise) {
    const mod = await import('compromise');
    nlp = mod.default || mod;
  }
  const bibleData = await readBooks();
  const meta = findBookMeta(bibleData, bookCode);
  if (!meta) throw new Error(`Unknown book code: ${bookCode}`);
  const usfm = await fetchUsfm(meta.usfm, meta.testament);
  const twJson = await loadTwJsonLocal();
  const strongPivot = pivotByStrong(twJson);

  // 1) initial TSV
  const baseTsv = buildInitialTsv(usfm, strongPivot, meta.key);

  // 2) add GLQuote and GLOccurrence
  const glRes = await addGLQuoteCols({
    bibleLinks: ["unfoldingWord/en_ult/master"],
    bookCode: meta.key,
    tsvContent: baseTsv,
    trySeparatorsAndOccurrences: true,
  });
  const withGl = glRes.output;

  // 3) Convert GLQuote/GLOccurrence into OrigWords/Occurrence and convert to OL quotes BEFORE matching
  const lines0 = withGl.split(/\r?\n/);
  const header0 = lines0.shift();
  const h0 = header0.split('\t');
  const I0 = {
    Reference: h0.indexOf('Reference'),
    ID: h0.indexOf('ID'),
    Tags: h0.indexOf('Tags'),
    OrigWords: h0.indexOf('OrigWords'),
    Occurrence: h0.indexOf('Occurrence'),
    TWLink: h0.indexOf('TWLink'),
    GLQuote: h0.indexOf('GLQuote'),
    GLOccurrence: h0.indexOf('GLOccurrence'),
  };
  const rebuilt0 = [header0].concat(lines0.filter(Boolean).map(row => {
    const c = row.split('\t');
    const newCols = c.slice();
    if (I0.GLQuote >= 0) newCols[I0.OrigWords] = c[I0.GLQuote];
    if (I0.GLOccurrence >= 0) newCols[I0.Occurrence] = c[I0.GLOccurrence];
    return newCols.join('\t');
  })).join('\n');
  const convEarly = await convertGLQuotes2OLQuotes({
    bibleLinks: ["unfoldingWord/en_ult/master"],
    bookCode: meta.key,
    tsvContent: rebuilt0,
    trySeparatorsAndOccurrences: true,
  });

  // 4) Reorder columns and add Strongs + randomized 4-char IDs before matching
  const linesA = convEarly.output.split(/\r?\n/);
  const headerA = linesA.shift();
  const aCols = headerA.split('\t');
  const A = {
    Reference: aCols.indexOf('Reference'),
    ID: aCols.indexOf('ID'),
    Tags: aCols.indexOf('Tags'),
    OrigWords: aCols.indexOf('OrigWords'),
    Occurrence: aCols.indexOf('Occurrence'),
    TWLink: aCols.indexOf('TWLink'),
    GLQuote: aCols.indexOf('GLQuote'),
    GLOccurrence: aCols.indexOf('GLOccurrence'),
  };

  // New header order: Reference, ID, Tags, OrigWords, Occurrence, TWLink, Strongs, GLQuote, GLOccurrence
  const finalHeaderBase = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'Strongs', 'GLQuote', 'GLOccurrence'];
  const usedIds = new Set();
  const genId = () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789';
    while (true) {
      const first = letters[Math.floor(Math.random() * letters.length)];
      let rest = '';
      for (let i = 0; i < 3; i++) rest += alnum[Math.floor(Math.random() * alnum.length)];
      const id = first + rest;
      if (!usedIds.has(id)) { usedIds.add(id); return id; }
    }
  };

  const preparedRows = [];
  for (const ln of linesA) {
    if (!ln.trim()) continue;
    const c = ln.split('\t');
    if (c.length < 7) continue;
    const strongsVal = c[A.ID];
    const newId = genId();
    const newRow = [
      c[A.Reference],
      newId,
      c[A.Tags],
      c[A.OrigWords],
      c[A.Occurrence],
      c[A.TWLink],
      strongsVal,
      c[A.GLQuote],
      c[A.GLOccurrence],
    ];
    preparedRows.push(newRow);
  }

  // Indexes for prepared rows
  const H = {
    Reference: 0,
    ID: 1,
    Tags: 2,
    OrigWords: 3,
    Occurrence: 4,
    TWLink: 5,
    Strongs: 6,
    GLQuote: 7,
    GLOccurrence: 8,
  };

  // 5) pick best TWLink based on GLQuote terms using Strongs column; include Variant of column
  const termMap = buildArticleTermMap(twJson);
  const outRows = [finalHeaderBase.concat(['Variant of', 'Disambiguation']).join('\t')];
  const noMatchRows = [finalHeaderBase.concat(['Disambiguation']).join('\t')];
  let totalRows = 0;
  let droppedRows = 0;
  let multiDisambRows = 0;
  const noMatchSamples = [];

  for (const cols of preparedRows) {
    totalRows++;
    const strongId = cols[H.Strongs];
    const glq = cols[H.GLQuote] || '';
    const result = chooseArticleByGlQuote(glq, strongId, strongPivot, termMap, { useCompromise, nlp });
    if (!result) {
      droppedRows++;
      if (noMatchSamples.length < 8) {
        const ref = cols[H.Reference] || '';
        noMatchSamples.push(`${ref}\t${strongId}\t${glq}`);
      }
      const tried = prioritizeArticles(glq, strongId, strongPivot) || [];
      const disambTried = tried.length ? `(${tried.join(', ')})` : '';
      noMatchRows.push(cols.join('\t') + '\t' + disambTried);
      continue;
    }
    const art = result.article;
    cols[H.TWLink] = `rc://*/tw/dict/bible/${art}`;
    // Update Tags based on selected article prefix
    let tag = '';
    if (art.startsWith('kt/')) tag = 'keyterm';
    else if (art.startsWith('names/')) tag = 'name';
    cols[H.Tags] = tag;
    if (result.disamb) multiDisambRows++;
    const variantOf = result.variantTerm || '';
    outRows.push(cols.join('\t') + '\t' + variantOf + '\t' + (result.disamb || ''));
  }

  const keptRows = totalRows - droppedRows;
  const pct = totalRows ? ((keptRows / totalRows) * 100).toFixed(1) : '0.0';
  console.log(`[TWL] ${bookCode.toUpperCase()}: kept ${keptRows}/${totalRows} (${pct}%), dropped ${droppedRows}, disambiguated ${multiDisambRows}`);
  if (noMatchSamples.length) {
    console.log(`[TWL] ${bookCode.toUpperCase()}: no-match samples (up to 8):`);
    for (const s of noMatchSamples) console.log(`  ${s}`);
  }

  const matchedTsv = outRows.join('\n');
  const noMatchTsv = noMatchRows.join('\n');
  return { matchedTsv, noMatchTsv };
}
