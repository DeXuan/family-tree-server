import { api, session } from '../api.js';
import { esc, fmtDate, PRECISION } from '../ui.js';

const precisionOptions = (selected) => Object.entries(PRECISION).map(([v, label]) =>
  `<option value="${v}"${v === selected ? ' selected' : ''}>${label}</option>`).join('');

export async function renderPersonForm(root, id = null) {
  const isEdit = !!id;
  let person = {
    family_name: '', given_name: '', courtesy_name: '', generation_name: '',
    generation_no: '', branch: '', gender: 'unknown',
    birth_date: '', birth_precision: 'unknown', birth_place: '',
    death_date: '', death_precision: 'unknown', death_place: '', burial_place: '',
    is_deceased: false, occupation: '', education: '', bio: '', contact: {}, former_names: [],
  };
  let branches = [];

  try {
    const stats = await api('/api/stats');
    branches = (stats.branches || []).map((b) => b.branch);
    if (isEdit) person = { ...person, ...(await api(`/api/persons/${id}`)) };
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const val = (v) => esc(v ?? '');
  const dateVal = (v) => esc(fmtDate(v));
  const showContact = session.isAdmin || (isEdit && session.user?.personId === id);
  const contact = person.contact || {};

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <h1>${isEdit ? '编辑成员' : '录入成员'}</h1>
          <p class="page-sub">${isEdit ? '修改将写入审计日志，可追溯改动前后值' : '仅需填写已知信息，未知项可留空'}</p>
        </div>
        <div class="spacer"></div>
        <a class="btn btn-ghost" href="${isEdit ? `#/person/${id}` : '#/people'}">取消</a>
      </div>

      <div class="card">
        <div class="card-body">
          <form id="person-form">
            <div class="form-grid">
              <div class="field span-3">
                <label for="family_name">姓</label>
                <input id="family_name" name="family_name" type="text" value="${val(person.family_name)}" placeholder="王">
              </div>
              <div class="field span-3">
                <label for="given_name">名</label>
                <input id="given_name" name="given_name" type="text" value="${val(person.given_name)}" placeholder="大伯">
              </div>
              <div class="field span-3">
                <label for="courtesy_name">字 / 号</label>
                <input id="courtesy_name" name="courtesy_name" type="text" value="${val(person.courtesy_name)}" placeholder="子厚">
              </div>
              <div class="field span-3">
                <label for="gender">性别</label>
                <select id="gender" name="gender">
                  <option value="male"${person.gender === 'male' ? ' selected' : ''}>男</option>
                  <option value="female"${person.gender === 'female' ? ' selected' : ''}>女</option>
                  <option value="unknown"${person.gender === 'unknown' ? ' selected' : ''}>未知</option>
                </select>
              </div>

              <div class="field span-12">
                <label for="former_names">曾用名</label>
                <input id="former_names" name="former_names" type="text"
                  value="${val((person.former_names || []).join('、'))}"
                  placeholder="多个用顿号或逗号分隔，如：王德福、王阿昌">
              </div>

              <div class="field span-2">
                <label for="generation_name">字辈</label>
                <input id="generation_name" name="generation_name" type="text" value="${val(person.generation_name)}" placeholder="德">
              </div>
              <div class="field span-2">
                <label for="generation_no">世代</label>
                <input id="generation_no" name="generation_no" type="number" min="1" value="${val(person.generation_no)}" placeholder="2">
              </div>
              <div class="field span-3">
                <label for="branch">支系</label>
                <input id="branch" name="branch" type="text" list="branch-list" value="${val(person.branch)}" placeholder="长房">
                <datalist id="branch-list">${branches.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
              </div>
              <div class="field span-5">
                <label for="occupation">职业</label>
                <input id="occupation" name="occupation" type="text" value="${val(person.occupation)}" placeholder="教师">
              </div>

              <div class="field span-3">
                <label for="birth_date">出生日期</label>
                <input id="birth_date" name="birth_date" type="date" value="${dateVal(person.birth_date)}">
              </div>
              <div class="field span-3">
                <label for="birth_precision">日期精度</label>
                <select id="birth_precision" name="birth_precision">${precisionOptions(person.birth_precision || 'unknown')}</select>
                <span class="hint">族谱常见“约 1902 年生”，请如实选择</span>
              </div>
              <div class="field span-6">
                <label for="birth_place">出生地</label>
                <input id="birth_place" name="birth_place" type="text" value="${val(person.birth_place)}" placeholder="河北保定">
              </div>

              <div class="field span-3">
                <label for="death_date">去世日期</label>
                <input id="death_date" name="death_date" type="date" value="${dateVal(person.death_date)}">
              </div>
              <div class="field span-3">
                <label for="death_precision">日期精度</label>
                <select id="death_precision" name="death_precision">${precisionOptions(person.death_precision || 'unknown')}</select>
              </div>
              <div class="field span-3">
                <label for="death_place">去世地</label>
                <input id="death_place" name="death_place" type="text" value="${val(person.death_place)}">
              </div>
              <div class="field span-3">
                <label for="burial_place">安葬地</label>
                <input id="burial_place" name="burial_place" type="text" value="${val(person.burial_place)}">
              </div>

              <div class="field span-6">
                <label for="education">学历 / 师承</label>
                <input id="education" name="education" type="text" value="${val(person.education)}">
              </div>
              <div class="field span-6">
                <label>状态</label>
                <label class="row small">
                  <input id="is_deceased" name="is_deceased" type="checkbox"${person.is_deceased ? ' checked' : ''}>
                  已故
                </label>
              </div>

              ${showContact ? `
              <div class="field span-12">
                <label>联系方式 <span class="badge badge-muted">私密 · 仅本人与管理员可见</span></label>
              </div>
              <div class="field span-4">
                <label for="contact_phone">电话</label>
                <input id="contact_phone" name="contact_phone" type="text" value="${val(contact.phone)}" autocomplete="tel">
              </div>
              <div class="field span-4">
                <label for="contact_email">邮箱</label>
                <input id="contact_email" name="contact_email" type="email" value="${val(contact.email)}" autocomplete="email">
              </div>
              <div class="field span-4">
                <label for="contact_address">住址</label>
                <input id="contact_address" name="contact_address" type="text" value="${val(contact.address)}" autocomplete="street-address">
              </div>` : ''}

              <div class="field span-12">
                <label for="bio">生平简介</label>
                <textarea id="bio" name="bio" placeholder="生平事迹、迁徙、职业变迁等…">${val(person.bio)}</textarea>
              </div>
            </div>

            <div id="form-error" hidden></div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit" id="save-btn">${isEdit ? '保存修改' : '保存并录入'}</button>
              <a class="btn btn-ghost" href="${isEdit ? `#/person/${id}` : '#/people'}">取消</a>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  const form = root.querySelector('#person-form');
  const errorBox = root.querySelector('#form-error');
  const saveBtn = root.querySelector('#save-btn');

  // 未保存提醒：表单有改动时离开页面/刷新会提示
  let dirty = false;
  const beforeUnload = (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('route:leave', () => {
    window.removeEventListener('beforeunload', beforeUnload);
  }, { once: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const fd = new FormData(form);
    const body = {
      family_name: fd.get('family_name').trim(),
      given_name: fd.get('given_name').trim(),
      courtesy_name: fd.get('courtesy_name').trim(),
      gender: fd.get('gender'),
      generation_name: fd.get('generation_name').trim(),
      generation_no: fd.get('generation_no') ? Number(fd.get('generation_no')) : null,
      branch: fd.get('branch').trim(),
      occupation: fd.get('occupation').trim(),
      birth_date: fd.get('birth_date') || null,
      birth_precision: fd.get('birth_precision'),
      birth_place: fd.get('birth_place').trim(),
      death_date: fd.get('death_date') || null,
      death_precision: fd.get('death_precision'),
      death_place: fd.get('death_place').trim(),
      burial_place: fd.get('burial_place').trim(),
      education: fd.get('education').trim(),
      is_deceased: fd.get('is_deceased') === 'on',
      bio: fd.get('bio').trim(),
      former_names: String(fd.get('former_names') || '')
        .split(/[、,，;；\s]+/).map((s) => s.trim()).filter(Boolean),
    };
    if (showContact) {
      body.contact = {
        phone: (fd.get('contact_phone') || '').trim(),
        email: (fd.get('contact_email') || '').trim(),
        address: (fd.get('contact_address') || '').trim(),
      };
    }
    if (!body.family_name && !body.given_name) {
      errorBox.hidden = false;
      errorBox.className = 'form-error';
      errorBox.textContent = '请至少填写姓或名';
      return;
    }
    if (body.is_deceased && !body.death_date) body.death_precision = 'unknown';

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      if (isEdit) {
        // 带上读取时的版本，若他人在此期间修改过会收到 409
        body.expectedUpdatedAt = person.updated_at;
        await api(`/api/persons/${id}`, { method: 'PUT', body });
        dirty = false;
        location.hash = `#/person/${id}`;
      } else {
        const created = await api('/api/persons', { method: 'POST', body });
        dirty = false;
        location.hash = `#/person/${created.id}`;
      }
    } catch (err) {
      errorBox.hidden = false;
      errorBox.className = 'form-error';
      errorBox.textContent = err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '保存修改' : '保存并录入';
    }
  });
}
