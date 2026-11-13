// データの置き場所。SQLite へのアクセスはこのファイルに閉じ込める
// （node:sqlite は実験的機能なので、差し替えられるようにしておく）。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES } from './core/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB = resolve(ROOT, 'data', 'dandori.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  charter TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  owner TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'human',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_by_type ON items(project_id, type);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES items(id),
  to_id INTEGER NOT NULL REFERENCES items(id),
  kind TEXT NOT NULL,
  UNIQUE(from_id, to_id, kind)
);
-- 追記のみ。誰が・いつ・何を・どう変えたか。記録は後から足せない。
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  item_id INTEGER,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
`;

const COLS = ['title', 'body', 'status', 'owner', 'due'];
const now = () => new Date().toISOString();

export class Store {
  constructor(path = process.env.DANDORI_DB || DEFAULT_DB) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() { this.db.close(); }

  #tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  #log(projectId, itemId, actor, action, detail = {}) {
    this.db.prepare('INSERT INTO events (project_id, item_id, at, actor, action, detail) VALUES (?,?,?,?,?,?)')
      .run(projectId, itemId, now(), actor, action, JSON.stringify(detail));
  }

  // ---- プロジェクト ----

  #project(row) { return row && { ...row, charter: JSON.parse(row.charter) }; }

  currentProject() {
    return this.#project(this.db.prepare('SELECT * FROM projects ORDER BY id DESC LIMIT 1').get());
  }

  createProject({ name, purpose = '' }, actor = 'human') {
    if (!name?.trim()) throw new UserError('プロジェクト名を入れてください');
    return this.#tx(() => {
      const { lastInsertRowid: id } = this.db.prepare('INSERT INTO projects (name, purpose, created_at) VALUES (?,?,?)')
        .run(name.trim(), purpose.trim(), now());
      this.#log(Number(id), null, actor, 'project.create', { name, purpose });
      return this.currentProject();
    });
  }

  updateProject(id, patch, actor = 'human') {
    return this.#tx(() => {
      const cur = this.#project(this.db.prepare('SELECT * FROM projects WHERE id=?').get(id));
      if (!cur) throw new UserError('プロジェクトが見つかりません');
      const changes = {};
      const next = { name: cur.name, purpose: cur.purpose, charter: { ...cur.charter } };
      for (const k of ['name', 'purpose']) {
        if (typeof patch[k] === 'string' && patch[k] !== cur[k]) { changes[k] = [cur[k], patch[k]]; next[k] = patch[k]; }
      }
      for (const [k, v] of Object.entries(patch.charter ?? {})) {
        if (v !== cur.charter[k]) { changes[`charter.${k}`] = [cur.charter[k] ?? '', v]; next.charter[k] = v; }
      }
      if (!next.name.trim()) throw new UserError('プロジェクト名は空にできません');
      if (Object.keys(changes).length) {
        this.db.prepare('UPDATE projects SET name=?, purpose=?, charter=? WHERE id=?')
          .run(next.name, next.purpose, JSON.stringify(next.charter), id);
        this.#log(id, null, actor, 'project.update', changes);
      }
      return this.currentProject();
    });
  }

  // ---- 項目 ----

  #item(row) { return row && { ...row, fields: JSON.parse(row.fields) }; }

  #nextSeq(projectId, type) {
    return this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM items WHERE project_id=? AND type=?').get(projectId, type).n;
  }

  getItem(id) { return this.#item(this.db.prepare('SELECT * FROM items WHERE id=?').get(id)); }

  listItems(projectId, { type } = {}) {
    const rows = type
      ? this.db.prepare('SELECT * FROM items WHERE project_id=? AND type=? ORDER BY id').all(projectId, type)
      : this.db.prepare('SELECT * FROM items WHERE project_id=? ORDER BY id').all(projectId);
    return rows.map((r) => this.#item(r));
  }

  addItem(projectId, input, actor = 'human') {
    const type = input.type ?? 'inbox';
    if (!TYPES[type]) throw new UserError(`知らない種類です: ${type}`);
    if (!input.title?.trim()) throw new UserError('内容が空です');
    return this.#tx(() => {
      const t = now();
      const source = actor === 'ai' ? 'ai' : 'human';
      const { lastInsertRowid } = this.db.prepare(
        `INSERT INTO items (project_id, type, seq, title, body, fields, status, owner, due, source, confirmed_by, confirmed_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(projectId, type, this.#nextSeq(projectId, type), input.title.trim(), input.body ?? '',
        JSON.stringify(input.fields ?? {}), type === 'inbox' ? 'new' : 'open', input.owner ?? '', input.due ?? '',
        source, source === 'human' ? 'human' : '', source === 'human' ? t : '', t, t);
      const id = Number(lastInsertRowid);
      this.#log(projectId, id, actor, 'create', { type, title: input.title.trim() });
      return this.getItem(id);
    });
  }

  // 変更。種類を変えると（受付箱からの振り分けなど）番号を振り直す。
  updateItem(id, patch, actor = 'human') {
    return this.#tx(() => {
      const cur = this.getItem(id);
      if (!cur) throw new UserError('項目が見つかりません');
      const next = { ...cur, fields: { ...cur.fields } };
      const changes = {};
      for (const k of COLS) {
        if (typeof patch[k] === 'string' && patch[k] !== cur[k]) { changes[k] = [cur[k], patch[k]]; next[k] = patch[k]; }
      }
      for (const [k, v] of Object.entries(patch.fields ?? {})) {
        if (v !== (cur.fields[k] ?? '')) { changes[`fields.${k}`] = [cur.fields[k] ?? '', v]; next.fields[k] = v; }
      }
      if (changes.status && !['new', 'open', 'done', 'dropped'].includes(next.status)) throw new UserError(`知らない状態です: ${next.status}`);
      if (patch.type && patch.type !== cur.type) {
        if (!TYPES[patch.type]) throw new UserError(`知らない種類です: ${patch.type}`);
        changes.type = [cur.type, patch.type];
        next.type = patch.type;
        next.seq = this.#nextSeq(cur.project_id, patch.type);
        if (cur.status === 'new') { next.status = 'open'; changes.status = ['new', 'open']; }
      }
      if (!next.title.trim()) throw new UserError('内容は空にできません');
      if (!Object.keys(changes).length) return cur;
      this.db.prepare('UPDATE items SET type=?, seq=?, title=?, body=?, fields=?, status=?, owner=?, due=?, updated_at=? WHERE id=?')
        .run(next.type, next.seq, next.title.trim(), next.body, JSON.stringify(next.fields), next.status, next.owner, next.due, now(), id);
      this.#log(cur.project_id, id, actor, changes.type ? 'convert' : 'update', changes);
      return this.getItem(id);
    });
  }

  // AIの案を、人が確認する。確認者の名前を残す（沈黙は合意ではない）。
  confirmItem(id, by = 'human') {
    return this.#tx(() => {
      const cur = this.getItem(id);
      if (!cur) throw new UserError('項目が見つかりません');
      const t = now();
      this.db.prepare('UPDATE items SET confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=?').run(by, t, t, id);
      this.#log(cur.project_id, id, by, 'confirm', {});
      return this.getItem(id);
    });
  }

  // 未決が決まった。決定を新しく作り、元の未決に紐づけて閉じる。
  resolveOpen(id, { decision, reason = '', alternatives = '', owner = '' }, actor = 'human') {
    const cur = this.getItem(id);
    if (!cur || cur.type !== 'open') throw new UserError('未決の項目ではありません');
    if (!decision?.trim()) throw new UserError('何を決めたかを書いてください');
    const d = this.addItem(cur.project_id, {
      type: 'decision', title: decision, owner: owner || cur.owner,
      fields: { reason, alternatives, context: cur.title },
    }, actor);
    this.#tx(() => {
      this.db.prepare('INSERT OR IGNORE INTO links (from_id, to_id, kind) VALUES (?,?,?)').run(d.id, id, 'resolves');
      this.db.prepare("UPDATE items SET status='done', updated_at=? WHERE id=?").run(now(), id);
      this.#log(cur.project_id, id, actor, 'resolve', { decision_id: d.id });
    });
    return d;
  }

  linksOf(id) {
    return this.db.prepare(
      `SELECT l.kind, l.from_id, l.to_id, i.id, i.type, i.seq, i.title
       FROM links l JOIN items i ON i.id = CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END
       WHERE l.from_id=? OR l.to_id=?`,
    ).all(id, id, id);
  }

  events({ projectId, itemId, limit = 50 }) {
    const rows = itemId
      ? this.db.prepare('SELECT * FROM events WHERE item_id=? ORDER BY id DESC LIMIT ?').all(itemId, limit)
      : this.db.prepare('SELECT * FROM events WHERE project_id=? ORDER BY id DESC LIMIT ?').all(projectId, limit);
    return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
  }
}

// 使う人の入力に原因があるエラー（画面にそのまま出してよい）
export class UserError extends Error {}
