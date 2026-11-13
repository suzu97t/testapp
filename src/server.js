// ローカル専用のサーバー。127.0.0.1 でのみ待ち受ける。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, UserError } from './db.js';
import { TYPES, SORTABLE, GOAL_KINDS, displayId } from './core/types.js';
import { classify, splitLines } from './core/classify.js';
import { nextActions, charterGaps } from './core/next.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const view = (i) => ({ ...i, display_id: displayId(i), suggestion: i.type === 'inbox' ? classify(i.title) : undefined });

export function createApp(store = new Store()) {
  const needProject = () => {
    const p = store.currentProject();
    if (!p) throw new UserError('先にプロジェクトを作ってください');
    return p;
  };

  const routes = [
    ['GET', /^\/api\/meta$/, () => ({ types: TYPES, sortable: SORTABLE, goalKinds: GOAL_KINDS })],
    ['GET', /^\/api\/state$/, () => {
      const project = store.currentProject();
      if (!project) return { project: null };
      const items = store.listItems(project.id);
      const next = nextActions({ project, items, today: today() });
      const counts = {};
      for (const i of items) {
        if (i.status === 'dropped' || i.status === 'done') continue;
        counts[i.type] = (counts[i.type] ?? 0) + 1;
      }
      return { project, today: today(), next: next.slice(0, 3), nextMore: Math.max(0, next.length - 3), counts, gaps: charterGaps({ project, items }) };
    }],
    ['POST', /^\/api\/project$/, (_, body) => store.createProject(body)],
    ['PATCH', /^\/api\/project$/, (_, body) => store.updateProject(needProject().id, body)],
    ['GET', /^\/api\/items$/, (_, __, q) => store.listItems(needProject().id, { type: q.get('type') || undefined }).map(view)],
    ['POST', /^\/api\/items$/, (_, body) => view(store.addItem(needProject().id, body))],
    // 受付箱：複数行の貼り付けを1行1件にして入れる
    ['POST', /^\/api\/inbox$/, (_, body) => {
      const p = needProject();
      const lines = splitLines(body.text ?? '');
      if (!lines.length) throw new UserError('内容が空です');
      return lines.map((title) => view(store.addItem(p.id, { type: 'inbox', title })));
    }],
    ['GET', /^\/api\/items\/(\d+)$/, (m) => {
      const item = store.getItem(Number(m[1]));
      if (!item) throw new UserError('項目が見つかりません');
      return { item: view(item), events: store.events({ itemId: item.id }), links: store.linksOf(item.id).map((l) => ({ ...l, display_id: displayId(l) })) };
    }],
    ['PATCH', /^\/api\/items\/(\d+)$/, (m, body) => view(store.updateItem(Number(m[1]), body))],
    ['POST', /^\/api\/items\/(\d+)\/confirm$/, (m) => view(store.confirmItem(Number(m[1])))],
    ['POST', /^\/api\/items\/(\d+)\/resolve$/, (m, body) => view(store.resolveOpen(Number(m[1]), body))],
    ['GET', /^\/api\/events$/, () => store.events({ projectId: needProject().id, limit: 100 })],
  ];

  return createServer(async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    try {
      // 他サイトのページからローカルのデータを触られないようにする
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost'].includes(host)) return send(403, { error: 'forbidden' });
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method !== 'GET') {
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON で送ってください' });
          const chunks = [];
          for await (const c of req) chunks.push(c);
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        }
        for (const [method, re, fn] of routes) {
          const m = req.method === method && url.pathname.match(re);
          if (m) return send(200, fn(m, body, url.searchParams));
        }
        return send(404, { error: '見つかりません' });
      }

      const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = join(WEB, rel);
      if (!file.startsWith(WEB)) return send(403, { error: 'forbidden' });
      send(200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
    } catch (e) {
      if (e instanceof UserError || e instanceof SyntaxError) return send(400, { error: e.message });
      if (e.code === 'ENOENT') return send(404, { error: '見つかりません' });
      console.error(e);
      send(500, { error: '内部エラーが起きました。ターミナルの表示を確認してください。' });
    }
  });
}

export function serve({ port = 4321, store } = {}) {
  return new Promise((ok, ng) => {
    const app = createApp(store);
    app.once('error', ng);
    app.listen(port, '127.0.0.1', () => ok(app));
  });
}
