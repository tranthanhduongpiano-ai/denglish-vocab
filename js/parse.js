/* Denglish Vocab (iPhone) - tach tu tu chu go tay / file ghi chu (giong vocab.parse_heuristic) */
import { cleanTerm, norm, validTerm, VI_CHARS } from './util.js';

const BULLET = /^\s*(?:[-*+•●▪◦·○■□✓✔☐☑>]|\d{1,4}\s*[.)/]|\(?[a-zA-Z]\)|\[[ xX]?\])\s+/;
const SEP = /\s*(?:\t|:|=>|->|→|=|\s[-–—]\s|\s[-–—]$|^[-–—]\s)\s*|\s+[-–—]\s*(?=\S)/;
const POS_TAG = /\s*\((?:n|v|adj|adv|prep|conj|pron|det|phr\.?\s*v|phrasal\s+verb|idiom|noun|verb|adjective|adverb|exp|expr|phr|collocation|n\.?\s*phr)\.?\)\s*/i;
const IPA = /\s*[/[][^/[\]]*[ˈˌːəɪʊʌæɒɔɑɜθðʃʒŋɡ][^/[\]]*[/\]]\s*/gu;
const TABLE_HEAD = ['word', 'words', 'từ', 'từ vựng', 'vocabulary', 'term', 'english', 'tiếng anh'];

function splitLine(line) {
  let m = POS_TAG.exec(line);
  if (m && m.index > 0) return [line.slice(0, m.index), line.slice(m.index).trim()];
  m = SEP.exec(line);
  if (m && m.index > 0) return [line.slice(0, m.index), line.slice(m.index + m[0].length)];
  const tokens = line.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (VI_CHARS.test(tokens[i])) return [tokens.slice(0, i).join(' '), tokens.slice(i).join(' ')];
  }
  return [line, ''];
}

export function parseHeuristic(text) {
  const out = [], seen = new Set();
  const push = (term, note) => {
    term = cleanTerm(term);
    const key = norm(term);
    if (!key || seen.has(key) || !validTerm(term)) return;
    seen.add(key);
    out.push({ term, note: String(note || '').trim().replace(/^[ \-–—:|\t]+|[ \-–—:|\t]+$/g, '').slice(0, 300) });
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('```')) continue;
    if (/^[|:\-\s+=]+$/.test(line)) continue;
    line = line.replace(BULLET, '').replace(/\*\*|__|`|~~|\[\[|\]\]/g, '').replace(IPA, ' ').trim();
    if (!line) continue;
    let term, note;
    if (line.includes('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map(x => x.trim()).filter(Boolean);
      if (!cells.length) continue;
      term = cells[0]; note = cells.slice(1).join(' — ');
      if (TABLE_HEAD.includes(term.toLowerCase())) continue;
    } else {
      [term, note] = splitLine(line);
    }
    term = term.trim();
    if (term.split(/\s+/).length > 4 && /[.!?]$/.test(term)) continue;      // cau vi du
    const parts = term.split(',').map(p => p.trim());
    if (!note && parts.length >= 2 && parts.every(p => p && p.split(/\s+/).length <= 4)) {
      parts.forEach(p => push(p, ''));
      continue;
    }
    push(term, note);
  }
  return out;
}

/* ---------- doc chu tu file ---------- */
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('Không tải được bộ đọc file (cần mạng lần đầu).')); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function docxText(file) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(file);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('File Word không đọc được (thiếu nội dung).');
  const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const lines = [];
  for (const p of xml.getElementsByTagNameNS(W, 'p')) {
    let s = '';
    const walk = (node) => {
      for (const ch of node.childNodes) {
        if (ch.namespaceURI === W && ch.localName === 't') s += ch.textContent;
        else if (ch.namespaceURI === W && ch.localName === 'tab') s += '\t';
        else if (ch.namespaceURI === W && (ch.localName === 'br' || ch.localName === 'cr')) s += '\n';
        else if (ch.nodeType === 1) walk(ch);
      }
    };
    walk(p);
    lines.push(s);
  }
  return lines.join('\n');
}

async function pdfText(file) {
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '';
    for (const it of tc.items) {
      line += it.str;
      if (it.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

export async function extractFile(file) {
  const name = (file.name || '').toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error('File quá lớn (tối đa 20 MB).');
  let text;
  if (name.endsWith('.docx')) text = await docxText(file);
  else if (name.endsWith('.pdf')) text = await pdfText(file);
  else if (/\.(doc|rtf|pages)$/.test(name)) throw new Error('Chưa đọc được file này — lưu lại thành .docx hoặc .txt rồi thử lại.');
  else text = (await file.text()).replace(/^﻿/, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('Không thấy chữ nào trong file (có thể là PDF dạng ảnh scan).');
  return text;
}
