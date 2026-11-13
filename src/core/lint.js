// 要件の文面を点検する。答えは出さない。「何が決まっていないか」を問いの形で返す。

// 未決定を隠しやすい言葉と、それを見つけたときの問い
const AMBIGUOUS = [
  ['適切', '「適切」かどうかは、誰が、何を見て判定しますか？'],
  ['適宜', '「適宜」とは、誰が、どんなときに、何をすることですか？'],
  ['必要に応じて', '「必要」かどうかは、誰が、どんな条件で判断しますか？'],
  ['場合によって', 'どんな場合に、どうなりますか？ 場合を並べられますか？'],
  ['柔軟', '「柔軟に」とは、具体的に何と何に対応できることですか？'],
  ['臨機応変', '誰の判断で、どこまで変えてよいですか？'],
  ['基本的に', '「基本」から外れるのは、どんなときですか？'],
  ['原則', '「原則」から外れるのは、どんなときですか？ そのとき誰が決めますか？'],
  ['など', '「など」に含まれるものを、全部並べられますか？'],
  ['十分', '「十分」とは、数字でいくつですか？'],
  ['なるべく', 'できなかったときは、どうなりますか？ 最低ラインはどこですか？'],
  ['できるだけ', 'できなかったときは、どうなりますか？ 最低ラインはどこですか？'],
  ['可能な限り', 'できなかったときは、どうなりますか？ 最低ラインはどこですか？'],
  ['速やかに', '何分・何時間以内ですか？'],
  ['迅速', '何分・何時間以内ですか？'],
  ['すぐに', '何秒・何分以内ですか？'],
  ['リアルタイム', '「リアルタイム」とは、何秒以内ですか？'],
  ['使いやすく', '誰が、何を、何回の操作でできれば「使いやすい」ですか？'],
  ['わかりやすく', '誰が見て、何が分かればよいですか？'],
  ['ちゃんと', '何がどうなっていれば「ちゃんと」ですか？'],
  ['しっかり', '何がどうなっていれば「しっかり」ですか？'],
  ['いい感じ', '何がどうなっていれば「いい感じ」ですか？'],
  ['改善', '誰の、何が、どこからどこまで良くなれば「改善」ですか？'],
];

// 水準（速さ・量・止まらなさ）の話らしい言い回し
const LEVEL = /\d+\s*(秒|分|時間|件|人|%|％)(以内|以上|以下|未満|まで)?|同時に?\d|稼働率|ピーク時/;
// 結果が確かめられない書き方
const VAGUE_THEN = /正しく|適切|問題なく|正常に|うまく|エラーになる[。]?$|失敗する[。]?$|エラーを?表示(する)?[。]?$/;

export function lintText(text) {
  const out = [];
  for (const [word, question] of AMBIGUOUS) {
    if (text.includes(word)) out.push({ key: `word:${word}`, kind: 'word', word, message: `「${word}」は、決まっていないことを隠しやすい言葉です`, question });
  }
  return out;
}

export function lintRequirement(req, criteria = []) {
  const text = `${req.title}\n${req.body ?? ''}`;
  const out = lintText(text);
  const layer = req.fields?.layer;
  if (req.fields?.level !== 'yes' && LEVEL.test(text) && layer && layer !== 'function')
    out.push({ key: 'mixed-level', kind: 'mixed', message: '水準（速さ・量）の話が混ざっています。分けて書くと、決まっていないことが見えます',
      question: `「${req.title}」の数字は、何を根拠に決めましたか？ 別の要件として分けますか？` });
  if (layer === 'function' && req.fields?.level !== 'yes') {
    if (!criteria.length)
      out.push({ key: 'no-criteria', kind: 'criteria', message: '受け入れ条件がありません。何が満たされたら「できた」と言えますか', question: `「${req.title}」は、何が満たされたら完了と言えますか？` });
    else if (criteria.length === 1)
      out.push({ key: 'only-happy', kind: 'criteria', message: '受け入れ条件が1本だけです。対象がゼロなら？ 同時なら？ 途中で切れたら？', question: `「${req.title}」で、うまくいかない場合はどうなりますか？` });
  }
  for (const c of criteria) for (const f of lintCriterion(c)) out.push(f);
  return out;
}

export function lintCriterion(c) {
  const out = [];
  const then = c.fields?.then ?? '';
  if (!then.trim())
    out.push({ key: `then-empty:${c.id}`, kind: 'criteria', message: `「${c.title}」の結果（どうなるか）が空です`, question: `「${c.title}」のとき、画面とデータはどうなりますか？` });
  else if (VAGUE_THEN.test(then))
    out.push({ key: `then-vague:${c.id}`, kind: 'criteria', message: `「${c.title}」の結果が確かめられない書き方です（${then.match(VAGUE_THEN)[0]}）`, question: `「${c.title}」のとき、利用者には何が見え、データはどうなりますか？` });
  return out;
}
