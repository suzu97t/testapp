#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// コマンドライン。人も、コーディングエージェントも、ここからデータを読み書きする。
// 出力は JSON（--pretty なしでも読めるよう整形済み）。

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { Store, UserError } from '../src/db.js';
import { serve } from '../src/server.js';
import { TYPES, displayId } from '../src/core/types.js';
import { nextActions } from '../src/core/next.js';

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
  dandori types                            種類と入力欄の一覧

  --ai を付けると「AIの案」として記録され、人が確認するまで決定扱いになりません。
  種類: ${Object.entries(TYPES).map(([k, v]) => `${k}(${v.short ?? v.label})`).join(' ')}`;

const { values: o, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' }, open: { type: 'boolean' }, purpose: { type: 'string' },
    type: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' },
    title: { type: 'string' }, status: { type: 'string' }, body: { type: 'string' },
    field: { type: 'string', multiple: true }, ai: { type: 'boolean' }, all: { type: 'boolean' },
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

  const project = store.currentProject();
  if (!project) throw new UserError('プロジェクトがありません。先に: dandori init <名前>');

  switch (cmd) {
    case 'add':
      return out(slim(store.addItem(project.id, { type: o.type, title: args.join(' '), body: o.body, owner: o.owner, due: o.due, fields: fields() }, actor())));
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
      return out(nextActions({ project, items: store.listItems(project.id), today }).map(({ title, why }) => ({ title, why })));
    }
    default:
      throw new UserError(`知らないコマンドです: ${cmd}\n\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(e instanceof UserError ? e.message : e);
  process.exit(1);
});
