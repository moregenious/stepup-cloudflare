/**
 * Numbers game: numbers written in words (British English, as in the school's textbooks: "one hundred and five").
 * Levels: easy 1–100, middle 100–999 999, hard fractions, mixed numbers and decimals.
 * Each item: { key, html (how the number is shown), words }.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under100(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return under100(r);
  return `${ONES[h]} hundred${r ? ' and ' + under100(r) : ''}`;
}

/** 0 … 999 999 in words */
export function numberToWords(n) {
  if (n < 1000) return under1000(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  if (!r) return `${under1000(th)} thousand`;
  return `${under1000(th)} thousand${r < 100 ? ' and ' : ' '}${under1000(r)}`;
}

export const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const DENOMINATORS = {
  2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 5: ['fifth', 'fifths'],
  6: ['sixth', 'sixths'], 8: ['eighth', 'eighths'], 10: ['tenth', 'tenths'], 100: ['hundredth', 'hundredths']
};

function fractionWords(num, den) {
  const [one, many] = DENOMINATORS[den];
  if (num === 1) return (den === 2 || den === 4 ? 'a ' : 'one ') + one;
  return `${ONES[num] || numberToWords(num)} ${many}`;
}

const fracHtml = (num, den) => `<span class="num-frac"><span>${num}</span><span>${den}</span></span>`;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// Only fractions in lowest terms (2/4 is written 1/2)
const reduced = (num, den) => num >= 1 && num < den && gcd(num, den) === 1;
const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

const wholeItem = (n) => ({ key: String(n), html: formatNumber(n), words: numberToWords(n) });
const fracItem = (num, den) => ({ key: `${num}/${den}`, html: fracHtml(num, den), words: fractionWords(num, den) });
const mixedItem = (whole, num, den) => ({
  key: `${whole} ${num}/${den}`,
  html: `${whole}&nbsp;${fracHtml(num, den)}`,
  words: `${ONES[whole]} and ${fractionWords(num, den)}`
});
const decimalItem = (text) => {
  const [int, dec] = text.split('.');
  return { key: text, html: text, words: `${numberToWords(Number(int))} point ${dec.split('').map(d => ONES[Number(d)]).join(' ')}` };
};

// ---------------- random items per level ----------------
function randomEasy() {
  return wholeItem(rnd(1, 100));
}

function randomMiddle() {
  const size = pick([3, 4, 4, 5, 6]);
  return wholeItem(rnd(Math.max(100, 10 ** (size - 1)), 10 ** size - 1));
}

function randomFraction() {
  const den = pick([2, 3, 4, 5, 6, 8, 10]);
  let num = rnd(1, den - 1);
  while (!reduced(num, den)) num = rnd(1, den - 1);
  return fracItem(num, den);
}

function randomHard() {
  const kind = pick(['fraction', 'fraction', 'mixed', 'decimal', 'decimal']);
  if (kind === 'fraction') return randomFraction();
  if (kind === 'mixed') {
    const den = pick([2, 3, 4]);
    const num = den === 4 ? pick([1, 3]) : rnd(1, den - 1);
    return mixedItem(rnd(1, 5), num, den);
  }
  const int = rnd(0, 9);
  const dec = Math.random() < 0.5 ? String(rnd(1, 9)) : String(rnd(1, 9)) + String(rnd(1, 9));
  return decimalItem(`${int}.${dec}`);
}

// ---------------- look-alike wrong answers ----------------
const swapDigits = (s, i, j) => { const a = s.split(''); [a[i], a[j]] = [a[j], a[i]]; return a.join(''); };

function wholeLookAlikes(n, min, max) {
  const s = String(n);
  const out = [];
  if (n >= 13 && n <= 19) out.push((n - 10) * 10); // thirteen / thirty
  if (n >= 30 && n <= 90 && n % 10 === 0) out.push(n / 10 + 10);
  if (s.length >= 2) { out.push(Number(swapDigits(s, s.length - 1, s.length - 2))); out.push(Number(swapDigits(s, 0, 1))); }
  out.push(n + 1, n - 1, n + 10, n - 10, n * 10, Math.floor(n / 10), n + 100, n - 100, n + 1000, n - 1000);
  const changed = s.split('');
  const pos = rnd(0, changed.length - 1);
  changed[pos] = String((Number(changed[pos]) + rnd(1, 8)) % 10);
  out.push(Number(changed.join('')));
  return shuffle(out.filter(x => Number.isInteger(x) && x >= min && x <= max && x !== n)).map(wholeItem);
}

function hardLookAlikes(item) {
  const out = [];
  if (item.key.includes('.')) {
    const [int, dec] = item.key.split('.');
    out.push(`${dec.length > 1 ? swapDigits(dec, 0, 1) : dec}.${int}`, `${int}.${dec}0`.slice(0, int.length + 3), `${int}.${dec.length > 1 ? swapDigits(dec, 0, 1) : String((Number(dec) + 1) % 10 || 1)}`, `${(Number(int) + 1) % 10}.${dec}`);
    return shuffle(out.filter(k => /^\d+\.\d*[1-9]$/.test(k) && k !== item.key)).map(decimalItem);
  }
  const m = item.key.match(/^(?:(\d+) )?(\d+)\/(\d+)$/);
  const whole = m[1] ? Number(m[1]) : 0;
  const num = Number(m[2]);
  const den = Number(m[3]);
  const make = (w, a, b) => (DENOMINATORS[b] && reduced(a, b) ? (w ? mixedItem(w, a, b) : fracItem(a, b)) : null);
  out.push(make(whole, num, den === 4 ? 3 : den === 3 ? 4 : den * 2), make(whole, num + 1, den), make(whole, num - 1, den),
    make(whole, num, den + 1), make(whole ? whole + 1 : 0, num, den), make(0, den - num, den), make(whole, num, den === 8 ? 5 : den === 5 ? 8 : 10), make(whole, den - num, den));
  return shuffle(out.filter(x => x && x.key !== item.key));
}

const LEVEL_SETUP = {
  easy: { random: randomEasy, lookAlikes: (it) => wholeLookAlikes(Number(it.key), 1, 100) },
  middle: { random: randomMiddle, lookAlikes: (it) => wholeLookAlikes(Number(it.key), 100, 999999) },
  hard: { random: randomHard, lookAlikes: hardLookAlikes }
};

export const NUMBER_LEVELS = [
  { id: 'easy', icon: '🟢', name: 'Easy (Лёгкий)', desc: 'Числа от 1 до 100' },
  { id: 'middle', icon: '🟡', name: 'Middle (Средний)', desc: 'Числа от 100 до 999 999' },
  { id: 'hard', icon: '🔴', name: 'Hard (Сложный)', desc: 'Дроби, смешанные числа и десятичные дроби' }
];

/** Distinct random items of a level */
function distinctItems(level, count, taken = new Set()) {
  const out = [];
  for (let guard = 0; out.length < count && guard < 500; guard++) {
    const it = LEVEL_SETUP[level].random();
    if (!taken.has(it.key) && !taken.has(it.words)) { taken.add(it.key); taken.add(it.words); out.push(it); }
  }
  return out;
}

/**
 * A round of 10 points: 5 "pick 1 of 4" questions (half "number → words", half "words → number")
 * and one matching task of 5 pairs.
 */
export function buildNumbersRound(level = 'easy') {
  const taken = new Set();
  const questions = distinctItems(level, 5, taken).map((item, i) => {
    const wrong = [];
    const seen = new Set([item.key, item.words]);
    const add = (x) => { if (x && !seen.has(x.key) && !seen.has(x.words) && wrong.length < 3) { seen.add(x.key); seen.add(x.words); wrong.push(x); } };
    LEVEL_SETUP[level].lookAlikes(item).forEach(add);
    for (let guard = 0; wrong.length < 3 && guard < 200; guard++) add(LEVEL_SETUP[level].random());
    return { item, mode: i % 2 === 0 ? 'see' : 'find', options: shuffle([item, ...wrong]), answer: null };
  });
  const pairs = distinctItems(level, 5, taken);
  return { questions, pairs, words: shuffle(pairs) };
}
