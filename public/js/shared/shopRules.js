/**
 * Shop of looks (emoji avatars, frames, titles): prices and what a student may own.
 * Shared by the browser (shop, customization window) and the Worker, which checks every purchase and every
 * change a student makes to their own card: an item is the student's only when it was bought (or earned).
 */

/** Titles earned in mini-games (never sold) */
export const SECRET_TITLE_NAMES = ['Словарный ниндзя', 'Укротитель глаголов', 'Мастер «если бы»', 'Архитектор миров', 'Хранитель времени', 'Повелитель Rampage', 'Инженер предложений', 'Снайпер предлогов', 'Фразовый хакер', 'Грамматический детектив', 'Молния синонимов', 'Художник радуги', 'Смотритель зоопарка', 'Повелитель чисел', 'Мастер дробей', 'Легенда Step Up'];

/** Titles sold in the shop before teachers edit the list (then settings `titlesCatalog` is used) */
export const DEFAULT_TITLES = [
  { id: 't-boltun', text: 'Лучший болтун', icon: '🗣️', price: 150 },
  { id: 't-grammar', text: 'Гений грамматики', icon: '🧠', price: 150 },
  { id: 't-hw-king', text: 'Король домашки', icon: '👑', price: 150 },
  { id: 't-pp', text: 'Гроза Present Perfect', icon: '⚡', price: 150 },
  { id: 't-owl', text: 'Ночной зубрила', icon: '🦉', price: 150 },
  { id: 't-sherlock', text: 'Шерлок Холмс произношения', icon: '🕵️‍♂️', price: 150 },
  { id: 't-spy', text: 'Шпион в Лондоне', icon: '🇬🇧', price: 150 },
  { id: 't-memes', text: 'Главный по мемам', icon: '😎', price: 150 },
  { id: 't-questions', text: 'Генератор вопросов', icon: '❓', price: 150 },
  { id: 't-listener', text: 'Слушатель на 100%', icon: '🎧', price: 150 },
  { id: 't-irregular', text: 'Повелитель неправильных глаголов', icon: '⚔️', price: 150 },
  { id: 't-polyglot', text: 'Будущий полиглот', icon: '🚀', price: 150 },
  { id: 't-67', text: 'six-seven', icon: '6️⃣7️⃣', price: 500 }
];

export const SHOP_PRICES = Object.freeze({ AVATAR: 50, FRAME: 100, TITLE: 150 });

const FREE_FRAME = 'frame-none';
const COSMETIC_TYPES = new Set(['avatar', 'frame', 'title']);

/** A photo the student uploaded (not an emoji from the shop): free */
export const isPhotoAvatar = (v) => typeof v === 'string' && /^(https?:\/\/|\/|data:image\/)/.test(v);

const titleList = (catalog) => (Array.isArray(catalog) && catalog.length ? catalog : DEFAULT_TITLES).filter(t => t && t.text);

/** Price of a look in the shop, or null when it is not sold (unknown title, the free frame, a photo) */
export function cosmeticPrice(type, itemId, titlesCatalog) {
  const id = String(itemId || '');
  if (type === 'frame') return /^frame-[a-z0-9-]+$/.test(id) && id !== FREE_FRAME ? SHOP_PRICES.FRAME : null;
  if (type === 'avatar') return id && !isPhotoAvatar(id) && id.length <= 16 ? SHOP_PRICES.AVATAR : null;
  if (type === 'title') {
    const t = titleList(titlesCatalog).find(x => x.text === id);
    return t ? (Number(t.price) || SHOP_PRICES.TITLE) : null;
  }
  return null;
}

export const isCosmeticPurchase = (p) => p && COSMETIC_TYPES.has(p.type);

/** What the student's (not cancelled) purchases pay for: { avatar: Set, frame: Set, title: Set } */
export function ownedByPurchases(purchases) {
  const owned = { avatar: new Set(), frame: new Set(), title: new Set() };
  (purchases || []).forEach(p => {
    if (!isCosmeticPurchase(p) || p.status === 'cancelled') return;
    [p.itemId, p.itemName, String(p.itemName || '').replace(/^Титул «(.+)»$/, '$1')].filter(Boolean).forEach(v => owned[p.type].add(String(v)));
  });
  return owned;
}

const LISTS = [['unlockedAvatars', 'avatar'], ['unlockedFrames', 'frame'], ['unlockedTitles', 'title']];

/**
 * A student changed their own card (`after`, from `before`): keep only the looks they own.
 * New entries in the unlocked lists need a purchase (secret titles are earned in mini-games, photos and the
 * plain frame are free); an equipped avatar / frame / title must be one of the student's.
 * Entries that were there before stay (older data had no purchase records). Returns the names of what was undone.
 */
export function keepOwnedLooks(before, after, owned) {
  const undone = [];
  const prev = before || {};
  // What the student was already wearing is theirs (older cards have no lists: the page builds them from it)
  const worn = { avatar: [prev.avatarUrl], frame: [prev.avatarFrame], title: [prev.studentTitle, String(prev.studentTitle || '').replace(/^\S+\s+/, '')] };
  for (const [field, type] of LISTS) {
    if (!Array.isArray(after[field])) continue;
    const had = new Set([...(Array.isArray(prev[field]) ? prev[field] : []), ...worn[type].filter(Boolean)]);
    const allowed = (v) => had.has(v) || owned[type].has(String(v))
      || (type === 'frame' && v === FREE_FRAME)
      || (type === 'avatar' && isPhotoAvatar(v))
      || (type === 'title' && SECRET_TITLE_NAMES.includes(v));
    const kept = after[field].filter(allowed);
    if (kept.length !== after[field].length) { undone.push(field); after[field] = kept; }
  }
  if (after.avatarFrame !== prev.avatarFrame && after.avatarFrame && after.avatarFrame !== FREE_FRAME
      && !(after.unlockedFrames || []).includes(after.avatarFrame)) {
    after.avatarFrame = prev.avatarFrame; undone.push('avatarFrame');
  }
  if (after.avatarUrl !== prev.avatarUrl && after.avatarUrl && !isPhotoAvatar(after.avatarUrl)
      && !(after.unlockedAvatars || []).includes(after.avatarUrl)) {
    after.avatarUrl = prev.avatarUrl; undone.push('avatarUrl');
  }
  // The worn title is "icon text": its text must be one of the student's titles
  if (after.studentTitle !== prev.studentTitle && after.studentTitle
      && !(after.unlockedTitles || []).some(t => after.studentTitle === t || after.studentTitle.endsWith(' ' + t))) {
    after.studentTitle = prev.studentTitle; undone.push('studentTitle');
  }
  return undone;
}

/** Fields of a student's card that the looks check is about */
export const LOOK_FIELDS = ['unlockedAvatars', 'unlockedFrames', 'unlockedTitles', 'avatarFrame', 'avatarUrl', 'studentTitle'];
