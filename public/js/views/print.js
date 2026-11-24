import { api, session, withBase } from '../api.js';
import { esc, fmtDate, toast } from '../ui.js';

/** 宗谱打印页：浏览器Ctrl+P即可另存为PDF，打印样式在styles.css的@media print */
export async function renderPrint(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在排版宗谱…</div></div>';

  let tree, stats;
  try {
    [tree, stats] = await Promise.all([api('/api/tree?depth=12'), api('/api/stats')]);
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const surname = stats.familyName;
  const now = new Date();

  // 递归生成竖排行列
  function rowsOf(nodes, depth = 0) {
    const out = [];
    for (const n of nodes) {
      const name = n.name;
      const life = n.birth_year ? `${n.birth_year}${n.death_year ? '–' + n.death_year : n.deceased ? '–?' : '–'}` : '';
      const spouse = (n.spouses || []).map((s) => s.name).join('、');
      const gen = n.gen ? `第${n.gen}世` : '';
      out.push({ depth, name, life, spouse, gen, branch: n.branch });
      if (n.children?.length) out.push(...rowsOf(n.children, depth + 1));
    }
    return out;
  }
  const rows = rowsOf(tree.roots);

  root.innerHTML = `
    <div class="print-toolbar">
      <button class="btn btn-primary btn-sm" type="button" id="btn-print">打印 / 另存 PDF</button>
      <button class="btn btn-sm" type="button" id="btn-pdf">服务端生成 PDF</button>
      <a class="btn btn-sm" href="#/tree">返回世系树</a>
      <span class="small muted">在打印对话框中选择"另存为 PDF"即可导出</span>
    </div>

    <div class="print-page">
      <div class="print-cover">
        <div class="print-seal">${esc((surname || '族')[0])}</div>
        <h1>${esc(surname)}　宗谱</h1>
        <div class="print-meta">${esc(stats.familyName || '')}</div>
        <div class="print-sub">共 ${stats.total} 人 · ${stats.maxGeneration} 世 · 在世 ${stats.alive} 人</div>
        <div class="print-date">${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日　重排</div>
        <div class="print-rule"></div>
        <p class="print-fanli">凡例：右起为长，配偶并列，已故者加框；生卒年以公元纪年，不详者留空。</p>
      </div>

      <div class="print-body">
        <table class="print-table">
          <thead><tr><th>世系</th><th>姓名</th><th>生卒</th><th>配偶</th><th>支系</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr class="${r.depth === 0 ? 'print-root' : ''}">
                <td class="print-indent" data-depth="${r.depth}">
                  ${r.gen || (r.depth === 0 ? '始祖' : '')}
                </td>
                <td class="print-name">${esc(r.name)}${r.life && r.life.includes('–?') ? '<span class="print-deceased">†</span>' : ''}</td>
                <td>${esc(r.life || '—')}</td>
                <td>${esc(r.spouse || '—')}</td>
                <td>${esc(r.branch || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="print-footer">${esc(surname)}氏宗谱 · 第 1 页（共 1 页）· 内部资料</div>
    </div>`;

  // CSSOM 设置缩进（CSP 不允许 style 属性）
  root.querySelectorAll('[data-depth]').forEach((el) => {
    const d = Number(el.dataset.depth) || 0;
    el.style.paddingLeft = `${d * 16}px`;
  });

  root.querySelector('#btn-print').addEventListener('click', () => window.print());
  root.querySelector('#btn-pdf').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '正在生成…';
    try {
      const cap = await api('/api/export/pdf/capability');
      if (!cap.available) throw new Error('服务端未配置渲染器');
      const t = await api('/api/export/pdf/ticket', {
        method: 'POST',
        body: { kind: 'genealogy', options: { preset: 'a4_portrait', title: `${surname}宗谱` } },
      });
      const a = document.createElement('a');
      a.href = withBase(t.renderUrl);
      a.download = `${surname}宗谱.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('PDF 生成中，完成后自动下载', 'ok');
    } catch (err) {
      toast(`服务端 PDF 不可用（${err.message}），改用浏览器打印`, 'error');
      window.print();
    }
    btn.disabled = false;
    btn.textContent = '服务端生成 PDF';
  });
}
