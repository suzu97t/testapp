// 練習用のデータ。下敷きにした本（プロジェクトマネジメントの教科書）に出てくる
// 架空の会社「まるみ屋」の店舗受け取りプロジェクトを、点検の練習になるよう
// わざと穴を残した形で入れる。

export function seedSample(store) {
  const p = store.createProject({ name: '練習用：まるみ屋 在庫統合', purpose: '店舗で欲しい商品を見つけられなかったお客様を、そのまま帰さない' });
  store.updateProject(p.id, { charter: { goal_kind: 'operation', goal_text: '第1段階：3店舗で店舗受け取りが運用できる。第2段階：20店舗すべてで運用が回る（ここで解散）', constraints: '期間は6か月。開発は5人（専任3、兼任2）。夜間の在庫集計と月末の締め処理は止めない' } });
  const add = (type, title, rest = {}) => store.addItem(p.id, { type, title, ...rest });
  const req = (layer, title, parent, rest = {}) => {
    const r = add('requirement', title, { ...rest, fields: { layer, ...(rest.fields ?? {}) } });
    if (parent) store.setParent(r.id, parent.id);
    return r;
  };

  add('notdo', '倉庫の在庫は扱わない', { fields: { instead: '店舗とネット通販の2つだけを対象にする', kind: '恒久的にやらない' } });
  add('notdo', '店舗間の在庫移動はやらない', { fields: { instead: '偏りは現行の週次の補充で吸収する', kind: '今回はやらない（あとで再検討）' } });
  add('authority', 'スコープの変更', { owner: 'ネット通販部長' });
  add('authority', '店舗受け取りの売上の計上先', { owner: '社長' });
  add('exit', '先行3店舗で3か月運用して、店舗受け取りの注文が月20件に届かない', { owner: 'ネット通販部長', fields: { action: '残り17店舗への展開を止めて、設計を見直す' } });

  const goal = req('purpose', '店舗が近くにあるという強みを、ネット注文の受け皿にする');
  const biz = req('business', 'お客様が選んだ店舗で、店員が商品を取り置き、来店時に渡す', goal);
  const back = req('business', '期限までに来店がなかった取り置きを、店員が棚に戻す', goal); // 下がない＝抜け
  const sys = req('system', '店舗ごとの在庫を確認し、確保し、店舗に指示を出す', biz);
  const pick = req('function', 'お客様が受け取り店舗を選んで注文を確定できる', sys);
  req('function', '店員が取り置き対象の一覧を見られる', sys);
  const hand = req('function', '店員が本人確認をして引き渡しを記録できる', sys);
  req('function', '店舗別の売上ランキングを表示する'); // 上がない＝根拠なし
  req('system', '在庫の表示は3秒以内', biz, { fields: { level: 'yes' } });
  add('requirement', '店舗受け取りの注文は、適切に期限管理する。期限を過ぎたものは必要に応じて棚に戻す。'); // 層が未決・曖昧語

  const ac = add('criterion', '在庫があるとき', { fields: { given: '商品Aの在庫が、渋谷店に2個ある', when: 'お客様が受け取り店舗に渋谷店を選び、注文を確定する', then: '渋谷店の商品Aの在庫が1個減り、取り置き一覧に「未対応」で表示される' } });
  store.link(ac.id, pick.id, 'of');

  const tb = add('table', '来店して引き渡すとき', { fields: { spec: JSON.stringify({ kind: 'decision', conditions: ['期限内', '現物あり', '本人確認できた'], cells: { YYY: '引き渡す。注文を引渡済にする' } }) } });
  store.link(tb.id, hand.id, 'of');

  add('open', '店舗受け取りの売上を、店舗とネット通販のどちらに計上するか', { owner: '社長', due: '2027-08-31' });
  add('open', '入荷済みで棚に出す前の在庫を、受け取りの対象に含めるか');
  add('decision', '取り置きの期限は、全店共通で準備完了の通知から3日とする', { owner: 'ネット通販部長', fields: { reason: '店舗ごとに変えると、お客様への案内が複雑になる', alternatives: '', premise: '期限切れによる取り消しが月20件を超えたら見直す' } });
  add('risk', '店舗運営本部長が要件確認の場に出ないまま設計が完了した場合', { owner: 'PM', fields: { result: '展開直前に差し戻され、20店舗への展開が1か月以上止まる', sign: '定例に代理出席が2回続く', action: '月1回15分の個別説明の枠を確保する' } });
  add('risk', '「在庫」の意味が部署ごとに違うまま、画面の項目名が決まった場合', { fields: { result: '受け入れテストで数字の解釈が割れて2週間延びる', sign: '' } });
  add('term', '在庫（店舗）', { fields: { includes: 'その店舗の棚とバックヤードにあり、取り置き済みでないものの数', excludes: '他店の在庫、倉庫の在庫、発注済みで未着のもの' } });
  add('term', '取り置き', { fields: { includes: '在庫を確保してから引き渡すまでの状態', excludes: '' } });
  add('exception', '期限が切れた後に、お客様が来店した', { fields: { handling: '' } });
  add('exception', '棚に現物がなかった', { owner: 'ネット通販部長', fields: { handling: 'システムで扱う' }, body: '店員が「現物なし」を記録できるようにし、在庫を実数に直す' });
  add('inbox', '年末は取り置き件数が2倍になるらしい。棚が溢れるかもしれない');
  add('inbox', '代理の人が受け取りに来たらどうする？');
  return store.currentProject();
}
