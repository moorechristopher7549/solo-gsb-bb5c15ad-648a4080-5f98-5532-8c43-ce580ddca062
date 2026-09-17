import { useMemo, useRef, useState } from 'react';
import type { Rule } from '../types';
import { uid, validateRules } from '../validate';
import { analyzeShadowing, type ShadowReport } from '../shadow';
import { SAMPLE_RULES } from '../samples';
import { RuleCard } from './RuleCard';

interface Props {
  rules: Rule[];
  onRulesChange: (rules: Rule[]) => void;
  onShare: () => void;
}

export function RulesPanel({ rules, onRulesChange, onShare }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // 遮蔽诊断：规则表每次变化（增删、排序、字段、启停）即时重新分析，
  // 仅作提示，不影响模拟执行
  const shadowMap = useMemo(() => {
    const map = new Map<string, ShadowReport>();
    for (const report of analyzeShadowing(rules)) map.set(report.ruleId, report);
    return map;
  }, [rules]);

  const update = (i: number, next: Rule) =>
    onRulesChange(rules.map((r, j) => (j === i ? next : r)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    onRulesChange(next);
  };

  const remove = (i: number) => onRulesChange(rules.filter((_, j) => j !== i));

  const add = () =>
    onRulesChange([
      ...rules,
      {
        id: uid(),
        name: `规则 ${rules.length + 1}`,
        enabled: true,
        method: 'ANY',
        host: 'example.com',
        pathTemplate: '/',
        action: { type: 'rewrite', target: '/', status: 302 },
      },
    ]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'url-rules.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = validateRules(JSON.parse(text));
      onRulesChange(parsed);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>规则表（按顺序匹配，首条命中生效）</h2>
        <div className="toolbar">
          <button onClick={add}>＋ 添加规则</button>
          <button onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <button onClick={exportJson} disabled={rules.length === 0}>
            导出 JSON
          </button>
          <button onClick={onShare}>加密分享</button>
          <button onClick={() => onRulesChange(structuredClone(SAMPLE_RULES))}>
            载入示例
          </button>
          <button
            className="danger"
            disabled={rules.length === 0}
            onClick={() => onRulesChange([])}
          >
            清空
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {importError && <div className="banner error">导入失败：{importError}</div>}

      {shadowMap.size > 0 && (
        <div className="banner warn">
          ⚠️ 遮蔽诊断：{shadowMap.size} 条已启用规则不可达（全部被更早的启用规则覆盖），
          详见对应规则卡片。诊断仅作提示，不影响模拟执行。
        </div>
      )}

      {rules.length === 0 ? (
        <p className="empty">暂无规则。点击「添加规则」或「载入示例」开始。</p>
      ) : (
        rules.map((rule, i) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            index={i}
            total={rules.length}
            shadow={shadowMap.get(rule.id)}
            onChange={(next) => update(i, next)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
          />
        ))
      )}
    </section>
  );
}
