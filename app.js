'use strict';

/* =========================================================
 * モチベーショングラフ
 * 経験（出来事）→ 感情 → 価値観 の順にたどり、自分が大切にしている
 * 価値観を見つけるためのアプリ。
 * データはすべて localStorage に保存し、分析も端末内で行う（外部送信なし）。
 * ========================================================= */

const STORAGE_KEY = 'motivation-graph:v1';
const EXPORT_APP_ID = 'motivation-graph';
const DATA_VERSION = 2;
const MAX_WORK_TERMS = 15;
const MAX_TAGS = 10;
const MAX_MY_VALUES = 3;

const BASE_PERIODS = [
  { id: 'early', name: '幼少期', short: '幼少', from: 0, to: 6,
    hints: ['家族との思い出', '好きだった遊び', '習い事', '引っ越し', '保育園・幼稚園'] },
  { id: 'elem', name: '小学校', short: '小', from: 6, to: 12,
    hints: ['友達', '運動会・行事', '習い事', '先生', '夢中になったこと'] },
  { id: 'junior', name: '中学校', short: '中', from: 12, to: 15,
    hints: ['部活', '受験', '友人関係', '反抗期', '初めての挑戦'] },
  { id: 'high', name: '高校', short: '高', from: 15, to: 18,
    hints: ['部活', '受験', '文化祭', '進路', 'アルバイト'] },
  { id: 'college', name: '大学・専門', short: '大学', from: 18, to: 22,
    hints: ['サークル', 'アルバイト', '就活', '一人暮らし', '研究・実習'] },
];
const BASE_INDEX = new Map(BASE_PERIODS.map((p, i) => [p.id, i]));

const WORK_HINTS = [
  ['初めての仕事', '同期・先輩', '仕事を覚えた', '一人暮らし', '初めての失敗'],
  ['後輩ができた', '任された仕事', '異動', '転職', '仕事以外の時間'],
  ['役割の変化', '結婚・家族', '転職・独立', '体調・健康', '趣味・学び直し'],
];

const SCORE_LABELS = {
  '-5': '最悪', '-4': 'すごくつらい', '-3': 'つらい', '-2': 'いまいち', '-1': 'ちょっと低め',
  '0': 'ふつう',
  '1': 'ちょっと良い', '2': '良い', '3': 'かなり良い', '4': 'すごく良い', '5': '最高',
};

const EMOTIONS_POS = ['嬉しい', '楽しい', '誇らしい', 'ワクワク', 'ほっとした', '感謝'];
const EMOTIONS_NEG = ['悔しい', '悲しい', '不安', '寂しい', '怒り', 'むなしい'];
const EMOTIONS = EMOTIONS_POS.concat(EMOTIONS_NEG);

const PRESET_VALUES = ['成長', '挑戦', '達成', '認められること', 'つながり', '人の役に立つ',
  '自由', '自分らしさ', '安心・安定', '楽しさ', '公平さ', '誠実さ'];

const COLORS = {
  bg: '#ffffff', bandA: '#fbf7f2', bandB: '#ffffff', grid: '#eee6dc', zero: '#cfc4b8',
  ink: '#2b2622', inkSoft: '#6f665e', inkFaint: '#a39a91',
  line: '#e0703c', pos: '#e0703c', neg: '#4a7fc1', neutral: '#a39a91',
};
const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif';

/* ---------------- periods ---------------- */

function workTermOf(id) {
  const m = /^work(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : 0;
}

function makeWorkPeriod(k) {
  const a = 3 * k - 2;
  const b = 3 * k;
  return {
    id: 'work' + k, name: `社会人 ${a}〜${b}年目`, label: `${a}〜${b}年目`, short: `${a}-${b}`,
    group: '社会人', from: 22 + 3 * (k - 1), to: 22 + 3 * k,
    hints: WORK_HINTS[Math.min(k, WORK_HINTS.length) - 1],
  };
}

function isValidPeriod(id) {
  if (typeof id !== 'string') return false;
  if (BASE_INDEX.has(id)) return true;
  const k = workTermOf(id);
  return k >= 1 && k <= MAX_WORK_TERMS;
}

function periodById(id) {
  if (BASE_INDEX.has(id)) return BASE_PERIODS[BASE_INDEX.get(id)];
  return makeWorkPeriod(workTermOf(id) || 1);
}

/** 社会人は3年ごとのターム。表示するターム数は登録済みの出来事と入力中の内容から決める */
function workTermCount() {
  let n = 1;
  for (const e of state.events) n = Math.max(n, workTermOf(e.period));
  if (state.draft) n = Math.max(n, workTermOf(state.draft.period));
  if (!state.guideDone) n = Math.max(n, state.workTerms);
  return Math.min(MAX_WORK_TERMS, n);
}

function getPeriods() {
  const n = workTermCount();
  const work = [];
  for (let k = 1; k <= n; k++) work.push(makeWorkPeriod(k));
  return BASE_PERIODS.concat(work);
}

/** 旧版の「社会人」（1区分）を年齢から3年ごとのタームに振り分ける */
function migratePeriod(id, age) {
  if (id !== 'work') return id;
  if (age === null) return 'work1';
  return 'work' + Math.min(MAX_WORK_TERMS, Math.max(1, Math.floor((age - 22) / 3) + 1));
}

/* ---------------- state & storage ---------------- */

let storageOk = true;
let state = loadState();
const ui = { popupId: null, lastAddedId: null, error: '', justFinished: false, tab: 'list', focusValue: null, openValue: null };

function defaultState() {
  return {
    version: DATA_VERSION, introSeen: false, guideDone: false, guideStep: 0, workTerms: 1,
    events: [], draft: null, myValues: [],
  };
}

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    storageOk = false;
  }
  if (!raw) return defaultState();
  try {
    const data = JSON.parse(raw);
    const s = defaultState();
    s.introSeen = !!data.introSeen;
    s.guideDone = !!data.guideDone;
    s.events = sanitizeEvents(data.events, false) || [];
    s.workTerms = clampInt(data.workTerms, 1, MAX_WORK_TERMS, 1);
    // 旧版のガイドは「社会人」が最後の6番目だった
    s.guideStep = clampInt(data.guideStep, 0, BASE_PERIODS.length + MAX_WORK_TERMS - 1, 0);
    s.draft = sanitizeDraft(data.draft);
    if (s.draft && s.draft.editingId && !s.events.some((e) => e.id === s.draft.editingId)) s.draft.editingId = null;
    s.myValues = sanitizeMyValues(data.myValues);
    return s;
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  if (!storageOk) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    storageOk = false;
    toast('この端末では自動保存ができません。「データを書き出す」で保存してください');
  }
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeTags(list, allowed) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().slice(0, 12);
    if (!tag || out.includes(tag)) continue;
    if (allowed && !allowed.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function sanitizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const score = Number(e.score);
  if (!Number.isInteger(score) || score < -5 || score > 5) return null;
  let age = null;
  if (e.age !== null && e.age !== undefined && e.age !== '') {
    const a = Number(e.age);
    if (!Number.isInteger(a) || a < 0 || a > 120) return null;
    age = a;
  }
  const period = migratePeriod(e.period, age);
  if (!isValidPeriod(period)) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : newId(),
    period,
    score,
    age,
    title: typeof e.title === 'string' ? e.title.slice(0, 100) : '',
    memo: typeof e.memo === 'string' ? e.memo.slice(0, 4000) : '',
    emotions: sanitizeTags(e.emotions, EMOTIONS),
    values: sanitizeTags(e.values),
    createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : Date.now(),
  };
}

/**
 * strict（ファイル読み込み）では1件でも不正なら null を返し、中途半端に取り込まない。
 * 端末内の保存データでは不正な1件だけを飛ばし、残りを守る。
 */
function sanitizeEvents(list, strict = true) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const ev = sanitizeEvent(item);
    if (!ev) {
      if (strict) return null;
      continue;
    }
    if (seen.has(ev.id)) ev.id = newId();
    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}

function sanitizeDraft(d) {
  if (!d || typeof d !== 'object' || !isValidPeriod(d.period)) return null;
  return {
    editingId: typeof d.editingId === 'string' ? d.editingId : null,
    period: d.period,
    score: clampInt(d.score, -5, 5, 0),
    age: typeof d.age === 'string' ? d.age.slice(0, 3) : '',
    title: typeof d.title === 'string' ? d.title.slice(0, 100) : '',
    memo: typeof d.memo === 'string' ? d.memo.slice(0, 4000) : '',
    emotions: sanitizeTags(d.emotions, EMOTIONS),
    values: sanitizeTags(d.values),
  };
}

function sanitizeMyValues(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    if (!v || typeof v.value !== 'string' || !v.value.trim()) continue;
    const value = v.value.trim().slice(0, 12);
    if (out.some((x) => x.value === value)) continue;
    out.push({ value, words: typeof v.words === 'string' ? v.words.slice(0, 200) : '' });
    if (out.length >= MAX_MY_VALUES) break;
  }
  return out;
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function freshDraft(period) {
  return { editingId: null, period, score: 0, age: '', title: '', memo: '', emotions: [], values: [] };
}

function draftFromEvent(ev) {
  return {
    editingId: ev.id, period: ev.period, score: ev.score,
    age: ev.age === null ? '' : String(ev.age), title: ev.title, memo: ev.memo,
    emotions: ev.emotions.slice(), values: ev.values.slice(),
  };
}

function guideDraft() {
  const periods = getPeriods();
  return freshDraft(periods[Math.min(state.guideStep, periods.length - 1)].id);
}

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtScore(n) { return n > 0 ? '+' + n : String(n); }
function fmtAvg(n) { const r = Math.round(n * 10) / 10; return r > 0 ? '+' + r : String(r); }
function scoreClass(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
function scoreColor(n) { return n > 0 ? COLORS.pos : n < 0 ? COLORS.neg : COLORS.neutral; }

function truncate(s, n) {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s;
}

function eventName(ev) {
  return ev.title || `${periodById(ev.period).name}の出来事`;
}

function eventsIn(periodId) {
  return state.events.filter((e) => e.period === periodId);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------- chart layout ---------------- */

/**
 * 各出来事の横位置を「時期の帯番号 + 帯内の位置(0〜1)」で求める。
 * 年齢があれば時期の年齢幅の中に配置し、なければ時期内で均等に並べる。
 */
function layoutEvents(events, periods) {
  const out = [];
  periods.forEach((p, i) => {
    const evs = events.filter((e) => e.period === p.id);
    const withAge = evs.filter((e) => e.age !== null);
    const withoutAge = evs.filter((e) => e.age === null);
    withAge.forEach((e) => {
      const f = Math.min(0.92, Math.max(0.08, (e.age - p.from) / (p.to - p.from)));
      out.push({ ev: e, pos: i + f });
    });
    withoutAge.forEach((e, k) => out.push({ ev: e, pos: i + (k + 1) / (withoutAge.length + 1) }));
  });
  out.sort((a, b) => a.pos - b.pos || a.ev.createdAt - b.ev.createdAt);
  return out;
}

/** 入力中の内容をグラフ上にプレビューするための出来事リスト */
function eventsWithDraft() {
  const d = state.draft;
  if (!d || !document.getElementById('event-form')) return { events: state.events, ghostId: null };
  const age = parseAge(d.age);
  const ghost = {
    id: d.editingId || '__draft__', period: d.period, score: d.score,
    age: age.ok ? age.value : null, title: d.title, memo: d.memo, emotions: d.emotions, values: d.values,
    createdAt: Number.MAX_SAFE_INTEGER,
  };
  if (d.editingId) {
    const orig = state.events.find((e) => e.id === d.editingId);
    if (orig) ghost.createdAt = orig.createdAt;
    return { events: state.events.map((e) => (e.id === d.editingId ? ghost : e)), ghostId: ghost.id };
  }
  return { events: state.events.concat([ghost]), ghostId: ghost.id };
}

/**
 * グラフを SVG 文字列として生成する（画面表示と画像保存で共用）。
 * 画像化のため色やフォントはすべて属性で直接指定する。
 */
function buildChartSvg(opts) {
  const { width: W, height: H, events, periods, ghostId = null, forExport = false, showLabels = false,
    focusValue = null, footer = '' } = opts;
  const narrow = W < 520;
  const pad = { l: narrow ? 30 : 40, r: 12, t: forExport ? 72 : showLabels ? 26 : 14, b: (narrow ? 40 : 46) + (footer ? 48 : 0) };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const bandW = plotW / periods.length;
  const x = (pos) => pad.l + pos * bandW;
  const y = (score) => pad.t + ((5 - score) / 10) * plotH;
  const fs = narrow ? 11 : 12;
  const row1 = pad.t + plotH + (narrow ? 16 : 19);
  const row2 = row1 + (narrow ? 15 : 17);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}' role="img" aria-label="モチベーショングラフ">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COLORS.bg}"/>`);

  if (forExport) {
    parts.push(`<text x="${pad.l}" y="38" font-size="24" font-weight="700" fill="${COLORS.ink}">モチベーショングラフ</text>`);
  }

  // 時期ごとの帯と軸ラベル（社会人のタームは下にまとめて「社会人」と表示）
  let workStart = -1;
  periods.forEach((p, i) => {
    parts.push(`<rect x="${x(i)}" y="${pad.t}" width="${bandW}" height="${plotH}" fill="${i % 2 === 0 ? COLORS.bandA : COLORS.bandB}"/>`);
    let label;
    if (p.group) {
      if (workStart < 0) workStart = i;
      label = bandW >= 64 ? p.label : p.short;
    } else {
      label = bandW >= 70 ? p.name : p.short;
    }
    parts.push(`<text x="${x(i + 0.5)}" y="${row1}" font-size="${fs}" fill="${COLORS.inkSoft}" text-anchor="middle">${esc(label)}</text>`);
  });
  if (workStart >= 0) {
    const x1 = x(workStart) + 4;
    const x2 = x(periods.length) - 4;
    parts.push(`<line x1="${x1}" x2="${x2}" y1="${row2 - (narrow ? 11 : 13)}" y2="${row2 - (narrow ? 11 : 13)}" stroke="${COLORS.zero}" stroke-width="1"/>`);
    parts.push(`<text x="${(x1 + x2) / 2}" y="${row2}" font-size="${fs}" fill="${COLORS.inkSoft}" text-anchor="middle">社会人</text>`);
  }

  // 横グリッドと目盛り（狭い画面では -5 / 0 / +5 のみ）
  for (let s = -5; s <= 5; s++) {
    if (narrow && s % 5 !== 0) continue;
    const isZero = s === 0;
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(s)}" y2="${y(s)}" stroke="${isZero ? COLORS.zero : COLORS.grid}" stroke-width="${isZero ? 1.5 : 1}"${isZero ? '' : ' stroke-dasharray="2 4"'}/>`);
    parts.push(`<text x="${pad.l - 6}" y="${y(s) + 4}" font-size="${fs - 1}" fill="${COLORS.inkFaint}" text-anchor="end">${fmtScore(s)}</text>`);
  }

  const laid = layoutEvents(events, periods);

  if (laid.length === 0 && !forExport) {
    parts.push(`<text x="${pad.l + plotW / 2}" y="${pad.t + plotH / 2 - 10}" font-size="${fs + 1}" fill="${COLORS.inkFaint}" text-anchor="middle">出来事を登録すると、</text>`);
    parts.push(`<text x="${pad.l + plotW / 2}" y="${pad.t + plotH / 2 + 10}" font-size="${fs + 1}" fill="${COLORS.inkFaint}" text-anchor="middle">ここにグラフが描かれます</text>`);
  }

  // 折れ線（なめらかな曲線）
  if (laid.length >= 2) {
    const pts = laid.map((l) => [x(l.pos), y(l.ev.score)]);
    parts.push(`<path d="${smoothPath(pts)}" fill="none" stroke="${COLORS.line}" stroke-width="${forExport ? 3.5 : 3}" stroke-linecap="round" stroke-linejoin="round"${focusValue ? ' opacity="0.35"' : ''}/>`);
  }

  const matches = (ev) => !focusValue || ev.values.includes(focusValue);

  // 出来事名ラベル
  if (showLabels) {
    laid.forEach((l) => {
      if (!l.ev.title || !matches(l.ev)) return;
      const above = l.ev.score >= 0;
      const ly = y(l.ev.score) + (above ? -12 : 20);
      parts.push(`<text x="${x(l.pos)}" y="${ly}" font-size="${forExport ? 14 : 11}" fill="${COLORS.ink}" text-anchor="middle" stroke="${COLORS.bg}" stroke-width="4" paint-order="stroke">${esc(truncate(l.ev.title, 10))}</text>`);
    });
  }

  // 点
  laid.forEach((l) => {
    const cx = x(l.pos);
    const cy = y(l.ev.score);
    const color = scoreColor(l.ev.score);
    const isGhost = l.ev.id === ghostId;
    const isNew = !forExport && l.ev.id === ui.lastAddedId;
    const r = forExport ? 7 : 6;
    if (isGhost) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="${COLORS.bg}" stroke="${color}" stroke-width="2.5" stroke-dasharray="3 3"/>`);
    } else {
      const dim = focusValue && !matches(l.ev);
      if (focusValue && !dim) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>`);
      parts.push(`<circle class="${isNew ? 'pt-new' : ''}" cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="${COLORS.bg}" stroke-width="2"${dim ? ' opacity="0.25"' : ''}/>`);
    }
    if (!forExport && !isGhost) {
      parts.push(`<circle class="hit" data-id="${esc(l.ev.id)}" cx="${cx}" cy="${cy}" r="18" fill="transparent" tabindex="0" role="button" aria-label="${esc(periodById(l.ev.period).name + ' ' + eventName(l.ev) + ' ' + fmtScore(l.ev.score))}"/>`);
    }
  });

  if (footer) {
    parts.push(`<text x="${pad.l}" y="${H - 22}" font-size="18" font-weight="700" fill="${COLORS.ink}">${esc(footer)}</text>`);
  }

  parts.push('</svg>');
  return { svg: parts.join(''), laid, x, y };
}

/** Catmull-Rom → ベジェ曲線。値を行き過ぎないよう控えめな張りにする */
function smoothPath(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  const t = 0.18;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    let c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    let c2y = p2[1] - (p3[1] - p1[1]) * t;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    c1y = Math.min(hi, Math.max(lo, c1y));
    c2y = Math.min(hi, Math.max(lo, c2y));
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/* ---------------- analysis（端末内のルールベース集計） ---------------- */

function countTop(list) {
  const m = new Map();
  list.forEach((t) => m.set(t, (m.get(t) || 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1]);
}

/**
 * 価値観ごとに「満たされた（上がった）」「損なわれた（下がった）」出来事を集める。
 * 上がったときにも下がったときにも出てくる価値観ほど、その人にとって重要とみなす。
 */
function analyze() {
  const periods = getPeriods();
  const seq = layoutEvents(state.events, periods).map((l) => l.ev);
  const valueMap = new Map();
  seq.forEach((ev) => ev.values.forEach((v) => {
    if (!valueMap.has(v)) valueMap.set(v, []);
    valueMap.get(v).push(ev);
  }));
  const values = [...valueMap].map(([value, evs]) => {
    const up = evs.filter((e) => e.score > 0);
    const down = evs.filter((e) => e.score < 0);
    const upWeight = up.reduce((s, e) => s + e.score, 0);
    const downWeight = down.reduce((s, e) => s - e.score, 0);
    return { value, evs, up, down, upWeight, downWeight, weight: upWeight + downWeight, both: up.length > 0 && down.length > 0 };
  }).sort((a, b) => b.weight - a.weight || b.evs.length - a.evs.length);

  const highs = seq.filter((e) => e.score > 0);
  const lows = seq.filter((e) => e.score < 0);
  const emoUp = countTop(highs.flatMap((e) => e.emotions));
  const emoDown = countTop(lows.flatMap((e) => e.emotions));

  // 落ち込み（-2以下）の直後に持ち直した出来事の価値観
  const recovery = [];
  for (let i = 0; i < seq.length - 1; i++) {
    if (seq[i].score <= -2 && seq[i + 1].score > seq[i].score) recovery.push(seq[i + 1]);
  }
  const recoveryValues = countTop(recovery.flatMap((e) => e.values));

  let bigRise = null;
  for (let i = 0; i < seq.length - 1; i++) {
    const d = seq[i + 1].score - seq[i].score;
    if (d >= 3 && (!bigRise || d > bigRise.delta)) bigRise = { from: seq[i], to: seq[i + 1], delta: d };
  }

  const withValues = seq.filter((e) => e.values.length).length;
  return { seq, values, emoUp, emoDown, recoveryValues, bigRise, withValues };
}

function buildInsights(a) {
  const out = [];
  if (a.seq.length < 3) {
    out.push({ text: '出来事が3件以上になると、傾向が見えてきます。' });
    return out;
  }
  if (!a.values.length) {
    out.push({ text: '出来事に「満たされていたもの／損なわれたもの」を付けると、あなたの価値観の候補がここに現れます。一覧から出来事をタップして付けてみましょう。' });
  }

  const both = a.values.filter((v) => v.both);
  if (both.length) {
    const v = both[0];
    out.push({
      strong: true,
      text: `「${v.value}」は、上がったとき${v.up.length}回・下がったとき${v.down.length}回出てきます。満たされると上がり、損なわれると下がる——あなたにとって大切な価値観の有力な候補です。`,
      question: `あなたにとって「${v.value}」とは、具体的にどんなことですか？`,
    });
  }
  const upOnly = a.values.filter((v) => !v.both && v.up.length).sort((x, y) => y.upWeight - x.upWeight)[0];
  if (upOnly && upOnly.up.length >= 1) {
    out.push({
      text: `上がったときには「${upOnly.value}」がありました（${upOnly.up.length}回）。これが満たされているとき、あなたは力を発揮しやすいようです。`,
      question: `今の毎日で「${upOnly.value}」を感じられる場面はありますか？`,
    });
  }
  const downOnly = a.values.filter((v) => !v.both && v.down.length).sort((x, y) => y.downWeight - x.downWeight)[0];
  if (downOnly) {
    out.push({
      text: `下がったときには「${downOnly.value}」が損なわれていました（${downOnly.down.length}回）。失ってつらいのは、それだけ大切にしているからかもしれません。`,
      question: `「${downOnly.value}」が守られているとき、あなたはどんな状態ですか？`,
    });
  }

  if (a.emoUp.length) {
    const [emo] = a.emoUp[0];
    const linked = countTop(a.seq.filter((e) => e.score > 0 && e.emotions.includes(emo)).flatMap((e) => e.values));
    out.push({
      text: linked.length
        ? `上がったときに多い感情は「${emo}」。その出来事では「${linked[0][0]}」が満たされていることが多いようです。`
        : `上がったときに多い感情は「${emo}」です。`,
    });
  }
  if (a.emoDown.length) {
    out.push({ text: `下がったときに多い感情は「${a.emoDown[0][0]}」です。その気持ちの裏で、何が損なわれていたのでしょうか。` });
  }
  if (a.recoveryValues.length) {
    out.push({ text: `落ち込んだあと持ち直したときには「${a.recoveryValues[0][0]}」がありました。あなたが立ち直るきっかけになりやすいのかもしれません。` });
  }
  if (a.bigRise) {
    out.push({
      text: `いちばん大きく上がったのは「${eventName(a.bigRise.from)}」→「${eventName(a.bigRise.to)}」（${fmtScore(a.bigRise.delta)}）。`,
      question: 'このとき、何が変わりましたか？',
    });
  }
  const missing = a.seq.length - a.withValues;
  if (a.values.length && missing > 0) {
    out.push({ text: `「満たされていたもの／損なわれたもの」が付いていない出来事が${missing}件あります。付けるほど、候補がはっきりしてきます。` });
  }
  return out;
}

/* ---------------- chart render ---------------- */

let chartGeom = null;

function renderChart() {
  const wrap = $('#chart-wrap');
  const width = Math.max(280, Math.round(wrap.clientWidth));
  const height = Math.round(Math.min(380, Math.max(236, width * 0.5)));
  const { events, ghostId } = eventsWithDraft();
  const result = buildChartSvg({
    width, height, events, periods: getPeriods(), ghostId, showLabels: width >= 640, focusValue: ui.focusValue,
  });
  $('#chart').innerHTML = result.svg;
  chartGeom = result;
  const bar = $('#focus-bar');
  if (ui.focusValue) {
    bar.innerHTML = `「${esc(ui.focusValue)}」が関わる出来事を強調しています <button type="button" class="link-btn" data-act="unfocus">解除</button>`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
  renderPopup();
}

function renderPopup() {
  const pop = $('#popup');
  const ev = state.events.find((e) => e.id === ui.popupId);
  if (!ev || !chartGeom) {
    pop.hidden = true;
    ui.popupId = null;
    return;
  }
  const laid = chartGeom.laid.find((l) => l.ev.id === ev.id);
  if (!laid) { pop.hidden = true; return; }
  const period = periodById(ev.period);
  pop.innerHTML = `
    <div class="meta">${esc(period.name)}${ev.age !== null ? ` ・ ${ev.age}歳` : ''}</div>
    <div class="title">${ev.title ? esc(ev.title) : '<span style="color:var(--ink-faint)">（出来事名なし）</span>'}</div>
    <div><span class="score-badge ${scoreClass(ev.score)}">${fmtScore(ev.score)}</span> ${esc(SCORE_LABELS[ev.score])}</div>
    ${ev.emotions.length ? `<div class="chain-row"><span class="chain-k">感情</span>${ev.emotions.map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${ev.values.length ? `<div class="chain-row"><span class="chain-k">${ev.score < 0 ? '損なわれた' : '満たされた'}</span>${ev.values.map((t) => `<span class="mini-tag value">${esc(t)}</span>`).join('')}</div>` : ''}
    <p class="memo ${ev.memo ? '' : 'empty'}">${ev.memo ? esc(ev.memo) : 'メモはまだありません'}</p>
    <div class="actions">
      <button type="button" class="secondary-btn" data-act="popup-close">閉じる</button>
      <button type="button" class="primary-btn" data-act="popup-edit">編集</button>
    </div>`;
  pop.hidden = false;
  const wrap = $('#chart-wrap');
  const px = chartGeom.x(laid.pos);
  const py = chartGeom.y(ev.score);
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = px - pw / 2;
  left = Math.max(4, Math.min(wrap.clientWidth - pw - 4, left));
  let top = py + 16;
  if (top + ph > wrap.clientHeight + 40) top = Math.max(4, py - ph - 16);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

/* ---------------- panel render ---------------- */

function renderPanel() {
  const panel = $('#panel');
  panel.innerHTML = state.guideDone ? freeModeHtml() : guideModeHtml();
  bindForm();
}

function guideModeHtml() {
  const periods = getPeriods();
  state.guideStep = Math.min(state.guideStep, periods.length - 1);
  const step = state.guideStep;
  const period = periods[step];
  const entries = layoutEvents(eventsIn(period.id), [period]).map((l) => l.ev);
  if (!state.draft || state.draft.period !== period.id) state.draft = freshDraft(period.id);
  const editing = !!state.draft.editingId;
  const term = workTermOf(period.id);
  const last = step === periods.length - 1;

  let nav;
  if (term && last) {
    nav = `
      <button type="button" class="secondary-btn" data-act="guide-back">← 戻る</button>
      <span class="nav-right">
        ${term < MAX_WORK_TERMS ? `<button type="button" class="secondary-btn" data-act="guide-more-term">次の3年（${3 * term + 1}〜${3 * term + 3}年目）へ</button>` : ''}
        <button type="button" class="primary-btn" data-act="guide-finish">完成！振り返りへ</button>
      </span>`;
  } else {
    const nextLabel = entries.length === 0 ? 'この時期はスキップ →' : '次の時期へ →';
    nav = `
      <button type="button" class="secondary-btn" data-act="guide-back" ${step === 0 ? 'disabled' : ''}>← 戻る</button>
      <button type="button" class="${entries.length ? 'primary-btn' : 'secondary-btn'}" data-act="guide-next">${nextLabel}</button>`;
  }

  return `
  <div class="card">
    <div class="progress-head">
      <span class="progress-count">${step + 1} / ${periods.length}</span>
      <h2 class="progress-title">${esc(period.name)}</h2>
    </div>
    <div class="progress-bar" aria-hidden="true"><span style="width:${((step + 1) / periods.length) * 100}%"></span></div>
    <p class="hint">思い出すきっかけ：${period.hints.map(esc).join('・')} など</p>
    ${term === 1 ? '<p class="hint">社会人は3年ごとに振り返ります。まだ社会人でなければ、そのまま「完成」へ進んでください。</p>' : ''}
    ${entries.length ? `<ul class="step-entries">${entries.map(entryItemHtml).join('')}</ul>` : ''}
    ${formHtml({ showPeriod: false, cancellable: editing, entryCount: entries.length })}
    <div class="step-nav">${nav}</div>
  </div>`;
}

function freeModeHtml() {
  const formOpen = !!state.draft;
  if (formOpen) {
    return `<div class="card"><div class="free-head"><h2>${state.draft.editingId ? '出来事を編集' : '出来事を追加'}</h2></div>${formHtml({ showPeriod: true, cancellable: true })}</div>`;
  }
  const tabs = `
  <div class="tabs" role="tablist">
    <button type="button" role="tab" class="tab" aria-selected="${ui.tab === 'list'}" data-act="tab" data-tab="list">出来事の一覧</button>
    <button type="button" role="tab" class="tab" aria-selected="${ui.tab === 'values'}" data-act="tab" data-tab="values">価値観を見つける</button>
  </div>`;
  const banner = ui.justFinished && state.events.length
    ? '<div class="done-banner">人生全体のグラフができました。ここからは、経験 → 感情 → 価値観 の順にたどって、あなたが大切にしているものを探してみましょう。</div>'
    : '';
  return banner + tabs + (ui.tab === 'values' ? valuesTabHtml() : listTabHtml());
}

function listTabHtml() {
  const periods = getPeriods();
  const groups = periods.map((p) => {
    const entries = layoutEvents(eventsIn(p.id), [p]).map((l) => l.ev);
    if (!entries.length) return '';
    return `<div class="period-group"><h3>${esc(p.name)}</h3><ul class="step-entries">${entries.map(entryItemHtml).join('')}</ul></div>`;
  }).join('');
  return `
  <div class="card">
    <div class="free-head"><h2>出来事の一覧</h2><button type="button" class="primary-btn" data-act="add">＋ 出来事を追加</button></div>
    ${groups || '<p class="empty-note">まだ出来事がありません。「＋ 出来事を追加」から登録できます。</p>'}
  </div>
  <div class="free-foot">
    <button type="button" class="link-btn" data-act="restart-guide">時期ごとにもう一度振り返る</button>
    <button type="button" class="link-btn" data-act="clear-all">すべてのデータを消す</button>
  </div>`;
}

function valuesTabHtml() {
  const a = analyze();
  const insights = buildInsights(a);
  const maxW = Math.max(1, ...a.values.map((v) => Math.max(v.upWeight, v.downWeight)));

  const valueRows = a.values.map((v) => {
    const open = ui.openValue === v.value;
    const focused = ui.focusValue === v.value;
    const chain = open ? `<ul class="chain-list">${v.evs.map((ev) => `
        <li>
          <button type="button" class="chain-item" data-act="edit" data-id="${esc(ev.id)}">
            <span class="chain-step"><span class="chain-k">経験</span><span class="score-badge ${scoreClass(ev.score)}">${fmtScore(ev.score)}</span> ${esc(eventName(ev))}<span class="chain-period">${esc(periodById(ev.period).name)}</span></span>
            <span class="chain-step"><span class="chain-k">感情</span>${ev.emotions.length ? ev.emotions.map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('') : '<span class="chain-empty">未入力</span>'}</span>
            <span class="chain-step"><span class="chain-k">価値観</span><span class="mini-tag value">${esc(v.value)}</span><span class="chain-note">${ev.score < 0 ? 'が損なわれた' : ev.score > 0 ? 'が満たされた' : 'が関わった'}</span></span>
          </button>
        </li>`).join('')}</ul>` : '';
    return `
    <li class="value-row ${v.both ? 'both' : ''}">
      <button type="button" class="value-head" data-act="toggle-value" data-value="${esc(v.value)}" aria-expanded="${open}">
        <span class="value-name">${esc(v.value)}${v.both ? '<span class="both-badge">上下どちらにも</span>' : ''}</span>
        <span class="diverge" aria-label="上がったとき${v.up.length}回、下がったとき${v.down.length}回">
          <span class="dv-side neg"><span style="width:${(v.downWeight / maxW) * 100}%"></span></span>
          <span class="dv-side pos"><span style="width:${(v.upWeight / maxW) * 100}%"></span></span>
        </span>
        <span class="value-counts"><span class="neg-t">↓${v.down.length}</span> <span class="pos-t">↑${v.up.length}</span></span>
      </button>
      ${open ? `<div class="value-actions">
          <button type="button" class="chip-btn" data-act="focus-value" data-value="${esc(v.value)}">${focused ? 'グラフの強調を解除' : 'グラフで見る'}</button>
          ${state.myValues.some((m) => m.value === v.value) ? '' : `<button type="button" class="chip-btn" data-act="pick-value" data-value="${esc(v.value)}">わたしの価値観に選ぶ</button>`}
        </div>${chain}` : ''}
    </li>`;
  }).join('');

  const emoGroup = (title, list, cls) => `
    <div class="emo-group ${cls}">
      <h4>${title}</h4>
      ${list.length ? list.slice(0, 6).map(([t, n]) => `<span class="mini-tag">${esc(t)} ×${n}</span>`).join('') : '<span class="chain-empty">まだありません</span>'}
    </div>`;

  const candidates = a.values.map((v) => v.value).filter((v) => !state.myValues.some((m) => m.value === v));
  const myValues = state.myValues.map((m, i) => `
    <li class="my-value">
      <div class="my-value-head"><span class="my-value-no">${i + 1}</span><strong>${esc(m.value)}</strong>
        <button type="button" class="link-btn" data-act="unpick-value" data-value="${esc(m.value)}">外す</button></div>
      <label class="sr-only" for="mv-${i}">「${esc(m.value)}」をあなたの言葉で</label>
      <textarea class="text-input my-words" id="mv-${i}" data-value="${esc(m.value)}" maxlength="200" placeholder="あなたの言葉で言うと？ 例：昨日の自分より少しでも前に進めていること">${esc(m.words)}</textarea>
    </li>`).join('');

  return `
  <div class="card analysis">
    <div class="framework" aria-label="経験から価値観へ">
      <span class="fw-step">経験<small>出来事</small></span><span class="fw-arrow">→</span>
      <span class="fw-step">感情<small>気持ち</small></span><span class="fw-arrow">→</span>
      <span class="fw-step strong">価値観<small>大切なもの</small></span>
    </div>
    <p class="analysis-note">集計はこの端末の中だけで行っています（外部には送信されません）。答えではなく、考えるためのヒントです。</p>

    <h3>気づき</h3>
    <ul class="insights">
      ${insights.map((i) => `<li class="${i.strong ? 'strong' : ''}">${esc(i.text)}${i.question ? `<span class="question">${esc(i.question)}</span>` : ''}</li>`).join('')}
    </ul>

    <h3>価値観の候補</h3>
    ${a.values.length ? `
      <p class="section-note">満たされて上がったとき（右・オレンジ）と、損なわれて下がったとき（左・青）の大きさです。両方に出てくるものほど、あなたにとって大切なものである可能性が高くなります。タップすると、経験→感情→価値観のつながりが見られます。</p>
      <div class="diverge-legend" aria-hidden="true"><span class="neg-t">← 損なわれて下がった</span><span class="pos-t">満たされて上がった →</span></div>
      <ul class="value-list">${valueRows}</ul>`
    : '<p class="empty-note">まだ候補がありません。出来事を編集して「満たされていたもの／損なわれたもの」を選ぶと、ここに現れます。</p>'}

    <h3>感情の傾向</h3>
    <div class="emo-groups">
      ${emoGroup('上がったとき', a.emoUp, 'pos')}
      ${emoGroup('下がったとき', a.emoDown, 'neg')}
    </div>

    <h3>わたしの価値観を言葉にする</h3>
    <p class="section-note">そこから見えてくる、あなたが大切にしている価値観は何ですか？ 候補から最大${MAX_MY_VALUES}つ選んで、自分の言葉で書いてみましょう。</p>
    ${state.myValues.length ? `<ol class="my-values">${myValues}</ol>` : ''}
    ${state.myValues.length < MAX_MY_VALUES ? `
      <div class="pick-row">
        ${candidates.map((v) => `<button type="button" class="tag-choice" data-act="pick-value" data-value="${esc(v)}">＋ ${esc(v)}</button>`).join('')}
        <span class="tag-add">
          <input class="text-input" id="mv-new" type="text" maxlength="12" placeholder="候補にない言葉で追加" aria-label="価値観を自分で追加">
          <button type="button" class="secondary-btn" data-act="pick-custom">追加</button>
        </span>
      </div>` : ''}
    ${state.myValues.length ? '<p class="section-note">選んだ価値観は「画像で保存」するとグラフの下に入ります。</p>' : ''}
  </div>`;
}

function entryItemHtml(ev) {
  const editing = state.draft && state.draft.editingId === ev.id;
  const tags = ev.emotions.concat(ev.values).map((t) => '#' + t).join(' ');
  const sub = [ev.age !== null ? `${ev.age}歳` : '', tags, ev.memo ? ev.memo.replace(/\s+/g, ' ') : ''].filter(Boolean).join(' ・ ');
  return `<li><button type="button" class="entry-btn ${editing ? 'editing' : ''}" data-act="edit" data-id="${esc(ev.id)}">
    <span class="score-badge ${scoreClass(ev.score)}">${fmtScore(ev.score)}</span>
    <span class="entry-text">
      <span class="entry-title ${ev.title ? '' : 'untitled'}">${ev.title ? esc(ev.title) : '（出来事名なし）'}</span>
      ${sub ? `<span class="entry-sub">${esc(sub)}</span>` : ''}
    </span>
  </button></li>`;
}

function valueQuestion(score) {
  if (score > 0) return 'そのとき、何が満たされていた？';
  if (score < 0) return 'そのとき、何が損なわれていた？足りなかった？';
  return 'そのとき、何が関わっていた？';
}

function valueChoices() {
  const custom = [];
  state.events.forEach((e) => e.values.forEach((v) => { if (!PRESET_VALUES.includes(v) && !custom.includes(v)) custom.push(v); }));
  if (state.draft) state.draft.values.forEach((v) => { if (!PRESET_VALUES.includes(v) && !custom.includes(v)) custom.push(v); });
  return PRESET_VALUES.concat(custom);
}

function tagChoicesHtml(kind) {
  const d = state.draft;
  const list = kind === 'emotions' ? (d.score < 0 ? EMOTIONS_NEG.concat(EMOTIONS_POS) : EMOTIONS) : valueChoices();
  return list.map((t) => `<button type="button" class="tag-choice ${kind === 'values' ? 'value' : ''}" data-kind="${kind}" data-tag="${esc(t)}" aria-pressed="${d[kind].includes(t)}">${esc(t)}</button>`).join('');
}

function formHtml({ showPeriod, cancellable, entryCount = 0 }) {
  const d = state.draft;
  const period = periodById(d.period);
  const placeholder = `例：${period.hints[0]}`;
  const periods = getPeriods();
  const lastTerm = workTermCount();
  return `
  <form class="event-form" id="event-form" novalidate>
    ${!showPeriod && entryCount ? '<p class="form-lead">ほかにも思い出したら、続けて登録できます（何件でもOK）。</p>' : ''}
    ${showPeriod ? `<div class="field">
      <span class="label">時期</span>
      <div class="period-choices" role="group" aria-label="時期">
        ${periods.map((p) => `<button type="button" class="period-choice" data-period="${p.id}" aria-pressed="${p.id === d.period}">${esc(p.name)}</button>`).join('')}
        ${lastTerm < MAX_WORK_TERMS ? '<button type="button" class="period-choice add" data-act="add-term">＋ 次の3年</button>' : ''}
      </div>
    </div>` : ''}
    <div class="field">
      <label for="f-title"><span class="step-tag">経験</span>どんな出来事？<span class="optional">任意</span></label>
      <input class="text-input" id="f-title" name="title" type="text" maxlength="100" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(d.title)}">
    </div>
    <div class="field">
      <label for="f-score">そのときのモチベーションは？</label>
      <div class="score-display" aria-hidden="true">
        <span class="score-num ${scoreClass(d.score)}" id="score-num">${fmtScore(d.score)}</span>
        <span class="score-word" id="score-word">${esc(SCORE_LABELS[d.score])}</span>
      </div>
      <input class="slider" id="f-score" name="score" type="range" min="-5" max="5" step="1" value="${d.score}" aria-valuetext="${esc(fmtScore(d.score) + ' ' + SCORE_LABELS[d.score])}">
      <div class="slider-ends" aria-hidden="true"><span>−5 最悪</span><span>ふつう</span><span>+5 最高</span></div>
    </div>
    <div class="field">
      <span class="label"><span class="step-tag">感情</span>どんな気持ちだった？<span class="optional">任意・いくつでも</span></span>
      <div class="tag-choices" id="emotion-choices">${tagChoicesHtml('emotions')}</div>
    </div>
    <div class="field">
      <span class="label"><span class="step-tag value">価値観</span><span id="value-q">${valueQuestion(d.score)}</span><span class="optional">任意・いくつでも</span></span>
      <div class="tag-choices" id="value-choices">${tagChoicesHtml('values')}</div>
      <div class="tag-add">
        <input class="text-input" id="f-newvalue" type="text" maxlength="12" placeholder="ぴったりの言葉がなければ追加" aria-label="価値観を自分で追加">
        <button type="button" class="secondary-btn" data-act="add-value-tag">追加</button>
      </div>
    </div>
    <div class="field">
      <label for="f-age">何歳ごろ？<span class="optional">任意</span></label>
      <input class="text-input age-input" id="f-age" name="age" type="number" inputmode="numeric" min="0" max="120" step="1" placeholder="${period.from}" value="${esc(d.age)}"> 歳
    </div>
    <div class="field">
      <label for="f-memo">メモ<span class="optional">任意</span></label>
      <textarea class="text-input" id="f-memo" name="memo" maxlength="4000" placeholder="なぜ上がった？下がった？ あとから書き足してもOKです">${esc(d.memo)}</textarea>
    </div>
    ${ui.error ? `<p class="form-error" role="alert">${esc(ui.error)}</p>` : ''}
    <div class="form-actions">
      <button type="submit" class="primary-btn">${d.editingId ? '更新する' : '登録する'}</button>
      ${cancellable ? '<button type="button" class="secondary-btn" data-act="cancel">キャンセル</button>' : ''}
      <span class="spacer"></span>
      ${d.editingId ? '<button type="button" class="danger-btn" data-act="delete">削除</button>' : ''}
    </div>
  </form>`;
}

function bindForm() {
  const form = $('#event-form');
  if (form) {
    form.addEventListener('input', onFormInput);
    form.addEventListener('submit', onSubmit);
    $('#f-newvalue').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addCustomValueTag(); }
    });
  }
  document.querySelectorAll('.my-words').forEach((el) => {
    el.addEventListener('input', () => {
      const m = state.myValues.find((x) => x.value === el.dataset.value);
      if (m) { m.words = el.value.slice(0, 200); saveState(); }
    });
  });
  const mvNew = $('#mv-new');
  if (mvNew) {
    mvNew.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pickValue(mvNew.value); }
    });
  }
}

function onFormInput(e) {
  const d = state.draft;
  if (!d) return;
  const t = e.target;
  if (t.name === 'title') d.title = t.value;
  if (t.name === 'memo') d.memo = t.value;
  if (t.name === 'age') d.age = t.value;
  if (t.name === 'score') {
    const prevSign = Math.sign(d.score);
    d.score = clampInt(t.value, -5, 5, 0);
    const num = $('#score-num');
    num.textContent = fmtScore(d.score);
    num.className = 'score-num ' + scoreClass(d.score);
    $('#score-word').textContent = SCORE_LABELS[d.score];
    $('#value-q').textContent = valueQuestion(d.score);
    t.setAttribute('aria-valuetext', fmtScore(d.score) + ' ' + SCORE_LABELS[d.score]);
    if (Math.sign(d.score) !== prevSign) $('#emotion-choices').innerHTML = tagChoicesHtml('emotions');
  }
  if (!t.name) return;
  saveState();
  if (t.name === 'score' || t.name === 'age') renderChart();
}

function toggleTag(kind, tag) {
  const d = state.draft;
  if (!d) return;
  const list = d[kind];
  const i = list.indexOf(tag);
  if (i >= 0) list.splice(i, 1);
  else if (list.length < MAX_TAGS) list.push(tag);
  saveState();
  document.querySelectorAll(`.tag-choice[data-kind="${kind}"]`).forEach((b) => b.setAttribute('aria-pressed', String(list.includes(b.dataset.tag))));
}

function addCustomValueTag() {
  const input = $('#f-newvalue');
  const d = state.draft;
  if (!input || !d) return;
  const tag = input.value.trim().slice(0, 12);
  if (!tag) return;
  if (!d.values.includes(tag) && d.values.length < MAX_TAGS) d.values.push(tag);
  input.value = '';
  saveState();
  $('#value-choices').innerHTML = tagChoicesHtml('values');
}

function parseAge(v) {
  const s = String(v ?? '').trim();
  if (s === '') return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 120) return { ok: false };
  return { ok: true, value: n };
}

function onSubmit(e) {
  e.preventDefault();
  const d = state.draft;
  if (!d) return;
  const age = parseAge(d.age);
  if (!age.ok) {
    ui.error = '年齢は0〜120の数字で入力してください（空欄でもOKです）';
    renderPanel();
    $('#f-age') && $('#f-age').focus();
    return;
  }
  ui.error = '';
  const values = {
    period: d.period, score: d.score, age: age.value, title: d.title.trim(), memo: d.memo.trim(),
    emotions: d.emotions.slice(), values: d.values.slice(),
  };
  if (d.editingId) {
    const ev = state.events.find((x) => x.id === d.editingId);
    if (ev) Object.assign(ev, values);
    ui.lastAddedId = null;
    toast('更新しました');
  } else {
    const ev = { id: newId(), createdAt: Date.now(), ...values };
    state.events.push(ev);
    ui.lastAddedId = ev.id;
    toast('登録しました');
  }
  state.draft = state.guideDone ? null : guideDraft();
  saveState();
  renderAll();
}

/* ---------------- actions ---------------- */

function startEdit(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  ui.error = '';
  ui.popupId = null;
  state.draft = draftFromEvent(ev);
  if (!state.guideDone) state.guideStep = getPeriods().findIndex((p) => p.id === ev.period);
  saveState();
  renderAll();
  const form = $('#event-form');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteEditing() {
  const id = state.draft && state.draft.editingId;
  if (!id) return;
  if (!confirm('この出来事を削除しますか？')) return;
  state.events = state.events.filter((e) => e.id !== id);
  state.draft = state.guideDone ? null : guideDraft();
  ui.error = '';
  saveState();
  renderAll();
  toast('削除しました');
}

function cancelForm() {
  ui.error = '';
  state.draft = state.guideDone ? null : guideDraft();
  saveState();
  renderAll();
}

function guideGo(step) {
  ui.error = '';
  state.guideStep = Math.max(0, step);
  state.draft = guideDraft();
  saveState();
  renderAll();
  const panel = $('#panel');
  if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function guideMoreTerm() {
  const term = workTermOf(getPeriods()[state.guideStep].id);
  state.workTerms = Math.min(MAX_WORK_TERMS, term + 1);
  guideGo(state.guideStep + 1);
}

function guideFinish() {
  state.guideDone = true;
  state.draft = null;
  ui.justFinished = true;
  ui.tab = state.events.length ? 'values' : 'list';
  saveState();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAdd() {
  ui.error = '';
  ui.justFinished = false;
  const lastPeriod = state.events.length ? state.events[state.events.length - 1].period : 'work1';
  state.draft = freshDraft(lastPeriod);
  saveState();
  renderAll();
  const t = $('#f-title');
  if (t) t.focus({ preventScroll: true });
}

function addTerm() {
  if (!state.draft) return;
  const n = workTermCount();
  if (n >= MAX_WORK_TERMS) return;
  state.draft.period = 'work' + (n + 1);
  saveState();
  renderAll();
}

function restartGuide() {
  state.guideDone = false;
  state.guideStep = 0;
  state.workTerms = workTermCount();
  state.draft = freshDraft(BASE_PERIODS[0].id);
  ui.focusValue = null;
  saveState();
  renderAll();
}

function clearAll() {
  if (!confirm('すべての出来事と「わたしの価値観」を消去します。元に戻せません。\n（残したい場合は先に「データを書き出す」で保存してください）')) return;
  state = defaultState();
  state.introSeen = true;
  ui.popupId = null;
  ui.focusValue = null;
  ui.tab = 'list';
  saveState();
  renderAll();
  toast('すべてのデータを消去しました');
}

function setDraftPeriod(periodId) {
  if (!state.draft) return;
  state.draft.period = periodId;
  saveState();
  document.querySelectorAll('.period-choice[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === periodId)));
  const age = $('#f-age');
  if (age) age.placeholder = String(periodById(periodId).from);
  renderChart();
}

function pickValue(raw) {
  const value = String(raw || '').trim().slice(0, 12);
  if (!value || state.myValues.length >= MAX_MY_VALUES || state.myValues.some((m) => m.value === value)) return;
  state.myValues.push({ value, words: '' });
  ui.tab = 'values';
  saveState();
  renderPanel();
  const inputs = document.querySelectorAll('.my-words');
  if (inputs.length) inputs[inputs.length - 1].focus({ preventScroll: false });
}

function unpickValue(value) {
  state.myValues = state.myValues.filter((m) => m.value !== value);
  saveState();
  renderPanel();
}

/* ---------------- export / import ---------------- */

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportJson() {
  if (!state.events.length) { toast('まだ出来事がありません'); return; }
  const data = {
    app: EXPORT_APP_ID,
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    events: state.events,
    myValues: state.myValues,
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `motivation-graph-${dateStamp()}.json`);
  toast('データファイルを書き出しました');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(String(reader.result));
    } catch (e) {
      alert('ファイルを読み込めませんでした。このアプリで書き出したファイルを選んでください。');
      return;
    }
    const events = data && data.app === EXPORT_APP_ID ? sanitizeEvents(data.events) : null;
    if (!events) {
      alert('このファイルはモチベーショングラフのデータではないか、内容が壊れています。');
      return;
    }
    if (state.events.length && !confirm(`${events.length}件の出来事を読み込みます。\n今この端末にあるデータ（${state.events.length}件）は置き換えられます。よろしいですか？`)) return;
    state.events = events;
    state.myValues = sanitizeMyValues(data.myValues);
    state.guideDone = true;
    state.introSeen = true;
    state.draft = null;
    ui.popupId = null;
    ui.lastAddedId = null;
    ui.focusValue = null;
    saveState();
    renderAll();
    toast(`${events.length}件の出来事を読み込みました`);
  };
  reader.onerror = () => alert('ファイルを読み込めませんでした。');
  reader.readAsText(file);
}

function savePng() {
  if (!state.events.length) { toast('まだ出来事がありません'); return; }
  const W = 1200;
  const footer = state.myValues.length ? 'わたしの価値観：' + state.myValues.map((m) => m.value).join(' ／ ') : '';
  const H = footer ? 680 : 630;
  const { svg } = buildChartSvg({ width: W, height: H, events: state.events, periods: getPeriods(), forExport: true, showLabels: true, footer });
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) { alert('画像を作成できませんでした。'); return; }
      downloadBlob(blob, `motivation-graph-${dateStamp()}.png`);
      toast('画像を保存しました');
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('画像を作成できませんでした。');
  };
  img.src = url;
}

/* ---------------- intro ---------------- */

function showIntro(show) {
  $('#intro').hidden = !show;
  if (show) $('#intro-start').focus();
}

/* ---------------- wiring ---------------- */

function renderAll() {
  renderPanel();
  renderChart();
}

document.addEventListener('click', (e) => {
  const periodBtn = e.target.closest('.period-choice[data-period]');
  if (periodBtn) { setDraftPeriod(periodBtn.dataset.period); return; }

  const tagBtn = e.target.closest('.tag-choice[data-kind]');
  if (tagBtn) { toggleTag(tagBtn.dataset.kind, tagBtn.dataset.tag); return; }

  const hit = e.target.closest('#chart .hit');
  if (hit) {
    ui.popupId = ui.popupId === hit.dataset.id ? null : hit.dataset.id;
    renderPopup();
    return;
  }

  const actEl = e.target.closest('[data-act]');
  if (actEl) {
    const act = actEl.dataset.act;
    const val = actEl.dataset.value;
    if (act === 'edit') startEdit(actEl.dataset.id);
    else if (act === 'delete') deleteEditing();
    else if (act === 'cancel') cancelForm();
    else if (act === 'guide-next') guideGo(state.guideStep + 1);
    else if (act === 'guide-back') guideGo(state.guideStep - 1);
    else if (act === 'guide-more-term') guideMoreTerm();
    else if (act === 'guide-finish') guideFinish();
    else if (act === 'add') openAdd();
    else if (act === 'add-term') addTerm();
    else if (act === 'add-value-tag') addCustomValueTag();
    else if (act === 'restart-guide') restartGuide();
    else if (act === 'clear-all') clearAll();
    else if (act === 'popup-close') { ui.popupId = null; renderPopup(); }
    else if (act === 'popup-edit') startEdit(ui.popupId);
    else if (act === 'tab') { ui.tab = actEl.dataset.tab; ui.justFinished = false; renderPanel(); }
    else if (act === 'toggle-value') { ui.openValue = ui.openValue === val ? null : val; renderPanel(); }
    else if (act === 'focus-value') {
      ui.focusValue = ui.focusValue === val ? null : val;
      renderAll();
      if (ui.focusValue) $('.chart-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else if (act === 'unfocus') { ui.focusValue = null; renderAll(); }
    else if (act === 'pick-value') pickValue(val);
    else if (act === 'pick-custom') pickValue($('#mv-new') && $('#mv-new').value);
    else if (act === 'unpick-value') unpickValue(val);
    return;
  }

  if (ui.popupId && !e.target.closest('#popup')) {
    ui.popupId = null;
    renderPopup();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.popupId) {
    ui.popupId = null;
    renderPopup();
    return;
  }
  const hit = e.target.closest && e.target.closest('#chart .hit');
  if (hit && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    ui.popupId = hit.dataset.id;
    renderPopup();
  }
});

$('#save-png').addEventListener('click', savePng);
$('#export-json').addEventListener('click', exportJson);
$('#import-json').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importJson(file);
  e.target.value = '';
});
$('#help-btn').addEventListener('click', () => showIntro(true));
$('#intro-start').addEventListener('click', () => {
  state.introSeen = true;
  saveState();
  showIntro(false);
  const t = $('#f-title');
  if (t) t.focus({ preventScroll: true });
});

let resizeTimer = null;
let lastWidth = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = $('#chart-wrap').clientWidth;
    if (w !== lastWidth) { lastWidth = w; renderChart(); }
  }, 120);
});

renderAll();
lastWidth = $('#chart-wrap').clientWidth;
if (!state.introSeen) showIntro(true);
if (!storageOk) toast('この端末では自動保存ができません。「データを書き出す」で保存してください');
