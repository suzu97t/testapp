// 項目の種類。画面の言葉は、フレームワーク名ではなく日常の言葉にする。
// 各フォームの入力欄は最大5つ（記入3分以内）。

export const TYPES = {
  inbox: { label: '受付', prefix: 'I', titleLabel: '内容', fields: [] },
  open: {
    label: 'まだ決まっていないこと', short: '未決', prefix: 'Q',
    titleLabel: '何が決まっていない？',
    example: '店舗受け取りの売上を、店舗とネット通販のどちらに計上するか',
    fields: [
      { key: 'owner', label: '決める人', col: true },
      { key: 'due', label: 'いつまでに', col: true, type: 'date' },
      { key: 'body', label: '補足', col: true, type: 'textarea' },
    ],
  },
  decision: {
    label: '決めたこと', short: '決定', prefix: 'D',
    titleLabel: '何を決めた？',
    example: '取り置きの期限は全店共通で3日とする',
    fields: [
      { key: 'reason', label: 'なぜそう決めた？', type: 'textarea' },
      { key: 'alternatives', label: '選ばなかった案と、その理由', type: 'textarea', hint: 'これが一番あとで効きます' },
      { key: 'premise', label: 'この前提が変わったら見直す' },
      { key: 'owner', label: '決めた人', col: true },
    ],
  },
  risk: {
    label: '起きたら困ること', short: 'リスク', prefix: 'RK',
    titleLabel: 'もし何が起きたら？（条件）',
    example: '店舗運営本部長が要件確認の場に出ないまま設計が完了した場合',
    fields: [
      { key: 'result', label: 'そのとき、どうなる？（結果）', type: 'textarea' },
      { key: 'sign', label: '何が見えたら近づいている？（兆候）' },
      { key: 'action', label: 'どうする？' },
      { key: 'owner', label: '見ている人', col: true },
    ],
  },
  term: {
    label: '言葉', short: '言葉', prefix: 'T',
    titleLabel: '言葉',
    example: '在庫（店舗）',
    fields: [
      { key: 'includes', label: '意味（含むもの）', type: 'textarea' },
      { key: 'excludes', label: '含まないもの', type: 'textarea', hint: '含まないものを書くと、初めて議論が起きます' },
    ],
  },
  requirement: {
    label: '要件', short: '要件', prefix: 'R',
    titleLabel: '何ができるようにする？',
    example: '店員が、取り置き対象の商品を一覧で見られる',
    fields: [{ key: 'body', label: '補足', col: true, type: 'textarea' }],
  },
  request: {
    label: '依頼', short: '依頼', prefix: 'RQ',
    titleLabel: '依頼のタイトル',
    example: '受け取り期限を店舗ごとに変えたい',
    fields: [
      { key: 'problem', label: '解決したい課題（要望ではなく）', type: 'textarea' },
      { key: 'who', label: '誰が困っている？' },
      { key: 'due', label: 'いつまでに', col: true, type: 'date' },
      { key: 'due_reason', label: 'その期日の根拠は？' },
      { key: 'workaround', label: '今はどうやって対処している？' },
    ],
  },
  notdo: {
    label: 'やらないこと', short: 'やらない', prefix: 'N',
    titleLabel: '何をやらない？',
    example: '店舗間の在庫移動はやらない',
    fields: [
      { key: 'instead', label: 'その代わりに何が起きる？', hint: '例：偏りは現行の週次の補充で吸収する' },
      { key: 'kind', label: 'いつまで？', type: 'select', options: ['今回はやらない（あとで再検討）', '恒久的にやらない'] },
    ],
  },
  exit: {
    label: '立ち止まる条件', short: '撤退基準', prefix: 'X',
    titleLabel: 'どうなったら立ち止まる？（測れる形で）',
    example: '3店舗で3か月運用して、注文が月20件に届かない',
    fields: [
      { key: 'due', label: '判定する日', col: true, type: 'date' },
      { key: 'owner', label: '判定する人', col: true },
      { key: 'action', label: '当てはまったら何をする？', hint: '中止ではなく「再判断する」でよい' },
    ],
  },
  authority: {
    label: '誰が何を決めるか', short: '決める人', prefix: 'A',
    titleLabel: '決めること',
    example: 'スコープの変更',
    fields: [{ key: 'owner', label: '決める人（必ず1人）', col: true }],
  },
};

// 受付箱から振り分けられる先
export const SORTABLE = ['open', 'decision', 'risk', 'term', 'requirement', 'request'];

export const GOAL_KINDS = {
  release: { label: 'リリースしたら', miss: '使われるかどうかは見ない。使われなくても終わり' },
  operation: { label: '業務が新しいやり方で回ったら', miss: '効果があったかどうかは見ない' },
  metric: { label: '数字が目標に届いたら', miss: '終わりが自分たちの手で決まらない' },
};

export function displayId(item) {
  return `${TYPES[item.type]?.prefix ?? '?'}-${item.seq}`;
}
