import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, UserError } from '../src/db.js';
import { classify, splitLines } from '../src/core/classify.js';
import { nextActions, charterGaps } from '../src/core/next.js';
import { displayId } from '../src/core/types.js';

const fresh = () => {
  const s = new Store(':memory:');
  return [s, s.createProject({ name: '在庫統合', purpose: '' })];
};
const keys = (s, p, today = '2026-11-13') => nextActions({ project: s.currentProject(), items: s.listItems(p.id), today }).map((n) => n.key);

test('受付箱に入れたものは残り、履歴に1件ある', () => {
  const [s, p] = fresh();
  const i = s.addItem(p.id, { title: '売上の計上先はどちらか？' });
  assert.equal(i.type, 'inbox');
  assert.equal(i.status, 'new');
  assert.equal(s.events({ itemId: i.id }).length, 1);
});

test('受付箱から振り分けると、種類ごとの番号が振られ、履歴に残る', () => {
  const [s, p] = fresh();
  const a = s.addItem(p.id, { title: 'A' });
  const b = s.addItem(p.id, { title: 'B' });
  const q1 = s.updateItem(a.id, { type: 'open' });
  const q2 = s.updateItem(b.id, { type: 'open' });
  assert.equal(displayId(q1), 'Q-1');
  assert.equal(displayId(q2), 'Q-2');
  assert.equal(q1.status, 'open');
  const ev = s.events({ itemId: a.id });
  assert.equal(ev[0].action, 'convert');
  assert.deepEqual(ev[0].detail.type, ['inbox', 'open']);
});

test('変更がなければ履歴は増えない', () => {
  const [s, p] = fresh();
  const a = s.addItem(p.id, { type: 'open', title: 'A', owner: '部長' });
  s.updateItem(a.id, { title: 'A', owner: '部長', fields: {} });
  assert.equal(s.events({ itemId: a.id }).length, 1);
});

test('AIが足したものは案のまま。人が確認すると確認者が残る', () => {
  const [s, p] = fresh();
  const d = s.addItem(p.id, { type: 'decision', title: '期限は3日' }, 'ai');
  assert.equal(d.source, 'ai');
  assert.equal(d.confirmed_at, '');
  assert.ok(keys(s, p).includes('drafts'));
  const c = s.confirmItem(d.id);
  assert.equal(c.confirmed_by, 'human');
  assert.ok(!keys(s, p).includes('drafts'));
});

test('未決が決まると、決定が作られて紐づき、未決は閉じる', () => {
  const [s, p] = fresh();
  const q = s.addItem(p.id, { type: 'open', title: '売上の計上先', owner: '社長' });
  const d = s.resolveOpen(q.id, { decision: '店舗に計上する', alternatives: '通販に計上：店舗の協力が得られない' });
  assert.equal(d.type, 'decision');
  assert.equal(d.owner, '社長');
  assert.equal(s.getItem(q.id).status, 'done');
  assert.equal(s.linksOf(q.id)[0].kind, 'resolves');
  assert.throws(() => s.resolveOpen(d.id, { decision: 'x' }), UserError);
});

test('入力の誤りは UserError になる', () => {
  const [s, p] = fresh();
  assert.throws(() => s.addItem(p.id, { title: '  ' }), UserError);
  assert.throws(() => s.addItem(p.id, { type: 'nope', title: 'x' }), UserError);
  const a = s.addItem(p.id, { title: 'x' });
  assert.throws(() => s.updateItem(a.id, { status: 'whatever' }), UserError);
  assert.throws(() => s.createProject({ name: '' }), UserError);
});

test('次の一手：最初は目的、次にゴール。埋まると出なくなる', () => {
  const [s, p] = fresh();
  assert.deepEqual(keys(s, p).slice(0, 2), ['purpose', 'goal']);
  s.updateProject(p.id, { purpose: 'お客様を帰さない', charter: { goal_kind: 'operation' } });
  const k = keys(s, p);
  assert.ok(!k.includes('purpose') && !k.includes('goal'));
  assert.deepEqual(k, ['notdo', 'authority', 'exit']);
});

test('次の一手：期限切れの未決、人のいない未決、判定日の来た条件', () => {
  const [s, p] = fresh();
  s.addItem(p.id, { type: 'open', title: '期限切れ', owner: '部長', due: '2026-11-01' });
  s.addItem(p.id, { type: 'open', title: '人なし' });
  s.addItem(p.id, { type: 'exit', title: '月20件未満', due: '2026-11-13' });
  const k = keys(s, p);
  assert.ok(k.includes('open-overdue') && k.includes('open-ownerless') && k.includes('exit-due'));
  assert.ok(k.indexOf('open-overdue') < k.indexOf('open-ownerless'));
});

test('次の一手：憲章を30日開いていないと出る', () => {
  const [s, p] = fresh();
  s.updateProject(p.id, { purpose: 'x', charter: { goal_kind: 'release', reviewed_at: '2026-10-01' } });
  assert.ok(keys(s, p).includes('charter-stale'));
  s.updateProject(p.id, { charter: { reviewed_at: '2026-11-13' } });
  assert.ok(!keys(s, p).includes('charter-stale'));
});

test('憲章の空欄を数える', () => {
  const [s, p] = fresh();
  assert.equal(charterGaps({ project: s.currentProject(), items: [] }).length, 6);
  s.updateProject(p.id, { purpose: 'x', charter: { goal_kind: 'release', goal_text: 'y' } });
  s.addItem(p.id, { type: 'notdo', title: '倉庫は扱わない' });
  assert.deepEqual(charterGaps({ project: s.currentProject(), items: s.listItems(p.id) }), ['誰が何を決めるか', '立ち止まる条件']);
});

test('文面から種類を推測する', () => {
  assert.equal(classify('売上の計上先は店舗か通販か？'), 'open');
  assert.equal(classify('取り置き期限は3日に決定'), 'decision');
  assert.equal(classify('本部長が出席しないと展開が止まるかもしれない'), 'risk');
  assert.equal(classify('在庫とは、棚にある数のこと'), 'term');
  assert.equal(classify('期限を店舗ごとに変えてほしい'), 'request');
  assert.equal(classify('店員が取り置き一覧を見られる。表示は2秒以内'), 'requirement');
  assert.equal(classify('メモ'), null);
});

test('貼り付けを1行1件に分ける', () => {
  assert.deepEqual(splitLines('- 一つ目\n\n2. 二つ目\n・三つ目\n  \n（4）四つ目'), ['一つ目', '二つ目', '三つ目', '四つ目']);
});
