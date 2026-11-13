// 「今日やること」を選ぶ。データから機械的に候補を作り、優先度順に並べる。
// 画面に出すのは先頭3件だけ（同時に多くを始めない）。

import { displayId } from './types.js';

const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);

export function nextActions({ project, items, today }) {
  const out = [];
  const add = (priority, key, title, why, href, action) => out.push({ priority, key, title, why, href, action });
  const c = project.charter ?? {};
  const live = items.filter((i) => i.status !== 'dropped');
  const of = (t) => live.filter((i) => i.type === t);
  const active = (t) => of(t).filter((i) => i.status === 'open');

  if (!project.purpose?.trim())
    add(100, 'purpose', 'このプロジェクトは何のため？', '目的が言葉になっていないと、後の優先順位がすべて感覚論になります。', '#/charter', '1文で書く');

  if (!c.goal_kind)
    add(95, 'goal', '何ができたら「終わり」？', 'リリース・運用が回る・数字が出る、のどれで終わるかで、関係者の期待がずれます。', '#/charter', '選ぶ');

  const inbox = of('inbox').filter((i) => i.status === 'new');
  if (inbox.length)
    add(90, 'inbox', `受付箱に未整理が ${inbox.length} 件`, '書きっぱなしにせず、種類を決めて台帳に送ります。1件数秒です。', '#/inbox', '整理する');

  const overdue = active('open').filter((i) => i.due && i.due < today);
  if (overdue.length)
    add(88, 'open-overdue', `期限を過ぎた未決が ${overdue.length} 件（${displayId(overdue[0])} ほか）`,
      '決める人に聞くか、期限を引き直します。放置された未決は、現場が勝手に埋めます。', '#/ledger/open', '見る');

  const drafts = live.filter((i) => i.source === 'ai' && !i.confirmed_at && i.type !== 'inbox');
  if (drafts.length)
    add(85, 'drafts', `AIの案が ${drafts.length} 件、確認待ち`, '確認するまで「決まったこと」には数えません。採用するか、直すか、捨てます。', `#/ledger/${drafts[0].type}`, '確認する');

  const judge = active('exit').filter((i) => i.due && i.due <= today);
  if (judge.length)
    add(84, 'exit-due', `立ち止まる条件の判定日が来ています（${displayId(judge[0])}）`, '当てはまったかどうかを確かめる約束の日です。', '#/charter', '判定する');

  const ownerless = active('open').filter((i) => !i.owner || !i.due);
  if (ownerless.length)
    add(70, 'open-ownerless', `決める人か期限のない未決が ${ownerless.length} 件`,
      '人と日付が付いた時点で、放置された論点ではなくなります。', '#/ledger/open', '付ける');

  if (project.purpose?.trim() && c.goal_kind) {
    if (!of('notdo').length)
      add(60, 'notdo', 'やらないことを1つ書く', '「それは困る」と言う人が、本当の関係者です。境界は外側を決めて初めて引けます。', '#/charter', '書く');
    if (!of('authority').length)
      add(55, 'authority', '誰が何を決めるかを1つ書く', '判断が下りてこないことが、プロジェクトが止まる一番の原因です。', '#/charter', '書く');
    if (!of('exit').length)
      add(50, 'exit', '立ち止まる条件を1つ書く', '苦しくなってからでは書けません。余裕のある今しか置けない条件です。', '#/charter', '書く');
  }

  const thin = active('decision').filter((i) => !i.fields?.alternatives?.trim());
  if (thin.length)
    add(40, 'decision-thin', `選ばなかった案が書かれていない決定が ${thin.length} 件`,
      '半年後に「こうすればよかったのでは」と言われたとき、検討済みかどうかが分かります。', '#/ledger/decision', '足す');

  const vague = active('risk').filter((i) => !i.fields?.sign?.trim());
  if (vague.length)
    add(35, 'risk-sign', `兆候が書かれていない「起きたら困ること」が ${vague.length} 件`,
      '確率は見積りですが、兆候は観測できます。兆候があれば定例の5分で見回れます。', '#/ledger/risk', '足す');

  const reviewed = c.reviewed_at ?? project.created_at?.slice(0, 10);
  if (project.purpose?.trim() && reviewed && daysBetween(reviewed, today) >= 30)
    add(30, 'charter-stale', `憲章を ${daysBetween(reviewed, today)} 日開いていません`, '前提が変わったのに憲章が変わっていない状態は、憲章がないより悪くなります。', '#/charter', '見直す');

  return out.sort((a, b) => b.priority - a.priority);
}

// 憲章の空欄。未記入は「未決」として数える。
export function charterGaps({ project, items }) {
  const c = project.charter ?? {};
  const has = (t) => items.some((i) => i.type === t && i.status !== 'dropped');
  const gaps = [];
  if (!project.purpose?.trim()) gaps.push('目的');
  if (!c.goal_kind) gaps.push('ゴールの置き方');
  if (!c.goal_text?.trim()) gaps.push('ゴールの中身');
  if (!has('notdo')) gaps.push('やらないこと');
  if (!has('authority')) gaps.push('誰が何を決めるか');
  if (!has('exit')) gaps.push('立ち止まる条件');
  return gaps;
}
