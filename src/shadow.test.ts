import { describe, expect, it } from 'vitest';
import {
  diagnoseShadows,
  hostCovers,
  methodCovers,
  pathCovers,
  pathIsMatchable,
} from './shadow';
import type { Rule } from './types';

function rule(partial: Partial<Rule> = {}): Rule {
  return {
    id: partial.id ?? `r${Math.random().toString(36).slice(2)}`,
    name: partial.name ?? partial.id ?? 'r',
    enabled: partial.enabled ?? true,
    method: partial.method ?? 'ANY',
    host: partial.host ?? 'example.com',
    pathTemplate: partial.pathTemplate ?? '/',
    action: { type: 'rewrite', target: '/', status: 302, ...partial.action },
  };
}

describe('methodCovers', () => {
  it('ANY 覆盖具体方法与 ANY，具体方法只覆盖相同方法', () => {
    expect(methodCovers('ANY', 'GET')).toBe(true);
    expect(methodCovers('ANY', 'ANY')).toBe(true);
    expect(methodCovers('GET', 'GET')).toBe(true);
    expect(methodCovers('GET', 'POST')).toBe(false);
    expect(methodCovers('GET', 'ANY')).toBe(false);
    expect(methodCovers('POST', 'GET')).toBe(false);
  });
});

describe('hostCovers', () => {
  it('* 覆盖任意主机模式（含自身与另一个 *）', () => {
    expect(hostCovers('*', 'example.com')).toBe(true);
    expect(hostCovers('*', '*.example.com')).toBe(true);
    expect(hostCovers('*', '*')).toBe(true);
    expect(hostCovers('*', 'a.b.c.dev')).toBe(true);
  });

  it('字面主机只覆盖相同字面值（忽略大小写与首尾空白）', () => {
    expect(hostCovers('Example.com', 'example.com')).toBe(true);
    expect(hostCovers(' example.com ', 'EXAMPLE.COM')).toBe(true);
    expect(hostCovers('example.com', 'a.example.com')).toBe(false);
    expect(hostCovers('example.com', 'notexample.com')).toBe(false);
    expect(hostCovers('example.com', '*')).toBe(false);
  });

  it('*.example.com 只覆盖其至少一级子域，不覆盖裸域与旁系域', () => {
    expect(hostCovers('*.example.com', 'a.example.com')).toBe(true);
    expect(hostCovers('*.example.com', 'a.b.example.com')).toBe(true);
    expect(hostCovers('*.example.com', 'example.com')).toBe(false);
    expect(hostCovers('*.example.com', 'notexample.com')).toBe(false);
    expect(hostCovers('*.example.com', '*')).toBe(false);
  });

  it('通配覆盖更深一级的通配子域，但不覆盖旁系通配', () => {
    expect(hostCovers('*.example.com', '*.cdn.example.com')).toBe(true);
    expect(hostCovers('*.example.com', '*.a.b.example.com')).toBe(true);
    expect(hostCovers('*.example.com', '*.notexample.com')).toBe(false);
    expect(hostCovers('*.example.com', '*.other.com')).toBe(false);
    // 相同通配互为覆盖
    expect(hostCovers('*.example.com', '*.example.com')).toBe(true);
  });
});

describe('pathCovers / pathIsMatchable', () => {
  it('空值或 * 覆盖任意路径模板', () => {
    expect(pathCovers('', '/a/b/c')).toBe(true);
    expect(pathCovers('*', '/users/:id')).toBe(true);
    expect(pathCovers('  *  ', '/x')).toBe(true);
  });

  it('具体模板不覆盖任意路径模板（仅部分交集）', () => {
    expect(pathCovers('/a', '*')).toBe(false);
    expect(pathCovers('/a', '')).toBe(false);
    expect(pathCovers('/users/:id', '*')).toBe(false);
  });

  it('参数段覆盖同位任意单段，字面段只覆盖相同字面值', () => {
    expect(pathCovers('/users/:id', '/users/42')).toBe(true);
    expect(pathCovers('/users/:id', '/users/:name')).toBe(true);
    expect(pathCovers('/users/:id', '/groups/42')).toBe(false);
    expect(pathCovers('/users/list', '/users/42')).toBe(false);
    expect(pathCovers('/users/list', '/users/list')).toBe(true);
  });

  it('段数不同不覆盖，根路径覆盖根路径', () => {
    expect(pathCovers('/users/:id', '/users/42/extra')).toBe(false);
    expect(pathCovers('/users/:id', '/users')).toBe(false);
    expect(pathCovers('/', '/')).toBe(true);
    expect(pathCovers('/', '/users')).toBe(false);
  });

  it('参数段不被同位字面段覆盖（集合方向不可颠倒）', () => {
    expect(pathCovers('/users/42', '/users/:id')).toBe(false);
    expect(pathCovers('/:a/:b', '/x/y')).toBe(true);
    expect(pathCovers('/x/y', '/:a/:b')).toBe(false);
  });

  it('空参数名模板不可匹配，诊断阶段将其排除', () => {
    expect(pathIsMatchable('/a/:/b')).toBe(false);
    // 覆盖判定只比较可匹配集合：非法模板不参与分析，由 pathIsMatchable 排除
    expect(pathCovers('/a/:/b', '/a/x/b')).toBe(false);
    expect(pathIsMatchable('/a/:b')).toBe(true);
    expect(pathIsMatchable('')).toBe(true);
    expect(pathIsMatchable('*')).toBe(true);
  });
});

describe('diagnoseShadows', () => {
  it('完整三维度覆盖：标记不可达并给出首个遮蔽规则及三项依据', () => {
    const rules = [
      rule({ id: 'r1', method: 'ANY', host: '*', pathTemplate: '*' }),
      rule({ id: 'r2', method: 'GET', host: 'a.com', pathTemplate: '/x' }),
    ];
    const diag = diagnoseShadows(rules);
    expect([...diag.keys()]).toEqual([1]);
    const info = diag.get(1)!;
    expect(info.shadowedByIndex).toBe(0);
    expect(info.shadowedByName).toBe('r1');
    expect(info.method.value).toBe('ANY');
    expect(info.host.value).toBe('*');
    expect(info.path.value).toBe('*');
  });

  it('只有三维度同时覆盖才告警，任一维度仅交集不算', () => {
    // 方法 ANY、主机 * 覆盖，但路径仅部分交集
    let diag = diagnoseShadows([
      rule({ id: 'r1', method: 'ANY', host: '*', pathTemplate: '/a' }),
      rule({ id: 'r2', method: 'ANY', host: '*', pathTemplate: '/b' }),
    ]);
    expect(diag.size).toBe(0);

    // 路径覆盖、主机覆盖，但具体方法与 ANY 不同
    diag = diagnoseShadows([
      rule({ id: 'r1', method: 'POST', host: '*', pathTemplate: '*' }),
      rule({ id: 'r2', method: 'GET', host: 'a.com', pathTemplate: '/x' }),
    ]);
    expect(diag.size).toBe(0);

    // 方法与路径覆盖，但主机仅部分交集（裸域不被子域通配覆盖）
    diag = diagnoseShadows([
      rule({ id: 'r1', method: 'ANY', host: '*.example.com', pathTemplate: '*' }),
      rule({ id: 'r2', method: 'ANY', host: 'example.com', pathTemplate: '/x' }),
    ]);
    expect(diag.size).toBe(0);
  });

  it('报告首个遮蔽它的规则（多条前置可覆盖时取下标最小者）', () => {
    const rules = [
      rule({ id: 'r1', method: 'GET', host: 'a.com', pathTemplate: '/x/:id' }),
      rule({ id: 'r2', method: 'GET', host: 'a.com', pathTemplate: '/x/y' }),
      rule({ id: 'r3', method: 'ANY', host: '*', pathTemplate: '*' }),
      rule({ id: 'r4', method: 'GET', host: 'a.com', pathTemplate: '/x/y' }),
    ];
    const diag = diagnoseShadows(rules);
    expect(diag.get(1)?.shadowedByIndex).toBe(0);
    expect(diag.get(3)?.shadowedByIndex).toBe(0);
  });

  it('禁用规则不参与分析：既不被标记，也不遮蔽后续规则', () => {
    const rules = [
      rule({ id: 'off', enabled: false, method: 'ANY', host: '*', pathTemplate: '*' }),
      rule({ id: 'live', method: 'GET', host: 'a.com', pathTemplate: '/x' }),
    ];
    expect(diagnoseShadows(rules).size).toBe(0);
  });

  it('catch-all 位于末尾不会遮蔽任何规则；移到前面后全部不可达', () => {
    const ordered = [
      rule({ id: 'specific', method: 'GET', host: 'a.com', pathTemplate: '/x' }),
      rule({ id: 'catch', method: 'ANY', host: '*', pathTemplate: '*' }),
    ];
    expect([...diagnoseShadows(ordered).keys()]).toEqual([]);

    const swapped = [ordered[1], ordered[0]];
    const diag = diagnoseShadows(swapped);
    expect([...diag.keys()]).toEqual([1]);
  });

  it('同方法下通配子域 + 参数段覆盖子域具体请求规则', () => {
    const rules = [
      rule({ id: 'r1', method: 'GET', host: '*.example.com', pathTemplate: '/assets/:f' }),
      rule({ id: 'r2', method: 'GET', host: 'cdn.example.com', pathTemplate: '/assets/app.js' }),
    ];
    const diag = diagnoseShadows(rules);
    expect(diag.get(1)?.shadowedByIndex).toBe(0);
  });

  it('裸域规则不被 *.example.com 遮蔽，但被 * 遮蔽', () => {
    const wildcardOnly = diagnoseShadows([
      rule({ id: 'r1', host: '*.example.com', pathTemplate: '*' }),
      rule({ id: 'r2', host: 'example.com', pathTemplate: '/' }),
    ]);
    expect(wildcardOnly.size).toBe(0);

    const star = diagnoseShadows([
      rule({ id: 'r0', host: '*', pathTemplate: '*' }),
      rule({ id: 'r1', host: '*.example.com', pathTemplate: '*' }),
      rule({ id: 'r2', host: 'example.com', pathTemplate: '/' }),
    ]);
    expect([...star.keys()]).toEqual([1, 2]);
  });

  it('自身条件不可匹配的规则（空主机 / 非法路径）不标记，也不遮蔽', () => {
    const rules = [
      rule({ id: 'r1', host: '', pathTemplate: '*' }),
      rule({ id: 'r2', method: 'GET', host: 'a.com', pathTemplate: '/a/:/b' }),
    ];
    expect(diagnoseShadows(rules).size).toBe(0);
  });

  it('诊断只读：不修改规则，且不改变 simulate 的执行结果', async () => {
    const { simulate } = await import('./engine');
    const rules = [
      rule({
        id: 'r1',
        pathTemplate: '/a',
        action: { type: 'rewrite', target: '/b', status: 302 },
      }),
      rule({
        id: 'r2',
        pathTemplate: '/a',
        action: { type: 'rewrite', target: '/never', status: 302 },
      }),
      rule({
        id: 'r3',
        pathTemplate: '/b',
        action: { type: 'rewrite', target: '/c', status: 302 },
      }),
    ];
    const snapshot = JSON.stringify(rules);
    const before = simulate(rules, 'GET', 'http://example.com/a');
    diagnoseShadows(rules);
    const after = simulate(rules, 'GET', 'http://example.com/a');
    expect(JSON.stringify(rules)).toBe(snapshot);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.steps.map((s) => s.rule.id)).toEqual(['r1', 'r3']);
    // r2 在匹配语义上不可达（与 r1 条件完全一致），诊断应如实指出
    expect(diagnoseShadows(rules).get(1)?.shadowedByIndex).toBe(0);
  });
});
