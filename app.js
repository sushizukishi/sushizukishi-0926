'use strict';

/* =========================================================
 * モチベーショングラフ
 * データはすべて localStorage に保存し、外部には送信しない。
 * ========================================================= */

const STORAGE_KEY = 'motivation-graph:v1';
const EXPORT_APP_ID = 'motivation-graph';
const MAX_PER_STEP = 3;

const PERIODS = [
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
  { id: 'work', name: '社会人', short: '社会人', from: 22, to: null,
    hints: ['初めての仕事', '異動・転職', '昇進', '結婚・家族', '趣味'] },
];

const PERIOD_INDEX = Object.fromEntries(PERIODS.map((p, i) => [p.id, i]));

const SCORE_LABELS = {
  '-5': '最悪', '-4': 'すごくつらい', '-3': 'つらい', '-2': 'いまいち', '-1': 'ちょっと低め',
  '0': 'ふつう',
  '1': 'ちょっと良い', '2': '良い', '3': 'かなり良い', '4': 'すごく良い', '5': '最高',
};

const COLORS = {
  bg: '#ffffff', bandA: '#fbf7f2', bandB: '#ffffff', grid: '#eee6dc', zero: '#cfc4b8',
  ink: '#2b2622', inkSoft: '#6f665e', inkFaint: '#a39a91',
  line: '#e0703c', pos: '#e0703c', neg: '#4a7fc1', neutral: '#a39a91',
};
const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif';

/* ---------------- state & storage ---------------- */

let storageOk = true;
let state = loadState();
const ui = { popupId: null, lastAddedId: null, error: '', justFinished: false };

function defaultState() {
  return { version: 1, introSeen: false, guideDone: false, guideStep: 0, events: [], draft: null };
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
    s.guideStep = clampInt(data.guideStep, 0, PERIODS.length - 1, 0);
    s.events = sanitizeEvents(data.events) || [];
    s.draft = sanitizeDraft(data.draft);
    if (s.draft && s.draft.editingId && !s.events.some((e) => e.id === s.draft.editingId)) s.draft.editingId = null;
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

function sanitizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  if (!(e.period in PERIOD_INDEX)) return null;
  const score = Number(e.score);
  if (!Number.isInteger(score) || score < -5 || score > 5) return null;
  let age = null;
  if (e.age !== null && e.age !== undefined && e.age !== '') {
    const a = Number(e.age);
    if (!Number.isInteger(a) || a < 0 || a > 120) return null;
    age = a;
  }
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : newId(),
    period: e.period,
    score,
    age,
    title: typeof e.title === 'string' ? e.title.slice(0, 100) : '',
    memo: typeof e.memo === 'string' ? e.memo.slice(0, 4000) : '',
    createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : Date.now(),
  };
}

/** 1件でも不正なら null を返す（読み込み時に中途半端な取り込みをしないため） */
function sanitizeEvents(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const ev = sanitizeEvent(item);
    if (!ev) return null;
    if (seen.has(ev.id)) ev.id = newId();
    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}

function sanitizeDraft(d) {
  if (!d || typeof d !== 'object' || !(d.period in PERIOD_INDEX)) return null;
  return {
    editingId: typeof d.editingId === 'string' ? d.editingId : null,
    period: d.period,
    score: clampInt(d.score, -5, 5, 0),
    age: typeof d.age === 'string' ? d.age.slice(0, 3) : '',
    title: typeof d.title === 'string' ? d.title.slice(0, 100) : '',
    memo: typeof d.memo === 'string' ? d.memo.slice(0, 4000) : '',
  };
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function freshDraft(period) {
  return { editingId: null, period, score: 0, age: '', title: '', memo: '' };
}

function draftFromEvent(ev) {
  return {
    editingId: ev.id, period: ev.period, score: ev.score,
    age: ev.age === null ? '' : String(ev.age), title: ev.title, memo: ev.memo,
  };
}

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtScore(n) { return n > 0 ? '+' + n : String(n); }
function scoreClass(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
function scoreColor(n) { return n > 0 ? COLORS.pos : n < 0 ? COLORS.neg : COLORS.neutral; }

function truncate(s, n) {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s;
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
function layoutEvents(events) {
  const out = [];
  PERIODS.forEach((p, i) => {
    const evs = events.filter((e) => e.period === p.id);
    const withAge = evs.filter((e) => e.age !== null);
    const withoutAge = evs.filter((e) => e.age === null);
    let to = p.to;
    if (to === null) {
      const maxAge = withAge.reduce((m, e) => Math.max(m, e.age), 0);
      to = Math.max(40, maxAge + 3);
    }
    withAge.forEach((e) => {
      const f = Math.min(0.92, Math.max(0.08, (e.age - p.from) / (to - p.from)));
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
    age: age.ok ? age.value : null, title: d.title, memo: d.memo,
    createdAt: Number.MAX_SAFE_INTEGER, ghost: true,
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
  const { width: W, height: H, events, ghostId = null, forExport = false, showLabels = false } = opts;
  const narrow = W < 520;
  const pad = { l: narrow ? 30 : 40, r: 12, t: forExport ? 72 : showLabels ? 26 : 14, b: narrow ? 30 : 34 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const bandW = plotW / PERIODS.length;
  const x = (pos) => pad.l + pos * bandW;
  const y = (score) => pad.t + ((5 - score) / 10) * plotH;
  const fs = narrow ? 11 : 12;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}' role="img" aria-label="モチベーショングラフ">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COLORS.bg}"/>`);

  if (forExport) {
    parts.push(`<text x="${pad.l}" y="38" font-size="24" font-weight="700" fill="${COLORS.ink}">モチベーショングラフ</text>`);
  }

  // 時期ごとの帯
  PERIODS.forEach((p, i) => {
    parts.push(`<rect x="${x(i)}" y="${pad.t}" width="${bandW}" height="${plotH}" fill="${i % 2 === 0 ? COLORS.bandA : COLORS.bandB}"/>`);
    const label = bandW < 70 ? p.short : p.name;
    parts.push(`<text x="${x(i + 0.5)}" y="${H - pad.b + (narrow ? 18 : 22)}" font-size="${fs}" fill="${COLORS.inkSoft}" text-anchor="middle">${esc(label)}</text>`);
  });

  // 横グリッドと目盛り（狭い画面では -5 / 0 / +5 のみ）
  for (let s = -5; s <= 5; s++) {
    if (narrow && s % 5 !== 0) continue;
    const isZero = s === 0;
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(s)}" y2="${y(s)}" stroke="${isZero ? COLORS.zero : COLORS.grid}" stroke-width="${isZero ? 1.5 : 1}"${isZero ? '' : ' stroke-dasharray="2 4"'}/>`);
    parts.push(`<text x="${pad.l - 6}" y="${y(s) + 4}" font-size="${fs - 1}" fill="${COLORS.inkFaint}" text-anchor="end">${fmtScore(s)}</text>`);
  }

  const laid = layoutEvents(events);

  if (laid.length === 0 && !forExport) {
    parts.push(`<text x="${pad.l + plotW / 2}" y="${pad.t + plotH / 2 - 10}" font-size="${fs + 1}" fill="${COLORS.inkFaint}" text-anchor="middle">出来事を登録すると、</text>`);
    parts.push(`<text x="${pad.l + plotW / 2}" y="${pad.t + plotH / 2 + 10}" font-size="${fs + 1}" fill="${COLORS.inkFaint}" text-anchor="middle">ここにグラフが描かれます</text>`);
  }

  // 折れ線（なめらかな曲線）
  if (laid.length >= 2) {
    const pts = laid.map((l) => [x(l.pos), y(l.ev.score)]);
    parts.push(`<path d="${smoothPath(pts)}" fill="none" stroke="${COLORS.line}" stroke-width="${forExport ? 3.5 : 3}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // 出来事名ラベル
  if (showLabels) {
    laid.forEach((l) => {
      if (!l.ev.title) return;
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
      parts.push(`<circle class="${isNew ? 'pt-new' : ''}" cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="${COLORS.bg}" stroke-width="2"/>`);
    }
    if (!forExport && !isGhost) {
      const name = l.ev.title || '出来事';
      parts.push(`<circle class="hit" data-id="${esc(l.ev.id)}" cx="${cx}" cy="${cy}" r="18" fill="transparent" tabindex="0" role="button" aria-label="${esc(PERIODS[PERIOD_INDEX[l.ev.period]].name + ' ' + name + ' ' + fmtScore(l.ev.score))}"/>`);
    }
  });

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

/* ---------------- chart render ---------------- */

let chartGeom = null;

function renderChart() {
  const wrap = $('#chart-wrap');
  const width = Math.max(280, Math.round(wrap.clientWidth));
  const height = Math.round(Math.min(380, Math.max(220, width * 0.5)));
  const { events, ghostId } = eventsWithDraft();
  const result = buildChartSvg({ width, height, events, ghostId, showLabels: width >= 640 });
  $('#chart').innerHTML = result.svg;
  chartGeom = result;
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
  const period = PERIODS[PERIOD_INDEX[ev.period]];
  pop.innerHTML = `
    <div class="meta">${esc(period.name)}${ev.age !== null ? ` ・ ${ev.age}歳` : ''}</div>
    <div class="title">${ev.title ? esc(ev.title) : '<span style="color:var(--ink-faint)">（出来事名なし）</span>'}</div>
    <div><span class="score-badge ${scoreClass(ev.score)}">${fmtScore(ev.score)}</span> ${esc(SCORE_LABELS[ev.score])}</div>
    <p class="memo ${ev.memo ? '' : 'empty'}">${ev.memo ? esc(ev.memo) : '理由メモはまだありません'}</p>
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
  const step = state.guideStep;
  const period = PERIODS[step];
  const entries = eventsIn(period.id);
  if (!state.draft || (state.draft.period !== period.id)) {
    state.draft = freshDraft(period.id);
  }
  const editing = !!state.draft.editingId;
  const full = entries.length >= MAX_PER_STEP && !editing;
  const last = step === PERIODS.length - 1;
  const nextLabel = last ? '完成！グラフを見る' : entries.length === 0 ? 'この時期はスキップ →' : '次の時期へ →';

  return `
  <div class="card">
    <div class="progress-head">
      <span class="progress-count">${step + 1} / ${PERIODS.length}</span>
      <h2 class="progress-title">${esc(period.name)}</h2>
    </div>
    <div class="progress-bar" aria-hidden="true"><span style="width:${((step + 1) / PERIODS.length) * 100}%"></span></div>
    <p class="hint">思い出すきっかけ：${period.hints.map(esc).join('・')} など</p>
    ${entries.length ? `<ul class="step-entries">${entries.map(entryItemHtml).join('')}</ul>` : ''}
    ${full
      ? `<p class="step-full">この時期は${MAX_PER_STEP}件登録できました。次へ進みましょう（あとから追加もできます）。</p>`
      : formHtml({ showPeriod: false, cancellable: editing })}
    <div class="step-nav">
      <button type="button" class="secondary-btn" data-act="guide-back" ${step === 0 ? 'disabled' : ''}>← 戻る</button>
      <button type="button" class="${entries.length || last ? 'primary-btn' : 'secondary-btn'}" data-act="guide-next">${nextLabel}</button>
    </div>
  </div>`;
}

function freeModeHtml() {
  const formOpen = !!state.draft;
  const groups = PERIODS.map((p) => {
    const entries = layoutEvents(eventsIn(p.id)).map((l) => l.ev);
    if (!entries.length) return '';
    return `<div class="period-group"><h3>${esc(p.name)}</h3><ul class="step-entries">${entries.map(entryItemHtml).join('')}</ul></div>`;
  }).join('');

  return `
  ${ui.justFinished && state.events.length && !formOpen ? `<div class="done-banner">人生全体のグラフができました。点をタップするとメモを見返せます。思い出したことがあれば自由に追加・編集してください。</div>` : ''}
  <div class="card">
    ${formOpen
      ? `<div class="free-head"><h2>${state.draft.editingId ? '出来事を編集' : '出来事を追加'}</h2></div>${formHtml({ showPeriod: true, cancellable: true })}`
      : `<div class="free-head"><h2>出来事の一覧</h2><button type="button" class="primary-btn" data-act="add">＋ 出来事を追加</button></div>
         ${groups || '<p class="empty-note">まだ出来事がありません。「＋ 出来事を追加」から登録できます。</p>'}`}
  </div>
  ${formOpen ? '' : `<div class="free-foot">
    <button type="button" class="link-btn" data-act="restart-guide">時期ごとにもう一度振り返る</button>
    <button type="button" class="link-btn" data-act="clear-all">すべてのデータを消す</button>
  </div>`}`;
}

function entryItemHtml(ev) {
  const editing = state.draft && state.draft.editingId === ev.id;
  const sub = [ev.age !== null ? `${ev.age}歳` : '', ev.memo ? ev.memo.replace(/\s+/g, ' ') : ''].filter(Boolean).join(' ・ ');
  return `<li><button type="button" class="entry-btn ${editing ? 'editing' : ''}" data-act="edit" data-id="${esc(ev.id)}">
    <span class="score-badge ${scoreClass(ev.score)}">${fmtScore(ev.score)}</span>
    <span class="entry-text">
      <span class="entry-title ${ev.title ? '' : 'untitled'}">${ev.title ? esc(ev.title) : '（出来事名なし）'}</span>
      ${sub ? `<span class="entry-sub">${esc(sub)}</span>` : ''}
    </span>
  </button></li>`;
}

function formHtml({ showPeriod, cancellable }) {
  const d = state.draft;
  const period = PERIODS[PERIOD_INDEX[d.period]];
  const placeholder = `例：${period.hints[0]}`;
  return `
  <form class="event-form" id="event-form" novalidate>
    ${showPeriod ? `<div class="field">
      <span class="label">時期</span>
      <div class="period-choices" role="group" aria-label="時期">
        ${PERIODS.map((p) => `<button type="button" class="period-choice" data-period="${p.id}" aria-pressed="${p.id === d.period}">${esc(p.name)}</button>`).join('')}
      </div>
    </div>` : ''}
    <div class="field">
      <label for="f-title">どんな出来事？<span class="optional">任意</span></label>
      <input class="text-input" id="f-title" name="title" type="text" maxlength="100" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(d.title)}">
    </div>
    <div class="field">
      <label for="f-score">そのときの気持ちは？</label>
      <div class="score-display" aria-hidden="true">
        <span class="score-num ${scoreClass(d.score)}" id="score-num">${fmtScore(d.score)}</span>
        <span class="score-word" id="score-word">${esc(SCORE_LABELS[d.score])}</span>
      </div>
      <input class="slider" id="f-score" name="score" type="range" min="-5" max="5" step="1" value="${d.score}" aria-valuetext="${esc(fmtScore(d.score) + ' ' + SCORE_LABELS[d.score])}">
      <div class="slider-ends" aria-hidden="true"><span>−5 最悪</span><span>ふつう</span><span>+5 最高</span></div>
    </div>
    <div class="field">
      <label for="f-age">何歳ごろ？<span class="optional">任意</span></label>
      <input class="text-input age-input" id="f-age" name="age" type="number" inputmode="numeric" min="0" max="120" step="1" placeholder="${period.from}" value="${esc(d.age)}"> 歳
    </div>
    <div class="field">
      <label for="f-memo">なぜ上がった？下がった？<span class="optional">任意</span></label>
      <textarea class="text-input" id="f-memo" name="memo" maxlength="4000" placeholder="あとから書き足してもOKです">${esc(d.memo)}</textarea>
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
  if (!form) return;
  form.addEventListener('input', onFormInput);
  form.addEventListener('submit', onSubmit);
}

function onFormInput(e) {
  const d = state.draft;
  if (!d) return;
  const t = e.target;
  if (t.name === 'title') d.title = t.value;
  if (t.name === 'memo') d.memo = t.value;
  if (t.name === 'age') d.age = t.value;
  if (t.name === 'score') {
    d.score = clampInt(t.value, -5, 5, 0);
    const num = $('#score-num');
    num.textContent = fmtScore(d.score);
    num.className = 'score-num ' + scoreClass(d.score);
    $('#score-word').textContent = SCORE_LABELS[d.score];
    t.setAttribute('aria-valuetext', fmtScore(d.score) + ' ' + SCORE_LABELS[d.score]);
  }
  saveState();
  if (t.name === 'score' || t.name === 'age') renderChart();
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
  const values = { period: d.period, score: d.score, age: age.value, title: d.title.trim(), memo: d.memo.trim() };
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
  state.draft = state.guideDone ? null : freshDraft(PERIODS[state.guideStep].id);
  saveState();
  renderAll();
}

/* ---------------- actions ---------------- */

function startEdit(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  ui.error = '';
  ui.popupId = null;
  if (!state.guideDone) state.guideStep = PERIOD_INDEX[ev.period];
  state.draft = draftFromEvent(ev);
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
  state.draft = state.guideDone ? null : freshDraft(PERIODS[state.guideStep].id);
  ui.error = '';
  saveState();
  renderAll();
  toast('削除しました');
}

function cancelForm() {
  ui.error = '';
  state.draft = state.guideDone ? null : freshDraft(PERIODS[state.guideStep].id);
  saveState();
  renderAll();
}

function guideMove(delta) {
  ui.error = '';
  const next = state.guideStep + delta;
  if (next >= PERIODS.length) {
    state.guideDone = true;
    state.draft = null;
    ui.justFinished = true;
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  state.guideStep = Math.max(0, next);
  state.draft = freshDraft(PERIODS[state.guideStep].id);
  saveState();
  renderAll();
}

function openAdd() {
  ui.error = '';
  ui.justFinished = false;
  const lastPeriod = state.events.length ? state.events[state.events.length - 1].period : PERIODS[PERIODS.length - 1].id;
  state.draft = freshDraft(lastPeriod);
  saveState();
  renderAll();
  const t = $('#f-title');
  if (t) t.focus({ preventScroll: true });
}

function restartGuide() {
  state.guideDone = false;
  state.guideStep = 0;
  state.draft = freshDraft(PERIODS[0].id);
  saveState();
  renderAll();
}

function clearAll() {
  if (!confirm('すべての出来事を消去します。元に戻せません。\n（残したい場合は先に「データを書き出す」で保存してください）')) return;
  state = defaultState();
  state.introSeen = true;
  ui.popupId = null;
  saveState();
  renderAll();
  toast('すべてのデータを消去しました');
}

function setDraftPeriod(periodId) {
  if (!state.draft) return;
  state.draft.period = periodId;
  saveState();
  document.querySelectorAll('.period-choice').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === periodId)));
  const age = $('#f-age');
  if (age) age.placeholder = String(PERIODS[PERIOD_INDEX[periodId]].from);
  renderChart();
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
    version: 1,
    exportedAt: new Date().toISOString(),
    events: state.events,
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
    state.guideDone = true;
    state.introSeen = true;
    state.draft = null;
    ui.popupId = null;
    ui.lastAddedId = null;
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
  const H = 630;
  const { svg } = buildChartSvg({ width: W, height: H, events: state.events, forExport: true, showLabels: true });
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
  const periodBtn = e.target.closest('.period-choice');
  if (periodBtn) { setDraftPeriod(periodBtn.dataset.period); return; }

  const hit = e.target.closest('#chart .hit');
  if (hit) {
    ui.popupId = ui.popupId === hit.dataset.id ? null : hit.dataset.id;
    renderPopup();
    return;
  }

  const actEl = e.target.closest('[data-act]');
  if (actEl) {
    const act = actEl.dataset.act;
    if (act === 'edit') startEdit(actEl.dataset.id);
    else if (act === 'delete') deleteEditing();
    else if (act === 'cancel') cancelForm();
    else if (act === 'guide-next') guideMove(1);
    else if (act === 'guide-back') guideMove(-1);
    else if (act === 'add') openAdd();
    else if (act === 'restart-guide') restartGuide();
    else if (act === 'clear-all') clearAll();
    else if (act === 'popup-close') { ui.popupId = null; renderPopup(); }
    else if (act === 'popup-edit') startEdit(ui.popupId);
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
