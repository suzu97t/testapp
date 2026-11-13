// 要件まわりの関係をまとめて計算する。画面・コマンド・書き出し・次の一手で共用する。

import { lintRequirement } from './lint.js';
import { summarize } from './tables.js';
import { displayId } from './types.js';

export const LAYERS = [
  ['purpose', '目的', 'なぜやるのか'],
  ['business', '業務', '誰が何をするのか'],
  ['system', 'システム', 'システムが何を担うのか'],
  ['function', '機能', '具体的に何ができるのか'],
].map(([key, label, hint], order) => ({ key, label, hint, order }));
export const layerOf = (key) => LAYERS.find((l) => l.key === key);

export function analyze({ items, links }) {
  const live = items.filter((i) => i.status !== 'dropped');
  const byId = new Map(live.map((i) => [i.id, i]));
  const reqs = live.filter((i) => i.type === 'requirement');
  const parentOf = new Map();
  const childrenOf = new Map(reqs.map((r) => [r.id, []]));
  const attached = { of: new Map(), about: new Map() }; // 要件ID → 受け入れ条件・表 / 未決

  for (const l of links) {
    const from = byId.get(l.from_id);
    const to = byId.get(l.to_id);
    if (!from || !to) continue;
    if (l.kind === 'parent' && from.type === 'requirement' && to.type === 'requirement') {
      parentOf.set(from.id, to.id);
      childrenOf.get(to.id).push(from);
    } else if (attached[l.kind]) {
      if (!attached[l.kind].has(to.id)) attached[l.kind].set(to.id, []);
      attached[l.kind].get(to.id).push(from);
    }
  }
  const criteriaOf = (id) => (attached.of.get(id) ?? []).filter((i) => i.type === 'criterion');
  const tablesOf = (id) => (attached.of.get(id) ?? []).filter((i) => i.type === 'table');
  const opensOf = (id) => (attached.about.get(id) ?? []).filter((i) => i.type === 'open');

  const findings = new Map();
  for (const r of reqs) {
    const layer = layerOf(r.fields?.layer);
    const isLevel = r.fields?.level === 'yes';
    const list = [];
    if (!layer) list.push({ key: 'no-layer', kind: 'trace', message: 'どの層の話かが決まっていません', question: null });
    else {
      const parent = byId.get(parentOf.get(r.id));
      if (layer.key !== 'purpose' && !parent)
        list.push({ key: 'no-parent', kind: 'trace', message: 'なぜ必要かを上まで辿れません（根拠が書かれていない）', question: `「${r.title}」は、どの業務の、何のために必要ですか？` });
      if (parent && layerOf(parent.fields?.layer) && layerOf(parent.fields.layer).order >= layer.order)
        list.push({ key: 'bad-parent', kind: 'trace', message: `上に置いた ${displayId(parent)} のほうが、同じか下の層です`, question: null });
      if (layer.key !== 'function' && !isLevel && !childrenOf.get(r.id).length)
        list.push({ key: 'no-child', kind: 'trace', message: 'これを実現するものが、下にまだありません（抜け）', question: `「${r.title}」を実現する手段は何ですか？ 人がやるなら、誰が、何を見て、どう記録しますか？` });
    }
    list.push(...lintRequirement(r, criteriaOf(r.id)));
    for (const t of tablesOf(r.id)) {
      const s = summarize(t);
      if (s.blank) list.push({ key: `table-blank:${t.id}`, kind: 'table', message: `表「${t.title}」に空白が ${s.blank} つあります`, question: null, table_id: t.id });
    }
    // 起票済みの未決と、「問題ない」とした点は数えない
    const raised = new Map(opensOf(r.id).filter((o) => o.fields?.lint_key).map((o) => [o.fields.lint_key, o]));
    const dismissed = new Set((r.fields?.dismissed ?? '').split('\n').filter(Boolean));
    findings.set(r.id, list.filter((f) => !dismissed.has(f.key)).map((f) => {
      const o = raised.get(f.key);
      return o ? { ...f, raised: displayId(o), raised_status: o.status } : f;
    }));
  }
  const openFindings = (id) => (findings.get(id) ?? []).filter((f) => !f.raised);
  return { reqs, byId, parentOf, childrenOf, criteriaOf, tablesOf, opensOf, findings, openFindings };
}
