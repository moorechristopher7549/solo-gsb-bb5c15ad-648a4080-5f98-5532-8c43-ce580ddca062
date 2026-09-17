import { useMemo, useRef, useState } from 'react';
import type { Rule } from '../types';
import { uid, validateRules } from '../validate';
import { SAMPLE_RULES } from '../samples';
import { diagnoseShadows } from '../shadow';
import { RuleCard } from './RuleCard';

interface Props {
  rules: Rule[];
  onRulesChange: (rules: Rule[]) => void;
  onShare: () => void;
}

export function RulesPanel({ rules, onRulesChange, onShare }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // 遮蔽诊断为纯派生数据：规则顺序 / 字段 / 启用状态任意变更后随渲染即时刷新，
  // 不写回规则、不影响模拟执行
  const shadows = useMemo(() => diagnoseShadows(rules), [rules]);
  const shadowCount = shadows.size;
  const activeCount = useMemo(
    () => rules.reduce((n, r) => n + (r.enabled ? 1 : 0), 0),
    [rules],
  );

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

      {rules.length > 0 &&
        (shadowCount > 0 ? (
          <div className="banner warn shadow-summary" role="status">
            遮蔽诊断：{activeCount} 条已启用规则中有 <strong>{shadowCount}</strong>{' '}
            条不可达——其全部可匹配请求已被它之前的已启用规则覆盖；标记规则上列出了首个遮蔽规则与方法、主机、路径三项依据。调整顺序或字段后实时更新。
          </div>
        ) : (
          <div className="banner ok shadow-summary" role="status">
            遮蔽诊断：{activeCount} 条已启用规则均可达，未发现完整遮蔽。
          </div>
        ))}

      {rules.length === 0 ? (
        <p className="empty">暂无规则。点击「添加规则」或「载入示例」开始。</p>
      ) : (
        rules.map((rule, i) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            index={i}
            total={rules.length}
            shadow={shadows.get(i)}
            onChange={(next) => update(i, next)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
          />
        ))
      )}
    </section>
  );
}
