#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// コマンドライン。人も、コーディングエージェントも、ここからデータを読み書きする。
// 出力は JSON（--pretty なしでも読めるよう整形済み）。

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { Store, UserError } from '../src/db.js';
import { serve } from '../src/server.js';
import { TYPES, displayId } from '../src/core/types.js';
import { nextActions } from '../src/core/next.js';
import { analyze } from '../src/core/analyze.js';
import { summarize, splitNames } from '../src/core/tables.js';
import { exportMarkdown } from '../src/core/export.js';
import { seedSample } from '../src/sample.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HELP = `段取り — プロジェクトマネジメントと要件定義のサポート

使い方:
  dandori serve [--port 4321] [--open]     画面を起動する
  dandori init <名前> [--purpose <目的>]   プロジェクトを作る
  dandori add <内容> [--type <種類>] [--owner <人>] [--due YYYY-MM-DD]
              [--field key=value ...] [--ai]
                                           項目を足す（--type 省略時は受付箱へ）
  dandori list [--type <種類>] [--all]     一覧（--all で完了・破棄も含む）
  dandori show <ID>                        1件の詳細と履歴（例: Q-3）
  dandori update <ID> [--title ...] [--type ...] [--status open|done|dropped]
              [--owner ...] [--due ...] [--field key=value ...] [--ai]
  dandori next                             今日やること
  dandori lint [ID]                        要件の点検（気になる点と、問いの形の指摘）
  dandori tree                             要件を層のツリーで見る
  dandori table <要件ID> <表の名前> --conditions "条件A,条件B,条件C"
  dandori table <要件ID> <表の名前> --states "状態A,状態B" --events "出来事A,出来事B"
                                           例外さがしの表を作る（空白は画面で埋める）
  dandori export [出力先フォルダ]          Markdown に書き出す（既定: export/）
  dandori sample                           練習用のプロジェクト（まるみ屋）を作る
  dandori projects / dandori use <番号>    プロジェクトの一覧 / 切り替え

  要件: add --type requirement --field layer=purpose|business|system|function --parent R-1
        （水準の話は --field level=yes）
  受け入れ条件: add <場合の名前> --type criterion --parent R-3
        --field given=... --field when=... --field then=...
  未決を要件に紐づける: add <問い> --type open --about R-3
  例外: add <例外> --type exception --field handling="システムで扱う" 
  dandori types                            種類と入力欄の一覧

  --ai を付けると「AIの案」として記録され、人が確認するまで決定扱いになりません。
  種類: ${Object.entries(TYPES).map(([k, v]) => `${k}(${v.short ?? v.label})`).join(' ')}`;

const { values: o, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' }, open: { type: 'boolean' }, purpose: { type: 'string' },
    type: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' },
    title: { type: 'string' }, status: { type: 'string' }, body: { type: 'string' },
    field: { type: 'string', multiple: true }, parent: { type: 'string' }, about: { type: 'string' },
    conditions: { type: 'string' }, states: { type: 'string' }, events: { type: 'string' }, ai: { type: 'boolean' }, all: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const out = (x) => console.log(JSON.stringify(x, null, 2));
const slim = (i) => ({ id: displayId(i), type: i.type, title: i.title, status: i.status, owner: i.owner || undefined, due: i.due || undefined,
  ...(Object.keys(i.fields).length ? { fields: i.fields } : {}), ...(i.body ? { body: i.body } : {}),
  ...(i.source === 'ai' ? { draft: !i.confirmed_at } : {}) });
const fields = () => Object.fromEntries((o.field ?? []).map((f) => {
  const k = f.indexOf('=');
  if (k < 1) throw new UserError(`--field は key=value の形で: ${f}`);
  return [f.slice(0, k), f.slice(k + 1)];
}));
const actor = () => (o.ai ? 'ai' : 'human');

function find(store, project, ref) {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(ref ?? '');
  const type = m && Object.keys(TYPES).find((t) => TYPES[t].prefix === m[1].toUpperCase());
  const item = type && store.listItems(project.id, { type }).find((i) => i.seq === Number(m[2]));
  if (!item) throw new UserError(`見つかりません: ${ref}（例: Q-3）`);
  return item;
}

async function main() {
  if (!cmd || o.help || cmd === 'help') return console.log(HELP);
  if (cmd === 'types') return out(TYPES);

  const store = new Store();
  if (cmd === 'serve') {
    const port = Number(o.port ?? process.env.PORT ?? 4321);
    await serve({ port, store });
    const url = `http://127.0.0.1:${port}/`;
    console.log(`段取り を起動しました: ${url}\n終了するには Ctrl+C`);
    if (o.open) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
    return;
  }
  if (cmd === 'init') return out(store.createProject({ name: args[0], purpose: o.purpose }));
  if (cmd === 'sample') return out(seedSample(store));
  if (cmd === 'projects') { const cur = store.currentProject(); return out(store.listProjects().map((p) => ({ ...p, current: p.id === cur?.id }))); }
  if (cmd === 'use') return out(store.selectProject(Number(args[0])));

  const project = store.currentProject();
  if (!project) throw new UserError('プロジェクトがありません。先に: dandori init <名前>');

  switch (cmd) {
    case 'add': {
      const parent = o.parent && find(store, project, o.parent);
      const about = o.about && find(store, project, o.about);
      const type = o.type;
      const item = store.addItem(project.id, { type, title: args.join(' '), body: o.body, owner: o.owner, due: o.due, fields: fields() }, actor());
      if (parent) type === 'requirement' ? store.setParent(item.id, parent.id, actor()) : store.link(item.id, parent.id, 'of', actor());
      if (about) store.link(item.id, about.id, 'about', actor());
      return out(slim(item));
    }
    case 'table': {
      const r = find(store, project, args[0]);
      const spec = o.conditions ? { kind: 'decision', conditions: splitNames(o.conditions), cells: {} }
        : { kind: 'state', states: splitNames(o.states ?? ''), events: splitNames(o.events ?? ''), cells: {} };
      if (spec.kind === 'decision' ? !spec.conditions.length || spec.conditions.length > 5 : !spec.states.length || !spec.events.length)
        throw new UserError('--conditions（1〜5個）か、--states と --events を指定してください');
      const t = store.addItem(project.id, { type: 'table', title: args.slice(1).join(' ') || '表', fields: { spec: JSON.stringify(spec) } }, actor());
      store.link(t.id, r.id, 'of', actor());
      return out({ id: displayId(t), ...summarize(t) });
    }
    case 'lint': case 'tree': {
      const a = analyze({ items: store.listItems(project.id), links: store.listLinks(project.id) });
      if (cmd === 'tree') {
        const walk = (r, d) => [`${'  '.repeat(d)}${displayId(r)} [${r.fields.layer ?? '?'}${r.fields.level === 'yes' ? ',level' : ''}] ${r.title}`, ...a.childrenOf.get(r.id).flatMap((ch) => walk(ch, d + 1))];
        return console.log(a.reqs.filter((r) => !a.parentOf.has(r.id)).flatMap((r) => walk(r, 0)).join('\n'));
      }
      const only = args[0] && find(store, project, args[0]);
      return out(a.reqs.filter((r) => !only || r.id === only.id).map((r) => ({ id: displayId(r), title: r.title,
        findings: a.findings.get(r.id).map((f) => ({ message: f.message, question: f.question ?? undefined, raised: f.raised })) })).filter((r) => only || r.findings.length));
    }
    case 'export': {
      const dir = resolve(args[0] ?? 'export');
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `${project.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.md`);
      writeFileSync(file, exportMarkdown({ project, items: store.listItems(project.id), links: store.listLinks(project.id) }));
      return out({ file });
    }
    case 'list':
      return out(store.listItems(project.id, { type: o.type }).filter((i) => o.all || !['done', 'dropped'].includes(i.status)).map(slim));
    case 'show': {
      const i = find(store, project, args[0]);
      return out({ ...slim(i), history: store.events({ itemId: i.id }).map((e) => ({ at: e.at, actor: e.actor, action: e.action, detail: e.detail })) });
    }
    case 'update': {
      const i = find(store, project, args[0]);
      return out(slim(store.updateItem(i.id, { title: o.title, type: o.type, status: o.status, owner: o.owner, due: o.due, body: o.body, fields: fields() }, actor())));
    }
    case 'next': {
      const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      return out(nextActions({ project, items: store.listItems(project.id), links: store.listLinks(project.id), today }).map(({ title, why }) => ({ title, why })));
    }
    default:
      throw new UserError(`知らないコマンドです: ${cmd}\n\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(e instanceof UserError ? e.message : e);
  process.exit(1);
});
