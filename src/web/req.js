// 要件まわりの画面：層のツリー、1件の点検、例外さがしの表、観点での例外さがし。

import { h, api, toast, guard, refresh, T, META, STATE, itemRow, editDialog, showDialog } from './app.js';

const layer = (key) => META.layers.find((l) => l.key === key);
const layerBadge = (item) => {
  const l = layer(item.fields?.layer);
  return h('span', { class: `layer ${l ? '' : 'none'}` }, l ? l.label : '層が未決', item.fields?.level === 'yes' ? '・水準' : '');
};
const patch = (id, body, msg) => guard(async () => {
  await api('PATCH', `/api/items/${id}`, body);
  if (msg) toast(msg);
  await refresh();
})();

// ---- 一覧：層のツリー ----

export async function requirements() {
  const reqs = await api('GET', '/api/requirements');
  const kids = new Map();
  for (const r of reqs) if (r.parent_id) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  const order = (r) => layer(r.fields.layer)?.order ?? 9;
  const unsorted = reqs.filter((r) => !r.fields.layer);
  const roots = reqs.filter((r) => !r.parent_id && r.fields.layer).sort((a, b) => order(a) - order(b));
  const total = reqs.reduce((n, r) => n + r.findings, 0);

  const row = (r, depth) => [
    h('li', { class: 'click', tabindex: 0, role: 'link', style: `padding-left:${16 + depth * 22}px`,
      onclick: () => (location.hash = `#/requirements/${r.id}`),
      onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/requirements/${r.id}`) },
      layerBadge(r),
      h('span', { class: 'item-title' }, h('span', { class: 'id' }, r.display_id), r.title,
        r.source === 'ai' && !r.confirmed_at ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'AIの案・未確認') : null),
      r.findings ? h('span', { class: 'flag' }, `気になる点 ${r.findings}`) : h('span', { class: 'ok' }, '✓')),
    (kids.get(r.id) ?? []).map((c) => row(c, depth + 1)),
  ];

  return [
    h('h1', {}, '要件'),
    h('p', { class: 'muted' }, '上から「なぜ → 誰が何を → システムが何を → 具体的に何が」の順に並べます。上に辿れない機能は根拠がなく、下のない業務は抜けです。'),
    h('div', { class: 'row spread' },
      h('span', { class: 'small' }, reqs.length ? (total ? `気になる点が全部で ${total} あります` : '気になる点はありません') : ''),
      h('div', { class: 'row' },
        h('button', { onclick: () => (location.hash = '#/requirements/sweep') }, '例外さがし'),
        h('button', { class: 'primary', onclick: () => editDialog({ type: 'requirement', fields: {} }) }, '＋ 足す'))),

    unsorted.length ? [
      h('h2', {}, `まだ整理していない要件（${unsorted.length}）`),
      h('p', { class: 'muted small' }, 'これはどの話ですか？ 1つ選んでください。1文に複数の話が混ざっていたら、開いて分けます。'),
      h('ul', { class: 'list' }, unsorted.map((r) => h('li', {},
        h('div', { class: 'item-title' }, h('span', { class: 'id' }, r.display_id), h('a', { href: `#/requirements/${r.id}` }, r.title)),
        h('div', { class: 'chips' }, META.layers.map((l) =>
          h('button', { title: l.hint, onclick: () => patch(r.id, { fields: { layer: l.key } }, `${l.label}の層に置きました`) }, `${l.label}：${l.hint}`)))))),
    ] : null,

    roots.length ? [unsorted.length ? h('h2', {}, '整理済み') : null, h('ul', { class: 'list tree' }, roots.map((r) => row(r, 0)))]
      : !unsorted.length ? h('div', { class: 'empty' }, h('b', {}, '要件はまだありません'),
        '受付箱から「要件」に送るか、「＋ 足す」で書けます。', h('div', { class: 'example' }, `書き方の例：${T('requirement').example}`)) : null,
  ];
}

// ---- 1件：点検・受け入れ条件・表 ----

export async function requirement(id) {
  const d = await api('GET', `/api/requirements/${id}`);
  const r = d.item;
  const myOrder = layer(r.fields.layer)?.order ?? 9;

  const title = h('input', { id: 'q-title', value: r.title });
  title.addEventListener('change', () => patch(r.id, { title: title.value }, '保存しました'));
  const body = h('textarea', { id: 'q-body', value: r.body, placeholder: '背景や、業務側で取り決めたことなど' });
  body.addEventListener('change', () => patch(r.id, { body: body.value }, '保存しました'));
  const layerSel = h('select', { id: 'q-layer' }, h('option', { value: '' }, '（まだ決めない）'),
    META.layers.map((l) => h('option', { value: l.key, selected: l.key === r.fields.layer }, `${l.label}：${l.hint}`)));
  layerSel.addEventListener('change', () => patch(r.id, { fields: { layer: layerSel.value } }, '保存しました'));
  const parents = d.candidates.filter((c) => (layer(c.fields.layer)?.order ?? 9) < myOrder || c.id === d.parent?.id);
  const parentSel = h('select', { id: 'q-parent' }, h('option', { value: '' }, '（なし）'),
    parents.map((c) => h('option', { value: c.id, selected: c.id === d.parent?.id }, `${c.display_id} ${c.title}`)));
  parentSel.addEventListener('change', guard(async () => {
    await api('POST', `/api/items/${r.id}/parent`, { parent_id: parentSel.value || null });
    toast('保存しました');
    await refresh();
  }));
  const level = h('input', { type: 'checkbox', id: 'q-level', checked: r.fields.level === 'yes' });
  level.addEventListener('change', () => patch(r.id, { fields: { level: level.checked ? 'yes' : '' } }, '保存しました'));

  const raise = (f) => guard(async () => {
    const q = await api('POST', '/api/items', { type: 'open', title: f.question, fields: { lint_key: f.key }, link: { to: r.id, kind: 'about' } });
    toast(`未決 ${q.display_id} として起票しました。決める人と期限は台帳で付けられます`);
    await refresh();
  });
  const dismiss = (f) => () => patch(r.id, { fields: { dismissed: [r.fields.dismissed, f.key].filter(Boolean).join('\n') } }, '問題なしとして記録しました');
  const active = d.findings.filter((f) => !f.raised);
  const raised = d.findings.filter((f) => f.raised);

  const newTable = (kind) => () => {
    const name = h('input', { id: 't-name', required: true, placeholder: '例：来店して引き渡すとき' });
    const a = h('textarea', { id: 't-a', required: true, placeholder: kind === 'decision' ? '期限内\n現物あり\n本人確認できた' : '受付済\n確保済\n準備完了\n引渡済' });
    const b = kind === 'state' ? h('textarea', { id: 't-b', required: true, placeholder: '来店・引渡\n期限到来\n客がキャンセル\n現物なし判明' }) : null;
    const dlg = h('dialog', {});
    dlg.append(h('form', { onsubmit: guard(async (e) => {
      e.preventDefault();
      const names = (el) => [...new Set(el.value.split(/[\n,、]/).map((x) => x.trim()).filter(Boolean))];
      const spec = kind === 'decision' ? { kind, conditions: names(a), cells: {} } : { kind, states: names(a), events: names(b), cells: {} };
      if (kind === 'decision' && spec.conditions.length > 5) throw new Error('条件は5つまでにしてください（5つで32行になります）。多いときは場面を分けます');
      const t = await api('POST', '/api/items', { type: 'table', title: name.value, fields: { spec: JSON.stringify(spec) }, link: { to: r.id, kind: 'of' } });
      dlg.close();
      location.hash = `#/requirements/table/${t.id}`;
    }) },
      h('h2', {}, kind === 'decision' ? '条件の組み合わせ表を作る' : '状態と出来事の表を作る'),
      h('p', { class: 'muted small' }, kind === 'decision'
        ? '「はい／いいえ」で答えられる条件を並べると、すべての組み合わせを行にします。埋まらない行が、決まっていない例外です。'
        : '対象が取りうる状態と、起きうる出来事を並べると、掛け合わせを表にします。「この状態でこれが起きたら？」を1マスずつ確かめます。'),
      h('label', { for: 't-name' }, 'どの場面の表？'), name,
      h('label', { for: 't-a' }, kind === 'decision' ? '条件（1行に1つ、5つまで）' : '状態（1行に1つ）'), a,
      b ? [h('label', { for: 't-b' }, '出来事（1行に1つ）'), b] : null,
      h('div', { class: 'actions' }, h('button', { class: 'primary' }, '表を作る'), h('button', { type: 'button', class: 'push', onclick: () => dlg.close() }, 'やめる'))));
    showDialog(dlg);
  };

  const nextLayer = META.layers[Math.min(myOrder + 1, 3)]?.key ?? 'function';

  return [
    h('p', { class: 'small' }, h('a', { href: '#/requirements' }, '← 要件の一覧')),
    h('h1', {}, h('span', { class: 'id' }, r.display_id), r.title),
    r.source === 'ai' && !r.confirmed_at ? h('p', {}, h('span', { class: 'badge' }, 'AIの案・未確認'), ' ',
      h('button', { onclick: guard(async () => { await api('POST', `/api/items/${r.id}/confirm`); toast('確認しました'); await refresh(); }) }, '確認済みにする')) : null,

    h('div', { class: 'card fields' },
      h('div', { class: 'wide' }, h('label', { for: 'q-title', style: 'margin-top:0' }, '何ができるようにする？'), title),
      h('div', {}, h('label', { for: 'q-layer' }, 'どの層の話？'), layerSel),
      h('div', {}, h('label', { for: 'q-parent' }, '何のため？（1つ上の要件）'), parentSel),
      h('div', { class: 'wide' }, h('label', { class: 'check', for: 'q-level' }, level, '速さ・量・止まらなさなど「どの水準で動くか」の話')),
      h('div', { class: 'wide' }, h('label', { for: 'q-body' }, '補足'), body)),

    h('h2', {}, active.length ? `気になる点（${active.length}）` : '気になる点'),
    active.length ? active.map((f) => h('div', { class: 'card finding' },
      h('div', {}, f.message),
      f.question ? h('div', { class: 'q' }, `問い：${f.question}`) : null,
      h('div', { class: 'row' },
        f.question ? h('button', { class: 'primary', onclick: raise(f) }, '未決として起票する') : null,
        f.table_id ? h('button', { class: 'primary', onclick: () => (location.hash = `#/requirements/table/${f.table_id}`) }, '表を開く') : null,
        f.kind !== 'trace' && f.kind !== 'table' ? h('button', { class: 'quiet', onclick: dismiss(f) }, 'これは問題ない') : null)))
      : h('p', { class: 'ok' }, '✓ いま機械的に見つかる点はありません。'),
    raised.length ? h('p', { class: 'small muted' }, `起票済み：${raised.map((f) => f.raised).join('、')}`) : null,

    h('div', { class: 'row spread sec' }, h('h2', {}, `受け入れ条件（${d.criteria.length}）`),
      h('button', { onclick: () => editDialog({ type: 'criterion', fields: {}, link: { to: r.id, kind: 'of' } }) }, '＋ 場合を足す')),
    h('p', { class: 'muted small' }, 'うまくいく場合は1本、うまくいかない場合は4本以上出るのが普通です。対象がゼロなら？ 同時なら？ 途中で切れたら？ 権限がなかったら？'),
    d.criteria.length ? h('ul', { class: 'list' }, d.criteria.map((c) =>
      h('li', { class: 'click', tabindex: 0, role: 'button', onclick: () => editDialog(c), onkeydown: (e) => e.key === 'Enter' && editDialog(c) },
        h('div', { class: 'item-title' }, h('span', { class: 'id' }, c.display_id), h('b', {}, c.title),
          c.source === 'ai' && !c.confirmed_at ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'AIの案・未確認') : null),
        h('dl', { class: 'gwt' },
          h('dt', {}, '前提'), h('dd', {}, c.fields.given || '—'),
          h('dt', {}, '操作'), h('dd', {}, c.fields.when || '—'),
          h('dt', {}, '結果'), h('dd', {}, c.fields.then || '—')))))
      : h('div', { class: 'empty' }, h('b', {}, 'まだありません'), '実装を始める前に書くと、仕様の穴が先に見つかります。'),

    h('div', { class: 'row spread sec' }, h('h2', {}, `例外さがしの表（${d.tables.length}）`),
      h('div', { class: 'row' }, h('button', { onclick: newTable('decision') }, '＋ 条件の組み合わせ'), h('button', { onclick: newTable('state') }, '＋ 状態と出来事'))),
    d.tables.length ? h('ul', { class: 'list' }, d.tables.map((t) =>
      h('li', { class: 'click', tabindex: 0, role: 'link', onclick: () => (location.hash = `#/requirements/table/${t.id}`),
        onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/requirements/table/${t.id}`) },
        h('div', { class: 'row spread' },
          h('span', { class: 'item-title' }, h('span', { class: 'id' }, t.display_id), t.title),
          t.blank ? h('span', { class: 'flag' }, `空白 ${t.blank} / ${t.total}`) : h('span', { class: 'ok' }, `✓ ${t.total} マスすべて埋まっています`)))))
      : h('p', { class: 'muted small' }, '「例外はありますか」と聞いても出てきません。表にして空白を見せると、人は埋めたくなります。'),

    h('div', { class: 'row spread sec' }, h('h2', {}, `この下にあるもの（${d.children.length}）`),
      h('button', { onclick: () => editDialog({ type: 'requirement', fields: { layer: nextLayer }, parent_id: r.id }) }, '＋ この下に足す')),
    d.children.length ? h('ul', { class: 'list tree' }, d.children.map((c) =>
      h('li', { class: 'click', onclick: () => (location.hash = `#/requirements/${c.id}`) }, layerBadge(c),
        h('span', { class: 'item-title' }, h('span', { class: 'id' }, c.display_id), c.title), h('span', {})))) : null,

    h('div', { class: 'row spread sec' }, h('h2', {}, `この要件の未決（${d.opens.filter((o) => o.status === 'open').length}）`),
      h('button', { onclick: () => editDialog({ type: 'open', fields: {}, link: { to: r.id, kind: 'about' } }) }, '＋ 未決を書く')),
    d.opens.length ? h('ul', { class: 'list' }, d.opens.map(itemRow)) : null,

    h('p', { style: 'margin-top:40px' }, h('button', { class: 'quiet', onclick: guard(async () => {
      await api('PATCH', `/api/items/${r.id}`, { status: 'dropped' });
      toast('捨てました（履歴には残ります）');
      location.hash = '#/requirements';
    }) }, 'この要件を捨てる')),
  ];
}

// ---- 表：空白を数えて見せる ----

export async function tableEditor(id) {
  const d = await api('GET', `/api/tables/${id}`);
  const spec = d.spec;
  spec.cells ??= {};
  const keys = spec.kind === 'decision'
    ? Array.from({ length: 2 ** spec.conditions.length }, (_, i) => spec.conditions.map((_, j) => ((i >> (spec.conditions.length - 1 - j)) & 1 ? 'N' : 'Y')).join(''))
    : spec.states.flatMap((s) => spec.events.map((e) => `${s}|${e}`));
  const progress = h('p', { class: 'progress', 'aria-live': 'polite' });
  const show = () => {
    const blank = keys.filter((k) => !String(spec.cells[k] ?? '').trim()).length;
    progress.textContent = blank ? `空白：残り ${blank} / ${keys.length}` : `✓ ${keys.length} マスすべて埋まりました`;
    progress.className = `progress ${blank ? '' : 'ok'}`;
  };
  const cell = (key, label) => {
    const input = h('input', { value: spec.cells[key] ?? '', placeholder: '？', 'aria-label': label });
    const td = h('td', { class: `cell ${input.value.trim() ? '' : 'blank'}` }, input);
    input.addEventListener('change', guard(async () => {
      spec.cells[key] = input.value.trim();
      td.className = `cell ${input.value.trim() ? '' : 'blank'}`;
      show();
      await api('PATCH', `/api/items/${id}`, { fields: { spec: JSON.stringify(spec) } });
    }));
    return td;
  };
  show();
  const grid = spec.kind === 'decision'
    ? h('table', { class: 'grid' },
      h('tr', {}, h('th', {}, '#'), spec.conditions.map((c) => h('th', {}, c)), h('th', {}, 'どうする？')),
      keys.map((k, n) => h('tr', {}, h('td', { class: 'yn muted' }, String(n + 1)),
        [...k].map((v) => h('td', { class: 'yn' }, v === 'Y' ? 'はい' : 'いいえ')),
        cell(k, `${n + 1}行目：${spec.conditions.map((c, j) => `${c}＝${k[j] === 'Y' ? 'はい' : 'いいえ'}`).join('、')}`))))
    : h('table', { class: 'grid' },
      h('tr', {}, h('th', {}, '状態 ＼ 出来事'), spec.events.map((e) => h('th', {}, e))),
      spec.states.map((s) => h('tr', {}, h('th', {}, s), spec.events.map((e) => cell(`${s}|${e}`, `${s} のときに ${e}`)))));
  return [
    d.requirement ? h('p', { class: 'small' }, h('a', { href: `#/requirements/${d.requirement.id}` }, `← ${d.requirement.display_id} ${d.requirement.title}`)) : null,
    h('h1', {}, h('span', { class: 'id' }, d.item.display_id), d.item.title),
    h('p', { class: 'muted' }, spec.kind === 'decision'
      ? '1行ずつ「この組み合わせのとき、どうしますか？」と確かめます。分からない行は空白のままで構いません。空白が、まだ決まっていない例外です。'
      : '1マスずつ「この状態のときにこれが起きたら、どうなりますか？」と確かめます。起きないと決めたマスには「—」と書きます。'),
    progress,
    h('div', { class: 'scroll' }, grid),
    h('p', { class: 'small muted', style: 'margin-top:12px' }, '入力はマスを離れたときに保存されます。'),
    h('div', { class: 'row', style: 'margin-top:20px' },
      h('button', { onclick: () => editDialog({ type: 'exception', fields: {} }) }, '＋ ここで見つかった例外を書く'),
      h('button', { class: 'quiet', onclick: guard(async () => {
        await api('PATCH', `/api/items/${id}`, { status: 'dropped' });
        toast('表を捨てました（履歴には残ります）');
        location.hash = d.requirement ? `#/requirements/${d.requirement.id}` : '#/requirements';
      }) }, 'この表を捨てる')),
  ];
}

// ---- 例外さがし：観点を1つずつ当てる ----

let currentViewpoint = null;

export async function sweep() {
  const d = await api('GET', '/api/sweep');
  const done = d.viewpoints.filter((v) => v.cleared || v.found).length;
  const v = d.viewpoints.find((x) => x.key === currentViewpoint) ?? d.viewpoints.find((x) => !x.cleared && !x.found) ?? d.viewpoints[0];
  const input = h('input', { id: 'ex-new', placeholder: '出てきた例外を1行で', 'aria-label': '出てきた例外' });
  const addEx = guard(async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    currentViewpoint = v.key;
    await api('POST', '/api/items', { type: 'exception', title: input.value, fields: { viewpoint: v.key } });
    toast('例外を記録しました。扱いは下の一覧で決められます');
    await refresh();
    document.getElementById('ex-new')?.focus();
  });
  const clear = guard(async () => {
    await api('PATCH', '/api/project', { charter: { [`sweep_${v.key}`]: STATE.today } });
    currentViewpoint = d.viewpoints[d.viewpoints.indexOf(v) + 1]?.key ?? v.key;
    toast(`「${v.label}」は何も出なかった、と記録しました`);
    await refresh();
  });
  const setHandling = (ex, sel) => guard(async () => {
    await api('PATCH', `/api/items/${ex.id}`, { fields: { handling: sel.value } });
    toast('保存しました');
    await refresh();
  });
  return [
    h('p', { class: 'small' }, h('a', { href: '#/requirements' }, '← 要件の一覧')),
    h('h1', {}, '例外さがし'),
    h('p', { class: 'muted' }, '稀なことは、聞かれないと誰も思い出しません。観点を1つずつ当てます。1つにつき5分で十分です。何も出てこなければ、それも成果です。'),
    h('p', { class: 'progress' }, `${d.viewpoints.length} の観点のうち ${done} 済み`),
    h('div', { class: 'vp' }, d.viewpoints.map((x) =>
      h('button', { 'aria-pressed': String(x.key === v.key), onclick: () => { currentViewpoint = x.key; refresh(); } },
        h('span', {}, x.label), h('span', { class: x.found ? 'flag' : 'ok' }, x.found ? `${x.found}件` : x.cleared ? '✓' : '')))),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, `観点：${v.label}`),
      h('ul', {}, v.prompts.map((p) => h('li', {}, p))),
      h('form', { class: 'row', onsubmit: addEx }, h('div', { style: 'flex:1;min-width:200px' }, input), h('button', { class: 'primary' }, '例外を足す')),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { onclick: clear }, '何も出てこなかった'),
        v.cleared ? h('span', { class: 'small muted' }, `前回の確認：${v.cleared}`) : null)),

    h('div', { class: 'row spread sec' }, h('h2', {}, `見つかった例外（${d.exceptions.length}）`),
      h('button', { onclick: () => editDialog({ type: 'exception', fields: {} }) }, '＋ 足す')),
    h('p', { class: 'muted small' }, 'すべてをシステムで扱う必要はありません。扱わないと決めることも、立派な決定です。決めないまま残すのが一番危険です。'),
    d.exceptions.length ? h('ul', { class: 'list' }, d.exceptions.map((ex) => {
      const sel = h('select', { 'aria-label': `${ex.title} をどう扱うか`, style: 'max-width:260px' },
        h('option', { value: '' }, 'どう扱う？（未決）'), META.handling.map((o) => h('option', { value: o, selected: o === ex.fields.handling }, o)));
      sel.addEventListener('change', setHandling(ex, sel));
      const undecided = !ex.fields.handling || ex.fields.handling === 'まだ決まっていない';
      return h('li', {},
        h('div', { class: 'item-title' }, h('span', { class: 'id' }, ex.display_id), h('a', { href: '#', onclick: (e) => { e.preventDefault(); editDialog(ex); } }, ex.title),
          ex.source === 'ai' && !ex.confirmed_at ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'AIの案・未確認') : null,
          undecided ? h('span', { class: 'flag', style: 'margin-left:8px' }, '扱いが未決') : null),
        h('div', { class: 'row', style: 'margin-top:6px' }, sel, ex.owner ? h('span', { class: 'small muted' }, `決めた人：${ex.owner}`) : null));
    })) : h('div', { class: 'empty' }, h('b', {}, 'まだ見つかっていません'), '上の観点を当てるか、要件の画面で表を作ると出てきます。'),
  ];
}
