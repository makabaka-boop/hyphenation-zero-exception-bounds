import { Dictionary, WordResult } from './types';

export interface ExportGap {
  gap: number;
  breakPosition: number | null;
  score: number;
  contributors: string[];
  allowed: boolean;
  fromException: boolean;
  reason: string;
}

export interface ExportWord {
  word: string;
  hyphenated: string;
  breaks: number[];
  exception: string | null;
  gaps: ExportGap[];
}

export interface ExportPayload {
  generatedAt: string;
  rules: {
    leftMin: number;
    rightMin: number;
    patternCount: number;
    exceptionCount: number;
  };
  words: ExportWord[];
}

/**
 * 由「页面上正在高亮展示的同一份 WordResult」构建导出 JSON。
 * 不做任何二次计算，保证导出内容与高亮逐间隙一致。
 */
export function buildExport(results: WordResult[], dictionary: Dictionary): ExportPayload {
  return {
    generatedAt: new Date().toISOString(),
    rules: {
      leftMin: dictionary.leftMin,
      rightMin: dictionary.rightMin,
      patternCount: dictionary.patterns.length,
      exceptionCount: dictionary.exceptions.size
    },
    words: results.map((r) => ({
      word: r.word,
      hyphenated: r.hyphenated,
      breaks: r.breaks,
      exception: r.exception?.source ?? null,
      gaps: r.gaps.map((g) => ({
        gap: g.gap,
        breakPosition: g.breakPosition,
        score: g.score,
        contributors: g.contributors,
        allowed: g.allowed,
        fromException: g.fromException,
        reason: g.reason
      }))
    }))
  };
}

export function exportJson(results: WordResult[], dictionary: Dictionary): string {
  return JSON.stringify(buildExport(results, dictionary), null, 2);
}
