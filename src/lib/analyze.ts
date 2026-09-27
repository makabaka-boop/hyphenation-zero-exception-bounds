import { buildDictionary, BuildInput, validateWord } from './dictionary';
import { PatternTrie } from './trie';
import {
  Dictionary,
  GapResult,
  MAX_WORDS,
  WordResult
} from './types';

/** 按断点把词拼成 "hel-lo" 形式 */
export function hyphenate(word: string, breaks: number[]): string {
  const sorted = [...breaks].sort((a, b) => a - b);
  let out = '';
  let prev = 0;
  for (const b of sorted) {
    out += `${word.slice(prev, b)}-`;
    prev = b;
  }
  return out + word.slice(prev);
}

/**
 * 判定一个词内间隙是否可断，并给出人类可读的原因。
 * @param leftChars  断点左侧字母数（断点位置，1..L-1）
 * @param rightChars 断点右侧字母数
 */
function describeGap(
  score: number,
  contributors: string[],
  leftChars: number,
  rightChars: number,
  dict: Dictionary
): { allowed: boolean; reason: string } {
  if (score === 0) {
    return { allowed: false, reason: '无命中模式：间隙分值 0，不可断' };
  }
  if (score % 2 === 0) {
    return {
      allowed: false,
      reason: `偶数分值 ${score}（来源 ${contributors.join('、')}）：偶数显式禁止断开`
    };
  }
  // 奇数分值，继续检查左右最少保留字母数
  if (leftChars < dict.leftMin) {
    return {
      allowed: false,
      reason: `奇数分值 ${score} 本可断（来源 ${contributors.join('、')}），但左侧仅 ${leftChars} 个字母，少于左最少保留 ${dict.leftMin} 个`
    };
  }
  if (rightChars < dict.rightMin) {
    return {
      allowed: false,
      reason: `奇数分值 ${score} 本可断（来源 ${contributors.join('、')}），但右侧仅 ${rightChars} 个字母，少于右最少保留 ${dict.rightMin} 个`
    };
  }
  return {
    allowed: true,
    reason: `奇数分值 ${score}（来源 ${contributors.join('、')}），且满足左 ≥ ${dict.leftMin}、右 ≥ ${dict.rightMin}，可断`
  };
}

/** 对单个词执行完整分析（调用前应已通过 validateWord 与词典构建） */
export function analyzeWord(word: string, dict: Dictionary, trie: PatternTrie): WordResult {
  const padded = `.${word}.`;
  const match = trie.match(padded);
  const exception = dict.exceptions.get(word) ?? null;
  const exceptionBreaks = new Set(exception?.breaks ?? []);
  const L = word.length;

  const gaps: GapResult[] = [];
  const breaks: number[] = [];

  for (let gi = 0; gi < padded.length + 1; gi += 1) {
    const raw = match.gaps[gi];
    let breakPosition: number | null = null;
    let allowed = false;
    let fromException = false;
    let reason: string;

    if (gi === 0 || gi === padded.length) {
      // 加边界符词的外侧间隙：永远不允许断
      reason =
        raw.score === 0
          ? '边界外侧间隙：无命中，不可断'
          : `边界外侧间隙：虽有模式 ${raw.contributors.join('、')} 给出分值 ${raw.score}，但词首/词尾外侧不可断`;
    } else if (gi === 1 || gi === padded.length - 1) {
      // 紧贴边界符的间隙 = 词的最首/最尾间隙
      breakPosition = gi - 1; // 0 或 L
      if (exception) {
        // 例外的显式断点只可能在 1..L-1，因此这里不会命中
        reason = `例外词 "${exception.source}"：该间隙不在其显式断点中，不可断`;
      } else if (raw.score === 0) {
        reason = '词首/词尾间隙：分值 0，不可断';
      } else {
        reason = `词首/词尾间隙：模式 ${raw.contributors.join('、')} 给出分值 ${raw.score}，但不能在第 0 / 第 ${L} 个字符处断开（无字母可保留）`;
      }
    } else {
      // 词内间隙，breakPosition ∈ 1..L-1
      breakPosition = gi - 1;
      const bp = breakPosition;
      const leftChars = bp;
      const rightChars = L - bp;

      if (exception) {
        const marked = exceptionBreaks.has(bp);
        if (marked && leftChars < dict.leftMin) {
          // 例外断点覆盖模式分值，但不能越过左/右最少保留字母数
          reason = `例外词 "${exception.source}" 在此标注了断点（模式分值为 ${raw.score}），但左侧仅 ${leftChars} 个字母，少于左最少保留 ${dict.leftMin} 个，断点不生效，不可断`;
        } else if (marked && rightChars < dict.rightMin) {
          reason = `例外词 "${exception.source}" 在此标注了断点（模式分值为 ${raw.score}），但右侧仅 ${rightChars} 个字母，少于右最少保留 ${dict.rightMin} 个，断点不生效，不可断`;
        } else if (marked) {
          allowed = true;
          fromException = true;
          reason = `例外词 "${exception.source}" 的显式断点，覆盖模式结果（模式分值为 ${raw.score}），可断`;
        } else {
          const patternWouldAllow = raw.score % 2 === 1 && leftChars >= dict.leftMin && rightChars >= dict.rightMin;
          const patternVerdict =
            raw.score === 0
              ? '模式分值为 0，本来也不可断'
              : patternWouldAllow
                ? `模式分值为奇数 ${raw.score} 本可断，但被例外压制`
                : `模式分值为 ${raw.score}（偶数或受左右限制，本来就不可断），例外同样未标注`;
          reason = `例外词 "${exception.source}" 未在此标注断点，覆盖模式结果：${patternVerdict}，不可断`;
        }
      } else {
        const verdict = describeGap(raw.score, raw.contributors, leftChars, rightChars, dict);
        allowed = verdict.allowed;
        reason = verdict.reason;
      }
    }

    if (allowed && breakPosition !== null) breaks.push(breakPosition);
    gaps.push({
      gap: gi,
      breakPosition,
      score: raw.score,
      contributors: raw.contributors,
      allowed,
      fromException,
      reason
    });
  }

  breaks.sort((a, b) => a - b);
  return { word, padded, gaps, breaks, hyphenated: hyphenate(word, breaks), exception };
}

/** 批量分析：words 数量不得超过 2000 */
export function analyzeWords(words: string[], dict: Dictionary): WordResult[] {
  if (words.length > MAX_WORDS) {
    throw new Error(`一次最多分析 ${MAX_WORDS} 个词，当前 ${words.length} 个`);
  }
  const trie = new PatternTrie(dict.patterns);
  return words.map((w) => {
    validateWord(w);
    return analyzeWord(w, dict, trie);
  });
}

/** 端到端便捷入口：解析词典 → 校验词 → 逐词分析 */
export function analyzeAll(input: BuildInput & { words: string[] }): {
  dictionary: Dictionary;
  results: WordResult[];
} {
  const dictionary = buildDictionary(input);
  const results = analyzeWords(input.words, dictionary);
  return { dictionary, results };
}
