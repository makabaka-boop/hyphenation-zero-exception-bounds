/**
 * 断字词典核心类型。
 * 规则采用 Knuth-Liang 风格：模式在「加了边界符的词」上匹配，
 * 每个字符间隙取所有命中模式数字的最大值；奇数允许断开，偶数/0 禁止。
 */

/** 模式数量上限 1000，用户词数量上限 2000，词长上限 40 */
export const MAX_PATTERNS = 1000;
export const MAX_EXCEPTIONS = 1000;
export const MAX_WORDS = 2000;
export const MAX_WORD_LENGTH = 40;

/** 一条解析后的断字模式 */
export interface Pattern {
  /** 去数字后的符号串（小写字母，首尾可带 '.' 边界符），如 ".he2l" -> ".hel" */
  symbols: string;
  /** 原始文本，便于在 UI/导出中展示来源 */
  source: string;
  /**
   * 与 symbols 对齐的间隙分值数组，长度 symbols.length + 1。
   * digits[k] 表示 symbols 第 k 个间隙的数字（0 表示无数字）。
   */
  digits: number[];
}

/** 一条例外词：显式断点用 '-' 标注，如 "as-so-ciate" */
export interface Exception {
  /** 去掉 '-' 的小写词，作为查表键 */
  word: string;
  /** 原始写法（含 '-'） */
  source: string;
  /** 显式断点集合：断点 i 表示 word 的第 i 个字符之后（i 从 1 开始） */
  breaks: number[];
}

export interface Dictionary {
  patterns: Pattern[];
  exceptions: Map<string, Exception>;
  leftMin: number;
  rightMin: number;
}

/** 单个字符间隙的最终分析结果（含边界间隙） */
export interface GapResult {
  /**
   * 间隙索引，针对加边界符后的词 `.word.`：
   *   0、L+2 为外侧边界间隙；1..L+1 对应词内间隙，
   *   其中 gap k (1..L+1) 的断点位置为 k-1（词的第 k-1 个字符之后）。
   */
  gap: number;
  /** 对应的词内断点位置；首/尾外侧边界间隙为 null */
  breakPosition: number | null;
  /** 模式 trie 在该间隙给出的最大分值（0 表示无任何命中） */
  score: number;
  /**
   * 贡献该最大分值的模式来源（去重、字典序排序）。
   * 分值为 0（无正分命中）时为空数组。
   */
  contributors: string[];
  /** 该间隙是否最终可断（已应用左右最少保留字母数与例外覆盖） */
  allowed: boolean;
  /** 是否为例外词的显式断点 */
  fromException: boolean;
  /** 被排除/放行的原因，供编辑者逐间隙核对 */
  reason: string;
}

/** 单个词的完整分析结果 */
export interface WordResult {
  word: string;
  /** 加边界符后的词，形如 ".word." */
  padded: string;
  gaps: GapResult[];
  /** 最终允许的词内断点（字符之后的位置，1..L-1） */
  breaks: number[];
  /** 按断点拼出的结果，如 "hel-lo"；无断点时等于原词 */
  hyphenated: string;
  exception: Exception | null;
}
