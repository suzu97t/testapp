// 要件定義の画面を、練習用データ（まるみ屋）で通す。
// 使い方: node test/e2e-req.mjs [スクリーンショットの出力先]
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../src/db.js';
import { serve } from '../src/server.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv[2];
const store = new Store(join(mkdtempSync(join(tmpdir(), 'dandori-')), 'e2e.db'));
const app = await serve({ port: 0, store });
const url = `http://127.0.0.1:${app.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
const step = (s) => console.log('✓', s);
const row = (id) => page.locator('ul.list > li', { has: page.locator('.id', { hasText: new RegExp(`^${id}$`) }) });

try {
  await page.goto(url);
  await page.getByRole('button', { name: '練習用のプロジェクトで試す' }).click();
  await page.getByRole('heading', { name: '今日やること' }).waitFor();
  assert.equal(await page.locator('.card.next').count(), 3);
  step('はじめての画面から、練習用のプロジェクトを1クリックで作れる');

  // 層のツリー：上のない機能と、下のない業務が見える
  await page.locator('nav.tabs').getByRole('link', { name: /^要件/ }).click();
  await page.getByRole('heading', { name: 'まだ整理していない要件（1）' }).waitFor();
  assert.match(await row('R-3').innerText(), /気になる点 1/);
  assert.match(await row('R-8').innerText(), /気になる点 2/);
  assert.match(await row('R-4').innerText(), /✓/);
  await shot('m2-1-tree');
  step('ツリーで、下のない業務 R-3 と、上のない機能 R-8 に印が付く');

  // 曖昧な言葉 → 未決を起票
  await page.getByRole('link', { name: /適切に期限管理/ }).click();
  await page.getByText('「適切」は、決まっていないことを隠しやすい言葉です').waitFor();
  await page.getByText('「必要に応じて」は、決まっていないことを隠しやすい言葉です').waitFor();
  await shot('m2-2-lint');
  await page.locator('.finding', { hasText: '「適切」' }).getByRole('button', { name: '未決として起票する' }).click();
  await page.getByText(/起票済み：Q-3/).waitFor();
  await page.getByRole('button', { name: '＋ 未決を書く' }).click();
  await page.getByLabel('何が決まっていない？').fill('期限の起算点は、注文時か、準備完了の通知時か');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('heading', { name: 'この要件の未決（2）' }).waitFor();
  await page.getByLabel('どの層の話？').selectOption('business');
  await page.getByText('これを実現するものが、下にまだありません（抜け）').waitFor();
  step('曖昧な言葉から未決を起票でき、手で足した未決も要件に紐づく。層を決めると次の点検が出る');

  // 下のない業務
  await page.goto(url + '#/requirements');
  await row('R-3').click();
  await page.getByText('これを実現するものが、下にまだありません（抜け）').waitFor();
  await page.getByRole('button', { name: '＋ この下に足す' }).click();
  await page.getByLabel('何ができるようにする？').last().fill('棚に戻したことを、店員が記録できる');
  assert.equal(await page.locator('dialog #f-layer').inputValue(), 'system');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('heading', { name: 'この下にあるもの（1）' }).waitFor();
  assert.equal(await page.getByText('これを実現するものが、下にまだありません（抜け）').count(), 0);
  step('下のない業務に「この下に足す」と、抜けの指摘が消える');

  // 条件の組み合わせ表：空白7
  await page.goto(url + '#/requirements');
  await row('R-7').click();
  await page.getByText('空白 7 / 8').waitFor();
  await page.locator('.finding').getByRole('button', { name: '表を開く' }).click();
  await page.getByText('空白：残り 7 / 8').waitFor();
  await shot('m2-3-table');
  await page.getByLabel(/^2行目/).fill('注文番号の提示があれば、代理でも渡す');
  await page.getByLabel(/^2行目/).blur();
  await page.getByText('空白：残り 6 / 8').waitFor();
  await page.reload();
  await page.getByText('空白：残り 6 / 8').waitFor();
  assert.equal(await page.getByLabel(/^2行目/).inputValue(), '注文番号の提示があれば、代理でも渡す');
  step('3条件の表で空白7が数えられ、1行埋めると6になり、読み込み直しても残る');

  // 状態と出来事の表を新しく作る
  await page.getByRole('link', { name: /← R-7/ }).click();
  await page.getByRole('button', { name: '＋ 状態と出来事' }).click();
  await page.getByLabel('どの場面の表？').fill('取り置き注文の状態');
  await page.getByLabel('状態（1行に1つ）').fill('受付済\n確保済\n引渡済');
  await page.getByLabel('出来事（1行に1つ）').fill('期限到来\n客がキャンセル');
  await page.getByRole('button', { name: '表を作る' }).click();
  await page.getByText('空白：残り 6 / 6').waitFor();
  await page.getByLabel('引渡済 のときに 期限到来').fill('—');
  await page.getByLabel('引渡済 のときに 期限到来').blur();
  await page.getByText('空白：残り 5 / 6').waitFor();
  await shot('m2-4-state');
  step('状態と出来事の表を作れ、「起きない」と決めたマスは空白から外れる');

  // 受け入れ条件：確かめられない結果を指摘
  await page.goto(url + '#/requirements');
  await row('R-6').click();
  await page.getByText('受け入れ条件がありません').waitFor();
  await page.getByRole('button', { name: '＋ 場合を足す' }).click();
  await page.getByLabel('どんな場合？（ひとことで）').fill('取り置きが1件もない');
  await page.getByLabel('どういう状態のとき（前提）').fill('その店舗に取り置き対象が0件');
  await page.getByLabel('何をしたら（操作）').fill('店員が一覧を開く');
  await page.getByLabel('どうなる（結果）').fill('正しく処理される');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/結果が確かめられない書き方です（正しく）/).waitFor();
  await page.getByText('受け入れ条件が1本だけです').waitFor();
  await shot('m2-5-criteria');
  step('受け入れ条件を足すと、「正しく処理される」と「1本だけ」が指摘される');

  // 例外さがし
  await page.goto(url + '#/requirements/sweep');
  await page.getByText('17 の観点のうち 0 済み').waitFor();
  await page.getByLabel('出てきた例外').fill('年末セールの初日に、同じ商品へ注文が集中する');
  await page.keyboard.press('Enter');
  await page.getByText('17 の観点のうち 1 済み').waitFor();
  await page.getByRole('button', { name: /^時間/ }).click();
  await page.getByRole('heading', { name: '観点：時間' }).waitFor();
  await page.getByRole('button', { name: '何も出てこなかった' }).click();
  await page.getByText('17 の観点のうち 2 済み').waitFor();
  await page.getByLabel('年末セールの初日に、同じ商品へ注文が集中する をどう扱うか').selectOption('システムで扱う');
  await page.locator('#toast.show', { hasText: '保存しました' }).waitFor();
  await shot('m2-6-sweep');
  step('観点を当てて例外を足せ、「何も出なかった」も記録され、扱いを一覧で決められる');

  // プロジェクトの切り替えと書き出し
  const md = (await (await page.request.get(url + 'api/export')).json()).markdown;
  assert.match(md, /R-11.*棚に戻したことを、店員が記録できる/);
  assert.match(md, /\| 2 \| Y \| Y \| N \| 注文番号の提示があれば、代理でも渡す \|/);
  assert.match(md, /？（未決）/);
  await page.getByLabel('プロジェクトを切り替える').selectOption('new');
  await page.getByLabel('プロジェクトの名前').fill('本番のプロジェクト');
  await page.getByRole('button', { name: '始める' }).click();
  await page.getByRole('heading', { name: '今日やること' }).waitFor();
  assert.equal(await page.getByLabel('プロジェクトを切り替える').locator('option').count(), 4);
  await page.getByLabel('プロジェクトを切り替える').selectOption({ label: '練習用：まるみ屋 在庫統合' });
  await page.getByText('目的：店舗で欲しい商品を').waitFor();
  step('Markdown に表と未決が書き出される。プロジェクトを足して切り替えられる');

  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ['#/requirements', '#/requirements/7', '#/requirements/sweep']) {
    await page.goto(url + path);
    await page.locator('main h1').waitFor();
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} が横にはみ出している`);
  }
  await shot('m2-7-mobile');
  step('スマホ幅でも横にはみ出さない');

  assert.deepEqual(errors, []);
  console.log('すべて通りました');
} finally {
  await browser.close();
  app.close(); app.closeAllConnections?.();
}
