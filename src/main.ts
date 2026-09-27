import './styles.css';
import { analyzeAll } from './lib/analyze';
import { BuildInput } from './lib/dictionary';
import { exportJson } from './lib/export';
import { Dictionary, GapResult, WordResult } from './lib/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const patternsEl = $<HTMLTextAreaElement>('patterns');
const exceptionsEl = $<HTMLTextAreaElement>('exceptions');
const wordsEl = $<HTMLTextAreaElement>('words');
const leftMinEl = $<HTMLInputElement>('leftMin');
const rightMinEl = $<HTMLInputElement>('rightMin');
const errorEl = $<HTMLDivElement>('error');
const resultsEl = $<HTMLDivElement>('results');
const exportPreviewEl = $<HTMLPreElement>('exportPreview');
const dictMetaEl = $<HTMLDivElement>('dictMeta');

/** 当前页面状态：渲染、高亮、导出全部取自这同一份 results */
interface State {
  dictionary: Dictionary | null;
  results: WordResult[];
}
const state: State = { dictionary: null, results: [] };

const DEMO = {
  patterns: [
    // 在 ".hello." 的 gap3（he|llo，断点 2）形成 1/3/5 同间隙覆盖，4 在竞争中被 5 压过
    '.he1l',
    '.he3l',
    '.he4l',
    '.he5l',
    'hel3l',
    'll4o',
    'lo1',
    '1lo',
    '.as',
    'so2c',
    'ci1a',
    'a1tion',
    'hy3phen',
    '5te',
    '.te5st'
  ].join('\n'),
  exceptions: ['as-so-ciate', 'hello'].join('\n'),
  words: ['hello', 'associate', 'hyphenation', 'test', 'lo', 'a'].join('\n'),
  leftMin: 2,
  rightMin: 2
};

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

function readInput(): BuildInput & { words: string[] } {
  return {
    patternText: patternsEl.value,
    exceptionText: exceptionsEl.value,
    leftMin: Number(leftMinEl.value),
    rightMin: Number(rightMinEl.value),
    words: splitLines(wordsEl.value)
  };
}

/** 重新计算，并让渲染/高亮/导出共用同一份结果 */
function recompute(): void {
  try {
    const input = readInput();
    const { dictionary, results } = analyzeAll(input);
    state.dictionary = dictionary;
    state.results = results;
    errorEl.hidden = true;
    errorEl.textContent = '';
    dictMetaEl.textContent =
      `已加载 ${dictionary.patterns.length} 条模式（去重后）、` +
      `${dictionary.exceptions.size} 条例外；左最少 ${dictionary.leftMin}，右最少 ${dictionary.rightMin}。`;
    render(results);
    refreshExport();
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

function chipClass(g: GapResult): string {
  if (g.breakPosition === null) return 'boundary';
  if (g.fromException && g.allowed) return 'exception';
  if (g.allowed) return 'allowed';
  return 'denied';
}

function verdictPill(g: GapResult): { cls: string; text: string } {
  if (g.breakPosition === null) return { cls: 'bd', text: '边界' };
  if (g.fromException && g.allowed) return { cls: 'ex', text: '例外断点' };
  if (g.fromException) return { cls: 'no', text: '例外受左右限制' };
  if (g.allowed) return { cls: 'ok', text: '可断' };
  return { cls: 'no', text: '排除' };
}

function renderGapStrip(card: HTMLElement, result: WordResult): void {
  const strip = document.createElement('div');
  strip.className = 'gap-row';
  const padded = result.padded;

  // gap 0 → 字符 0 → gap 1 → ... → 字符 n-1 → gap n
  for (let gi = 0; gi < result.gaps.length; gi += 1) {
    const gap = result.gaps[gi];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `gap-chip ${chipClass(gap)}`;
    chip.dataset.gap = String(gi);
    chip.title = gap.reason;
    chip.textContent = `[${gap.score === 0 ? '·' : gap.score}]`;
    strip.appendChild(chip);

    if (gi < padded.length) {
      const letter = document.createElement('span');
      letter.style.fontFamily = 'ui-monospace, monospace';
      letter.style.padding = '0 2px';
      letter.textContent = padded[gi];
      strip.appendChild(letter);
    }
  }

  chipRowClickDelegation(strip, card);
  card.appendChild(strip);
}

function chipRowClickDelegation(strip: HTMLElement, card: HTMLElement): void {
  strip.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const chip = target.closest('.gap-chip') as HTMLElement | null;
    if (!chip) return;
    const gi = chip.dataset.gap!;
    card.querySelectorAll('.gap-chip.selected').forEach((el) => el.classList.remove('selected'));
    card.querySelectorAll('tr.selected').forEach((el) => el.classList.remove('selected'));
    chip.classList.add('selected');
    const row = card.querySelector(`tr[data-gap="${gi}"]`);
    row?.classList.add('selected');
  });
}

function renderGapTable(card: HTMLElement, result: WordResult): void {
  const table = document.createElement('table');
  table.className = 'gap-table';
  table.innerHTML =
    '<thead><tr><th>间隙</th><th>断点位置</th><th>最终分值</th><th>贡献该分值的模式</th><th>结果</th><th>排除/放行原因</th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (const g of result.gaps) {
    const tr = document.createElement('tr');
    tr.dataset.gap = String(g.gap);
    const rowKind =
      g.breakPosition === null
        ? 'row-boundary'
        : g.fromException && g.allowed
          ? 'row-exception'
          : g.allowed
            ? 'row-allowed'
            : 'row-denied';
    tr.classList.add(rowKind);

    const pill = verdictPill(g);
    const positionText = g.breakPosition === null
      ? '—（边界外侧）'
      : g.breakPosition === 0 || g.breakPosition === result.word.length
        ? `${g.breakPosition}（词端，不可断）`
        : `${g.breakPosition}（"${result.word.slice(0, g.breakPosition)}|${result.word.slice(g.breakPosition)}"）`;

    tr.innerHTML =
      `<td>${g.gap}</td>` +
      `<td>${positionText}</td>` +
      `<td class="score">${g.score}</td>` +
      `<td class="contribs">${g.contributors.length ? g.contributors.map((c) => escapeHtml(c)).join('<br>') : '—'}</td>` +
      `<td><span class="pill ${pill.cls}">${pill.text}</span></td>` +
      `<td>${escapeHtml(g.reason)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
}

function render(results: WordResult[]): void {
  resultsEl.textContent = '';
  if (results.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = 'var(--muted)';
    empty.textContent = '在左侧输入模式与词后，结果会在此逐间隙展示。';
    resultsEl.appendChild(empty);
    return;
  }

  for (const result of results) {
    const card = document.createElement('div');
    card.className = 'word-card';

    const head = document.createElement('div');
    head.className = 'word-head';
    const word = document.createElement('span');
    word.className = 'word-text';
    word.textContent = result.word;
    const hyph = document.createElement('span');
    hyph.className = `word-hyphen${result.breaks.length === 0 ? ' no-break' : ''}`;
    hyph.textContent = result.breaks.length ? result.hyphenated : '（无断点）';
    head.append(word, hyph);
    if (result.exception) {
      const tag = document.createElement('span');
      tag.className = 'ex-tag';
      tag.textContent = `例外：${result.exception.source}`;
      head.appendChild(tag);
    }
    card.appendChild(head);

    renderGapStrip(card, result);
    renderGapTable(card, result);
    resultsEl.appendChild(card);
  }
}

/** 导出直接序列化 state.results —— 与上面的高亮、表格同源 */
function refreshExport(): string {
  const json =
    state.dictionary === null
      ? ''
      : exportJson(state.results, state.dictionary);
  exportPreviewEl.textContent = json;
  return json;
}

function downloadExport(): void {
  if (state.dictionary === null) {
    errorEl.hidden = false;
    errorEl.textContent = '当前没有可导出的计算结果，请先修正输入并重新计算。';
    return;
  }
  const json = refreshExport();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hyphen-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let timer: number | undefined;
const scheduleRecompute = (): void => {
  window.clearTimeout(timer);
  timer = window.setTimeout(recompute, 250);
};

for (const el of [patternsEl, exceptionsEl, wordsEl, leftMinEl, rightMinEl]) {
  el.addEventListener('input', scheduleRecompute);
}
$('recompute').addEventListener('click', recompute);
$('export').addEventListener('click', downloadExport);
$('loadDemo').addEventListener('click', () => {
  loadDemo();
  recompute();
});

function loadDemo(): void {
  patternsEl.value = DEMO.patterns;
  exceptionsEl.value = DEMO.exceptions;
  wordsEl.value = DEMO.words;
  leftMinEl.value = String(DEMO.leftMin);
  rightMinEl.value = String(DEMO.rightMin);
}

// 首次打开直接展示一份可交互的示例
loadDemo();
recompute();
