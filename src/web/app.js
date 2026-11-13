// 画面。ビルド不要の素の JavaScript。
// 文字列は必ず textContent 経由で入れる（h() が面倒を見る）。

const $app = document.getElementById('app');
let META = null;
let STATE = null;

// ---- 小道具 ----

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '失敗しました');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isError ? 5000 : 2400);
}

// 失敗を握りつぶさず、画面に出す
const guard = (fn) => async (...a) => {
  try { await fn(...a); } catch (e) { toast(e.message, true); }
};

const T = (type) => META.types[type];
const short = (type) => T(type).short ?? T(type).label;
const fmtDate = (iso) => iso.slice(0, 16).replace('T', ' ');

// ---- 起動と画面の切り替え ----

async function refresh() {
  STATE = await api('GET', '/api/state');
  await render();
}

async function render() {
  if (!STATE.project) return $app.replaceChildren(welcome());
  const [route = 'home', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const pages = { home, inbox, requirements, ledger, charter };
  const page = pages[route] ?? home;
  const body = await page(arg);
  // 描き直しても、受付欄に書きかけの文字とカーソルは失わない
  const old = document.getElementById('capture');
  const keep = old && { value: old.value, focused: document.activeElement === old };
  $app.replaceChildren(header(pages[route] ? route : 'home'), h('main', { class: 'wrap' }, body));
  if (keep) {
    const input = document.getElementById('capture');
    input.value = keep.value;
    if (keep.focused) input.focus();
  }
}

function header(route) {
  const tab = (id, label, count) =>
    h('a', { href: `#/${id}`, 'aria-current': route === id ? 'page' : null }, label, count ? h('span', { class: 'count' }, String(count)) : null);
  const input = h('input', {
    id: 'capture', placeholder: '思いついたこと・聞いたこと・頼まれたことを、なんでも1行で', 'aria-label': '受付箱に書く', autocomplete: 'off',
  });
  const submit = guard(async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const added = await api('POST', '/api/inbox', { text: input.value });
    document.getElementById('capture').value = '';
    toast(`受付箱に ${added.length} 件入れました`);
    await refresh();
  });
  // 複数行を貼り付けたら、1行1件として受け付ける
  input.addEventListener('paste', guard(async (e) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    const added = await api('POST', '/api/inbox', { text });
    toast(`貼り付けた内容を ${added.length} 件に分けて受付箱に入れました`);
    location.hash = '#/inbox';
    await refresh();
  }));
  const c = STATE.counts;
  return h('header', { class: 'top' }, h('div', { class: 'wrap' },
    h('div', { class: 'brand' }, h('b', {}, '段取り'), h('span', { class: 'muted small' }, STATE.project.name)),
    h('form', { class: 'capture', onsubmit: submit }, input, h('button', { class: 'primary' }, '受付箱へ')),
    h('nav', { class: 'tabs', 'aria-label': 'メニュー' },
      tab('home', 'ホーム'), tab('inbox', '受付箱', c.inbox), tab('requirements', '要件', c.requirement),
      tab('ledger', '台帳', (c.open ?? 0) || null), tab('charter', '憲章', STATE.gaps.length || null)),
  ));
}

// ---- はじめての画面 ----

function welcome() {
  const name = h('input', { id: 'p-name', required: true, placeholder: '例：在庫統合プロジェクト', autofocus: true });
  const purpose = h('textarea', { id: 'p-purpose', placeholder: '例：店舗で欲しい商品を見つけられなかったお客様を、そのまま帰さない' });
  return h('main', { class: 'wrap welcome' },
    h('h1', {}, 'プロジェクトを始める'),
    h('p', { class: 'muted' }, '入力は2つだけです。あとからいつでも直せます。'),
    h('form', {
      class: 'card',
      onsubmit: guard(async (e) => {
        e.preventDefault();
        await api('POST', '/api/project', { name: name.value, purpose: purpose.value });
        location.hash = '#/home';
        await refresh();
      }),
    },
      h('label', { for: 'p-name' }, 'プロジェクトの名前'), name,
      h('label', { for: 'p-purpose' }, '何のためのプロジェクト？', h('span', { class: 'hint' }, 'まだ書けなければ空でかまいません')), purpose,
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'primary' }, '始める')),
    ));
}

// ---- ホーム：今日やること ----

function home() {
  const p = STATE.project;
  const cards = STATE.next.map((n) =>
    h('div', { class: 'card next' },
      h('h3', {}, n.title), h('p', {}, n.why),
      h('button', { class: 'primary', onclick: () => (location.hash = n.href) }, n.action)));
  const c = STATE.counts;
  const stat = (type) => h('a', { href: `#/ledger/${type}` }, `${short(type)} ${c[type] ?? 0}`);
  return [
    h('h1', {}, '今日やること'),
    h('p', { class: 'muted' }, p.purpose ? `目的：${p.purpose}` : '目的はまだ書かれていません。'),
    cards.length ? cards : h('div', { class: 'empty' }, h('b', {}, '今日やることはありません'), '思いついたことは、上の欄に1行で書いておいてください。'),
    STATE.nextMore ? h('p', { class: 'muted small' }, `ほかに ${STATE.nextMore} 件ありますが、上の3件が先です。`) : null,
    h('h2', {}, 'いまの状況'),
    h('p', { class: 'row small' }, stat('open'), stat('decision'), stat('risk'), stat('term'), stat('request'),
      h('a', { href: '#/requirements' }, `要件 ${c.requirement ?? 0}`)),
  ];
}

// ---- 受付箱 ----

async function inbox() {
  const items = (await api('GET', '/api/items?type=inbox')).filter((i) => i.status === 'new');
  const move = (item, type) => guard(async () => {
    const moved = await api('PATCH', `/api/items/${item.id}`, { type });
    toast(`${short(type)} ${moved.display_id} にしました`);
    await refresh();
  });
  const drop = (item) => guard(async () => {
    await api('PATCH', `/api/items/${item.id}`, { status: 'dropped' });
    toast('捨てました（履歴には残ります）');
    await refresh();
  });
  return [
    h('h1', {}, '受付箱'),
    h('p', { class: 'muted' }, 'これは何ですか？ 1つ選ぶと台帳に送られます。色の付いたボタンは、文面からの推測です。'),
    items.length
      ? h('ul', { class: 'list' }, items.map((i) =>
        h('li', {},
          h('div', { class: 'item-title' }, i.title),
          h('div', { class: 'chips' },
            META.sortable.map((t) => h('button', { class: i.suggestion === t ? 'primary' : '', title: T(t).label, onclick: move(i, t) }, short(t))),
            h('button', { class: 'quiet', onclick: drop(i) }, '捨てる')))))
      : h('div', { class: 'empty' }, h('b', {}, '受付箱は空です'),
        '上の欄に書くと、ここに溜まります。議事録を貼り付けると、1行ずつに分かれて入ります。'),
  ];
}

// ---- 一覧（台帳と要件で共用）----

function itemRow(i) {
  const late = i.status === 'open' && i.due && i.due < STATE.today;
  return h('li', { class: `click ${i.status === 'done' ? 'done' : ''}`, tabindex: 0, role: 'button',
    onclick: () => openItem(i.id), onkeydown: (e) => e.key === 'Enter' && openItem(i.id) },
    h('div', { class: 'item-title' }, h('span', { class: 'id' }, i.display_id), i.title,
      i.source === 'ai' && !i.confirmed_at ? h('span', { class: 'badge', style: 'margin-left:8px' }, 'AIの案・未確認') : null),
    h('div', { class: 'meta' },
      i.owner ? h('span', {}, `${T(i.type).fields.find((f) => f.key === 'owner')?.label ?? '担当'}：${i.owner}`) : null,
      i.due ? h('span', { class: late ? 'late' : '' }, `${late ? '期限切れ ' : ''}${i.due}`) : null,
      i.type === 'open' && i.status === 'open' && !i.owner ? h('span', { class: 'late' }, '決める人がいません') : null,
      i.status === 'done' ? h('span', {}, '済み') : null));
}

async function itemList(type) {
  const all = (await api('GET', `/api/items?type=${type}`)).filter((i) => i.status !== 'dropped');
  const items = [...all.filter((i) => i.status !== 'done'), ...all.filter((i) => i.status === 'done')];
  return [
    h('div', { class: 'row spread' },
      h('span', { class: 'muted small' }, `${T(type).label}　${all.filter((i) => i.status !== 'done').length} 件`),
      h('button', { class: 'primary', onclick: () => editDialog({ type, fields: {} }) }, '＋ 足す')),
    items.length
      ? h('ul', { class: 'list' }, items.map(itemRow))
      : h('div', { class: 'empty' }, h('b', {}, `「${T(type).label}」はまだありません`),
        '受付箱から送るか、「＋ 足す」で書けます。', h('div', { class: 'example' }, `書き方の例：${T(type).example}`)),
  ];
}

const LEDGER = ['open', 'decision', 'risk', 'term', 'request'];

async function ledger(arg) {
  const type = LEDGER.includes(arg) ? arg : 'open';
  return [
    h('h1', {}, '台帳'),
    h('nav', { class: 'subtabs', 'aria-label': '台帳の種類' }, LEDGER.map((t) =>
      h('a', { href: `#/ledger/${t}`, 'aria-current': t === type ? 'page' : null }, T(t).label,
        STATE.counts[t] ? ` ${STATE.counts[t]}` : ''))),
    type === 'open' && STATE.gaps.length
      ? h('p', { class: 'small' }, `このほかに、憲章の空欄が ${STATE.gaps.length} つあります（${STATE.gaps.join('・')}）。`, h('a', { href: '#/charter' }, '憲章を開く'))
      : null,
    await itemList(type),
  ];
}

async function requirements() {
  return [
    h('h1', {}, '要件'),
    h('p', { class: 'muted' }, 'いまは一覧だけです。層ごとの整理、曖昧な言葉の点検、受け入れ条件、例外さがしは次の版で入ります。'),
    await itemList('requirement'),
  ];
}

// ---- 項目の入力・編集 ----

async function openItem(id) {
  try {
    const { item, events, links } = await api('GET', `/api/items/${id}`);
    editDialog(item, events, links);
  } catch (e) { toast(e.message, true); }
}

function fieldInput(f, value, id) {
  if (f.type === 'textarea') return h('textarea', { id, value: value ?? '' });
  if (f.type === 'select') return h('select', { id }, h('option', { value: '' }, '（選ぶ）'), f.options.map((o) => h('option', { value: o, selected: o === value }, o)));
  return h('input', { id, type: f.type === 'date' ? 'date' : 'text', value: value ?? '', placeholder: f.hint && f.type !== 'date' ? '' : null });
}

function showDialog(dlg) {
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function editDialog(item, events = [], links = []) {
  const def = T(item.type);
  const isNew = !item.id;
  const title = h('input', { id: 'f-title', value: item.title ?? '', required: true, placeholder: isNew ? `例：${def.example}` : null });
  const inputs = def.fields.map((f) => ({ f, el: fieldInput(f, f.col ? item[f.key] : item.fields?.[f.key], `f-${f.key}`) }));
  const dlg = h('dialog', {});
  const collect = () => {
    const patch = { title: title.value, fields: {} };
    for (const { f, el } of inputs) (f.col ? patch : patch.fields)[f.key] = el.value;
    return patch;
  };
  const save = guard(async (e) => {
    e.preventDefault();
    if (isNew) await api('POST', '/api/items', { type: item.type, ...collect() });
    else await api('PATCH', `/api/items/${item.id}`, collect());
    dlg.close();
    toast('保存しました');
    await refresh();
  });
  const setStatus = (status, msg) => guard(async () => {
    await api('PATCH', `/api/items/${item.id}`, { ...collect(), status });
    dlg.close();
    toast(msg);
    await refresh();
  });
  const isDraft = item.source === 'ai' && !item.confirmed_at;
  dlg.append(h('form', { onsubmit: save },
    h('h2', {}, isNew ? `${def.label}を足す` : `${item.display_id}　${def.label}`),
    isDraft ? h('p', { class: 'badge', style: 'display:inline-block' }, 'AIの案です。確認するまで、決まったことには数えません') : null,
    h('label', { for: 'f-title' }, def.titleLabel), title,
    inputs.map(({ f, el }) => [h('label', { for: el.id }, f.label, f.hint ? h('span', { class: 'hint' }, f.hint) : null), el]),
    links.length ? h('p', { class: 'small muted', style: 'margin-top:14px' }, '関連：', links.map((l) => `${l.display_id} ${l.title}`).join('、')) : null,
    h('div', { class: 'actions' },
      h('button', { class: 'primary' }, '保存'),
      isDraft ? h('button', { type: 'button', onclick: guard(async () => {
        await api('PATCH', `/api/items/${item.id}`, collect());
        await api('POST', `/api/items/${item.id}/confirm`);
        dlg.close(); toast('確認しました'); await refresh();
      }) }, '保存して、確認済みにする') : null,
      !isNew && item.type === 'open' && item.status === 'open'
        ? h('button', { type: 'button', onclick: () => { dlg.close(); resolveDialog(item); } }, '決まった') : null,
      !isNew && item.status === 'open' && ['risk', 'request', 'requirement', 'exit'].includes(item.type)
        ? h('button', { type: 'button', onclick: setStatus('done', '済みにしました') }, '済みにする') : null,
      !isNew && item.status === 'done' ? h('button', { type: 'button', onclick: setStatus('open', '戻しました') }, '未了に戻す') : null,
      h('button', { type: 'button', class: 'push', onclick: () => dlg.close() }, '閉じる'),
      !isNew ? h('button', { type: 'button', class: 'quiet', onclick: setStatus('dropped', '捨てました（履歴には残ります）') }, '捨てる') : null),
    events.length ? h('details', {}, h('summary', {}, `履歴（${events.length} 件）`),
      h('ul', {}, events.map((e) => h('li', {}, `${fmtDate(e.at)}　${ACTOR[e.actor] ?? e.actor}が${ACTION[e.action] ?? e.action}`,
        Object.keys(e.detail).filter((k) => Array.isArray(e.detail[k])).length ? `（${Object.keys(e.detail).filter((k) => Array.isArray(e.detail[k])).map(fieldName(def)).join('・')}）` : '')))) : null,
  ));
  showDialog(dlg);
}

const ACTOR = { human: '自分', ai: 'AI' };
const ACTION = { create: '作成', update: '変更', convert: '種類を変更', confirm: '確認', resolve: '決定' };
const fieldName = (def) => (k) => {
  const key = k.replace(/^fields\./, '');
  return { title: '内容', status: '状態', type: '種類' }[key] ?? def.fields.find((f) => f.key === key)?.label ?? key;
};

// 未決が決まったとき。選ばなかった案まで書いてもらう。
function resolveDialog(item) {
  const d = T('decision');
  const decision = h('input', { id: 'r-decision', required: true });
  const reason = h('textarea', { id: 'r-reason' });
  const alternatives = h('textarea', { id: 'r-alt' });
  const owner = h('input', { id: 'r-owner', value: item.owner ?? '' });
  const dlg = h('dialog', {});
  dlg.append(h('form', {
    onsubmit: guard(async (e) => {
      e.preventDefault();
      const made = await api('POST', `/api/items/${item.id}/resolve`, {
        decision: decision.value, reason: reason.value, alternatives: alternatives.value, owner: owner.value,
      });
      dlg.close();
      toast(`決めたこと ${made.display_id} として記録しました`);
      location.hash = '#/ledger/decision';
      await refresh();
    }),
  },
    h('h2', {}, '決まったことを記録する'),
    h('p', { class: 'muted small' }, `${item.display_id}　${item.title}`),
    h('label', { for: 'r-decision' }, d.titleLabel), decision,
    h('label', { for: 'r-owner' }, '決めた人'), owner,
    h('label', { for: 'r-reason' }, 'なぜそう決めた？'), reason,
    h('label', { for: 'r-alt' }, '選ばなかった案と、その理由', h('span', { class: 'hint' }, 'これが一番あとで効きます')), alternatives,
    h('div', { class: 'actions' }, h('button', { class: 'primary' }, '記録する'),
      h('button', { type: 'button', class: 'push', onclick: () => dlg.close() }, 'やめる'))));
  showDialog(dlg);
}

// ---- 憲章：1ページ ----

async function charter() {
  const p = STATE.project;
  const c = p.charter;
  const saveProject = (patch, msg = '保存しました') => guard(async () => {
    await api('PATCH', '/api/project', patch);
    toast(msg);
    await refresh();
  })();
  const onChange = (el, toPatch) => el.addEventListener('change', () => saveProject(toPatch(el.value)));

  const purpose = h('textarea', { id: 'c-purpose', value: p.purpose, placeholder: '例：店舗で欲しい商品を見つけられなかったお客様を、そのまま帰さない' });
  onChange(purpose, (v) => ({ purpose: v }));
  const goalText = h('textarea', { id: 'c-goal', value: c.goal_text ?? '', placeholder: '例：3店舗で店舗受け取りが運用できる（9月末）' });
  onChange(goalText, (v) => ({ charter: { goal_text: v } }));
  const constraints = h('textarea', { id: 'c-constraints', value: c.constraints ?? '', placeholder: '例：期間は6か月。開発は5人（専任3、兼任2）。月末の締め処理は止めない' });
  onChange(constraints, (v) => ({ charter: { constraints: v } }));

  const section = async (type, lead) => {
    const items = (await api('GET', `/api/items?type=${type}`)).filter((i) => i.status !== 'dropped');
    return [
      h('div', { class: 'row spread sec' }, h('h2', {}, T(type).label), h('button', { onclick: () => editDialog({ type, fields: {} }) }, '＋ 足す')),
      h('p', { class: 'muted small' }, lead),
      items.length ? h('ul', { class: 'list' }, items.map(itemRow))
        : h('div', { class: 'empty' }, h('b', {}, 'まだ書かれていません（未決）'), h('div', { class: 'example' }, `書き方の例：${T(type).example}`)),
    ];
  };

  return [
    h('h1', {}, '憲章'),
    h('p', { class: 'muted' }, '困ったときに立ち返る1ページです。空欄は「まだ決まっていないこと」として数えます。',
      STATE.gaps.length ? ` いまの空欄：${STATE.gaps.join('・')}` : ' 空欄はありません。'),

    h('h2', {}, h('label', { for: 'c-purpose', style: 'margin:0;font-size:inherit' }, '何のためのプロジェクト？')), purpose,

    h('h2', {}, '何ができたら「終わり」？'),
    h('p', { class: 'muted small' }, 'どれが正しいということはありません。ただ、選ばないままだと関係者ごとに違う終わりを思い浮かべます。'),
    h('div', { class: 'choice', role: 'radiogroup' }, Object.entries(META.goalKinds).map(([k, g]) =>
      h('label', {},
        h('input', { type: 'radio', name: 'goal', value: k, checked: c.goal_kind === k, onchange: () => saveProject({ charter: { goal_kind: k } }) }),
        h('b', {}, g.label), h('span', {}, `この置き方で落ちるもの：${g.miss}`)))),
    h('label', { for: 'c-goal' }, '具体的には？', h('span', { class: 'hint' }, '段階に分けてもかまいません')), goalText,

    await section('notdo', 'やることには誰も反対しません。やらないことを書くと「それは困る」と言う人が現れます。その人が本当の関係者です。'),
    await section('authority', '決める人は必ず1人にします。'),
    await section('exit', '中止のスイッチではなく、立ち止まって判断し直す合図です。余裕のある今しか書けません。'),

    h('h2', {}, h('label', { for: 'c-constraints', style: 'margin:0;font-size:inherit' }, '動かせない条件（期間・人・止められないもの）')), constraints,

    h('div', { class: 'card row spread', style: 'margin-top:32px' },
      h('span', { class: 'small muted' }, c.reviewed_at ? `最後に見直した日：${c.reviewed_at}` : 'まだ一度も見直していません'),
      h('button', { onclick: () => saveProject({ charter: { reviewed_at: STATE.today } }, '見直した日を記録しました') }, '読み直した。今も有効')),
  ];
}

// ---- 開始 ----

window.addEventListener('hashchange', guard(refresh));
guard(async () => {
  META = await api('GET', '/api/meta');
  await refresh();
})();
