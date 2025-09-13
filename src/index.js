import { BibleBookData } from './common/books.js';
import { addGLQuoteCols, convertGLQuotes2OLQuotes } from 'tsv-quote-converters';
import { Inflectors } from 'en-inflectors';

const isBrowser = typeof window !== 'undefined';

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

async function loadTermsFromEnTw(dcsHost = 'https://git.door43.org') {
  // Use the updated zipProcessor that accepts dcsHost
  const { generateTWTerms } = await import('./utils/zipProcessor.js');
  return await generateTWTerms(dcsHost);
} function pivotByStrong(twMap) {
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

// Helper function to find matching articles from a given list of articles
function findMatchingArticles(glq, articlesList, termMap, opts = {}) {
  const useCompromise = !!opts.useCompromise;
  const nlp = opts.nlp;
  const textOrig = String(glq || '');
  const textLower = textOrig.toLowerCase();
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Same helper functions as in chooseArticleByGlQuote
  const splitHeadLast = (term) => {
    const parts = String(term || '').trim().split(/\s+/);
    if (parts.length <= 1) return { head: '', last: parts[0] || '' };
    const last = parts.pop();
    return { head: parts.join(' '), last };
  };

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
    add(term + 's');
    return Array.from(out);
  };

  const isVowel = (ch) => /[aeiou]/i.test(ch);
  const isConsonant = (ch) => /[a-z]/i.test(ch) && !isVowel(ch);
  const endsWithCVC = (w) => {
    if (w.length < 3) return false;
    const a = w[w.length - 3], b = w[w.length - 2], c = w[w.length - 1];
    if (!isConsonant(a) || !isVowel(b) || !isConsonant(c)) return false;
    if (/[wxy]/i.test(c)) return false;
    return true;
  };
  const presentParticipleWord = (w) => {
    if (/ie$/i.test(w)) return w.replace(/ie$/i, 'ying');
    if (/ee$/i.test(w)) return w + 'ing';
    if (/e$/i.test(w)) return w.replace(/e$/i, 'ing');
    if (endsWithCVC(w)) return w + w[w.length - 1] + 'ing';
    return w + 'ing';
  };
  const pastTenseWord = (w) => {
    if (/e$/i.test(w)) return w + 'd';
    if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ied');
    if (endsWithCVC(w)) return w + w[w.length - 1] + 'ed';
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

  const conjugationsForTerm = (term) => {
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

  // Find matching articles
  const perArticleMatches = [];

  for (const art of articlesList) {
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
    // Stage 3: case-sensitive, substring matching at word boundaries or after dashes
    if (stage === 0) {
      for (const tobj of terms) {
        const termOrig = tobj.orig;
        if (termOrig) {
          // Match if the term appears:
          // - At word boundary (beginning of word or after dash)
          // - Allow substring matching (e.g., "reap" matches "reapers")
          const re3 = new RegExp(`(?:^|\\b|[—–-])${escapeRegExp(termOrig)}`, '');
          if (re3.test(textOrig)) { stage = 3; termHit = termOrig; break; }
        }
      }
    }
    // Stage 4: case-insensitive, substring on derived stripped forms
    if (stage === 0) {
      const strippedForms = (base) => {
        const { head, last } = splitHeadLast(base);
        const prefix = head ? head + ' ' : '';
        const results = [];

        const addIf = (form, isStripped = false) => {
          const v = String(form || '').trim().toLowerCase();
          if (v && v.length >= 3) {
            results.push({ form: v, isStripped });
          }
        };

        const addFromLast = (w) => {
          const lw = String(w || '').toLowerCase();
          if (!lw) return;
          const full = prefix + lw;
          addIf(full, false); // Always add the full form

          // Add stripped variants, marking them as stripped
          if (/y$/i.test(lw)) addIf(prefix + lw.slice(0, -1), true);
          if (/e$/i.test(lw)) addIf(prefix + lw.slice(0, -1), true);
          if (/ing$/i.test(lw)) addIf(prefix + lw.slice(0, -3), true);
          if (/ed$/i.test(lw)) addIf(prefix + lw.slice(0, -2), true);
          if (/es$/i.test(lw)) addIf(prefix + lw.slice(0, -2), true);
          if (/s$/i.test(lw) && !/ss$/i.test(lw)) addIf(prefix + lw.slice(0, -1), true);
        };

        const addYEOnlyFromLast = (w) => {
          const lw = String(w || '').toLowerCase();
          if (!lw) return;
          const full = prefix + lw;
          addIf(full, false); // Always add the full form

          // Add Y/E stripped variants, marking them as stripped
          if (/y$/i.test(lw)) addIf(prefix + lw.slice(0, -1), true);
          if (/e$/i.test(lw)) addIf(prefix + lw.slice(0, -1), true);
        };

        addFromLast(last);
        for (const x of conjugationsForTerm(base)) {
          const { head: h2, last: l2 } = splitHeadLast(x);
          if ((h2 || '') === (head || '')) addYEOnlyFromLast(l2);
        }
        for (const x of irregularFormsForTerm(base)) {
          const { head: h2, last: l2 } = splitHeadLast(x);
          if ((h2 || '') === (head || '')) addYEOnlyFromLast(l2);
        }
        return results;
      };

      outerStrip:
      for (const tobj of terms) {
        const termOrig = tobj.orig;
        const formResults = strippedForms(termOrig);

        for (const { form, isStripped } of formResults) {
          if (!form) continue;

          if (isStripped) {
            // For stripped forms, we need to be more careful about matching
            // Only match if the stripped form is followed by a grammatical ending
            const regex = new RegExp(escapeRegExp(form) + '(ed|ing|er|est|es|ies|s|d|n|t)\\b', 'i');
            if (regex.test(textLower)) {
              stage = 4;
              termHit = termOrig;
              truncated = false;
              break outerStrip;
            }
          } else {
            // For non-stripped forms, match at word boundaries or after dashes (case-insensitive)
            // Allow substring matching (e.g., "reap" matches "reapers")
            const regex4 = new RegExp(`(?:^|\\b|[—–-])${escapeRegExp(form)}`, 'i');
            if (regex4.test(textOrig)) {
              stage = 4;
              termHit = termOrig;
              truncated = false;
              break outerStrip;
            }
          }
        }
      }
    }

    if (stage > 0) {
      perArticleMatches.push({ art, stage, termHit, truncated });
    }
  }

  return perArticleMatches;
}

// Get articles for disambiguation: those with matching Strong's OR those with empty Strong's lists
function getDisambiguationArticles(strongId, strongPivot, termMap, twMap) {
  // Get articles with matching Strong's (same as prioritizeArticles but without prioritization)
  let articlesWithMatchingStrongs = (strongPivot[strongId] || []).slice();
  if ((!articlesWithMatchingStrongs || !articlesWithMatchingStrongs.length) && /^(H|G)\d+[a-f]$/.test(strongId)) {
    const base = strongId.slice(0, -1);
    articlesWithMatchingStrongs = (strongPivot[base] || []).slice();
  }

  const result = new Set(articlesWithMatchingStrongs);

  // Add articles that have empty Strong's lists (orphaned articles)
  for (const [article, val] of Object.entries(twMap)) {
    const articleData = val || {};
    const articleStrongs = articleData.strongs || [];

    // Check if this article has empty Strong's lists
    // An article qualifies if it has no strongs array or if all its strongs arrays are empty
    const hasEmptyStrongs = !Array.isArray(articleStrongs) ||
      articleStrongs.length === 0 ||
      articleStrongs.every(strongsArray => !Array.isArray(strongsArray) || strongsArray.length === 0);

    if (hasEmptyStrongs) {
      result.add(article);
    }
  }

  return Array.from(result);
}

function chooseArticleByGlQuote(glq, strongId, strongPivot, termMap, twMap, opts = {}) {
  const useCompromise = !!opts.useCompromise;
  const nlp = opts.nlp;
  const prioritized = prioritizeArticles(glq, strongId, strongPivot);
  if (!prioritized.length) return null;
  const textOrig = String(glq || '');
  const textLower = textOrig.toLowerCase();
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find matches among prioritized articles (those with matching Strong's numbers) for TWLink selection
  const prioritizedMatches = findMatchingArticles(glq, prioritized, termMap, { useCompromise, nlp });

  if (!prioritizedMatches.length) return null;

  // Determine best stage among prioritized matches for TWLink selection
  const bestStage = Math.min(...prioritizedMatches.map(m => m.stage));
  const bestMatches = prioritizedMatches.filter(m => m.stage === bestStage);
  // Among best matches, pick the one that appears earliest in prioritized list
  const artIndex = new Map(prioritized.map((a, i) => [a, i]));
  bestMatches.sort((a, b) => artIndex.get(a.art) - artIndex.get(b.art));
  const chosenMatch = bestMatches[0];

  // For disambiguation, search articles with matching Strong's OR articles with empty Strong's lists
  const disambiguationArticles = getDisambiguationArticles(strongId, strongPivot, termMap, twMap);
  const allMatches = findMatchingArticles(glq, disambiguationArticles, termMap, { useCompromise, nlp });

  // Disambiguation: list all matched articles (from Strong's + empty Strong's filtered articles)
  const matchesList = allMatches.map(m => m.art);
  const disamb = matchesList.length > 1 ? `(${matchesList.join(', ')})` : '';

  const isVariant = (chosenMatch.stage >= 3) || chosenMatch.truncated;
  let variantTerm = isVariant ? chosenMatch.termHit : '';
  // If marked variant due to non-word-boundary/truncation, but ANY term from the chosen
  // article matches on word-boundaries case-insensitively, then do NOT mark as variant.
  if (variantTerm) {
    const termObjs = termMap.get(chosenMatch.art) || [];

    // Helper functions needed for variant checking
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
      add(term + 's');
      return Array.from(out);
    };

    const splitHeadLast = (term) => {
      const parts = String(term || '').trim().split(/\s+/);
      if (parts.length <= 1) return { head: '', last: parts[0] || '' };
      const last = parts.pop();
      return { head: parts.join(' '), last };
    };

    const isVowel = (ch) => /[aeiou]/i.test(ch);
    const isConsonant = (ch) => /[a-z]/i.test(ch) && !isVowel(ch);
    const endsWithCVC = (w) => {
      if (w.length < 3) return false;
      const a = w[w.length - 3], b = w[w.length - 2], c = w[w.length - 1];
      if (!isConsonant(a) || !isVowel(b) || !isConsonant(c)) return false;
      if (/[wxy]/i.test(c)) return false;
      return true;
    };
    const presentParticipleWord = (w) => {
      if (/ie$/i.test(w)) return w.replace(/ie$/i, 'ying');
      if (/ee$/i.test(w)) return w + 'ing';
      if (/e$/i.test(w)) return w.replace(/e$/i, 'ing');
      if (endsWithCVC(w)) return w + w[w.length - 1] + 'ing';
      return w + 'ing';
    };
    const pastTenseWord = (w) => {
      if (/e$/i.test(w)) return w + 'd';
      if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ied');
      if (endsWithCVC(w)) return w + w[w.length - 1] + 'ed';
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
  // Extract dcsHost option with default
  const dcsHost = options.dcsHost || 'https://git.door43.org';
  const quiet = !!options.quiet;

  // Load terms from en_tw zip file instead of local tw_strongs_list.json
  const termToArticles = await loadTermsFromEnTw(dcsHost);

  // Build trie for fast scanning
  const { buildTermTrie, scanVerseMatches } = await import('./utils/twl-matcher.js');
  const trie = buildTermTrie(termToArticles);

  // Fetch and parse ULT USFM into verses
  const { processUsfmForBook } = await import('./utils/usfm-alignment-remover.js');
  const bibleData = await readBooks();
  const meta = findBookMeta(bibleData, bookCode);
  if (!meta) throw new Error(`Unknown book code: ${bookCode}`);
  const versesByChapter = await processUsfmForBook(meta.key, dcsHost);

  const header = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'Variant of', 'Disambiguation'];
  const outRows = [header.join('\t')];

  // ID generator
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

  // Helpers for Variant of decision (allow only plural/-ed/-ing without marking variant)
  const pluralizeWord = (w) => {
    if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
    if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
    if (/f$/i.test(w) && !/(roof|belief|chief|proof)$/i.test(w)) return w.replace(/f$/i, 'ves');
    if (/fe$/i.test(w)) return w.replace(/fe$/i, 'ves');
    if (/o$/i.test(w)) return w + 'es';
    return w + 's';
  };
  const isVowel = (ch) => /[aeiou]/i.test(ch);
  const isConsonant = (ch) => /[a-z]/i.test(ch) && !isVowel(ch);
  const endsWithCVC = (w) => w.length >= 3 && isConsonant(w[w.length - 3]) && isVowel(w[w.length - 2]) && isConsonant(w[w.length - 1]) && !/[wxy]/i.test(w[w.length - 1]);
  const edForm = (w) => {
    if (/e$/i.test(w)) return w + 'd';
    if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ied');
    // Do not double the final consonant for words ending in "er" (e.g., gather -> gathered)
    const lastCh = w[w.length - 1];
    if (endsWithCVC(w) && !/(?:er|en|or|on|al)$/i.test(w)) return w + lastCh + 'ed';
    return w + 'ed';
  };
  const ingForm = (w) => {
    if (/ie$/i.test(w)) return w.replace(/ie$/i, 'ying');
    if (/ee$/i.test(w)) return w + 'ing';
    if (/e$/i.test(w)) return w.replace(/e$/i, 'ing');
    const lastCh = w[w.length - 1];
    if (endsWithCVC(w) && !/(?:er|en|or|on|al)$/i.test(w)) return w + lastCh + 'ing';
    return w + 'ing';
  };

  const allowNoVariant = (base, match) => {
    const b = String(base || '');
    const m = String(match || '');
    if (!b || !m) return true;
    if (b.toLowerCase() === m.toLowerCase()) return true;
    const parts = b.trim().split(/\s+/);
    const head = parts.length > 1 ? parts.slice(0, -1).join(' ') + ' ' : '';
    const last = parts[parts.length - 1];
    const allowed = new Set([
      head + pluralizeWord(last),
      head + new Inflectors(last).toPlural(),
      head + new Inflectors(last).toSingular(),
      head + edForm(last),
      head + new Inflectors(last).toPast(),
      head + ingForm(last),
      head + new Inflectors(last).toGerund(),
    ].map(x => x.toLowerCase()));
    return allowed.has(m.toLowerCase());
  };

  // Walk through verses in order
  const chapterNums = Object.keys(versesByChapter).map(n => parseInt(n, 10)).sort((a, b) => a - b);
  for (const c of chapterNums) {
    const verses = versesByChapter[c] || {};
    const verseNums = Object.keys(verses).map(n => parseInt(n, 10)).sort((a, b) => a - b);
    for (const v of verseNums) {
      const text = verses[v] || '';
      const matches = scanVerseMatches(text, trie);
      // Count occurrences per exact matchedText (case-sensitive)
      const occMap = new Map();
      for (const m of matches) {
        const glq = m.matchedText;
        const occ = (occMap.get(glq) || 0) + 1;
        occMap.set(glq, occ);

        const ref = `${c}:${v}`;
        const id = genId();
        const primaryArticle = (m.articles && m.articles[0]) || '';
        let tag = '';
        if (primaryArticle.startsWith('kt/')) tag = 'keyterm';
        else if (primaryArticle.startsWith('names/')) tag = 'name';
        const twLink = primaryArticle ? `rc://*/tw/dict/bible/${primaryArticle}` : '';

        // Variant of: only if beyond plural/-ed/-ing differences
        const variantOf = allowNoVariant(m.term, glq) ? '' : m.term;
        // Disambiguation: list all candidate articles for this match
        const disamb = (m.articles && m.articles.length > 1) ? `(${m.articles.join(', ')})` : '';

        // Set OrigWords/Occurrence equal to GLQuote/GLOccurrence for English-first output
        outRows.push([
          ref,
          id,
          tag,
          glq,
          String(occ),
          twLink,
          variantOf,
          disamb,
        ].join('\t'));
      }
    }
  }

  // Build TSV and convert GL OrigWords back to OL using tsv-quote-converters
  let matchedTsv = outRows.join('\n');
  try {
    const conv = await convertGLQuotes2OLQuotes({
      bibleLink: 'unfoldingWord/en_ult/master',
      bookCode: String(meta.key || bookCode).toLowerCase(),
      tsvContent: matchedTsv,
      trySeparatorsAndOccurrences: true,
      quiet,
    });
    if (conv && typeof conv.output === 'string' && conv.output.length) {
      matchedTsv = conv.output;
    }
  } catch (e) {
    // If conversion fails (e.g., no network), fall back to unconverted TSV
  }

  // Now add the actual GLQuote/GLOccurrence by calling addGLQuoteCols
  try {
    const result = await addGLQuoteCols({
      bibleLinks: ['unfoldingWord/en_ult/master'],
      bookCode: String(meta.key || bookCode).toLowerCase(),
      tsvContent: matchedTsv,
      trySeparatorsAndOccurrences: true,
      usePreviousGLQuotes: true,
      quiet,
    });
    if (result && typeof result.output === 'string' && result.output.length) {
      matchedTsv = result.output;
      // Reorder columns: move cols[5] and cols[6] to after cols[7] for every line
      try {
        const lines = String(matchedTsv || '').split('\n');
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          // require at least 8 columns so cols[7] exists
          if (cols.length >= 8) {
            const removed = cols.splice(5, 2); // remove cols[5] and cols[6]
            // after removal, original cols[7] is at index 5, so insert after it at index 6
            const insertIndex = Math.min(6, cols.length);
            cols.splice(insertIndex, 0, ...removed);
            lines[i] = cols.join('\t');
          }
        }
        matchedTsv = lines.join('\n');
      } catch (err) {
        // leave matchedTsv unchanged on error
      }
    }
  } catch (e) {
    try {
      const lines = String(matchedTsv || '').split('\n');
      if (lines.length > 0) {
        lines[0] = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'GLQuote', 'GLOccurrence', 'Variant of', 'Disambiguation'].join('\t');
        const out = [lines[0]];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          const g = (idx) => (cols[idx] !== undefined ? cols[idx] : '');
          const newRow = [
            g(0), // Reference
            g(1), // ID
            g(2), // Tags
            g(3), // OrigWords
            g(4), // Occurrence
            g(5), // TWLink
            g(3), // GLQuote (copy of OrigWords)
            g(4), // GLOccurrence (copy of Occurrence)
            g(6), // Variant of
            g(7), // Disambiguation
          ].join('\t');
          out.push(newRow);
        }
        matchedTsv = out.join('\n');
      }
    } catch (err) {
      // leave matchedTsv unchanged on any transformation error
    }
  }

  const noMatchHeader = ['Reference', 'ID', 'Tags', 'OrigWords', 'Occurrence', 'TWLink', 'GLQuote', 'GLOccurrence', 'Disambiguation'];
  const noMatchTsv = [noMatchHeader.join('\t')].join('\n');
  return { matchedTsv, noMatchTsv };
}
