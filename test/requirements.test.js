import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, UserError } from '../src/db.js';
import { lintText, lintRequirement } from '../src/core/lint.js';
import { analyze } from '../src/core/analyze.js';
import { decisionRows, blanks, summarize, splitNames } from '../src/core/tables.js';
import { nextActions } from '../src/core/next.js';
import { exportMarkdown } from '../src/core/export.js';
import { seedSample } from '../src/sample.js';

const sample = () => {
  const s = new Store(':memory:');
  const p = seedSample(s);
  const load = () => analyze({ items: s.listItems(p.id), links: s.listLinks(p.id) });
  const byTitle = (re) => s.listItems(p.id).find((i) => re.test(i.title));
  return { s, p, load, byTitle };
};
const keys = (a, r) => a.openFindings(r.id).map((f) => f.key);

test('曖昧な言葉を見つけ、問いの形で返す', () => {
  const f = lintText('店舗受け取りの注文は、適切に期限管理する。期限を過ぎたものは必要に応じて棚に戻す。');
  assert.deepEqual(f.map((x) => x.word), ['適切', '必要に応じて']);
  assert.ok(f.every((x) => x.question.endsWith('？')));
  assert.deepEqual(lintText('準備完了の通知から3日を過ぎた取り置きは、店員が棚に戻す'), []);
});

test('機能には受け入れ条件を求め、確かめられない結果を指摘する', () => {
  const r = { title: '一覧を見られる', fields: { layer: 'function' } };
  assert.deepEqual(lintRequirement(r).map((f) => f.key), ['no-criteria']);
  const ok = { id: 1, title: '通常', fields: { then: '一覧に3件表示される' } };
  assert.deepEqual(lintRequirement(r, [ok]).map((f) => f.key), ['only-happy']);
  const vague = { id: 2, title: '0件', fields: { then: '正しく処理される' } };
  assert.deepEqual(lintRequirement(r, [ok, vague]).map((f) => f.key), ['then-vague:2']);
  assert.deepEqual(lintRequirement({ title: '強みを活かす', fields: { layer: 'purpose' } }).map((f) => f.key), []);
});

test('業務の文に水準の数字が混ざっていたら指摘する', () => {
  const mixed = { title: '店員が在庫を3秒以内に案内できる', fields: { layer: 'business' } };
  assert.ok(lintRequirement(mixed).some((f) => f.key === 'mixed-level'));
  assert.ok(!lintRequirement({ ...mixed, fields: { layer: 'system', level: 'yes' } }).some((f) => f.key === 'mixed-level'));
});

test('練習用データ：下のない業務、上のない機能、層が未決の要件が見つかる', () => {
  const { load, byTitle } = sample();
  const a = load();
  assert.deepEqual(keys(a, byTitle(/棚に戻す$/)), ['no-child']);
  assert.deepEqual(keys(a, byTitle(/売上ランキング/)), ['no-parent', 'no-criteria']);
  assert.deepEqual(keys(a, byTitle(/適切に期限管理/)), ['no-layer', 'word:適切', 'word:必要に応じて']);
  assert.deepEqual(keys(a, byTitle(/在庫の表示は3秒以内/)), []);
  assert.deepEqual(keys(a, byTitle(/在庫を確認し、確保し/)), []);
});

test('練習用データ：3条件の表で空白が7つ数えられる', () => {
  const { s, p, load, byTitle } = sample();
  const t = s.listItems(p.id, { type: 'table' })[0];
  assert.deepEqual(summarize(t), { kind: 'decision', total: 8, blank: 7 });
  const f = load().openFindings(byTitle(/本人確認をして引き渡し/).id).find((x) => x.kind === 'table');
  assert.match(f.message, /空白が 7 つ/);
});

test('指摘から起票した未決は数えず、「問題ない」とした点も数えない', () => {
  const { s, p, load, byTitle } = sample();
  const r = byTitle(/適切に期限管理/);
  const q = s.addItem(p.id, { type: 'open', title: '誰が判定する？', fields: { lint_key: 'word:適切' } });
  s.link(q.id, r.id, 'about');
  assert.deepEqual(keys(load(), r), ['no-layer', 'word:必要に応じて']);
  assert.equal(load().findings.get(r.id).find((f) => f.key === 'word:適切').raised, 'Q-3');
  s.updateItem(r.id, { fields: { dismissed: 'word:必要に応じて' } });
  assert.deepEqual(keys(load(), r), ['no-layer']);
});

test('上下の付け替え：上は1つだけ。輪は作れない', () => {
  const { s, load, byTitle } = sample();
  const [goal, biz, sys] = [byTitle(/強みを/), byTitle(/来店時に渡す/), byTitle(/在庫を確認し、確保し/)];
  s.setParent(sys.id, goal.id);
  assert.equal(load().parentOf.get(sys.id), goal.id);
  assert.equal(s.listLinks(goal.project_id).filter((l) => l.from_id === sys.id && l.kind === 'parent').length, 1);
  assert.throws(() => s.setParent(goal.id, sys.id), UserError);
  assert.throws(() => s.setParent(biz.id, biz.id), UserError);
  s.setParent(sys.id, null);
  assert.ok(!load().parentOf.has(sys.id));
  s.setParent(goal.id, byTitle(/売上ランキング/).id); // 目的の上に機能を置くのは、層が逆
  assert.ok(keys(load(), goal).includes('bad-parent'));
});

test('表：行の並びと空白の数え方', () => {
  assert.deepEqual(decisionRows(['a', 'b']), ['YY', 'YN', 'NY', 'NN']);
  assert.equal(blanks({ kind: 'state', states: ['受付', '引渡'], events: ['期限', '取消'], cells: { '受付|期限': 'キャンセル', '引渡|期限': '—', '引渡|取消': '  ' } }).length, 2);
  assert.deepEqual(splitNames('期限内、現物あり\n本人確認, 期限内'), ['期限内', '現物あり', '本人確認']);
});

test('次の一手に、要件の点検結果が出る', () => {
  const { s, p } = sample();
  const k = nextActions({ project: s.currentProject(), items: s.listItems(p.id), links: s.listLinks(p.id), today: '2026-11-13' }).map((n) => n.key);
  for (const want of ['req-layer', 'req-criteria', 'table-blank', 'exception-undecided', 'req-trace', 'req-lint']) assert.ok(k.includes(want), want);
});

test('プロジェクトを切り替えられ、データは混ざらない', () => {
  const { s, p } = sample();
  const mine = s.createProject({ name: '本番' });
  assert.equal(s.currentProject().id, mine.id);
  assert.equal(s.listItems(mine.id).length, 0);
  assert.equal(s.selectProject(p.id).id, p.id);
  const other = s.addItem(mine.id, { type: 'requirement', title: 'x' });
  assert.throws(() => s.link(other.id, s.listItems(p.id)[0].id, 'about'), UserError);
});

test('書き出し：ツリー、受け入れ条件、表の未決、AIの案の印が入る', () => {
  const { s, p, byTitle } = sample();
  s.addItem(p.id, { type: 'decision', title: 'AIが勝手に決めた' }, 'ai');
  const md = exportMarkdown({ project: s.currentProject(), items: s.listItems(p.id), links: s.listLinks(p.id) });
  assert.match(md, /    - \*\*R-4\*\* ［システム］/);
  assert.match(md, /Given 商品Aの在庫が、渋谷店に2個ある/);
  assert.match(md, /\| 8 \| N \| N \| N \| ？（未決） \|/);
  assert.match(md, /【AIの案・未確認】AIが勝手に決めた/);
  assert.ok(!md.includes(byTitle(/年末は取り置き/).title), '受付箱の中身は書き出さない');
});
