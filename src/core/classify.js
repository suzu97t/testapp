// 受付箱に入った1行が、どの種類らしいかを当てる（AIなしの素朴なルール）。
// 外れてもよい。人が1クリックで直せる。

const RULES = [
  ['request', /てほしい|て欲しい|お願い|依頼|対応して|ください$/],
  ['term', /とは[、。 ]|とは$|の定義|という言葉|の意味/],
  ['decision', /決定|決めた|決まった|合意した|ことにした|とする[。]?$|にする[。]?$/],
  ['open', /[?？]\s*$|かどうか|未定|未決|決まっていない|決まってない|どうする|要確認|確認する$/],
  ['risk', /リスク|懸念|心配|恐れ|おそれ|かもしれない|((たら|場合|ないと).*(遅れ|止ま|困|間に合わ|できな|崩れ|溢れ|ずれ))/],
  ['requirement', /できる|したい|表示|登録|検索|通知|一覧|必要|べき/],
];

export function classify(text) {
  for (const [type, re] of RULES) if (re.test(text)) return type;
  return null;
}

// 貼り付けた複数行を、1行1件に分ける。行頭の記号や番号は落とす。
export function splitLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*・●■□◯○]|\d+[.)、]|[（(]\d+[)）])\s*/, '').trim())
    .filter(Boolean);
}
