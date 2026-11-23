import { api } from '../api.js';
import { esc, fmtDate, openModal, debounce } from '../ui.js';

/** 成员选择器：搜索 → 立即选中，返回 {id, name} 或 null */
export function pickPerson(title, excludeId) {
  return new Promise((resolve) => {
    let resolved = false;
    const m = openModal({
      layered: true,
      title,
      body: `
        <div class="field">
          <label for="pick-q">搜索成员</label>
          <input id="pick-q" type="search" placeholder="输入姓名、字辈…" autocomplete="off">
        </div>
        <div class="picker-results" id="pick-results"><div class="empty">正在载入…</div></div>`,
      onClose: () => { if (!resolved) resolve(null); },
    });
    const input = m.el.querySelector('#pick-q');
    const box = m.el.querySelector('#pick-results');

    async function search() {
      try {
        const data = await api(`/api/persons?keyword=${encodeURIComponent(input.value.trim())}&pageSize=12`);
        const items = data.items.filter((p) => p.id !== excludeId);
        box.innerHTML = items.length
          ? items.map((p) => `
              <button type="button" class="picker-item" data-pick="${esc(p.id)}">
                <span class="pi-name">${esc(p.family_name + p.given_name)}</span>
                <span class="pi-meta">${p.generation_no ? p.generation_no + '世' : ''} ${esc(p.branch || '')} ${esc(fmtDate(p.birth_date) || (p.birth_year ?? ''))}</span>
              </button>`).join('')
          : '<div class="empty">没有匹配的成员</div>';
      } catch (err) {
        box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      }
    }

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      resolved = true;
      const name = btn.querySelector('.pi-name').textContent;
      m.close();
      resolve({ id: btn.dataset.pick, name });
    });

    input.addEventListener('input', debounce(search, 200));
    search();
    input.focus();
  });
}
