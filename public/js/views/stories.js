import { api, session, withBase } from '../api.js';
import { esc, fmtDate, toast, openModal, confirmDialog, badge, emptyState, debounce, PRECISION } from '../ui.js';
import { pickPerson } from '../components/personPicker.js';

const VIS_LABEL = { L0: '公开', L1: '族内', L2: '私密' };

function dateLabel(s) {
  if (!s.date) return '时间不详';
  const d = fmtDate(s.date);
  return s.precision === 'year' || s.precision === 'about' ? d.slice(0, 4) : d;
}

/** 故事列表 */
export async function renderStories(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在载入家族故事…</div></div>';

  let list;
  try { list = await api('/api/stories'); }
  catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const canEdit = session.canEdit;

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>故事与回忆录</h1>
          <p class="page-sub">长文、口述整理、家族往事 · 可关联多位人物 · 支持轻量标记（# 标题、**粗体**、- 列表、&gt; 引用）</p>
        </div>
        <div class="spacer"></div>
        ${canEdit ? '<button class="btn btn-primary btn-sm" type="button" id="new-story">＋ 写故事</button>' : ''}
      </div>

      <div class="card">
        <div class="card-body">
          <div class="field search-box">
            <label for="story-q">搜索标题 / 正文 / 署名</label>
            <input id="story-q" type="search" placeholder="如：迁居、口述、父亲…" autocomplete="off">
          </div>
        </div>
      </div>

      <div id="story-list" class="mt-16">
        ${list.length ? renderList(list) : emptyState('还没有故事。可以从一段长辈口述开始', '忆')}
      </div>
    </div>`;

  function renderList(items) {
    return `<div class="story-grid">
      ${items.map((s) => `
        <article class="card story-card" data-story="${esc(s.id)}">
          <div class="story-card-body">
            <div class="row">
              <span class="story-date">${esc(dateLabel(s))}</span>
              ${s.visibility === 'L2' ? badge('私密', 'muted') : s.visibility === 'L0' ? badge('公开', 'muted') : ''}
            </div>
            <h3 class="story-title">${esc(s.title)}</h3>
            <p class="story-excerpt">${esc(s.excerpt || '')}</p>
            <div class="story-meta">
              ${s.authorName ? `<span>口述/作者：${esc(s.authorName)}</span>` : ''}
              ${(s.persons || []).length ? `<span>涉及：${s.persons.slice(0, 3).map((p) => esc(p.name)).join('、')}${s.persons.length > 3 ? ' 等' : ''}</span>` : ''}
            </div>
          </div>
        </article>`).join('')}
    </div>`;
  }

  root.querySelector('#story-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-story]');
    if (card) location.hash = `#/story/${card.dataset.story}`;
  });

  root.querySelector('#story-q').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    try {
      const data = await api('/api/stories' + (q ? `?keyword=${encodeURIComponent(q)}` : ''));
      const box = root.querySelector('#story-list');
      box.innerHTML = data.length ? renderList(data) : emptyState('没有匹配的故事', '忆');
    } catch (err) { toast(err.message, 'error'); }
  }, 240));

  const preset = (() => {
    try {
      const raw = sessionStorage.getItem('story_person_pick');
      if (!raw) return null;
      sessionStorage.removeItem('story_person_pick');
      return JSON.parse(raw);
    } catch { return null; }
  })();

  root.querySelector('#new-story')?.addEventListener('click', () => {
    storyEditor(null, () => { location.reload(); }, preset ? [preset] : []);
  });

  if (preset) {
    // 从人物页跳转过来：直接打开编辑器并预填该人物
    storyEditor(null, () => { location.reload(); }, [preset]);
  }
}

/** 故事详情 */
export async function renderStory(root, id) {
  root.innerHTML = '<div class="content"><div class="empty">正在载入故事…</div></div>';

  let story;
  try { story = await api(`/api/stories/${id}`); }
  catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const canEdit = session.canEdit;
  const isAdmin = session.isAdmin;

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/stories">← 故事列表</a>
        <div class="spacer"></div>
        <button class="btn btn-sm" type="button" id="view-versions">版本历史</button>
        ${canEdit ? '<button class="btn btn-sm" type="button" id="edit-story">编辑</button>' : ''}
        ${isAdmin ? '<button class="btn btn-sm btn-danger" type="button" id="del-story">删除</button>' : ''}
      </div>

      <article class="card">
        <div class="story-head">
          <h1>${esc(story.title)}</h1>
          <div class="row small muted">
            <span>${esc(dateLabel(story))}</span>
            ${story.authorName ? `<span>· 口述/作者：${esc(story.authorName)}</span>` : ''}
            ${story.visibility !== 'L1' ? badge(VIS_LABEL[story.visibility], 'muted') : ''}
          </div>
          ${(story.persons || []).length ? `<div class="row small mt-8">
            <span class="muted">涉及人物：</span>
            ${story.persons.map((p) => `<a class="badge badge-muted" href="#/person/${esc(p.id)}">${esc(p.name)}${p.role === 'subject' ? '' : '（提及）'}</a>`).join(' ')}
          </div>` : ''}
        </div>
        <div class="story-body">${story.html}</div>
      </article>
    </div>`;

  root.querySelector('#edit-story')?.addEventListener('click', () => {
    storyEditor(story, () => location.reload());
  });
  root.querySelector('#view-versions')?.addEventListener('click', async () => {
    try {
      const versions = await api(`/api/stories/${story.id}/versions`);
      if (!versions.length) { toast('还没有历史版本（首次编辑后才生成 v1）', ''); return; }
      const m = openModal({
        title: '版本历史',
        body: `
          <p class="small muted">每次编辑前会自动保存快照。回滚会把当前状态也存为新版本。</p>
          <div class="mt-8">
            ${versions.map((v) => `
              <div class="citation-item">
                <div class="min-w-0">
                  <div><span class="badge badge-muted">v${v.version_no}</span>
                    <strong>${esc(v.title)}</strong></div>
                  <div class="small muted">${esc(v.saved_label || '系统')} · ${esc(fmtDate(v.created_at))}
                    ${v.note ? ` · ${esc(v.note)}` : ''}</div>
                </div>
                ${session.isAdmin ? `<button class="btn btn-sm" type="button" data-rollback="${v.version_no}">回滚</button>` : ''}
              </div>`).join('')}
          </div>`,
        footer: '<button class="btn btn-primary" type="button" data-act="ok">关闭</button>',
        layered: true,
      });
      m.el.querySelector('[data-act="ok"]').addEventListener('click', () => m.close());
      m.el.querySelectorAll('[data-rollback]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog(`确认回滚到 v${btn.dataset.rollback}？当前状态会先保存为新版本。`,
            { danger: true, okText: '回滚' });
          if (!ok) return;
          try {
            await api(`/api/stories/${story.id}/versions/${btn.dataset.rollback}/restore`, { method: 'POST' });
            m.close();
            toast('已回滚', 'ok');
            location.reload();
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelector('#del-story')?.addEventListener('click', async () => {
    const ok = await confirmDialog(`确认删除《${story.title}》？此操作不可恢复。`, { danger: true, okText: '删除' });
    if (!ok) return;
    try {
      await api(`/api/stories/${story.id}`, { method: 'DELETE' });
      toast('故事已删除', 'ok');
      location.hash = '#/stories';
    } catch (err) { toast(err.message, 'error'); }
  });
}

/** 故事编辑器 */
function storyEditor(story, onSaved, initialPicks = []) {
  const isEdit = !!story;
  let picked = isEdit
    ? (story?.persons || []).map((p) => ({ id: p.id, name: p.name }))
    : [...initialPicks];
  let submitted = false;

  const m = openModal({
    title: isEdit ? '编辑故事' : '写故事',
    body: `
      <div class="stack-8">
        <div class="field"><label for="st-title">标题 *</label>
          <input id="st-title" value="${esc(story?.title || '')}" placeholder="如：父亲口述的迁居往事"></div>
        <div class="row">
          <div class="field flex-1"><label for="st-date">日期</label>
            <input id="st-date" type="date" value="${story?.date ? esc(fmtDate(story.date)) : ''}"></div>
          <div class="field flex-1"><label for="st-precision">日期精度</label>
            <select id="st-precision">
              ${Object.entries(PRECISION).map(([v, l]) => `<option value="${v}"${(story?.precision || 'unknown') === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label for="st-author">口述/作者署名</label>
          <input id="st-author" value="${esc(story?.authorName || '')}" placeholder="如：王小明 记录"></div>
        <div class="field"><label for="st-visibility">可见范围</label>
          <select id="st-visibility">
            <option value="L1"${(story?.visibility || 'L1') === 'L1' ? ' selected' : ''}>族内可见</option>
            <option value="L0"${story?.visibility === 'L0' ? ' selected' : ''}>公开</option>
            ${session.isAdmin ? `<option value="L2"${story?.visibility === 'L2' ? ' selected' : ''}>仅本人与管理员</option>` : ''}
          </select>
        </div>
        <div class="field">
          <label>关联人物（可多选）</label>
          <div class="row">
            <button class="btn btn-sm" type="button" id="st-pick">＋ 添加人物</button>
            <span class="small muted" id="st-picked-count">${picked.length} 人</span>
          </div>
          <div class="chip-box" id="st-chips">
            ${picked.map((p) => `<span class="relation-item"><a href="#/person/${esc(p.id)}">${esc(p.name)}</a><button class="rel-del" type="button" data-remove="${esc(p.id)}">×</button></span>`).join('')}
          </div>
        </div>
                <div class="field">
          <label>正文工具</label>
          <button class="btn btn-sm" type="button" id="st-insert-img">＋ 插入照片</button>
          <span class="hint small">在光标处插入 <code>![说明](media:图片ID)</code></span>
        </div>
<div class="field"><label for="st-body">正文</label>
          <textarea id="st-body" class="story-editor" placeholder="支持：# 标题、**粗体**、*斜体*、- 列表、&gt; 引用、--- 分隔线">${esc(story?.body || '')}</textarea>
          <span class="hint">保存在服务端；渲染时会转义 HTML，避免脚本注入。</span>
        </div>
        <div id="st-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">${isEdit ? '保存' : '发布'}</button>`,
    onClose: () => { if (!submitted) onSaved?.(null); },
  });

  const errBox = m.el.querySelector('#st-error');
  const chips = m.el.querySelector('#st-chips');
  const countEl = m.el.querySelector('#st-picked-count');

  const syncChips = () => {
    chips.innerHTML = picked.map((p) =>
      `<span class="relation-item"><a href="#/person/${esc(p.id)}">${esc(p.name)}</a>
        <button class="rel-del" type="button" data-remove="${esc(p.id)}">×</button></span>`).join('');
    countEl.textContent = `${picked.length} 人`;
  };

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    picked = picked.filter((p) => p.id !== btn.dataset.remove);
    syncChips();
  });

  m.el.querySelector('#st-pick').addEventListener('click', async () => {
    if (picked.length >= 20) { toast('最多关联 20 人', 'error'); return; }
    const p = await pickPerson('选择关联人物');
    if (!p) return;
    if (picked.some((x) => x.id === p.id)) { toast('已添加过', ''); return; }
    picked.push(p);
    syncChips();
  });

  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('#st-insert-img').addEventListener('click', async () => {
    try {
      const images = await api('/api/media');
      const inner = images.length
        ? '<div class="media-pick-grid">' + images.map((img) =>
            `<button class="media-pick-item" type="button" data-img="${esc(img.id)}" data-name="${esc(img.name)}">`,
            `<img src="${esc(withBase(img.url))}" alt="${esc(img.name)}" loading="lazy">`,
            `<span>${esc(img.name)}<br><small>${esc(img.person)}</small></span></button>`).join('') + '</div>'
        : '<div class="empty">还没有可用照片，请先在成员档案上传</div>';
      const picker = openModal({ title: '选择要插入的照片', body: inner,
        footer: '<button class="btn" type="button" data-act="cancel">取消</button>', layered: true });
      picker.el.querySelector('[data-act="cancel"]').addEventListener('click', () => picker.close());
      picker.el.addEventListener('click', (ev) => {
        const item = ev.target.closest('[data-img]');
        if (!item) return;
        const ta = m.el.querySelector('#st-body');
        const snippet = `![${item.dataset.name}](media:${item.dataset.img})`;
        const pos = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, pos) + String.fromCharCode(10) + snippet + String.fromCharCode(10) + ta.value.slice(ta.selectionEnd ?? pos);
        ta.focus();
        picker.close();
        toast('已插入照片标记', 'ok');
      });
    } catch (err) { toast(err.message, 'error'); }
  });
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const body = {
      title: m.el.querySelector('#st-title').value.trim(),
      date: m.el.querySelector('#st-date').value || null,
      precision: m.el.querySelector('#st-precision').value,
      authorName: m.el.querySelector('#st-author').value.trim(),
      visibility: m.el.querySelector('#st-visibility').value,
      body: m.el.querySelector('#st-body').value,
      personIds: picked.map((p) => p.id),
    };
    if (!body.title) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = '标题必填';
      return;
    }
    btn.disabled = true;
    try {
      if (isEdit) await api(`/api/stories/${story.id}`, { method: 'PUT', body });
      else {
        const created = await api('/api/stories', { method: 'POST', body });
        submitted = true;
        m.close();
        toast('故事已发布', 'ok');
        location.hash = `#/story/${created.id}`;
        return;
      }
      submitted = true;
      m.close();
      toast('故事已保存', 'ok');
      onSaved?.();
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}