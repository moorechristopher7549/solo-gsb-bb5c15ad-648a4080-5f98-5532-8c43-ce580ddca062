import type { MethodMatcher, Rule } from './types';

/** 单项覆盖依据（方法 / 主机 / 路径之一） */
export interface ShadowBasis {
  /** 遮蔽规则该维度的匹配器原值（ANY、*、路径模板等），供逐字展示 */
  value: string;
  /** 中文覆盖说明：为什么该维度构成覆盖 */
  reason: string;
}

/** 一条「不可达」诊断结果 */
export interface ShadowInfo {
  /** 被遮蔽（不可达）规则在原规则表中的下标 */
  ruleIndex: number;
  /** 首个完整覆盖它的已启用规则下标 */
  shadowedByIndex: number;
  /** 遮蔽规则名称（快照，便于 UI 直接展示） */
  shadowedByName: string;
  method: ShadowBasis;
  host: ShadowBasis;
  path: ShadowBasis;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function normHost(pattern: string): string {
  return pattern.trim().toLowerCase();
}

/**
 * 方法覆盖：与 findMatch 的判定一致——
 * `ANY` 覆盖任意方法（含 ANY）；具体方法只覆盖相同的具体方法。
 */
export function methodCovers(coverer: MethodMatcher, target: MethodMatcher): boolean {
  return coverer === 'ANY' || coverer === target;
}

/**
 * 主机覆盖：主机模式 A 覆盖主机模式 B，当且仅当「B 能匹配的每个主机 A 也能匹配」。
 * 语义与 matchHost 保持一致：
 * - `*` 覆盖任意主机模式；
 * - `*.example.com` 覆盖自身，以及 example.com 的「至少一级子域」上的通配 / 精确模式；
 * - 字面模式只覆盖完全相同（忽略大小写、首尾空白）的字面值；
 * - 空模式本身不匹配任何主机（不属于可分析集合）。
 */
export function hostCovers(coverer: string, target: string): boolean {
  const a = normHost(coverer);
  const b = normHost(target);
  if (a === '') return false;
  if (a === '*') return true;
  if (a === b) return true;
  if (a.startsWith('*.')) {
    const suffix = a.slice(1); // ".example.com"
    if (b.startsWith('*.')) {
      // *.a.example.com（更深一级的通配子域）被 *.example.com 覆盖；
      // 内层域必须以「.example.com」结尾，前导点避免 notexample.com 类误判。
      // 同为 *.example.com 时 a === b，已在前面的相等分支处理。
      const inner = b.slice(2); // "a.example.com"
      return inner.length > suffix.length && inner.endsWith(suffix);
    }
    // 精确主机必须是至少一级子域：长度严格大于后缀且以后缀结尾
    return b.length > suffix.length && b.endsWith(suffix);
  }
  return false;
}

/**
 * 路径段：`:name` 为参数段（覆盖同位任意单段），其余为字面段。
 * 空参数名（模板为 `:/x`）在 matchPath 中会判定不匹配，这里记为不可匹配。
 */
type PathSeg = { kind: 'param'; name: string } | { kind: 'literal'; value: string };

/** 解析路径模板；返回 null 表示该模板不匹配任何路径（如空参数名段） */
function parsePath(template: string): PathSeg[] | null {
  const t = template.trim();
  const segs: PathSeg[] = [];
  for (const raw of t.split('/')) {
    if (raw === '') continue;
    if (raw.startsWith(':')) {
      const name = raw.slice(1);
      if (name === '') return null;
      segs.push({ kind: 'param', name });
    } else {
      segs.push({ kind: 'literal', value: safeDecode(raw) });
    }
  }
  return segs;
}

/** 该路径模板是否属于可匹配集合（空模板 / `*` 匹配任意路径，属于可匹配） */
export function pathIsMatchable(template: string): boolean {
  const t = template.trim();
  return t === '' || t === '*' || parsePath(template) !== null;
}

/**
 * 路径覆盖：路径模板 A 覆盖路径模板 B，当且仅当「B 能匹配的每个路径 A 也能匹配」。
 * 按分段比较，段数必须一致：
 * - A 为参数段时覆盖同位任意单段（无论 B 该位是字面段还是参数段）；
 * - A 为字面段时只覆盖 B 的同位相同字面值（参数段的匹配集合更大，不被覆盖）；
 * - 空值或 `*`（任意路径）覆盖任意可匹配模板；
 * - B 为空值或 `*` 时只有同样为任意路径的 A 才能覆盖。
 */
export function pathCovers(coverer: string, target: string): boolean {
  const a = coverer.trim();
  if (a === '' || a === '*') return true;
  const aSegs = parsePath(coverer);
  const bSegs = parsePath(target);
  if (aSegs === null || bSegs === null) return false;
  if (aSegs.length !== bSegs.length) return false;
  for (let i = 0; i < aSegs.length; i++) {
    const as = aSegs[i];
    const bs = bSegs[i];
    if (as.kind === 'param') continue;
    if (bs.kind !== 'literal' || bs.value !== as.value) return false;
  }
  return true;
}

/** 规则的匹配条件是否能匹配至少一部分请求（空主机 / 非法路径模板的规则无可匹配请求） */
function ruleMatchable(rule: Rule): boolean {
  return normHost(rule.host) !== '' && pathIsMatchable(rule.pathTemplate);
}

/** 三维度同时覆盖才构成完整覆盖；部分交集不算 */
function covers(coverer: Rule, target: Rule): boolean {
  return (
    methodCovers(coverer.method, target.method) &&
    hostCovers(coverer.host, target.host) &&
    pathCovers(coverer.pathTemplate, target.pathTemplate)
  );
}

function methodBasis(coverer: MethodMatcher, target: MethodMatcher): ShadowBasis {
  if (coverer === 'ANY') {
    return {
      value: 'ANY',
      reason: target === 'ANY' ? '同为 ANY，均匹配任意方法' : 'ANY 覆盖任意具体方法',
    };
  }
  return { value: coverer, reason: `均限定 ${coverer} 方法` };
}

function hostBasis(coverer: string, target: string): ShadowBasis {
  const a = normHost(coverer);
  const b = normHost(target);
  if (a === '*') {
    return {
      value: coverer,
      reason: b === '*' ? '主机均为 *，匹配任意主机' : '* 匹配任意主机',
    };
  }
  if (a.startsWith('*.')) {
    return {
      value: coverer,
      reason: b.startsWith('*.')
        ? `通配子域 ${coverer} 覆盖更深一级的 ${target}`
        : `通配子域 ${coverer} 覆盖子域 ${target}（不含裸域）`,
    };
  }
  return { value: coverer, reason: `主机均为 ${coverer}` };
}

function pathBasis(coverer: string, target: string): ShadowBasis {
  const a = coverer.trim();
  if (a === '' || a === '*') {
    return { value: coverer.trim() || '（空）', reason: '空值或 * 匹配任意路径' };
  }
  const aSegs = parsePath(coverer) ?? [];
  const bSegs = parsePath(target) ?? [];
  const parts = aSegs.map((seg, i) => {
    if (seg.kind === 'param') {
      const other = bSegs[i];
      return other.kind === 'param'
        ? `参数段 :${seg.name} 与同位 :${other.name} 均匹配任意单段`
        : `参数段 :${seg.name} 覆盖同位字面段「${other.value}」`;
    }
    return `字面段「${seg.value}」仅覆盖相同字面值`;
  });
  return {
    value: coverer,
    reason:
      parts.length === 0
        ? '段数一致（根路径），逐段相同'
        : `段数一致（${aSegs.length} 段）：${parts.join('；')}`,
  };
}

/**
 * 遮蔽诊断：按规则顺序分析。
 * 仅考虑 enabled 且自身条件可匹配（主机非空、路径模板合法）的规则；
 * 对每条规则，在它之前的已启用可匹配规则中找首个三维度完整覆盖它的规则，
 * 找不到则该规则可达。诊断为纯只读分析，不影响 simulate 的执行结果。
 */
export function diagnoseShadows(rules: Rule[]): Map<number, ShadowInfo> {
  const result = new Map<number, ShadowInfo>();
  const active: Array<{ index: number; rule: Rule }> = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule.enabled || !ruleMatchable(rule)) continue;
    const covererEntry = active.find((entry) => covers(entry.rule, rule));
    if (covererEntry) {
      result.set(i, {
        ruleIndex: i,
        shadowedByIndex: covererEntry.index,
        shadowedByName: covererEntry.rule.name,
        method: methodBasis(covererEntry.rule.method, rule.method),
        host: hostBasis(covererEntry.rule.host, rule.host),
        path: pathBasis(covererEntry.rule.pathTemplate, rule.pathTemplate),
      });
    }
    active.push({ index: i, rule });
  }
  return result;
}
