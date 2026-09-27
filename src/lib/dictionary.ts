import {
  Dictionary,
  Exception,
  MAX_EXCEPTIONS,
  MAX_PATTERNS,
  MAX_WORD_LENGTH,
  Pattern
} from './types';

const isLowerAscii = (c: string): boolean => c >= 'a' && c <= 'z';

/**
 * 解析一条 Knuth-Liang 模式。
 * 语法：小写 ASCII 字母连续排列，整体（含数字）首尾可各带至多一个 '.'；
 * 每个字符间隙至多一位 0~9 数字。
 *
 * 合法示例： "he2l3o"、".hel"、"lo."、".he2l"、"a1"、"5abc"、"abc8"、"." 非法（无字母）
 */
export function parsePattern(text: string): Pattern {
  const source = text;
  const stripped = text.replace(/[0-9]/g, '');

  // 去掉数字后必须形如：可选 '.' + 一个以上小写字母 + 可选 '.'
  const structural = /^\.?[a-z]+\.?$/;
  if (!structural.test(stripped)) {
    throw new Error(
      `模式 "${text}" 非法：字母必须是连续的小写 ASCII，且边界符 '.' 只能出现在最前或最后`
    );
  }
  const lettersPart = stripped.replace(/^\./, '').replace(/\.$/, '');
  if (lettersPart.length > MAX_WORD_LENGTH + 1) {
    throw new Error(`模式 "${text}" 过长：字母部分不得超过 ${MAX_WORD_LENGTH + 1} 个`);
  }

  const digits = new Array<number>(stripped.length + 1).fill(0);
  // 间隙是否已被数字占用：不能用 digits[gapIndex] !== 0 判断，
  // 否则先写入的 0 会被当成「未占用」，放过 a01b / a00b 这类重复标注
  const occupied = new Array<boolean>(stripped.length + 1).fill(false);
  let gapIndex = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      if (occupied[gapIndex]) {
        throw new Error(`模式 "${text}" 非法：同一个字母间隙出现了多个数字`);
      }
      occupied[gapIndex] = true;
      digits[gapIndex] = Number(ch);
    } else {
      gapIndex += 1;
    }
  }

  return { symbols: stripped, source, digits };
}

/**
 * 解析例外词。形式：小写词，用 '-' 标注显式断点，如 "as-so-ciate"。
 * 允许没有 '-'（仅登记为无断点例外，用于压制模式结果）。
 */
export function parseException(text: string): Exception {
  const source = text;
  const parts = text.split('-');
  if (parts.some((p) => p.length === 0)) {
    throw new Error(`例外词 "${text}" 非法：'-' 不能位于首尾或连续出现`);
  }
  const word = parts.join('');
  if (word.length === 0 || !/^[a-z]+$/.test(word)) {
    throw new Error(`例外词 "${text}" 非法：必须只包含小写 ASCII 字母`);
  }
  if (word.length > MAX_WORD_LENGTH) {
    throw new Error(`例外词 "${text}" 过长：不得超过 ${MAX_WORD_LENGTH} 个字母`);
  }
  const breaks: number[] = [];
  let pos = 0;
  for (let i = 0; i < parts.length - 1; i += 1) {
    pos += parts[i].length;
    breaks.push(pos);
  }
  return { word, source, breaks };
}

/** 校验一个待断词 */
export function validateWord(word: string): void {
  if (word.length === 0) {
    throw new Error('存在空行：请删除多余的空行或空输入');
  }
  if (word.length > MAX_WORD_LENGTH) {
    throw new Error(`词 "${word}" 长度 ${word.length} 超过上限 ${MAX_WORD_LENGTH}`);
  }
  for (const ch of word) {
    if (!isLowerAscii(ch)) {
      throw new Error(`词 "${word}" 非法：只能包含小写 ASCII 字母`);
    }
  }
}

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

export interface BuildInput {
  patternText: string;
  exceptionText: string;
  leftMin: number;
  rightMin: number;
}

/**
 * 解析并构建词典。数量约束：模式 0~1000 条、例外 0~1000 条。
 * 完全相同的模式行去重；同一个词出现多条例外视为错误（编辑者意图不明确）。
 */
export function buildDictionary(input: BuildInput): Dictionary {
  const patternLines = splitLines(input.patternText);
  const exceptionLines = splitLines(input.exceptionText);

  if (patternLines.length > MAX_PATTERNS) {
    throw new Error(`模式最多 ${MAX_PATTERNS} 条，当前 ${patternLines.length} 条`);
  }
  if (exceptionLines.length > MAX_EXCEPTIONS) {
    throw new Error(`例外词最多 ${MAX_EXCEPTIONS} 条，当前 ${exceptionLines.length} 条`);
  }
  if (!Number.isInteger(input.leftMin) || input.leftMin < 0 || input.leftMin > MAX_WORD_LENGTH) {
    throw new Error(`左最少保留字母数非法：需要 0~${MAX_WORD_LENGTH} 的整数`);
  }
  if (!Number.isInteger(input.rightMin) || input.rightMin < 0 || input.rightMin > MAX_WORD_LENGTH) {
    throw new Error(`右最少保留字母数非法：需要 0~${MAX_WORD_LENGTH} 的整数`);
  }

  const seenPatterns = new Set<string>();
  const patterns: Pattern[] = [];
  for (const line of patternLines) {
    if (seenPatterns.has(line)) continue; // 完全重复的模式安全去重
    seenPatterns.add(line);
    patterns.push(parsePattern(line));
  }

  const exceptions = new Map<string, Exception>();
  for (const line of exceptionLines) {
    const ex = parseException(line);
    const existing = exceptions.get(ex.word);
    if (existing && existing.source !== ex.source) {
      throw new Error(`例外词 "${ex.word}" 出现了互相冲突的写法："${existing.source}" 与 "${ex.source}"`);
    }
    exceptions.set(ex.word, ex);
  }

  return { patterns, exceptions, leftMin: input.leftMin, rightMin: input.rightMin };
}
