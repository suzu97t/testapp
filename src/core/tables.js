// 例外を機械的に探すための2つの表。
// 「空白のセルが、まだ決まっていない例外」。空白を数えて見せる。

export const NEVER = '—'; // 「起きない」と明示的に決めた印

// 条件の組み合わせ表：条件がN個なら 2^N 行。キーは 'YNY' のような文字列。
export function decisionRows(conditions) {
  const n = conditions.length;
  return Array.from({ length: 2 ** n }, (_, i) =>
    Array.from({ length: n }, (_, j) => ((i >> (n - 1 - j)) & 1 ? 'N' : 'Y')).join(''));
}

export function parseSpec(table) {
  try { return JSON.parse(table.fields?.spec || '{}'); } catch { return {}; }
}

export function cellKeys(spec) {
  if (spec.kind === 'decision') return decisionRows(spec.conditions ?? []);
  if (spec.kind === 'state') return (spec.states ?? []).flatMap((s) => (spec.events ?? []).map((e) => `${s}|${e}`));
  return [];
}

export function blanks(spec) {
  const cells = spec.cells ?? {};
  return cellKeys(spec).filter((k) => !String(cells[k] ?? '').trim());
}

export function summarize(table) {
  const spec = parseSpec(table);
  const keys = cellKeys(spec);
  return { kind: spec.kind, total: keys.length, blank: blanks(spec).length };
}

export const splitNames = (text) => [...new Set(String(text).split(/[\n,、]/).map((s) => s.trim()).filter(Boolean))];
