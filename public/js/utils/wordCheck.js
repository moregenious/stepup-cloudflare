/**
 * Checking a word the student wrote in the word game ("Russian → English, write the word").
 * Not important: capital letters, extra spaces, punctuation at the ends, "to" before a verb and
 * "a / an / the" before a noun. A word with several spellings ("colour/color", "get up, wake up") accepts any of them;
 * a part in brackets ("look (at)") may be left out.
 */

/** Tidy a piece of text after removing parts of it: no doubled spaces, no space before a comma, no comma at the ends */
function tidy(s) {
  return s.replace(/\s+/g, ' ').replace(/\s+([,;])/g, '$1').replace(/([,;])\1+/g, '$1')
    .replace(/^[\s,;]+|[\s,;]+$/g, '').trim();
}

/**
 * A translation without hints in brackets: lesson plans write pronunciation like "нос (ноуз)", "лётчик (пАйлэт)",
 * and in a game such a hint gives the right answer away. If the whole translation is in brackets, it is kept.
 */
export function cleanTranslation(s) {
  const raw = String(s || '').trim();
  // pairs of brackets with what is inside, then a stray bracket left by a broken entry ("Луэлин)")
  const out = tidy(raw.replace(/\([^)]*\)?|\[[^\]]*\]?/g, ' ').replace(/[()[\]]/g, ' '));
  return out || tidy(raw.replace(/[()[\]]/g, ' '));
}

/** An English word without Russian hints in brackets ("carry (кАри)" → "carry"); "look (at)" stays */
export function cleanEnglishWord(s) {
  const raw = String(s || '').trim();
  return tidy(raw.replace(/\([^)]*[а-яё][^)]*\)/gi, ' ')) || raw;
}

/** A spelling brought to a common form */
export function normalizeWord(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(to|a|an|the) (?=\S)/, '')
    .trim();
}

/** All accepted spellings of the word from the lesson plan */
export function acceptedSpellings(word) {
  const out = new Set();
  // the whole entry too: a phrase with a comma ("sorry, I'm busy then") is one answer, not two
  [String(word || ''), ...String(word || '').split(/[\/;,]/)].forEach(part => {
    const full = normalizeWord(part.replace(/[()]/g, ''));
    const short = normalizeWord(part.replace(/\([^)]*\)/g, ''));
    if (full) out.add(full);
    if (short) out.add(short);
  });
  return [...out];
}

/** Letters to change, add or remove to turn a into b */
export function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** { ok, errors } — errors: how many letters are wrong (compared with the closest accepted spelling) */
export function checkTypedWord(typed, word) {
  const t = normalizeWord(typed);
  const spellings = acceptedSpellings(word);
  if (!t || !spellings.length) return { ok: false, errors: Math.max(1, (spellings[0] || '').length) };
  if (spellings.includes(t)) return { ok: true, errors: 0 };
  return { ok: false, errors: Math.max(1, Math.min(...spellings.map(s => editDistance(t, s)))) };
}
