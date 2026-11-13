// プロジェクト全体を1枚の Markdown にする。共有や git での差分確認に使う。

import { TYPES, GOAL_KINDS, displayId } from './types.js';
import { analyze, LAYERS, layerOf } from './analyze.js';
import { parseSpec, decisionRows, NEVER } from './tables.js';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const draft = (i) => (i.source === 'ai' && !i.confirmed_at ? '【AIの案・未確認】' : '');

export function exportMarkdown({ project, items, links }) {
  const c = project.charter ?? {};
  const live = items.filter((i) => i.status !== 'dropped');
  const of = (t) => live.filter((i) => i.type === t);
  const a = analyze({ items, links });
  const L = [];
  const table = (head, rows) => { if (rows.length) L.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`), ''); else L.push('（まだありません）', ''); };

  L.push(`# ${project.name}`, '', '## 憲章', '', `**目的**　${project.purpose || '（未決）'}`, '',
    `**ゴール**　${c.goal_kind ? GOAL_KINDS[c.goal_kind].label : '（置き方が未決）'}${c.goal_text ? `：${c.goal_text}` : ''}`, '',
    `**動かせない条件**　${c.constraints || '（未記入）'}`, '', `最後に見直した日：${c.reviewed_at ?? 'なし'}`, '');
  L.push('### やらないこと', '');
  table(['ID', 'やらないこと', 'その代わりに起きること', 'いつまで'], of('notdo').map((i) => [displayId(i), i.title, i.fields.instead, i.fields.kind]));
  L.push('### 誰が何を決めるか', '');
  table(['決めること', '決める人'], of('authority').map((i) => [i.title, i.owner]));
  L.push('### 立ち止まる条件', '');
  table(['ID', '条件', '判定する日', '判定する人', '当てはまったら'], of('exit').map((i) => [displayId(i), i.title, i.due, i.owner, i.fields.action]));

  L.push('## 要件', '');
  const walk = (r, depth) => {
    const layer = layerOf(r.fields?.layer);
    const f = a.openFindings(r.id);
    L.push(`${'  '.repeat(depth)}- **${displayId(r)}** ［${layer?.label ?? '層が未決'}${r.fields?.level === 'yes' ? '・水準' : ''}］${draft(r)}${r.title}${f.length ? `　⚠ 気になる点 ${f.length}` : ''}`);
    for (const ch of a.childrenOf.get(r.id)) walk(ch, depth + 1);
  };
  const roots = a.reqs.filter((r) => !a.parentOf.has(r.id))
    .sort((x, y) => (layerOf(x.fields?.layer)?.order ?? 9) - (layerOf(y.fields?.layer)?.order ?? 9));
  roots.forEach((r) => walk(r, 0));
  if (!roots.length) L.push('（まだありません）');
  L.push('');

  for (const r of a.reqs) {
    const cs = a.criteriaOf(r.id); const ts = a.tablesOf(r.id); const fs = a.openFindings(r.id);
    if (!cs.length && !ts.length && !fs.length && !r.body) continue;
    L.push(`### ${displayId(r)} ${r.title}`, '');
    if (r.body) L.push(r.body, '');
    for (const cr of cs) L.push(`**${displayId(cr)} ${cr.title}**${draft(cr)}`, '', '```', `Given ${cr.fields.given ?? ''}`, `When  ${cr.fields.when ?? ''}`, `Then  ${cr.fields.then ?? ''}`, '```', '');
    for (const t of ts) {
      const spec = parseSpec(t); const cells = spec.cells ?? {};
      L.push(`**${displayId(t)} ${t.title}**`, '');
      if (spec.kind === 'decision') table(['#', ...spec.conditions, 'どうする'], decisionRows(spec.conditions).map((k, n) => [n + 1, ...k, cells[k] || '？（未決）']));
      else table(['状態＼出来事', ...spec.events], spec.states.map((s) => [s, ...spec.events.map((e) => cells[`${s}|${e}`] || '？')]));
    }
    if (fs.length) L.push('気になる点：', ...fs.map((f) => `- ${f.message}`), '');
  }

  L.push('## 例外', '');
  table(['ID', '例外', 'どう扱う', '決めた人', '補足'], of('exception').map((i) => [displayId(i), i.title, i.fields.handling || 'まだ決まっていない', i.owner, i.body]));

  const section = (type, head, row, filter = () => true) => { L.push(`## ${TYPES[type].label}`, ''); table(head, of(type).filter(filter).map(row)); };
  section('open', ['ID', '何が決まっていないか', '決める人', 'いつまでに'], (i) => [displayId(i), i.title, i.owner || '（いない）', i.due], (i) => i.status === 'open');
  section('decision', ['ID', '決めたこと', '理由', '選ばなかった案', '見直す条件', '決めた人'], (i) => [displayId(i), draft(i) + i.title, i.fields.reason, i.fields.alternatives, i.fields.premise, i.owner]);
  section('risk', ['ID', 'もし（条件）', 'どうなる（結果）', '兆候', 'どうする', '見ている人'], (i) => [displayId(i), draft(i) + i.title, i.fields.result, i.fields.sign, i.fields.action, i.owner], (i) => i.status === 'open');
  section('term', ['言葉', '意味（含むもの）', '含まないもの'], (i) => [draft(i) + i.title, i.fields.includes, i.fields.excludes]);
  section('request', ['ID', '依頼', '解決したい課題', '誰が困っている', '期日', '根拠', '今の対処'], (i) => [displayId(i), i.title, i.fields.problem, i.fields.who, i.due, i.fields.due_reason, i.fields.workaround], (i) => i.status === 'open');
  return L.join('\n');
}
