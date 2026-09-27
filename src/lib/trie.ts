import { Pattern } from './types';

/**
 * 模式 trie：按 symbols 字符（含边界符 '.'）建路径，
 * 节点上记录在该节点结束的模式。
 */
interface TrieNode {
  children: Map<string, TrieNode>;
  /** 在该节点结束的模式（letters 相同、数字不同的多条模式可共存） */
  patterns: Pattern[];
}

export interface RawGapScore {
  /** 该间隙的最大分值 */
  score: number;
  /** 贡献该最大分值的模式来源（排序、去重） */
  contributors: string[];
}

export interface TrieMatch {
  /** 长度为 padded.length + 1，逐间隙给出 trie 命中结果 */
  gaps: RawGapScore[];
}

function createNode(): TrieNode {
  return { children: new Map(), patterns: [] };
}

export class PatternTrie {
  private readonly root = createNode();

  constructor(patterns: Pattern[]) {
    for (const p of patterns) {
      let node = this.root;
      for (const ch of p.symbols) {
        let next = node.children.get(ch);
        if (!next) {
          next = createNode();
          node.children.set(ch, next);
        }
        node = next;
      }
      node.patterns.push(p);
    }
  }

  /**
   * 在加了边界符的词上运行 trie：
   * 以每个字符为起点沿 trie 下行，遇到结束模式就把它的数字写入对应间隙；
   * 同一间隙只保留所有命中权重的最大值，并记录贡献来源。
   */
  match(padded: string): TrieMatch {
    const gaps: RawGapScore[] = Array.from({ length: padded.length + 1 }, () => ({
      score: 0,
      contributors: []
    }));

    const contribute = (pattern: Pattern, start: number): void => {
      for (let d = 0; d < pattern.digits.length; d += 1) {
        const value = pattern.digits[d];
        if (value === 0) continue; // 无数字（等价于 0）不参与竞争
        const gi = start + d;
        const target = gaps[gi];
        if (value > target.score) {
          target.score = value;
          target.contributors = [pattern.source];
        } else if (value === target.score) {
          target.contributors.push(pattern.source);
        }
      }
    };

    for (let start = 0; start < padded.length; start += 1) {
      let node = this.root;
      for (let k = start; k < padded.length; k += 1) {
        const next = node.children.get(padded[k]);
        if (!next) break;
        node = next;
        for (const p of node.patterns) {
          contribute(p, start);
        }
      }
    }

    for (const g of gaps) {
      g.contributors = [...new Set(g.contributors)].sort();
    }
    return { gaps };
  }
}
