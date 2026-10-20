/**
 * Browser-native Word (.docx) Document Parser for English CRM & LMS
 * Operates 100% on the client side using JSZip and native browser DOMParser.
 * No backend / Python required! Works on Vercel, offline, and mobile.
 */

async function ensureJSZip() {
  if (typeof window !== 'undefined' && typeof window.JSZip !== 'undefined') {
    return window.JSZip;
  }

  // 1. Try local script
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = './js/utils/jszip.min.js';
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
    if (typeof window.JSZip !== 'undefined') {
      return window.JSZip;
    }
  } catch (err) {
    console.warn('Local jszip load failed, trying CDN fallback...');
  }

  // 2. Try CDN fallback
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('Не удалось загрузить библиотеку JSZip для чтения Word документов'));
    document.head.appendChild(s);
  });

  return window.JSZip;
}

function cleanText(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

function cleanApostrophes(s) {
  if (!s) return '';
  return String(s).replace(/[’‘`´′]/g, "'");
}

function normalizePhone(val) {
  const raw = cleanText(val);
  if (!raw) return '';
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('8') && digits.length === 11) {
    return '+7' + digits.slice(1);
  }
  return raw;
}

function normalizeShift(val) {
  const vl = cleanText(val).toLowerCase();
  if (vl.includes('2') || vl.includes('втор')) {
    return 'Вторая';
  }
  return 'Первая';
}

function cleanTranscription(tr) {
  if (!tr) return '';
  let str = tr.trim();
  const m = str.match(/[\[/]([^\]/]+)[\]/]/);
  if (m) {
    const c = m[1].trim();
    return c ? `[${c}]` : '';
  }
  const clean = str.replace(/[\[\]/\\\s]/g, '').trim();
  return clean ? `[${clean}]` : '';
}

const HEADER_KEYWORDS = new Set([
  'word', 'words', 'vocabulary', 'transcription', 'translation', 'meaning',
  'слово', 'слова', 'транскрипция', 'перевод', 'значение', 'пример', 'примеры',
  'example', 'examples', 'unit', 'lesson', 'урок', '№', 'no', 'num', 'id'
]);

function isValidVocabPair(w, tl) {
  if (!w || !tl) return false;
  const wClean = cleanApostrophes(w).trim();
  const tlClean = cleanApostrophes(tl).trim();
  if (wClean.length < 1 || wClean.length > 100) return false;
  if (tlClean.length < 1 || tlClean.length > 250) return false;
  if (HEADER_KEYWORDS.has(wClean.toLowerCase()) || HEADER_KEYWORDS.has(tlClean.toLowerCase())) return false;
  if (!/[a-zA-Z]/.test(wClean)) return false;
  return true;
}

function parseVocabLine(line) {
  line = cleanApostrophes(line).trim();
  if (!line) return null;

  // Strip list markers: 1., 1), *, -, bullet points
  line = line.replace(/^(?:\d+[\.\)]\s*|[\u2022\u2023\u25E6\u2043\u2219\*\-]\s*)/, '').trim();
  if (!line) return null;

  // Pattern 1: Word/Phrase [transcription] [-–—:] translation OR Word/Phrase /transcription/ translation
  const mBracket = line.match(/^([^\[\/]+?)\s*(?:\[([^\]]+)\]|\/([^\/]+)\/)\s*(?:[-–—:]\s*)?(.+)$/);
  if (mBracket) {
    const w = mBracket[1].trim();
    const tr = mBracket[2] || mBracket[3] || '';
    const tl = mBracket[4].replace(/^[-–—:\s]+/, '').trim();
    if (/[a-zA-Z]/.test(w) && tl) {
      return { word: w, transcription: cleanTranscription(tr), translation: tl };
    }
  }

  // Pattern 2: Word/Phrase - translation (with dash/colon)
  const mDash = line.match(/^([^–—:-]+?)\s*[-–—:]\s*(.+)$/);
  if (mDash) {
    const w = mDash[1].trim();
    const tlRaw = mDash[2].trim();
    const mInnerTr = tlRaw.match(/^(?:\[([^\]]+)\]|\/([^\/]+)\/)\s*(.+)$/);
    if (mInnerTr) {
      const tr = mInnerTr[1] || mInnerTr[2] || '';
      const tl = mInnerTr[3].replace(/^[-–—:\s]+/, '').trim();
      if (/[a-zA-Z]/.test(w) && tl) {
        return { word: w, transcription: cleanTranscription(tr), translation: tl };
      }
    }
    if (/[a-zA-Z]/.test(w) && tlRaw) {
      return { word: w, transcription: '', translation: tlRaw };
    }
  }

  // Pattern 3: Tab or multi-space separated (e.g. from copy-paste or table export)
  const parts = line.split(/\t+|\s{3,}/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const w = parts[0];
    if (/[\[/]/.test(parts[1]) || !/[а-яА-ЯёЁ]/.test(parts[1])) {
      return { word: w, transcription: cleanTranscription(parts[1]), translation: parts.slice(2).join(' ') };
    } else {
      return { word: w, transcription: '', translation: parts.slice(1).join(' ') };
    }
  } else if (parts.length === 2) {
    return { word: parts[0], transcription: '', translation: parts[1] };
  }

  // Pattern 4: English word followed immediately by Cyrillic translation
  const mLang = line.match(/^([A-Za-z0-9\s\'\-?!,.]+?)\s+([а-яА-ЯёЁ].*)$/);
  if (mLang) {
    return { word: mLang[1].trim(), transcription: '', translation: mLang[2].trim() };
  }

  return null;
}

/**
 * Extracts all tables and paragraph lines from word/document.xml
 */
async function extractDocxXml(fileOrBuffer) {
  const JSZip = await ensureJSZip();
  let buffer = fileOrBuffer;
  if (fileOrBuffer instanceof File || fileOrBuffer instanceof Blob) {
    buffer = await fileOrBuffer.arrayBuffer();
  }

  const zip = await JSZip.loadAsync(buffer);
  const docXmlEntry = zip.file('word/document.xml');
  if (!docXmlEntry) {
    throw new Error('Файл не является корректным документом Word (.docx): отсутствует word/document.xml');
  }

  const xmlText = await docXmlEntry.async('text');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
  return xmlDoc;
}

function getNodeText(node) {
  if (!node) return '';
  const tNodes = node.getElementsByTagNameNS('*', 't');
  let res = '';
  for (let i = 0; i < tNodes.length; i++) {
    res += tNodes[i].textContent || '';
  }
  return cleanText(res);
}

/**
 * Parse a Word (.docx) document containing student rows.
 * Supports table format and paragraph fallback.
 * Returns { success: true, count: number, students: Array }
 */
export async function parseStudentsDocx(fileOrBuffer) {
  try {
    const xmlDoc = await extractDocxXml(fileOrBuffer);
    const students = [];

    const tables = xmlDoc.getElementsByTagNameNS('*', 'tbl');
    const phonePattern = /телефон|phone|моб|тел\b|тел\.|связ|контакт/i;
    const parentPattern = /родител|мама|папа|представител|parent/i;

  for (let t = 0; t < tables.length; t++) {
    const tbl = tables[t];
    const rows = tbl.getElementsByTagNameNS('*', 'tr');
    if (rows.length === 0) continue;

    const firstRowCells = [];
    const firstRowTcs = rows[0].getElementsByTagNameNS('*', 'tc');
    for (let c = 0; c < firstRowTcs.length; c++) {
      firstRowCells.push(getNodeText(firstRowTcs[c]));
    }

    let headerIndices = {};
    let detectedAnyHeader = false;

    firstRowCells.forEach((text, idx) => {
      const tl = text.toLowerCase().trim();
      const isParent = parentPattern.test(tl);
      const isPhone = phonePattern.test(tl) || (tl.includes('номер') && tl.includes('тел'));
      const isNum = (/^(№|no|#|п\/п|пп|id|номер|n)$/i.test(tl) || /^(№|no|#|п\/п|пп|id)\s+/i.test(tl)) && !isPhone && !isParent;

      if (isParent && (isPhone || tl.includes('номер'))) {
        if (!('parentPhone' in headerIndices)) {
          headerIndices.parentPhone = idx;
          detectedAnyHeader = true;
        }
      } else if (isParent) {
        if (!('parentName' in headerIndices)) {
          headerIndices.parentName = idx;
          detectedAnyHeader = true;
        }
      } else if (isPhone) {
        if (!('phone' in headerIndices)) {
          headerIndices.phone = idx;
          detectedAnyHeader = true;
        }
      } else if (isNum) {
        if (!('num' in headerIndices)) {
          headerIndices.num = idx;
          detectedAnyHeader = true;
        }
      } else if (/фио|ученик|имя|фамил|ребенок|student|fio|name/i.test(tl)) {
        if (!('fullName' in headerIndices)) {
          headerIndices.fullName = idx;
          detectedAnyHeader = true;
        }
      } else if (/школ|сош|гимназ|лицей|school/i.test(tl)) {
        if (!('school' in headerIndices)) {
          headerIndices.school = idx;
          detectedAnyHeader = true;
        }
      } else if (/класс|группа|grade|class/i.test(tl)) {
        if (!('grade' in headerIndices)) {
          headerIndices.grade = idx;
          detectedAnyHeader = true;
        }
      } else if (/смен|shift/i.test(tl)) {
        if (!('shift' in headerIndices)) {
          headerIndices.shift = idx;
          detectedAnyHeader = true;
        }
      }
    });

    let startRowIdx = 0;
    if (detectedAnyHeader && 'fullName' in headerIndices) {
      startRowIdx = 1;
    } else {
      // Positional mapping
      headerIndices = {};
      const numCols = firstRowCells.length;
      const hasNumCol = numCols >= 5 && (/^\d+$/.test(firstRowCells[0]) || ['№', 'No', '#', 'N'].includes(firstRowCells[0]));

      if (hasNumCol) {
        headerIndices.fullName = 1;
        headerIndices.phone = numCols > 2 ? 2 : -1;
        headerIndices.school = numCols > 3 ? 3 : -1;
        headerIndices.grade = numCols > 4 ? 4 : -1;
        headerIndices.shift = numCols > 5 ? 5 : -1;
        headerIndices.parentName = numCols > 6 ? 6 : -1;
        headerIndices.parentPhone = numCols > 7 ? 7 : -1;
        startRowIdx = /^\d+$/.test(firstRowCells[0]) ? 0 : 1;
      } else {
        headerIndices.fullName = 0;
        headerIndices.phone = numCols > 1 ? 1 : -1;
        headerIndices.school = numCols > 2 ? 2 : -1;
        headerIndices.grade = numCols > 3 ? 3 : -1;
        headerIndices.shift = numCols > 4 ? 4 : -1;
        headerIndices.parentName = numCols > 5 ? 5 : -1;
        headerIndices.parentPhone = numCols > 6 ? 6 : -1;
        if (/фио|имя|ученик|fio|name/i.test(firstRowCells[0])) {
          startRowIdx = 1;
        }
      }
    }

    for (let r = startRowIdx; r < rows.length; r++) {
      const row = rows[r];
      const tcs = row.getElementsByTagNameNS('*', 'tc');
      const cellTexts = [];
      for (let c = 0; c < tcs.length; c++) {
        cellTexts.push(getNodeText(tcs[c]));
      }

      if (cellTexts.every(c => !c)) continue;

      const getVal = (fld) => {
        const idx = headerIndices[fld];
        if (typeof idx === 'number' && idx >= 0 && idx < cellTexts.length) {
          return cellTexts[idx];
        }
        return '';
      };

      let fullName = getVal('fullName');
      fullName = fullName.replace(/^\d+[\.\)]\s*/, '').trim();

      if (['фио', 'ученик', 'фио ученика', 'фамилия имя'].includes(fullName.toLowerCase())) continue;
      if (!fullName || fullName.length < 2) continue;

      students.push({
        fullName,
        phone: normalizePhone(getVal('phone')),
        school: getVal('school'),
        grade: getVal('grade'),
        shift: normalizeShift(getVal('shift')),
        parentName: cleanText(getVal('parentName')),
        parentPhone: normalizePhone(getVal('parentPhone'))
      });
    }
  }

  // Fallback to paragraphs if no students from tables
  if (students.length === 0) {
    const paras = xmlDoc.getElementsByTagNameNS('*', 'p');
    for (let p = 0; p < paras.length; p++) {
      const line = getNodeText(paras[p]);
      if (!line) continue;
      const parts = line.split(/[\t;|,]/).map(cleanText).filter(Boolean);
      if (parts.length >= 2) {
        let nameCandidate = parts[0].replace(/^\d+[\.\)]\s*/, '').trim();
        if (['фио', 'ученик', 'фио ученика', 'номер'].includes(nameCandidate.toLowerCase())) continue;
        if (nameCandidate.length >= 2 && /[а-яА-Яa-zA-Z]/.test(nameCandidate)) {
          students.push({
            fullName: nameCandidate,
            phone: normalizePhone(parts[1] || ''),
            school: parts[2] || '',
            grade: parts[3] || '',
            shift: normalizeShift(parts[4] || 'Первая'),
            parentName: parts[5] || '',
            parentPhone: normalizePhone(parts[6] || '')
          });
        }
      }
    }
  }

    return {
      success: true,
      count: students.length,
      students
    };
  } catch (err) {
    console.error('Client-side docx students parsing error:', err);
    return {
      success: false,
      error: err.message || 'Ошибка парсинга Word документа',
      students: []
    };
  }
}

/**
 * Parse a Word (.docx) document containing vocabulary lists or tables.
 * Returns { success: true, count: number, words: Array }
 */
export async function parseVocabDocx(fileOrBuffer) {
  try {
    const xmlDoc = await extractDocxXml(fileOrBuffer);
    const words = [];
    const seen = new Set();

  const addWord = (w, tr, tl) => {
    if (!isValidVocabPair(w, tl)) return;
    const key = w.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    words.push({
      word: cleanApostrophes(w).trim(),
      transcription: cleanTranscription(tr),
      translation: cleanApostrophes(tl).trim(),
      example: ''
    });
  };

  // 1. Check tables
  const tables = xmlDoc.getElementsByTagNameNS('*', 'tbl');
  for (let t = 0; t < tables.length; t++) {
    const tbl = tables[t];
    const rows = tbl.getElementsByTagNameNS('*', 'tr');
    if (rows.length === 0) continue;

    // Detect column roles
    const firstRowCells = [];
    const firstRowTcs = rows[0].getElementsByTagNameNS('*', 'tc');
    for (let c = 0; c < firstRowTcs.length; c++) {
      firstRowCells.push(getNodeText(firstRowTcs[c]));
    }

    let wordCol = -1;
    let trCol = -1;
    let tlCol = -1;

    firstRowCells.forEach((text, idx) => {
      const tl = text.toLowerCase();
      if (/слово|word|vocabulary/i.test(tl)) wordCol = idx;
      else if (/транскрипция|transcription/i.test(tl)) trCol = idx;
      else if (/перевод|translation|значение/i.test(tl)) tlCol = idx;
    });

    let startRow = (wordCol !== -1 && tlCol !== -1) ? 1 : 0;

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      const tcs = row.getElementsByTagNameNS('*', 'tc');
      const cells = [];
      for (let c = 0; c < tcs.length; c++) {
        cells.push(getNodeText(tcs[c]));
      }

      if (cells.length >= 2) {
        if (wordCol !== -1 && tlCol !== -1) {
          addWord(cells[wordCol] || '', trCol !== -1 ? (cells[trCol] || '') : '', cells[tlCol] || '');
        } else {
          // Positional analysis
          if (cells.length >= 3 && (/[\[/]/.test(cells[1]) || !/[а-яА-ЯёЁ]/.test(cells[1]))) {
            addWord(cells[0], cells[1], cells[2]);
          } else {
            addWord(cells[0], '', cells[1]);
          }
        }
      } else if (cells.length === 1) {
        const parsed = parseVocabLine(cells[0]);
        if (parsed) addWord(parsed.word, parsed.transcription, parsed.translation);
      }
    }
  }

  // 2. Check paragraphs
  const paras = xmlDoc.getElementsByTagNameNS('*', 'p');
  for (let p = 0; p < paras.length; p++) {
    const line = getNodeText(paras[p]);
    if (!line) continue;
    const parsed = parseVocabLine(line);
    if (parsed) {
      addWord(parsed.word, parsed.transcription, parsed.translation);
    }
  }

    return {
      success: true,
      count: words.length,
      words
    };
  } catch (err) {
    console.error('Client-side docx vocab parsing error:', err);
    return {
      success: false,
      error: err.message || 'Ошибка парсинга Word документа со словами',
      words: []
    };
  }
}

/**
 * Parse plain text string containing vocabulary items
 */
export function parseVocabText(textContent) {
  const words = [];
  const seen = new Set();

  const addWord = (w, tr, tl) => {
    if (!isValidVocabPair(w, tl)) return;
    const key = w.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    words.push({
      word: cleanApostrophes(w).trim(),
      transcription: cleanTranscription(tr),
      translation: cleanApostrophes(tl).trim(),
      example: ''
    });
  };

  const lines = (textContent || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes('\t')) {
      const parts = trimmed.split('\t').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        addWord(parts[0], parts[1], parts[2]);
        continue;
      } else if (parts.length === 2) {
        addWord(parts[0], '', parts[1]);
        continue;
      }
    }
    const parsed = parseVocabLine(trimmed);
    if (parsed) {
      addWord(parsed.word, parsed.transcription, parsed.translation);
    }
  }

  return {
    success: true,
    count: words.length,
    words
  };
}

/**
 * Universal client-side parser for .docx or .txt vocabulary files
 */
export async function parseVocabAny(fileOrBuffer) {
  if (!fileOrBuffer) return { success: false, words: [] };

  if (fileOrBuffer instanceof File || fileOrBuffer instanceof Blob) {
    const fname = (fileOrBuffer.name || '').toLowerCase();
    if (fname.endsWith('.txt')) {
      try {
        const text = await fileOrBuffer.text();
        return parseVocabText(text);
      } catch (err) {
        return { success: false, error: err.message, words: [] };
      }
    }
  }

  return await parseVocabDocx(fileOrBuffer);
}

