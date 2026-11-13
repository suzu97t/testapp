// 初見シナリオを実際のブラウザで通す。
// 使い方: node test/e2e.mjs [スクリーンショットの出力先]
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../src/db.js';
import { serve } from '../src/server.js';

// Playwright は依存に入れていない（グローバルに入っているものを使う）
const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv[2];
const dbPath = join(mkdtempSync(join(tmpdir(), 'dandori-')), 'e2e.db');
let store = new Store(dbPath);
let app = await serve({ port: 0, store });
const url = () => `http://127.0.0.1:${app.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
const step = (s) => console.log('✓', s);

try {
  // 1. はじめての画面：入力は2つだけ
  await page.goto(url());
  await page.getByLabel('プロジェクトの名前').fill('在庫統合プロジェクト');
  await shot('1-welcome');
  await page.getByRole('button', { name: '始める' }).click();
  await page.getByRole('heading', { name: '今日やること' }).waitFor();
  assert.equal(await page.locator('.card.next').count(), 2);
  assert.match(await page.locator('.card.next h3').first().innerText(), /何のため/);
  await shot('2-home-first');
  step('プロジェクトを作ると、ホームに「目的」と「ゴール」の2件が出る');

  // 2. 憲章で目的とゴールを決める
  await page.getByRole('button', { name: '1文で書く' }).click();
  await page.getByLabel('何のためのプロジェクト？').fill('店舗で欲しい商品を見つけられなかったお客様を、そのまま帰さない');
  await page.getByLabel('何のためのプロジェクト？').blur();
  await page.getByText('保存しました').waitFor();
  await page.getByText('業務が新しいやり方で回ったら').click();
  await page.locator('#toast.show').waitFor();
  await page.locator('input[value=operation]:checked').waitFor();
  step('憲章で目的を書き、ゴールの置き方を選べる');

  // 3. 受付箱に書く → 推測つきで振り分ける
  await page.getByLabel('受付箱に書く').fill('店舗受け取りの売上は、店舗と通販のどちらに計上するか？');
  await page.keyboard.press('Enter');
  await page.getByText('受付箱に 1 件入れました').waitFor();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text', '- 取り置き期限は全店共通で3日に決定\n- 本部長が出席しないまま進むと展開が止まるかもしれない\n- 店員が取り置き一覧を見られる');
    document.getElementById('capture').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.getByRole('heading', { name: '受付箱' }).waitFor();
  await page.locator('ul.list > li').nth(3).waitFor();
  assert.deepEqual(await page.locator('ul.list .chips button.primary').allInnerTexts(), ['未決', '決定', 'リスク', '要件']);
  await shot('3-inbox');
  for (let i = 0; i < 4; i++) {
    await page.locator('ul.list > li').first().locator('button.primary').click();
    await page.locator('ul.list > li').nth(3 - i).waitFor({ state: 'detached' });
  }
  await page.getByText('受付箱は空です').waitFor();
  step('1行と、貼り付けた3行が受付箱に入り、推測どおりに4件振り分けられる');

  // 4. 再起動しても消えない
  await new Promise((r) => app.close(r)); app.closeAllConnections?.(); store.close();
  store = new Store(dbPath); app = await serve({ port: 0, store });
  await page.goto(url() + '#/ledger/open');
  await page.locator('.id', { hasText: 'Q-1' }).waitFor();
  assert.match(await page.locator('ul.list > li').first().innerText(), /決める人がいません/);
  step('再起動してもデータが残っている');

  // 5. 未決に人と期限を付け、「決まった」で決定を記録する
  await page.locator('ul.list > li').first().click();
  await page.getByLabel('決める人').fill('社長');
  await page.getByLabel('いつまでに').fill('2027-08-31');
  await shot('4-edit-open');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('社長').first().waitFor();
  await page.locator('ul.list > li').first().click();
  assert.match(await page.locator('dialog details summary').innerText(), /履歴（3 件）/);
  await page.getByRole('button', { name: '決まった' }).click();
  await page.getByLabel('何を決めた？').fill('店舗受け取りの売上は店舗に計上する');
  await page.getByLabel('選ばなかった案と、その理由').fill('通販に計上：店舗側に協力する動機がなくなる');
  await page.getByRole('button', { name: '記録する' }).click();
  await page.locator('.id', { hasText: 'D-2' }).waitFor();
  await shot('5-decisions');
  step('未決を編集すると履歴が増え、「決まった」で決定 D-2 が記録される');

  // 6. 憲章：空欄が未決として数えられ、足すと減る
  await page.goto(url() + '#/charter');
  await page.getByText('いまの空欄：ゴールの中身・やらないこと・誰が何を決めるか・立ち止まる条件').waitFor();
  await page.getByRole('button', { name: '＋ 足す' }).first().click();
  await page.getByLabel('何をやらない？').fill('店舗間の在庫移動はやらない');
  await page.getByLabel('その代わりに何が起きる？').fill('偏りは現行の週次の補充で吸収する');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.id', { hasText: 'N-1' }).waitFor();
  await page.getByText('いまの空欄：ゴールの中身・誰が何を決めるか・立ち止まる条件').waitFor();
  await shot('6-charter');
  step('憲章の空欄が数えられ、やらないことを足すと減る');

  // 7. ホーム：3件まで。入力の誤りは画面に出る
  await page.goto(url() + '#/home');
  await page.locator('.card.next').first().waitFor();
  assert.ok((await page.locator('.card.next').count()) <= 3);
  await shot('7-home');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(url() + '#/ledger/risk');
  await page.locator('.id', { hasText: 'RK-1' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '横スクロールが出ている');
  await shot('8-mobile');
  step('ホームは3件以内。スマホ幅でも横にはみ出さない');

  assert.deepEqual(errors, []);
  console.log('すべて通りました');
} finally {
  await browser.close();
  app.close(); app.closeAllConnections?.();
}
