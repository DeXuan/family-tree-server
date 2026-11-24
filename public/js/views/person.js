import { compressImage } from '../lib/imageCompress.js';
import { api, session, withBase } from '../api.js';
import { pickPerson } from '../components/personPicker.js';
import {
  esc, fmtDate, dash, GENDER, RELATION, CERTAINTY, PRECISION, badge,
  toast, openModal, confirmDialog, debounce, initials, emptyState,
  EVENT_TYPE, VISIBILITY_LABEL,
} from '../ui.js';

/** 关系属性表单（父/母类型、确信度 / 婚姻类型等） */
function relationDetails(title, fields, okText = '确认添加') {
  return new Promise((resolve) => {
    const fieldHtml = fields.map((f) => {
      if (f.type === 'select') {
        return `<div class="field">
          <label for="rd-${f.name}">${esc(f.label)}</label>
          <select id="rd-${f.name}" name="${f.name}">
            ${f.options.map(([v, label]) => `<option value="${v}"${v === f.value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>`;
      }
      return `<div class="field">
        <label for="rd-${f.name}">${esc(f.label)}</label>
        <input id="rd-${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}">
      </div>`;
    }).join('');

    let submitted = false;
    const m = openModal({
      title,
      body: `<div class="stack-8">${fieldHtml}</div>`,
      footer: `<button class="btn" type="button" data-act="cancel">取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">${esc(okText)}</button>`,
      onClose: () => { if (!submitted) resolve(null); },
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-act="ok"]').addEventListener('click', () => {
      const out = {};
      for (const f of fields) out[f.name] = m.el.querySelector(`[name="${f.name}"]`).value;
      submitted = true;
      m.close();
      resolve(out);
    });
  });
}

const PARENT_TYPE_OPTIONS = Object.entries(RELATION);
const CERTAINTY_OPTIONS = Object.entries(CERTAINTY);

export async function renderPerson(root, id) {
  root.innerHTML = '<div class="content"><div class="empty">正在载入成员档案…</div></div>';

  let person, rel, events, media, citations, associations, stories;
  try {
    [person, rel, events, media, citations, associations, stories] = await Promise.all([
      api(`/api/persons/${id}`),
      api(`/api/relations/${id}/relations`),
      api(`/api/events/${id}`),
      api(`/api/media/person/${id}`),
      api(`/api/citations?targetType=person&targetId=${encodeURIComponent(id)}`),
      api(`/api/associations/person/${id}`),
      api(`/api/stories/person/${id}`),
    ]);
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const fullName = `${person.family_name || ''}${person.given_name || ''}`;
  const canEdit = session.canEdit;
  const isAdmin = session.isAdmin;
  const restricted = new Set(person.restricted || []);
  const isSelf = session.user?.personId === person.id;
  const hasContact = !!person.contact
    && Object.values(person.contact).some((v) => v !== null && v !== undefined && v !== '');
  const masked = (f) => restricted.has(f);
  const showField = (value, field) => (masked(field)
    ? '<span class="badge badge-muted">🔒 私密</span>'
    : esc(dash(value)));
  const birthText = masked('birth_date')
    ? (person.birth_year ? `${person.birth_year} 年（日期私密）` : '🔒 私密')
    : person.birth_date
      ? `${fmtDate(person.birth_date)}${person.birth_precision !== 'exact' ? `（${PRECISION[person.birth_precision] || ''}）` : ''}`
      : '—';
  const deathText = masked('death_date')
    ? (person.death_year ? `${person.death_year} 年（日期私密）` : '🔒 私密')
    : person.death_date
      ? `${fmtDate(person.death_date)}${person.death_precision !== 'exact' ? `（${PRECISION[person.death_precision] || ''}）` : ''}`
      : (person.is_deceased ? '不详' : '—');
  const headerPeriod = (() => {
    const b = masked('birth_date') ? (person.birth_year ?? '?') : (fmtDate(person.birth_date) || '?');
    const d = masked('death_date')
      ? (person.death_year ?? (person.is_deceased ? '?' : ''))
      : (fmtDate(person.death_date) || (person.is_deceased ? '?' : ''));
    return `${b}–${d}`;
  })();

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/people">← 成员名录</a>
      </div>

      <div class="card">
        <div class="detail-head">
          <div class="detail-avatar">${esc(initials(fullName))}</div>
          <div class="detail-title">
            <h1>${esc(fullName)}
              ${person.courtesy_name ? `<small>字 ${esc(person.courtesy_name)}</small>` : ''}
            </h1>
            <div class="row small">
              ${person.generation_no ? badge(`${person.generation_no} 世`, 'muted') : ''}
              ${person.branch ? badge(person.branch) : ''}
              ${person.generation_name ? badge(`字辈 ${person.generation_name}`, 'muted') : ''}
              ${person.is_deceased ? badge('已故', 'muted') : badge('在世', 'jade')}
              ${restricted.size ? badge('部分信息私密', 'muted') : ''}
              <span class="muted">${esc(GENDER[person.gender] || '未知')} · ${esc(headerPeriod)}</span>
            </div>
          </div>
          <div class="detail-actions">
            ${canEdit ? `<a class="btn" href="#/person/${esc(id)}/edit">编辑</a>` : ''}
            <button class="btn" type="button" id="rel-path">与某人的关系</button>
            <a class="btn" href="#/hourglass/${esc(id)}">沙漏世系</a>
            ${session.user?.role === 'member' ? '<button class="btn" type="button" id="suggest-edit">建议修改</button>' : ''}
            ${(isSelf || isAdmin) ? `<a class="btn" href="#/me">隐私设置</a>` : ''}
            ${isAdmin ? `<button class="btn btn-danger" type="button" id="del-person">删除</button>` : ''}
          </div>
        </div>
      </div>

      <div class="grid grid-2-1 mt-16">
        <div class="card">
          <div class="card-head"><h3>基本信息</h3></div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item"><dt>出生</dt><dd>${esc(birthText)}</dd></div>
              <div class="info-item"><dt>出生地</dt><dd>${showField(person.birth_place, 'birth_place')}</dd></div>
              <div class="info-item"><dt>去世</dt><dd>${esc(deathText)}</dd></div>
              <div class="info-item"><dt>去世地</dt><dd>${showField(person.death_place, 'death_place')}</dd></div>
              <div class="info-item"><dt>安葬地</dt><dd>${showField(person.burial_place, 'burial_place')}</dd></div>
              <div class="info-item"><dt>职业</dt><dd>${showField(person.occupation, 'occupation')}</dd></div>
              <div class="info-item"><dt>学历 / 师承</dt><dd>${showField(person.education, 'education')}</dd></div>
              <div class="info-item"><dt>支系</dt><dd>${esc(dash(person.branch))}</dd></div>
              ${(person.former_names || []).length
                ? `<div class="info-item"><dt>曾用名</dt><dd>${esc(person.former_names.join('、'))}</dd></div>`
                : ''}
            </div>
            ${person.bio
              ? `<div class="info-block"><h4 class="muted small">生平简介</h4><p class="small mt-8">${esc(person.bio)}</p></div>`
              : masked('bio')
                ? '<div class="info-block"><h4 class="muted small">生平简介</h4><p class="small mt-8"><span class="badge badge-muted">🔒 私密</span></p></div>'
                : ''}
            ${hasContact
              ? `<div class="info-block">
                   <h4 class="muted small">联系方式 <span class="badge badge-muted">私密</span></h4>
                   <div class="info-grid mt-8">
                     <div class="info-item"><dt>电话</dt><dd>${esc(dash(person.contact.phone))}</dd></div>
                     <div class="info-item"><dt>邮箱</dt><dd>${esc(dash(person.contact.email))}</dd></div>
                     <div class="info-item"><dt>住址</dt><dd>${esc(dash(person.contact.address))}</dd></div>
                   </div>
                 </div>`
              : masked('contact')
                ? '<div class="info-block"><h4 class="muted small">联系方式</h4><p class="small mt-8"><span class="badge badge-muted">🔒 仅本人与管理员可见</span></p></div>'
                : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>亲属关系</h3></div>
          <div class="card-body" id="relations-body">
            ${renderRelations(rel, canEdit)}
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>生平时间线</h3>
          <span class="badge badge-muted" id="event-count">${events.length} 条</span>
          <div class="spacer"></div>
          ${canEdit ? '<button class="btn btn-sm" type="button" id="add-event">＋ 添加事件</button>' : ''}
        </div>
        <div class="card-body" id="events-body">
          ${renderEvents(events, canEdit)}
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>照片与附件</h3>
          <span class="badge badge-muted" id="media-count">${media.length} 项</span>
          <div class="spacer"></div>
          ${canEdit ? `
            <input id="media-input" type="file" multiple class="media-input"
              accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,video/mp4,video/webm,application/pdf">
            <select id="media-visibility" class="media-visibility">
              <option value="L1">族内可见</option>
              <option value="L0">公开</option>
              ${session.isAdmin ? '<option value="L2">仅本人与管理员</option>' : ''}
            </select>
            <button class="btn btn-sm" type="button" id="media-upload">上传</button>` : ''}
        </div>
        <div class="card-body" id="media-body">
          ${renderMedia(media, canEdit)}
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>来源与考证</h3>
          <span class="badge badge-muted" id="citation-count">${citations.length} 条</span>
          <div class="spacer"></div>
          ${canEdit ? '<button class="btn btn-sm" type="button" id="add-citation">＋ 添加来源</button>' : ''}
        </div>
        <div class="card-body" id="citations-body">
          ${renderCitations(citations, canEdit)}
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>家族故事</h3>
          <span class="badge badge-muted">${stories.length} 篇</span>
          <div class="spacer"></div>
          ${canEdit ? '<button class="btn btn-sm" type="button" id="add-person-story">＋ 写关于他的故事</button>' : ''}
        </div>
        <div class="card-body" id="person-stories">
          ${stories.length ? stories.map((st) => `
            <div class="citation-item">
              <div class="min-w-0">
                <a href="#/story/${esc(st.id)}"><strong>${esc(st.title)}</strong></a>
                <div class="small muted">
                  ${st.date ? esc(fmtDate(st.date).slice(0, 10)) : ''}
                  ${st.authorName ? ` · ${esc(st.authorName)}` : ''}
                  ${st.role === 'mentioned' ? ' · 仅提及' : ''}
                </div>
                <div class="small muted">${esc(st.excerpt || '')}</div>
              </div>
            </div>`).join('') : '<div class="empty">还没有关于这位成员的故事</div>'}
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>其他关联</h3>
          <span class="badge badge-muted" id="assoc-count">${associations.length} 条</span>
          <div class="spacer"></div>
          ${canEdit ? '<button class="btn btn-sm" type="button" id="add-assoc">＋ 添加关联</button>' : ''}
        </div>
        <div class="card-body" id="assoc-body">
          ${renderAssociations(associations, canEdit)}
        </div>
      </div>
    </div>`;

  // ---------- 事件 ----------
  const delBtn = root.querySelector('#del-person');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog(`确认删除「${fullName}」？成员将被归档（不物理删除），可由管理员恢复。`, { danger: true, okText: '归档' });
      if (!ok) return;
      try {
        await api(`/api/persons/${id}`, { method: 'DELETE' });
        toast('已归档该成员', 'ok');
        location.hash = '#/people';
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  wireRelationEvents(root, person, rel, id);
  wireEventEvents(root, person, events, id);
  wireMedia(root, person, media);
  wireCitations(root, person, citations);
  wireAssociations(root, person, associations);
  root.querySelector('#add-person-story')?.addEventListener('click', () => {
    // 带上人物预填：跳到故事页并自动打开发起
    sessionStorage.setItem('story_person_pick', JSON.stringify({ id: person.id, name: fullName }));
    location.hash = '#/stories';
  });
  wireRelationPath(root, person);
  wireSuggestEdit(root, person);

  function rerenderRelations() {
    api(`/api/relations/${id}/relations`).then((fresh) => {
      rel = fresh;
      root.querySelector('#relations-body').innerHTML = renderRelations(rel, canEdit);
      wireRelationEvents(root, person, rel, id);
    }).catch((err) => toast(err.message, 'error'));
  }

  root._rerenderRelations = rerenderRelations;
}

function relationChip(p, roleText, { deletable, kind } = {}) {
  return `
    <span class="relation-item">
      <a href="#/person/${esc(p.id)}">${esc((p.family_name || '') + (p.given_name || ''))}</a>
      ${roleText ? `<span class="rel-role">${esc(roleText)}</span>` : ''}
      ${deletable ? `<button class="rel-del" type="button" data-del-rel="${esc(p.id)}" data-kind="${kind}" title="移除关系">×</button>` : ''}
    </span>`;
}

function renderRelations(rel, canEdit) {
  const parents = rel.parents || [];
  const unions = rel.unions || [];
  const children = rel.children || [];

  const addBtn = (kind, label) => canEdit
    ? `<button class="btn btn-sm" type="button" data-add="${kind}">＋ ${label}</button>`
    : '';

  const unionLabel = (u) => {
    const t = u.union_type === 'partner' ? '伴侣' : u.union_type === 'concubine' ? '妾' : '配偶';
    const s = u.status === 'divorced' ? '离异' : u.status === 'widowed' ? '丧偶' : u.status === 'separated' ? '分居' : '';
    return s ? `${t}·${s}` : t;
  };

  return `
    <div class="relation-group">
      <div class="row-between"><h4>父母</h4>${addBtn('parent', '添加父母')}</div>
      <div class="relation-list">
        ${parents.length ? parents.map((p) => relationChip(p, `${RELATION[p.relation_type] || ''}${p.certainty !== 'confirmed' ? '·' + (CERTAINTY[p.certainty] || '') : ''}`, { deletable: canEdit, kind: 'parent' })).join('') : '<span class="relation-empty">尚未录入</span>'}
      </div>
    </div>
    <div class="relation-group">
      <div class="row-between"><h4>配偶</h4>${addBtn('spouse', '添加配偶')}</div>
      <div class="relation-list">
        ${unions.length ? unions.map((u) => `
          <span class="relation-item">
            <a href="#/person/${esc(u.partner_id)}">${esc((u.family_name || '') + (u.given_name || ''))}</a>
            <span class="rel-role">${esc(unionLabel(u))}</span>
            ${canEdit ? `<button class="rel-del rel-del-text" type="button" data-edit-spouse="${esc(u.id)}" data-status="${esc(u.status || 'ongoing')}" title="修改婚姻状态">改</button><button class="rel-del" type="button" data-del-spouse="${esc(u.id)}" title="移除婚姻记录">×</button>` : ''}
          </span>`).join('') : '<span class="relation-empty">尚未录入</span>'}
      </div>
    </div>
    <div class="relation-group">
      <div class="row-between"><h4>子女</h4>${addBtn('child', '添加子女')}</div>
      <div class="relation-list">
        ${children.length ? children.map((c) => relationChip(c, RELATION[c.relation_type] || '', { deletable: canEdit, kind: 'child' })).join('') : '<span class="relation-empty">尚未录入</span>'}
      </div>
    </div>`;
}

function wireRelationEvents(root, person, rel, id) {
  const body = root.querySelector('#relations-body');

  // 添加父母
  body.querySelector('[data-add="parent"]')?.addEventListener('click', async () => {
    const picked = await pickPerson('选择父母', id);
    if (!picked) return;
    const details = await relationDetails('亲子关系属性', [
      { name: 'relationType', label: '关系类型', type: 'select', options: PARENT_TYPE_OPTIONS, value: 'biological' },
      { name: 'certainty', label: '确信度', type: 'select', options: CERTAINTY_OPTIONS, value: 'confirmed' },
    ]);
    if (!details) return;
    try {
      await api(`/api/relations/${id}/parents`, { method: 'POST', body: { parentId: picked.id, ...details } });
      toast(`已添加 ${picked.name} 为父母`, 'ok');
      root._rerenderRelations?.();
    } catch (err) { toast(err.message, 'error'); }
  });

  // 添加配偶
  body.querySelector('[data-add="spouse"]')?.addEventListener('click', async () => {
    const picked = await pickPerson('选择配偶', id);
    if (!picked) return;
    const details = await relationDetails('婚姻信息', [
      { name: 'unionType', label: '关系类型', type: 'select', options: [['married', '婚姻'], ['partner', '伴侣'], ['concubine', '妾（历史形态）']], value: 'married' },
      { name: 'status', label: '状态', type: 'select', options: [['ongoing', '存续'], ['divorced', '离异'], ['widowed', '丧偶'], ['separated', '分居']], value: 'ongoing' },
      { name: 'startDate', label: '开始日期（可空）', type: 'date' },
      { name: 'place', label: '地点（可空）', type: 'text' },
    ]);
    if (!details) return;
    try {
      await api(`/api/relations/${id}/spouses`, {
        method: 'POST',
        body: { spouseId: picked.id, unionType: details.unionType, status: details.status, startDate: details.startDate || null, place: details.place },
      });
      toast(`已添加配偶 ${picked.name}`, 'ok');
      root._rerenderRelations?.();
    } catch (err) { toast(err.message, 'error'); }
  });

  // 添加子女
  body.querySelector('[data-add="child"]')?.addEventListener('click', async () => {
    const picked = await pickPerson('选择子女', id);
    if (!picked) return;
    const details = await relationDetails('亲子关系属性', [
      { name: 'relationType', label: '关系类型', type: 'select', options: PARENT_TYPE_OPTIONS, value: 'biological' },
      { name: 'certainty', label: '确信度', type: 'select', options: CERTAINTY_OPTIONS, value: 'confirmed' },
    ]);
    if (!details) return;
    try {
      await api(`/api/relations/${picked.id}/parents`, { method: 'POST', body: { parentId: id, ...details } });
      toast(`已添加子女 ${picked.name}`, 'ok');
      root._rerenderRelations?.();
    } catch (err) { toast(err.message, 'error'); }
  });

  // 删除父母关系
  body.querySelectorAll('[data-del-rel][data-kind="parent"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('确认移除该父母关系？', { danger: true, okText: '移除' });
      if (!ok) return;
      try {
        await api(`/api/relations/${id}/parents/${btn.dataset.delRel}`, { method: 'DELETE' });
        toast('已移除关系', 'ok');
        root._rerenderRelations?.();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // 删除子女关系（删除 子女→本人 的父母边）
  body.querySelectorAll('[data-del-rel][data-kind="child"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('确认移除该子女关系？', { danger: true, okText: '移除' });
      if (!ok) return;
      try {
        await api(`/api/relations/${btn.dataset.delRel}/parents/${id}`, { method: 'DELETE' });
        toast('已移除关系', 'ok');
        root._rerenderRelations?.();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // 删除婚姻
  body.querySelectorAll('[data-edit-spouse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const STATUS = [
        ['ongoing', '在婚'], ['divorced', '离异'], ['widowed', '丧偶'],
        ['separated', '分居'], ['annulled', '婚姻无效'],
      ];
      let submitted = false;
      const m = openModal({
        title: '修改婚姻状态',
        body: `
          <div class="field">
            <label for="ms-status">状态</label>
            <select id="ms-status">
              ${STATUS.map(([v, l]) => `<option value="${v}"${v === btn.dataset.status ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <p class="small muted mt-8">改为"离异"会自动记录结束日期为今天。</p>
          <div id="ms-error" hidden></div>`,
        footer: `<button class="btn" type="button" data-act="cancel">取消</button>
                 <button class="btn btn-primary" type="button" data-act="ok">保存</button>`,
        onClose: () => { if (!submitted) toast('已取消', ''); },
      });
      const errBox = m.el.querySelector('#ms-error');
      m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        try {
          await api(`/api/relations/spouses/${btn.dataset.editSpouse}`, {
            method: 'PUT',
            body: { status: m.el.querySelector('#ms-status').value },
          });
          submitted = true;
          m.close();
          toast('婚姻状态已更新', 'ok');
          root._rerenderRelations?.();
        } catch (err) {
          errBox.hidden = false;
          errBox.className = 'form-error';
          errBox.textContent = err.message;
        }
      });
    });
  });

  body.querySelectorAll('[data-del-spouse]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('确认移除该婚姻记录？', { danger: true, okText: '移除' });
      if (!ok) return;
      try {
        await api(`/api/relations/${id}/spouses/${btn.dataset.delSpouse}`, { method: 'DELETE' });
        toast('已移除婚姻记录', 'ok');
        root._rerenderRelations?.();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// =====================================================================
// 生平事件时间线
// =====================================================================
function eventDateLabel(e) {
  if (!e.event_date) return '时间不详';
  const d = fmtDate(e.event_date);
  if (e.event_precision === 'year' || e.event_precision === 'about') return d.slice(0, 4);
  if (e.event_precision === 'range' && e.event_date_end) {
    return `${d.slice(0, 4)}–${fmtDate(e.event_date_end).slice(0, 4)}`;
  }
  return d;
}

function renderEvents(events, canEdit) {
  if (!events.length) {
    return '<div class="empty">还没有记录生平事件</div>';
  }
  return `<div class="timeline">
    ${events.map((e) => `
      <div class="timeline-item">
        <div class="timeline-date">${esc(eventDateLabel(e))}</div>
        <div class="timeline-dot"></div>
        <div class="timeline-body">
          <div class="row">
            <span class="badge badge-muted">${esc(EVENT_TYPE[e.event_type] || e.event_type)}</span>
            <strong>${esc(e.title)}</strong>
            ${e.visibility === 'L2' ? badge('私密', 'muted') : e.visibility === 'L0' ? badge('公开', 'muted') : ''}
            ${e.citation_count ? `<span class="badge badge-muted">来源 ${e.citation_count}</span>` : ''}
            ${canEdit ? `<button class="rel-del rel-del-text" type="button" data-event-source="${esc(e.id)}">＋来源</button>
                         <button class="rel-del rel-del-text" type="button" data-edit-event="${esc(e.id)}">编辑</button>
                         <button class="rel-del rel-del-text" type="button" data-del-event="${esc(e.id)}">删除</button>` : ''}
          </div>
          ${e.place ? `<div class="muted small">${esc(e.place)}</div>` : ''}
          ${e.description ? `<p class="small mt-8">${esc(e.description)}</p>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
}

function eventModal(person, existing, onSaved) {
  const isEdit = !!existing;
  const ev = existing || {
    event_type: 'custom', title: '', description: '', event_date: '',
    event_precision: 'unknown', place: '', visibility: 'L1',
  };
  const typeOptions = Object.entries(EVENT_TYPE).map(([v, label]) =>
    `<option value="${v}"${v === ev.event_type ? ' selected' : ''}>${label}</option>`).join('');
  const precisionOptions = Object.entries(PRECISION).map(([v, label]) =>
    `<option value="${v}"${v === ev.event_precision ? ' selected' : ''}>${label}</option>`).join('');
  const canPrivate = session.isAdmin;
  const visibilityOptions = ['L0', 'L1', ...(canPrivate ? ['L2'] : [])].map((v) =>
    `<option value="${v}"${v === ev.visibility ? ' selected' : ''}>${VISIBILITY_LABEL[v]}</option>`).join('');

  let submitted = false;
  const m = openModal({
    title: isEdit ? '编辑生平事件' : '添加生平事件',
    body: `
      <div class="stack-8">
        <div class="row">
          <div class="field flex-1"><label for="ev-type">类型</label><select id="ev-type">${typeOptions}</select></div>
          <div class="field flex-1"><label for="ev-visibility">可见范围</label><select id="ev-visibility">${visibilityOptions}</select></div>
        </div>
        <div class="field"><label for="ev-title">标题</label><input id="ev-title" type="text" value="${esc(ev.title)}" placeholder="如：迁居武汉"></div>
        <div class="row">
          <div class="field flex-1"><label for="ev-date">日期</label><input id="ev-date" type="date" value="${esc(fmtDate(ev.event_date))}"></div>
          <div class="field flex-1"><label for="ev-precision">日期精度</label><select id="ev-precision">${precisionOptions}</select></div>
        </div>
        <div class="field"><label for="ev-place">地点</label><input id="ev-place" type="text" value="${esc(ev.place)}"></div>
        <div class="field"><label for="ev-desc">经过</label><textarea id="ev-desc">${esc(ev.description)}</textarea></div>
        <div id="ev-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">${isEdit ? '保存' : '添加'}</button>`,
    onClose: () => { if (!submitted) onSaved(null); },
  });
  const errBox = m.el.querySelector('#ev-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const body = {
      eventType: m.el.querySelector('#ev-type').value,
      title: m.el.querySelector('#ev-title').value.trim(),
      eventDate: m.el.querySelector('#ev-date').value || null,
      eventPrecision: m.el.querySelector('#ev-precision').value,
      place: m.el.querySelector('#ev-place').value.trim(),
      description: m.el.querySelector('#ev-desc').value.trim(),
      visibility: m.el.querySelector('#ev-visibility').value,
    };
    if (!body.title) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = '事件标题必填';
      return;
    }
    btn.disabled = true;
    try {
      const saved = isEdit
        ? await api(`/api/events/${existing.id}`, { method: 'PUT', body })
        : await api(`/api/events/${person.id}`, { method: 'POST', body });
      submitted = true;
      m.close();
      onSaved(saved);
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}

function wireEventEvents(root, person, events, id) {
  let list = events;
  const body = root.querySelector('#events-body');

  async function reload() {
    try {
      list = await api(`/api/events/${id}`);
      body.innerHTML = renderEvents(list, session.canEdit);
      const count = root.querySelector('#event-count');
      if (count) count.textContent = `${list.length} 条`;
    } catch (err) { toast(err.message, 'error'); }
  }

  root.querySelector('#add-event')?.addEventListener('click', () => {
    eventModal(person, null, async (saved) => {
      if (saved) { toast('事件已添加', 'ok'); await reload(); }
    });
  });

  body.addEventListener('click', async (e) => {
    const srcBtn = e.target.closest('[data-event-source]');
    if (srcBtn) {
      citationModal({
        targetType: 'event',
        targetId: srcBtn.dataset.eventSource,
        onSaved: async () => { toast('来源已添加', 'ok'); await reload(); },
      });
      return;
    }
    const editBtn = e.target.closest('[data-edit-event]');
    if (editBtn) {
      const ev = list.find((x) => x.id === editBtn.dataset.editEvent);
      if (ev) eventModal(person, ev, async (saved) => {
        if (saved) { toast('事件已保存', 'ok'); await reload(); }
      });
      return;
    }
    const delBtn = e.target.closest('[data-del-event]');
    if (delBtn) {
      const ok = await confirmDialog('确认删除该事件？', { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/events/${delBtn.dataset.delEvent}`, { method: 'DELETE' });
        toast('事件已删除', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

// =====================================================================
// 与某人的关系
// =====================================================================
async function wireRelationPath(root, person) {
  const btn = root.querySelector('#rel-path');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const picked = await pickPerson('选择要查询关系的人', person.id);
    if (!picked) return;
    try {
      const [res, kin] = await Promise.all([
        api(`/api/tree/path?a=${encodeURIComponent(person.id)}&b=${encodeURIComponent(picked.id)}`),
        api(`/api/tree/kinship?a=${encodeURIComponent(person.id)}&b=${encodeURIComponent(picked.id)}`),
      ]);
      const me = `${person.family_name || ''}${person.given_name || ''}`;

      // 主结论：称谓
      const termLine = kin.term
        ? `<p class="kin-term">「${esc(me)}」应称 <strong>${esc(picked.name)}</strong> 为
             <span class="kin-term-word">${esc(kin.term)}</span>${kin.dialectDiffers ? `<span class="muted small">（${esc(kin.dialectTerm)}）</span>` : ''}
             <span class="badge badge-muted">${esc(kindLabel(kin.kind))}</span>
             ${kin.inFiveFu ? '<span class="badge badge-jade">五服之内</span>' : '<span class="badge badge-muted">五服之外</span>'}
           </p>
           ${kin.reverse?.term ? `<p class="small muted">对方称您为「${esc(kin.reverse.term)}」${kin.reverse.dialectDiffers ? `（${esc(kin.reverse.dialectTerm)}）` : ''}</p>` : ''}
           ${kin.note ? `<p class="small muted">依据：${esc(kin.note)}</p>` : ''}`
        : `<p class="small">${esc(kin.note || '暂时无法推导称谓')}</p>`;

      // 辅助：代际路径
      let pathLine = '';
      if (res.related) {
        if (res.aDistance === 0) pathLine = `${picked.name} 是您的第 ${res.bDistance} 代后裔。`;
        else if (res.bDistance === 0) pathLine = `${picked.name} 是您的第 ${res.aDistance} 代祖先。`;
        else {
          pathLine = `共同祖先「${res.commonAncestor.name}」，您距 ${res.aDistance} 代、对方距 ${res.bDistance} 代。`;
        }
      } else {
        pathLine = '未找到共同祖先（可能是姻亲或数据不全）。';
      }

      const m = openModal({
        title: '关系与称谓',
        body: `
          <div class="kin-hero">${termLine}</div>
          <div class="divider"></div>
          <p class="small muted">${esc(pathLine)}</p>
          ${res.related && res.commonAncestor ? `<p class="small muted">共同祖先：<a href="#/person/${esc(res.commonAncestor.id)}">${esc(res.commonAncestor.name)}</a></p>` : ''}`,
        footer: '<button class="btn btn-primary" type="button" data-act="ok">知道了</button>',
      });
      m.el.querySelector('[data-act="ok"]').addEventListener('click', () => m.close());
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// =====================================================================
// 照片与附件
// =====================================================================
const MEDIA_KIND = { image: '图片', audio: '音频', video: '视频', document: '文档' };

function renderMedia(list, canEdit) {
  if (!list.length) return '<div class="empty">还没有上传照片或附件</div>';
  return `<div class="media-grid">
    ${list.map((m) => `
      <figure class="media-item">
        ${m.mediaType === 'image'
          ? `<div class="media-thumb" data-media-src="${esc(m.url)}" data-media-id="${esc(m.id)}"></div>`
          : `<div class="media-thumb media-doc"><span>${esc(MEDIA_KIND[m.mediaType] || '文件')}</span></div>`}
        <figcaption>
          <div class="media-name" title="${esc(m.originalName)}">${esc(m.caption || m.originalName || '未命名')}</div>
          <div class="row media-actions">
            ${m.visibility === 'L2' ? badge('私密', 'muted') : m.visibility === 'L0' ? badge('公开', 'muted') : ''}
            ${m.mediaType === 'image' ? '' : `<button class="rel-del rel-del-text" type="button" data-media-dl="${esc(m.id)}" data-media-name="${esc(m.originalName)}">下载</button>`}
            ${canEdit ? `<button class="rel-del rel-del-text" type="button" data-media-del="${esc(m.id)}">删除</button>` : ''}
          </div>
        </figcaption>
      </figure>`).join('')}
  </div>`;
}

function wireMedia(root, person, initial) {
  let list = initial;
  const body = root.querySelector('#media-body');
  const count = root.querySelector('#media-count');
  const urls = [];

  async function hydrateImages() {
    for (const u of urls.splice(0)) URL.revokeObjectURL(u);
    const slots = body.querySelectorAll('[data-media-src]');
    for (const slot of slots) {
      try {
        const res = await fetch(withBase(slot.dataset.mediaSrc), {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) continue;
        const url = URL.createObjectURL(await res.blob());
        urls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = slot.dataset.mediaId || '';
        img.loading = 'lazy';
        slot.appendChild(img);
      } catch { /* 单张失败不影响其他 */ }
    }
  }

  async function reload() {
    try {
      list = await api(`/api/media/person/${person.id}`);
      body.innerHTML = renderMedia(list, session.canEdit);
      count.textContent = `${list.length} 项`;
      await hydrateImages();
    } catch (err) { toast(err.message, 'error'); }
  }

  window.addEventListener('route:leave', () => {
    for (const u of urls) URL.revokeObjectURL(u);
  }, { once: true });

  body.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-media-del]');
    if (del) {
      const ok = await confirmDialog('确认删除该文件？原文件会一并删除。', { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await api(`/api/media/${del.dataset.mediaDel}`, { method: 'DELETE' });
        toast('已删除', 'ok');
        await reload();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const dl = e.target.closest('[data-media-dl]');
    if (dl) {
      try {
        const res = await fetch(withBase(`/api/media/${dl.dataset.mediaDl}/file`), {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) throw new Error('下载失败');
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = dl.dataset.mediaName || 'file';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  const uploadBtn = root.querySelector('#media-upload');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const input = root.querySelector('#media-input');
      const files = Array.from(input.files || []);
      if (!files.length) { toast('请选择文件', 'error'); return; }
      const visibility = root.querySelector('#media-visibility').value;
      uploadBtn.disabled = true;
      uploadBtn.textContent = '上传中…';
      let okCount = 0;
for (const file of files) {
        let toSend = file;
        let note = '';
        try {
          // 图片先在前端压缩：长边 1920、质量 0.85，明显减小上传体积
          const res = await compressImage(file);
          if (res.compressed) {
            toSend = new File([res.blob], res.name, { type: res.type });
            note = `（已压缩 ${Math.round(res.savedBytes / 1024)}KB）`;
          }
        } catch {
          // 压缩失败就用原文件，不影响上传
        }
        try {
          const fd = new FormData();
          fd.append('file', toSend);
          fd.append('visibility', visibility);
          await api(`/api/media/person/${person.id}`, { method: 'POST', form: fd });
          okCount++;
          if (note) toast(`${file.name}${note}`, 'ok');
        } catch (err) {
          toast(`${file.name}：${err.message}`, 'error');
        }
      }
      input.value = '';
      uploadBtn.disabled = false;
      uploadBtn.textContent = '上传';
      if (okCount) toast(`已上传 ${okCount} 个文件`, 'ok');
      await reload();
    });
  }

  hydrateImages();
}

// =====================================================================
// 族人建议修改（提交变更提案，管理员审核）
// =====================================================================
function suggestEditModal(person, onDone) {
  const dateVal = (v) => esc(fmtDate(v));
  const precisionOptions = (selected) => Object.entries(PRECISION).map(([v, label]) =>
    `<option value="${v}"${v === selected ? ' selected' : ''}>${label}</option>`).join('');

  let submitted = false;
  const m = openModal({
    title: '建议修改',
    body: `
      <p class="small muted">提交后由家族管理员审核，通过后才会写入族谱。</p>
      <div class="form-grid mt-16">
        <div class="field span-6"><label for="sg-family">姓</label><input id="sg-family" type="text" value="${esc(person.family_name)}"></div>
        <div class="field span-6"><label for="sg-given">名</label><input id="sg-given" type="text" value="${esc(person.given_name)}"></div>
        <div class="field span-6"><label for="sg-courtesy">字 / 号</label><input id="sg-courtesy" type="text" value="${esc(person.courtesy_name)}"></div>
        <div class="field span-6"><label for="sg-former">曾用名</label><input id="sg-former" type="text" value="${esc((person.former_names || []).join('、'))}"></div>
        <div class="field span-4"><label for="sg-genname">字辈</label><input id="sg-genname" type="text" value="${esc(person.generation_name)}"></div>
        <div class="field span-4"><label for="sg-genno">世代</label><input id="sg-genno" type="number" min="0" max="100" value="${esc(person.generation_no ?? '')}"></div>
        <div class="field span-4"><label for="sg-branch">支系</label><input id="sg-branch" type="text" value="${esc(person.branch)}"></div>
        <div class="field span-4"><label for="sg-gender">性别</label>
          <select id="sg-gender">
            <option value="male"${person.gender === 'male' ? ' selected' : ''}>男</option>
            <option value="female"${person.gender === 'female' ? ' selected' : ''}>女</option>
            <option value="unknown"${person.gender === 'unknown' ? ' selected' : ''}>未知</option>
          </select>
        </div>
        <div class="field span-4"><label for="sg-birth">出生日期</label><input id="sg-birth" type="date" value="${dateVal(person.birth_date)}"></div>
        <div class="field span-4"><label for="sg-birthp">出生精度</label><select id="sg-birthp">${precisionOptions(person.birth_precision)}</select></div>
        <div class="field span-6"><label for="sg-birthplace">出生地</label><input id="sg-birthplace" type="text" value="${esc(person.birth_place)}"></div>
        <div class="field span-6"><label for="sg-death">去世日期</label><input id="sg-death" type="date" value="${dateVal(person.death_date)}"></div>
        <div class="field span-3"><label for="sg-deathp">去世精度</label><select id="sg-deathp">${precisionOptions(person.death_precision)}</select></div>
        <div class="field span-3"><label for="sg-deathplace">去世地</label><input id="sg-deathplace" type="text" value="${esc(person.death_place)}"></div>
        <div class="field span-6"><label for="sg-burial">安葬地</label><input id="sg-burial" type="text" value="${esc(person.burial_place)}"></div>
        <div class="field span-6"><label for="sg-occ">职业</label><input id="sg-occ" type="text" value="${esc(person.occupation)}"></div>
        <div class="field span-6"><label for="sg-edu">学历 / 师承</label><input id="sg-edu" type="text" value="${esc(person.education)}"></div>
        <div class="field span-12"><label for="sg-bio">生平简介</label><textarea id="sg-bio">${esc(person.bio)}</textarea></div>
        <div class="field span-12"><label for="sg-note">修改说明（给管理员）</label><input id="sg-note" type="text" placeholder="如：出生日期据族中长辈回忆更正"></div>
        <div class="field span-12"><label class="row small"><input id="sg-deceased" type="checkbox"${person.is_deceased ? ' checked' : ''}> 已故</label></div>
        <div id="sg-error" class="span-12" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">提交建议</button>`,
    onClose: () => { if (!submitted) onDone?.(null); },
  });

  const errBox = m.el.querySelector('#sg-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const val = (sel) => m.el.querySelector(sel).value.trim();
    const payload = {
      family_name: val('#sg-family'),
      given_name: val('#sg-given'),
      courtesy_name: val('#sg-courtesy'),
      former_names: val('#sg-former').split(/[、,，;；\s]+/).map((x) => x.trim()).filter(Boolean),
      generation_name: val('#sg-genname'),
      generation_no: val('#sg-genno') === '' ? null : Number(val('#sg-genno')),
      branch: val('#sg-branch'),
      gender: m.el.querySelector('#sg-gender').value,
      birth_date: val('#sg-birth') || null,
      birth_precision: m.el.querySelector('#sg-birthp').value,
      birth_place: val('#sg-birthplace'),
      death_date: val('#sg-death') || null,
      death_precision: m.el.querySelector('#sg-deathp').value,
      death_place: val('#sg-deathplace'),
      burial_place: val('#sg-burial'),
      is_deceased: m.el.querySelector('#sg-deceased').checked,
      occupation: val('#sg-occ'),
      education: val('#sg-edu'),
      bio: val('#sg-bio'),
    };
    btn.disabled = true;
    try {
      await api('/api/change-requests', {
        method: 'POST',
        body: { personId: person.id, payload, note: val('#sg-note') },
      });
      submitted = true;
      m.close();
      onDone?.(true);
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}

function wireSuggestEdit(root, person) {
  const btn = root.querySelector('#suggest-edit');
  if (!btn) return;
  btn.addEventListener('click', () => {
    suggestEditModal(person, (ok) => {
      if (ok) toast('建议已提交，等待管理员审核', 'ok');
    });
  });
}

// =====================================================================
// 来源与考证
// =====================================================================
const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' };

function renderCitations(list, canEdit) {
  if (!list.length) return '<div class="empty">尚未关联来源，建议为关键生卒与迁徙补充出处</div>';
  return list.map((c) => `
    <div class="citation-item">
      <div class="min-w-0">
        <div><strong>${esc(c.title)}</strong>
          ${c.author ? `<span class="small muted"> · ${esc(c.author)}</span>` : ''}
        </div>
        <div class="small muted">
          ${c.page ? `卷页：${esc(c.page)} · ` : ''}
          ${c.publication ? `${esc(c.publication)} · ` : ''}
          可信度 ${CONFIDENCE_LABEL[c.confidence] || c.confidence}
        </div>
        ${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}
      </div>
      ${canEdit ? `<button class="rel-del rel-del-text" type="button" data-citation-del="${esc(c.id)}">删除</button>` : ''}
    </div>`).join('');
}

function wireCitations(root, person, initial) {
  let list = initial;
  const body = root.querySelector('#citations-body');
  const count = root.querySelector('#citation-count');

  async function reload() {
    try {
      list = await api(`/api/citations?targetType=person&targetId=${person.id}`);
      body.innerHTML = renderCitations(list, session.canEdit);
      count.textContent = `${list.length} 条`;
    } catch (err) { toast(err.message, 'error'); }
  }

  root.querySelector('#add-citation')?.addEventListener('click', () => {
    citationModal({ targetType: 'person', targetId: person.id, onSaved: reload });
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-citation-del]');
    if (!btn) return;
    const ok = await confirmDialog('确认移除这条来源引文？来源本身不会被删除。', { danger: true, okText: '移除' });
    if (!ok) return;
    try {
      await api(`/api/citations/${btn.dataset.citationDel}`, { method: 'DELETE' });
      toast('引文已移除', 'ok');
      await reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function citationModal({ targetType, targetId, onSaved }) {
  let sources = [];
  try { sources = await api('/api/sources'); } catch { /* 无来源库时仍可新建 */ }

  const options = sources.map((s) =>
    `<option value="${esc(s.id)}">${esc(s.title)}${s.author ? ' · ' + esc(s.author) : ''}</option>`).join('');

  const m = openModal({
    title: targetType === 'event' ? '为事件添加来源' : '添加来源与考证',
    body: `
      <div class="stack-8">
        <div class="field">
          <label for="cit-source">选择来源</label>
          <select id="cit-source"><option value="">＋ 新建来源</option>${options}</select>
        </div>
        <div id="cit-new" class="stack-8">
          <div class="field"><label for="cit-title">来源标题 *</label><input id="cit-title" placeholder="如：光绪重修族谱"></div>
          <div class="row">
            <div class="field flex-1"><label for="cit-author">作者/编纂者</label><input id="cit-author"></div>
            <div class="field flex-1"><label for="cit-publication">出版/形成信息</label><input id="cit-publication"></div>
          </div>
          <div class="field"><label for="cit-repository">收藏地/档案馆</label><input id="cit-repository"></div>
        </div>
        <div class="row">
          <div class="field flex-1"><label for="cit-page">卷/页/条目</label><input id="cit-page" placeholder="如：卷三 · 第十二页"></div>
          <div class="field flex-1"><label for="cit-confidence">可信度</label>
            <select id="cit-confidence">
              <option value="high">高</option>
              <option value="medium" selected>中</option>
              <option value="low">低</option>
            </select>
          </div>
        </div>
        <div class="field"><label for="cit-note">考证说明</label><textarea id="cit-note" placeholder="如：与家书互证，生年据此更正"></textarea></div>
        <div id="cit-error" hidden></div>
      </div>`,
    footer: `<button class="btn" type="button" data-act="cancel">取消</button>
             <button class="btn btn-primary" type="button" data-act="ok">保存引文</button>`,
  });

  const newBox = m.el.querySelector('#cit-new');
  const syncNewBox = () => { newBox.hidden = !!m.el.querySelector('#cit-source').value; };
  m.el.querySelector('#cit-source').addEventListener('change', syncNewBox);
  syncNewBox();

  const errBox = m.el.querySelector('#cit-error');
  m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
  m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    errBox.hidden = true;
    btn.disabled = true;
    try {
      let sourceId = m.el.querySelector('#cit-source').value;
      if (!sourceId) {
        const title = m.el.querySelector('#cit-title').value.trim();
        if (!title) throw new Error('新建来源需要填写标题');
        const created = await api('/api/sources', {
          method: 'POST',
          body: {
            title,
            author: m.el.querySelector('#cit-author').value.trim(),
            publication: m.el.querySelector('#cit-publication').value.trim(),
            repository: m.el.querySelector('#cit-repository').value.trim(),
          },
        });
        sourceId = created.id;
      }
      await api('/api/citations', {
        method: 'POST',
        body: {
          sourceId,
          targetType,
          targetId,
          page: m.el.querySelector('#cit-page').value.trim(),
          confidence: m.el.querySelector('#cit-confidence').value,
          note: m.el.querySelector('#cit-note').value.trim(),
        },
      });
      m.close();
      onSaved?.();
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}

const KIND_LABEL = {
  self: '本人', spouse: '配偶', ancestor: '直系长辈', descendant: '直系晚辈',
  sibling: '兄弟姐妹', collateral: '旁系', inlaw: '姻亲', unknown: '未能判定',
};
function kindLabel(kind) {
  return KIND_LABEL[kind] || kind;
}

// =====================================================================
// 其他关联（义亲/见证/师承/邻里等，GEDCOM 7 ASSO 思路）
// =====================================================================
const ASSOC_ROLES = {
  godparent: '义父/义母', godchild: '义子/义女', witness: '见证人',
  employer: '雇主', employee: '雇员', neighbor: '邻里', friend: '好友',
  teacher: '师长', student: '门生', successor: '继承人', other: '其他',
};

function renderAssociations(list, canEdit) {
  if (!list.length) {
    return '<div class="empty">暂无其他关联。义亲、见证人、师承、邻里等可在此登记</div>';
  }
  return list.map((a) => `
    <div class="citation-item">
      <div class="min-w-0">
        <div>
          <span class="badge badge-muted">${esc(a.roleLabel || ASSOC_ROLES[a.role] || a.role)}</span>
          <a href="#/person/${esc(a.other.id)}">${esc(a.other.name)}</a>
          ${a.direction === 'reverse' ? '<span class="small muted">（对方登记）</span>' : ''}
        </div>
        ${a.note ? `<div class="small muted">${esc(a.note)}</div>` : ''}
      </div>
      ${canEdit ? `<button class="rel-del rel-del-text" type="button" data-assoc-del="${esc(a.id)}">删除</button>` : ''}
    </div>`).join('');
}

function wireAssociations(root, person, initial) {
  let list = initial;
  const body = root.querySelector('#assoc-body');
  const count = root.querySelector('#assoc-count');

  async function reload() {
    try {
      list = await api(`/api/associations/person/${person.id}`);
      body.innerHTML = renderAssociations(list, session.canEdit);
      count.textContent = `${list.length} 条`;
    } catch (err) { toast(err.message, 'error'); }
  }

  root.querySelector('#add-assoc')?.addEventListener('click', async () => {
    const picked = await pickPerson('选择关联成员', person.id);

    // 拉取可用角色（内置 + 自定义），失败时退回内置词表
    let roleOptions = Object.entries(ASSOC_ROLES);
    try {
      const roleRes = await api('/api/associations/roles');
      roleOptions = roleRes.roles.map((r) => [r.key, r.label]);
      if (session.canEdit) roleOptions = [...roleOptions, ['__manage', '＋ 管理自定义角色…']];
    } catch { /* 保持内置兜底 */ }
    if (!picked) return;

    const m = openModal({
      title: `与「${picked.name}」的关联`,
      body: `
        <div class="stack-8">
          <div class="field"><label for="as-role">关联类型</label>
            <select id="as-role">
              ${roleOptions.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label for="as-note">说明</label><input id="as-note" placeholder="如：同村邻里、婚宴见证"></div>
          <div id="as-error" hidden></div>
        </div>`,
      footer: `<button class="btn" type="button" data-act="cancel">取消</button>
               <button class="btn btn-primary" type="button" data-act="ok">添加</button>`,
    });
    // 「管理自定义角色」：以 layered 方式叠加，不关闭当前弹窗
    const roleSel = m.el.querySelector('#as-role');
    roleSel?.addEventListener('change', async () => {
      if (roleSel.value !== '__manage') return;
      await openRoleManager();
      roleSel.value = roleOptions[0]?.[0] || 'other';
    });

    const errBox = m.el.querySelector('#as-error');
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-act="ok"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/associations', {
          method: 'POST',
          body: {
            personAId: person.id,
            personBId: picked.id,
            role: m.el.querySelector('#as-role').value,
            note: m.el.querySelector('#as-note').value.trim(),
          },
        });
        m.close();
        toast('关联已添加', 'ok');
        await reload();
      } catch (err) {
        errBox.hidden = false;
        errBox.className = 'form-error';
        errBox.textContent = err.message;
        btn.disabled = false;
      }
    });
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-assoc-del]');
    if (!btn) return;
    const ok = await confirmDialog('确认删除该关联？', { danger: true, okText: '删除' });
    if (!ok) return;
    try {
      await api(`/api/associations/${btn.dataset.assocDel}`, { method: 'DELETE' });
      toast('关联已删除', 'ok');
      await reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/**
 * 自定义关联角色管理（layered 弹窗）：列出内置/自定义角色，可新增与删除。
 */
async function openRoleManager() {
  let data;
  try { data = await api('/api/associations/roles'); }
  catch (err) { toast(err.message, 'error'); return; }

  const renderRows = (d) => d.roles.map((r) => `
    <tr>
      <td>${esc(r.label)}</td>
      <td class="mono small muted">${esc(r.key)}</td>
      <td>${r.builtin ? '<span class="badge badge-muted">内置</span>' : '<span class="badge badge-jade">自定义</span>'}</td>
      <td>${r.builtin ? '—' : `<button class="btn btn-sm btn-danger" type="button" data-del-role="${esc(r.key)}">删除</button>`}</td>
    </tr>`).join('');

  const m = openModal({
    title: '关联角色管理',
    layered: true,
    body: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>标识</th><th>类型</th><th>操作</th></tr></thead>
          <tbody id="role-list">${renderRows(data)}</tbody>
        </table>
      </div>
      <div class="divider"></div>
      <div class="row">
        <div class="field flex-1"><label for="new-role-label">新增自定义角色</label>
          <input id="new-role-label" maxlength="12" placeholder="如：族老、义兄弟、同窗"></div>
        <div class="field flex-1"><label for="new-role-note">说明（可选）</label>
          <input id="new-role-note" maxlength="100"></div>
      </div>
      <p class="small muted">自定义角色最多 30 个，名称不超过 12 字；内置角色不可删除。</p>
      <div id="role-error" hidden></div>`,
    footer: `<button class="btn" type="button" data-act="close">关闭</button>
             <button class="btn btn-primary" type="button" data-act="add">新增角色</button>`,
  });

  const errBox = m.el.querySelector('#role-error');
  const tbody = m.el.querySelector('#role-list');
  m.el.querySelector('[data-act="close"]').addEventListener('click', () => m.close());

  const bindDeletes = () => {
    m.el.querySelectorAll('[data-del-role]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog('删除后该角色不能再用于新建关联（已有关联记录保留）。确认删除？', { danger: true, okText: '删除' });
        if (!ok) return;
        try {
          const res = await api(`/api/associations/roles/${encodeURIComponent(btn.dataset.delRole)}`, { method: 'DELETE' });
          data = {
            ...data,
            roles: data.roles.filter((r) => r.builtin)
              .concat(res.custom.map((c) => ({ key: c.key, label: c.label, builtin: false }))),
          };
          tbody.innerHTML = renderRows(data);
          bindDeletes();
          toast('角色已删除', 'ok');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  };
  bindDeletes();

  m.el.querySelector('[data-act="add"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    errBox.hidden = true;
    btn.disabled = true;
    try {
      const res = await api('/api/associations/roles', {
        method: 'POST',
        body: {
          label: m.el.querySelector('#new-role-label').value.trim(),
          note: m.el.querySelector('#new-role-note').value.trim(),
        },
      });
      data = {
        ...data,
        roles: [...data.roles, { key: res.role.key, label: res.role.label, builtin: false }],
      };
      tbody.innerHTML = renderRows(data);
      bindDeletes();
      m.el.querySelector('#new-role-label').value = '';
      m.el.querySelector('#new-role-note').value = '';
      toast(`已新增角色「${res.role.label}」`, 'ok');
    } catch (err) {
      errBox.hidden = false;
      errBox.className = 'form-error';
      errBox.textContent = err.message;
    }
    btn.disabled = false;
  });
}
