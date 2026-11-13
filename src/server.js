// ローカル専用のサーバー。127.0.0.1 でのみ待ち受ける。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, UserError } from './db.js';
import { TYPES, SORTABLE, GOAL_KINDS, displayId } from './core/types.js';
import { classify, splitLines } from './core/classify.js';
import { nextActions, charterGaps } from './core/next.js';
import { analyze, LAYERS } from './core/analyze.js';
import { summarize, parseSpec } from './core/tables.js';
import { VIEWPOINTS, HANDLING } from './core/viewpoints.js';
import { exportMarkdown } from './core/export.js';
import { seedSample } from './sample.js';

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
    ['GET', /^\/api\/meta$/, () => ({ types: TYPES, sortable: SORTABLE, goalKinds: GOAL_KINDS, layers: LAYERS, viewpoints: VIEWPOINTS, handling: HANDLING })],
    ['GET', /^\/api\/state$/, () => {
      const project = store.currentProject();
      if (!project) return { project: null, projects: [] };
      const items = store.listItems(project.id);
      const next = nextActions({ project, items, links: store.listLinks(project.id), today: today() });
      const counts = {};
      for (const i of items) {
        if (i.status === 'dropped' || i.status === 'done') continue;
        counts[i.type] = (counts[i.type] ?? 0) + 1;
      }
      return { project, projects: store.listProjects(), today: today(), next: next.slice(0, 3), nextMore: Math.max(0, next.length - 3), counts, gaps: charterGaps({ project, items }) };
    }],
    ['POST', /^\/api\/project$/, (_, body) => store.createProject(body)],
    ['PATCH', /^\/api\/project$/, (_, body) => store.updateProject(needProject().id, body)],
    ['GET', /^\/api\/items$/, (_, __, q) => store.listItems(needProject().id, { type: q.get('type') || undefined }).map(view)],
    ['POST', /^\/api\/items$/, (_, body) => {
      const item = store.addItem(needProject().id, body);
      if (body.link) store.link(item.id, Number(body.link.to), body.link.kind);
      if (body.parent_id) store.setParent(item.id, Number(body.parent_id));
      return view(item);
    }],
    ['POST', /^\/api\/projects\/select$/, (_, body) => store.selectProject(Number(body.id))],
    ['POST', /^\/api\/sample$/, () => seedSample(store)],
    ['POST', /^\/api\/items\/(\d+)\/parent$/, (m, body) => { store.setParent(Number(m[1]), body.parent_id ? Number(body.parent_id) : null); return { ok: true }; }],
    ['GET', /^\/api\/requirements$/, () => {
      const p = needProject();
      const a = analyze({ items: store.listItems(p.id), links: store.listLinks(p.id) });
      return a.reqs.map((r) => ({ ...view(r), parent_id: a.parentOf.get(r.id) ?? null, findings: a.openFindings(r.id).length,
        criteria: a.criteriaOf(r.id).length, tables: a.tablesOf(r.id).length }));
    }],
    ['GET', /^\/api\/requirements\/(\d+)$/, (m) => {
      const p = needProject();
      const a = analyze({ items: store.listItems(p.id), links: store.listLinks(p.id) });
      const r = a.byId.get(Number(m[1]));
      if (!r || r.type !== 'requirement') throw new UserError('要件が見つかりません');
      const parent = a.byId.get(a.parentOf.get(r.id));
      return { item: view(r), parent: parent ? view(parent) : null, children: a.childrenOf.get(r.id).map(view),
        candidates: a.reqs.filter((x) => x.id !== r.id).map(view), criteria: a.criteriaOf(r.id).map(view),
        tables: a.tablesOf(r.id).map((t) => ({ ...view(t), ...summarize(t) })), opens: a.opensOf(r.id).map(view), findings: a.findings.get(r.id) };
    }],
    ['GET', /^\/api\/tables\/(\d+)$/, (m) => {
      const t = store.getItem(Number(m[1]));
      if (!t || t.type !== 'table') throw new UserError('表が見つかりません');
      const of = store.linksOf(t.id).find((l) => l.kind === 'of');
      return { item: view(t), spec: parseSpec(t), ...summarize(t), requirement: of ? { id: of.id, display_id: displayId(of), title: of.title } : null };
    }],
    ['GET', /^\/api\/sweep$/, () => {
      const p = needProject();
      const ex = store.listItems(p.id, { type: 'exception' }).filter((i) => i.status !== 'dropped').map(view);
      return { exceptions: ex, viewpoints: VIEWPOINTS.map((v) => ({ ...v, cleared: p.charter[`sweep_${v.key}`] ?? null, found: ex.filter((e) => e.fields.viewpoint === v.key).length })) };
    }],
    ['GET', /^\/api\/export$/, () => {
      const p = needProject();
      return { name: p.name, markdown: exportMarkdown({ project: p, items: store.listItems(p.id), links: store.listLinks(p.id) }) };
    }],
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
