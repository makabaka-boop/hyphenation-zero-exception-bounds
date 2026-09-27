import { describe, expect, it } from 'vitest';
import { buildDictionary, parseException, parsePattern } from '../src/lib/dictionary';
import { analyzeWord, analyzeWords, hyphenate } from '../src/lib/analyze';
import { PatternTrie } from '../src/lib/trie';
import { buildExport } from '../src/lib/export';
import { GapResult, Pattern } from '../src/lib/types';

/**
 * 朴素逐模式扫描预言机：
 * 不使用 trie，对每条模式在 padded 词的每个起点做 startsWith 式逐字符比较，
 * 命中后把数字逐间隙写入。实现刻意与 src/lib 分开写，作为对拍基线。
 */
function naiveScore(patterns: Pattern[], padded: string): { score: number; who: string[] }[] {
  const out = Array.from({ length: padded.length + 1 }, () => ({ score: 0, who: [] as string[] }));

  for (const p of patterns) {
    for (let start = 0; start <= padded.length; start += 1) {
      // 逐字符比较 symbols 是否在 start 处出现
      let ok = start + p.symbols.length <= padded.length + 1 && start < padded.length;
      for (let k = 0; ok && k < p.symbols.length; k += 1) {
        if (padded[start + k] !== p.symbols[k]) ok = false;
      }
      if (!ok) continue;
      for (let d = 0; d < p.digits.length; d += 1) {
        const v = p.digits[d];
        if (v === null) continue; // 没有写数字的间隙不参与竞争
        const gi = start + d;
        if (v > out[gi].score) {
          out[gi].score = v;
          out[gi].who = [p.source];
        } else if (v === out[gi].score) {
          out[gi].who.push(p.source); // 显式 0 与初始 0 相等时也要登记来源
        }
      }
    }
  }
  for (const g of out) g.who = [...new Set(g.who)].sort();
  return out;
}

function analyzeWithOracle(
  words: string[],
  opts: { patternText: string; exceptionText?: string; leftMin?: number; rightMin?: number }
) {
  const dict = buildDictionary({
    patternText: opts.patternText,
    exceptionText: opts.exceptionText ?? '',
    leftMin: opts.leftMin ?? 2,
    rightMin: opts.rightMin ?? 2
  });
  const trie = new PatternTrie(dict.patterns);
  const results = words.map((w) => analyzeWord(w, dict, trie));
  const oracleByWord = new Map(words.map((w) => [w, naiveScore(dict.patterns, `.${w}.`)]));
  return { dict, results, oracleByWord };
}

/** 断言 trie 的逐间隙分值与来源完全等于朴素扫描 */
function expectScoresMatchOracle(results: ReturnType<typeof analyzeWords>, oracle: Map<string, { score: number; who: string[] }[]>) {
  for (const r of results) {
    const naive = oracle.get(r.word)!;
    expect(r.gaps).toHaveLength(naive.length);
    for (let i = 0; i < naive.length; i += 1) {
      expect(r.gaps[i].score, `${r.word} gap ${i} score`).toBe(naive[i].score);
      expect(r.gaps[i].contributors, `${r.word} gap ${i} contributors`).toEqual(naive[i].who);
    }
  }
}

/** 用预言机分值独立推导一遍期望断点（不含例外） */
function expectedBreaksFromOracle(
  word: string,
  oracle: { score: number; who: string[] }[],
  leftMin: number,
  rightMin: number
): number[] {
  const L = word.length;
  const breaks: number[] = [];
  // padded gap k (1..L+1) ↔ 词断点 k-1；词内断点为 1..L-1
  for (let bp = 1; bp < L; bp += 1) {
    const s = oracle[bp + 1].score;
    if (s % 2 === 1 && bp >= leftMin && L - bp >= rightMin) breaks.push(bp);
  }
  return breaks.sort((a, b) => a - b);
}

describe('parsePattern', () => {
  it('解析普通、带边界符与首尾数字的模式', () => {
    expect(parsePattern('he2l3o')).toMatchObject({ symbols: 'helo' });
    // 数字标记它在串中占据的物理间隙：2 在 e|l（槽位 2），3 在 l|o（槽位 3）
    expect(parsePattern('he2l3o').digits).toEqual([null, null, 2, 3, null]);
    expect(parsePattern('.hel').digits).toEqual([null, null, null, null, null]); // symbols ".hel" 长度 4（含边界点）→ 5 个间隙
    expect(parsePattern('lo.').symbols).toBe('lo.');
    expect(parsePattern('5abc').digits).toEqual([5, null, null, null]); // 前导数字在首间隙
    expect(parsePattern('abc8').digits).toEqual([null, null, null, 8]); // 后导数字在尾间隙
    expect(parsePattern('.he2l').digits).toEqual([null, null, null, 2, null]); // 2 在 e|l（含点后槽位 3）
  });

  it('显式写出的 0 与「没写数字」区分开', () => {
    expect(parsePattern('a0').digits).toEqual([null, 0]); // 尾间隙显式 0
    expect(parsePattern('.0abc').digits).toEqual([null, 0, null, null, null]); // 边界点后、a 前显式 0
    expect(parsePattern('a0b').digits).toEqual([null, 0, null]);
  });

  it('拒绝非法模式', () => {
    for (const bad of [
      '.', '..', 'a.b', '.a.b', 'A1b', 'ab$', '12ab', 'a12b', '1.', '.1', '--',
      'a1b2c3 ',
      // 点号错位：去掉数字后曾被旧解析器漏过
      'a1.b', 'abc.0', 'a.1', '4.8b',
      // 同一间隙两位数字，含 0（旧解析器把 0 当空位，错误放行）
      'a00b', 'a01b', 'a10b', '00ab', 'ab00'
    ]) {
      expect(() => parsePattern(bad), `bad pattern: ${bad}`).toThrow();
    }
  });

  it('同间隙数字与边界点顺序合法的模式应被接受', () => {
    // 数字位于点号内侧的间隙：前导点后可跟数字，结尾数字后可跟点
    expect(() => parsePattern('.0abc')).not.toThrow();
    expect(() => parsePattern('abc0.')).not.toThrow();
    expect(() => parsePattern('.5ab3c.')).not.toThrow();
  });

  it('同一个间隙两位数字必须报错（含重复 0）', () => {
    expect(() => parsePattern('a12b')).toThrow(/多个数字/);
    expect(() => parsePattern('a00b')).toThrow(/多个数字/);
    expect(() => parsePattern('a01b')).toThrow(/多个数字/);
  });
});

describe('parseException', () => {
  it('解析显式断点', () => {
    expect(parseException('as-so-ciate')).toMatchObject({ word: 'associate', breaks: [2, 4] });
    expect(parseException('hello')).toMatchObject({ word: 'hello', breaks: [] });
  });
  it('拒绝首尾或连续连字符', () => {
    expect(() => parseException('-abc')).toThrow();
    expect(() => parseException('abc-')).toThrow();
    expect(() => parseException('a--b')).toThrow();
  });
});

describe('trie 与朴素逐模式扫描对拍', () => {
  it('单模式命中与数字定位', () => {
    const { results, oracleByWord } = analyzeWithOracle(['hello'], {
      patternText: '.he2l\nhel3l\nll4o'
    });
    expectScoresMatchOracle(results, oracleByWord);
  });

  it('重叠规则：同一间隙多条模式取最大权重', () => {
    // 三条等长模式都在 ".hello." 的 gap5（"hel|lo" 之间，断点 4）放置数字：
    // 数字在其后字母之前，".hell" 后接数字即落在 gap5
    //   .hell1o → 1、.hell3o → 3、.hell5o → 5，互相覆盖后 gap5 = 5
    // 偶数演示放别处：.hell4o 同位置是 4，与 5 竞争失败；另用 hel2lo 在 gap4 放偶数 2
    const { results, oracleByWord } = analyzeWithOracle(['hello'], {
      patternText: '.hell1o\n.hell3o\n.hell5o\n.hell4o\n.hel2lo'
    });
    const r = results[0];
    expectScoresMatchOracle(results, oracleByWord);
    const gap5 = r.gaps[5];
    expect(gap5.score).toBe(5);
    expect(gap5.contributors).toEqual(['.hell5o']);
    // gap4：偶数 2 显式禁止断开
    expect(r.gaps[4].score).toBe(2);
    expect(r.gaps[4].contributors).toEqual(['.hel2lo']);
    expect(r.gaps[4].allowed).toBe(false);
    expect(r.gaps[4].reason).toMatch(/偶数/);
  });

  it('同分并列：贡献来源全部保留并排序', () => {
    // ".abc." gap1（边界符后、a 前）：模式 .1abc 与 .1ab 都在此放 1（等长前缀）
    const { results } = analyzeWithOracle(['abc'], {
      patternText: '.1abc\n.1ab'
    });
    const r = results[0];
    const tied = r.gaps.find((g) => g.contributors.length >= 2);
    expect(tied).toBeDefined();
    expect(tied!.gap).toBe(1);
    expect(tied!.contributors).toEqual(['.1ab', '.1abc']);
  });

  it('边界模式只在词首/词尾命中（"." 必须对齐边界符）', () => {
    const { results: withDot, oracleByWord: o1 } = analyzeWithOracle(['hellolo'], {
      patternText: '.he3'
    });
    expectScoresMatchOracle(withDot, o1);
    // ".he3"：3 是 'e' 的后导数字（位于 e 后、l 前），命中词首 ".he" 时落在 padded gap3
    expect(withDot[0].gaps[3].score).toBe(3);
    expect(withDot[0].gaps.filter((g) => g.score === 3)).toHaveLength(1);
    const { results: withoutDot, oracleByWord: o2 } = analyzeWithOracle(['hellolo'], {
      patternText: 'he3'
    });
    expectScoresMatchOracle(withoutDot, o2);

    // 词尾模式 "lo1."：1 是 'o' 的后导数字，命中词尾 "lo." 时落在 padded gap8（断点 7，即词尾）
    const { results: loBoundary } = analyzeWithOracle(['hellolo'], {
      patternText: 'lo1.'
    });
    const scores = loBoundary[0].gaps.map((g) => g.score);
    expect(scores.filter((s) => s === 1)).toHaveLength(1);
    expect(loBoundary[0].gaps[8].score).toBe(1);
  });

  it('首尾数字：5abc / abc8 类模式定位正确', () => {
    const { results, oracleByWord } = analyzeWithOracle(['abc'], {
      patternText: '5abc\nabc8'
    });
    expectScoresMatchOracle(results, oracleByWord);
    const r = results[0];
    expect(r.gaps[1].score).toBe(5); // 5 在符号 a 前 → padded gap 1
    expect(r.gaps[4].score).toBe(8); // 8 在符号 c 后 → padded gap 4
  });

  it('左右最少保留字母数逐间隙排除，并给出原因', () => {
    // 数字在「其后字母之前」：a2bc 在断点1放2、ab3cd 在断点2放3，依此类推
    const everyGap = ['a1bc', 'ab1cd', 'abc1de', 'abcd1ef', 'abcde1f'].join('\n');
    const { results } = analyzeWithOracle(['abcdef'], {
      patternText: everyGap,
      leftMin: 2,
      rightMin: 2
    });
    const r = results[0];
    const byBp = new Map<number, GapResult>();
    for (const g of r.gaps) if (g.breakPosition !== null) byBp.set(g.breakPosition, g);

    expect(byBp.get(1)!.allowed).toBe(false);
    expect(byBp.get(1)!.reason).toMatch(/左最少/);
    expect(byBp.get(2)!.allowed).toBe(true);
    expect(byBp.get(4)!.allowed).toBe(true);
    expect(byBp.get(5)!.allowed).toBe(false);
    expect(byBp.get(5)!.reason).toMatch(/右最少/);
    expect(r.breaks).toEqual([2, 3, 4]);
    expect(r.hyphenated).toBe('ab-c-d-ef');
  });

  it('无任何命中 → 全部间隙 0、无断点', () => {
    const { results } = analyzeWithOracle(['xyz'], { patternText: '.he2l\nlo1.' });
    const r = results[0];
    expect(r.gaps.every((g) => g.score === 0 && !g.allowed)).toBe(true);
    expect(r.breaks).toEqual([]);
    expect(r.hyphenated).toBe('xyz');
  });

  it('无断点词：所有奇数命中都被左右限制挡住', () => {
    const { results } = analyzeWithOracle(['ab'], {
      patternText: 'a3b',
      leftMin: 2,
      rightMin: 2
    });
    expect(results[0].breaks).toEqual([]);
    expect(results[0].gaps[2].allowed).toBe(false);
  });

  it('显式 0 数字：分值仍为 0，但来源必须可见、解释必须提到它', () => {
    const { results, oracleByWord } = analyzeWithOracle(['abc'], {
      patternText: 'a0b\na0bc'
    });
    expectScoresMatchOracle(results, oracleByWord);
    const r = results[0];
    // a0b 与 a0bc 都在 a|b（padded gap2，断点 1）显式写 0
    const g = r.gaps[2];
    expect(g.score).toBe(0);
    expect(g.contributors).toEqual(['a0b', 'a0bc']);
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/显式写 0|无意见/);
  });

  it('显式 0 与正分竞争：正分胜出后 0 不再是贡献来源', () => {
    const { results, oracleByWord } = analyzeWithOracle(['abc'], {
      patternText: 'a0b\na3b'
    });
    expectScoresMatchOracle(results, oracleByWord);
    const g = results[0].gaps[2];
    expect(g.score).toBe(3);
    expect(g.contributors).toEqual(['a3b']);
  });

  it('词首/词尾词端间隙上的显式 0 也要给出可解释来源', () => {
    // "0abc"：0 在边界符 '.' 与首字母 a 之间 = padded gap1（断点 0，词首词端，不可断）
    const { results } = analyzeWithOracle(['abc'], {
      patternText: '0abc'
    });
    const head = results[0].gaps[1];
    expect(head.breakPosition).toBe(0);
    expect(head.score).toBe(0);
    expect(head.contributors).toEqual(['0abc']);
    expect(head.allowed).toBe(false);
    expect(head.reason).toMatch(/词首\/词尾/);
    // 边界外侧间隙（gap0）不可能被任何合法模式命中
    expect(results[0].gaps[0].contributors).toEqual([]);
  });
});

describe('例外词覆盖', () => {
  const patternText = '.he5l\nhel3l\nll4o'; // 模式会允许/禁止一些间隙

  it('显式断点覆盖偶数分值与奇偶结果，但仍受左右最少保留字母数限制', () => {
    const { results } = analyzeWithOracle(['hello'], {
      patternText,
      exceptionText: 'h-ell-o', // 断点 1（左仅 1，违反 leftMin=2）与断点 4（右仅 1，违反 rightMin=2）
      leftMin: 2,
      rightMin: 2
    });
    const r = results[0];
    // 两个越界断点都不得进入最终 breaks：导入/解释/预览/导出同源，无一放行
    expect(r.breaks).toEqual([]);
    expect(r.hyphenated).toBe('hello');
    const byBp = new Map(r.gaps.filter((g) => g.breakPosition !== null).map((g) => [g.breakPosition, g]));
    expect(byBp.get(1)!.fromException).toBe(true);
    expect(byBp.get(1)!.allowed).toBe(false);
    expect(byBp.get(1)!.reason).toMatch(/左最少|左 ≥|不满足/);
    expect(byBp.get(4)!.fromException).toBe(true);
    expect(byBp.get(4)!.allowed).toBe(false);
    expect(byBp.get(4)!.reason).toMatch(/右最少|右 ≥|不满足/);
  });

  it('满足左右限制的显式断点才覆盖模式结果', () => {
    // 'he-ll-o'：断点 2 左右均 ≥2 放行；断点 4 右侧只剩 1 个字母，违反 rightMin=2 被压下
    const { results } = analyzeWithOracle(['hello'], {
      patternText,
      exceptionText: 'he-ll-o',
      leftMin: 2,
      rightMin: 2
    });
    const r = results[0];
    expect(r.breaks).toEqual([2]);
    const byBp = new Map(r.gaps.filter((g) => g.breakPosition !== null).map((g) => [g.breakPosition, g]));
    expect(byBp.get(2)!.fromException).toBe(true);
    expect(byBp.get(2)!.allowed).toBe(true);
    expect(byBp.get(4)!.fromException).toBe(true);
    expect(byBp.get(4)!.allowed).toBe(false);
    expect(byBp.get(4)!.reason).toMatch(/右最少|右 ≥|不满足/);
    // 模式下 gap4（断点 3）是奇数 5 且左右满足，本应可断；例外没有标注 → 被压制
    expect(byBp.get(3)!.allowed).toBe(false);
    expect(byBp.get(3)!.reason).toMatch(/未在此标注断点/);
  });

  it('leftMin/rightMin 放宽到 0 时，近首尾例外断点才放行', () => {
    const { results } = analyzeWithOracle(['abcdef'], {
      patternText: '',
      exceptionText: 'a-bcde-f', // 断点 1、5
      leftMin: 1,
      rightMin: 1
    });
    expect(results[0].breaks).toEqual([1, 5]);
    expect(results[0].hyphenated).toBe('a-bcde-f');

    // 同一词典把限制调回 2：结果必须立即不再放行越界断点（判定不固化在导入阶段）
    const { results: blocked } = analyzeWithOracle(['abcdef'], {
      patternText: '',
      exceptionText: 'a-bcde-f',
      leftMin: 2,
      rightMin: 2
    });
    expect(blocked[0].breaks).toEqual([]);
  });

  it('无断点例外压制全部模式断点', () => {
    const { results } = analyzeWithOracle(['hello'], {
      patternText,
      exceptionText: 'hello'
    });
    expect(results[0].breaks).toEqual([]);
    expect(results[0].gaps.some((g) => g.fromException)).toBe(false);
    expect(results[0].gaps.find((g) => g.breakPosition === 3)!.reason).toMatch(/覆盖模式结果/);
  });

  it('冲突的例外写法报错', () => {
    expect(() =>
      buildDictionary({
        patternText: '',
        exceptionText: 'a-b\nab',
        leftMin: 2,
        rightMin: 2
      })
    ).toThrow(/冲突/);
  });
});

describe('批量分析与端到端', () => {
  it('空词典也能产出全 0 结果', () => {
    const results = analyzeWords(['abc'], buildDictionary({ patternText: '', exceptionText: '', leftMin: 2, rightMin: 2 }));
    expect(results[0].breaks).toEqual([]);
  });

  it('词数与词长受限', () => {
    expect(() => analyzeWords(Array.from({ length: 2001 }, (_, i) => `a${i}`), buildDictionary({ patternText: '', exceptionText: '', leftMin: 0, rightMin: 0 }))).toThrow(/2000/);
    expect(() => analyzeWords(['abcdefghijklmnopqrstuvwxyzabcdefghijklmnop'], buildDictionary({ patternText: '', exceptionText: '', leftMin: 0, rightMin: 0 }))).toThrow(/40/);
    expect(() => analyzeWords(['Ab'], buildDictionary({ patternText: '', exceptionText: '', leftMin: 0, rightMin: 0 }))).toThrow(/小写/);
  });

  it('模式超过 1000 条报错，恰好 1000 条通过', () => {
    // 每条用唯一的 base-26 后缀，保证 symbols 合法且不重复
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const suffix = i
          .toString(26)
          .split('')
          .map((c) => String.fromCharCode(97 + (parseInt(c, 26) % 26)))
          .join('');
        return `a${i % 10}${suffix}`;
      })
      .join('\n');
    expect(() => buildDictionary({ patternText: mk(1001), exceptionText: '', leftMin: 0, rightMin: 0 })).toThrow(/1000/);
    expect(() => buildDictionary({ patternText: mk(1000), exceptionText: '', leftMin: 0, rightMin: 0 })).not.toThrow();
  });

  it('hyphenate 工具', () => {
    expect(hyphenate('hello', [3])).toBe('hel-lo');
    expect(hyphenate('hello', [])).toBe('hello');
  });
});

describe('导出 JSON 与高亮同源', () => {
  it('导出逐间隙镜像分析结果，allowed 与 breaks 完全一致', () => {
    const { dict, results } = analyzeWithOracle(['hello', 'abc'], {
      patternText: '.he5l\nhel3l\nll4o\na3b',
      exceptionText: 'he-ll-o'
    });
    const payload = buildExport(results, dict);
    expect(payload.words).toHaveLength(2);
    for (const w of payload.words) {
      const src = results.find((r) => r.word === w.word)!;
      expect(w.hyphenated).toBe(src.hyphenated);
      expect(w.breaks).toEqual(src.breaks);
      expect(w.gaps.map((g) => g.allowed)).toEqual(src.gaps.map((g) => g.allowed));
      expect(w.gaps.map((g) => g.score)).toEqual(src.gaps.map((g) => g.score));
      expect(w.gaps.map((g) => g.contributors.join(','))).toEqual(
        src.gaps.map((g) => g.contributors.join(','))
      );
      expect(w.gaps.map((g) => g.reason)).toEqual(src.gaps.map((g) => g.reason));
      // 所有 allowed 间隙都必须体现在 breaks 里（高亮与导出一致）
      const allowedPositions = w.gaps.filter((g) => g.allowed).map((g) => g.breakPosition);
      expect(allowedPositions).toEqual(w.breaks);
    }
    expect(payload.words[0].exception).toBe('he-ll-o');
  });

  it('越过左右最少保留的例外断点：解释、breaks、导出、hyphenated 全部一致不放行', () => {
    const { dict, results } = analyzeWithOracle(['abcdef'], {
      patternText: '',
      exceptionText: 'a-bcde-f', // 断点 1、5 都越过 leftMin=rightMin=2
      leftMin: 2,
      rightMin: 2
    });
    const r = results[0];
    expect(r.breaks).toEqual([]);
    expect(r.hyphenated).toBe('abcdef');
    for (const bp of [1, 5]) {
      const g = r.gaps.find((x) => x.breakPosition === bp)!;
      expect(g.fromException).toBe(true);
      expect(g.allowed).toBe(false);
    }
    const payload = buildExport(results, dict);
    const w = payload.words[0];
    expect(w.breaks).toEqual([]);
    expect(w.hyphenated).toBe('abcdef');
    expect(w.gaps.filter((g) => g.allowed)).toHaveLength(0);
    expect(w.gaps.filter((g) => g.fromException).map((g) => g.breakPosition)).toEqual([1, 5]);
  });
});

// ---------- 随机对拍 ----------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('随机对拍（trie vs 朴素扫描）', () => {
  const letters = 'abc';

  function randomPattern(rand: () => number): string {
    const len = 1 + Math.floor(rand() * 4);
    let s = '';
    for (let i = 0; i < len; i += 1) s += letters[Math.floor(rand() * letters.length)];
    // 在字母之间（含首字母前、末字母后）插入至多一位数字——逐间隙生成，天然不会出现同间隙两位
    let inner = '';
    for (let i = 0; i < s.length; i += 1) {
      if (rand() < 0.4) inner += Math.floor(rand() * 10);
      inner += s[i];
    }
    if (rand() < 0.3) inner += Math.floor(rand() * 10);
    // 边界点只能在绝对边缘：前导点在所有数字之前，结尾点在所有数字之后
    let out = '';
    if (rand() < 0.4) out += '.';
    out += inner;
    if (rand() < 0.4) out += '.';
    return out;
  }

  function randomWord(rand: () => number): string {
    const len = 1 + Math.floor(rand() * 8);
    let s = '';
    for (let i = 0; i < len; i += 1) s += letters[Math.floor(rand() * letters.length)];
    return s;
  }

  it('100 组随机词典：分值、来源、断点全一致', () => {
    const rand = rng(42);
    for (let iter = 0; iter < 100; iter += 1) {
      const patternSet = new Set<string>();
      const count = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < count; i += 1) {
        const p = randomPattern(rand);
        if (!/^\.?[a-z]+\.?$/.test(p.replace(/[0-9]/g, ''))) continue;
        patternSet.add(p);
      }
      const patternText = [...patternSet].join('\n');
      const leftMin = Math.floor(rand() * 3);
      const rightMin = Math.floor(rand() * 3);
      const words = Array.from({ length: 6 }, () => randomWord(rand));

      const { results, oracleByWord } = analyzeWithOracle(words, { patternText, leftMin, rightMin });
      expectScoresMatchOracle(results, oracleByWord);

      for (const r of results) {
        const oracle = oracleByWord.get(r.word)!;
        expect(r.breaks).toEqual(expectedBreaksFromOracle(r.word, oracle, leftMin, rightMin));
      }
    }
  });
});
