import { api, session } from '../api.js';
import { esc, toast, cnNum } from '../ui.js';

/** 家族洞察（借鉴 yimai 的六类洞察） */
export async function renderInsights(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在分析家族数据…</div></div>';

  let data;
  try {
    data = await api('/api/tree/insights');
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const maxGenTotal = Math.max(1, ...data.generationStructure.map((g) => g.total));
  const maxRegion = Math.max(1, ...data.regions.map((r) => r.count));
  const birth = data.birth;
  const spanSafe = Math.max(1, birth.span || 1);

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <div class="row">
            <h1>家族洞察</h1>
            ${data.livingGenerations >= 5 ? '<span class="badge badge-jade">五世同堂</span>' : ''}
          </div>
          <p class="page-sub">${data.total} 位成员 · ${data.generations} 世 · ${data.alive} 人在世</p>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm" type="button" id="copy-summary">复制摘要</button>
      </div>

      <div class="grid grid-4">
        <div class="card stat">
          <span class="stat-label">成员总数</span>
          <span class="stat-value">${data.total}</span>
          <span class="stat-sub">男 ${data.gender.male} · 女 ${data.gender.female}</span>
        </div>
        <div class="card stat stat-jade">
          <span class="stat-label">在世</span>
          <span class="stat-value">${data.alive}</span>
          <span class="stat-sub">已故 ${data.deceased} 人</span>
        </div>
        <div class="card stat stat-accent">
          <span class="stat-label">传承世代</span>
          <span class="stat-value">${data.generations}</span>
          <span class="stat-sub">${data.livingGenerations} 代在世</span>
        </div>
        <div class="card stat">
          <span class="stat-label">出生跨度</span>
          <span class="stat-value">${birth.span || '—'}</span>
          <span class="stat-sub">${birth.from ?? '?'} – ${birth.to ?? '?'}</span>
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>人丁结构</h3><span class="badge badge-muted">按世代</span></div>
          <div class="card-body">
            ${data.generationStructure.map((g) => `
              <div class="ins-gen">
                <span class="ins-gen-label">${esc(g.orderLabel)}${g.mainGenerationName ? `<s>${esc(g.mainGenerationName)}</s>` : ''}</span>
                <span class="ins-gen-bar">
                  <i class="m" data-w="${(g.male / maxGenTotal) * 100}"></i>
                  <i class="f" data-w="${(g.female / maxGenTotal) * 100}"></i>
                </span>
                <span class="ins-gen-value">${g.total}</span>
              </div>`).join('') || '<div class="empty">尚无世代数据</div>'}
            <div class="row mt-8 small muted">
              <span><b class="dot-male"></b> 男 ${data.gender.male}</span>
              <span><b class="dot-female"></b> 女 ${data.gender.female}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>字辈图谱</h3>
            ${data.zibei.broken ? '<span class="badge badge-amber">有断裂</span>' : data.zibei.kept >= 2 ? '<span class="badge badge-jade">连续</span>' : ''}
          </div>
          <div class="card-body">
            <p class="small">${esc(data.zibei.message)}</p>
            <div class="ins-zb mt-16">
              ${(data.zibei.series || []).map((z) => `
                <div class="ins-zb-row">
                  <span class="ins-zb-ch">${esc(z.generationName || '—')}</span>
                  <span class="small muted">${esc(z.orderLabel)} · ${z.count} 人</span>
                </div>`).join('') || '<div class="empty">尚未录入字辈</div>'}
            </div>
            ${data.generationAudit?.hasPoem ? `
              <div class="divider"></div>
              <div class="small">
                <strong>按派语取名符合度：${data.generationAudit.rate ?? '—'}%</strong>
                <span class="muted">（符合 ${data.generationAudit.ok} · 偏离 ${data.generationAudit.mismatch} · 姻亲不计 ${data.generationAudit.excluded}）</span>
              </div>
              ${data.generationAudit.mismatches?.length ? `<div class="small muted mt-8">偏离示例：
                ${data.generationAudit.mismatches.slice(0, 5).map((x) => `${esc(x.name)}（应「${esc(x.expected)}」）`).join("、")}
              </div>` : ''}` : ''}
          </div>
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-head"><h3>代际与寿数</h3></div>
          <div class="card-body">
            <div class="ins-nums">
              <div><b>${data.birth.span || '—'}</b><span>出生跨度（年）</span></div>
              <div><b>${data.longevity.averageAge ?? '—'}</b><span>已故平均享年</span></div>
              <div><b>${data.longevity.records.length}</b><span>已故记录</span></div>
            </div>
            ${data.longevity.oldest ? `<p class="small mt-8">最长寿：<strong>${esc(data.longevity.oldest.name)}</strong>（${data.longevity.oldest.age} 岁，${data.longevity.oldest.birthYear}–${data.longevity.oldest.deathYear}）</p>` : '<p class="small muted mt-8">族中暂无已故记录。</p>'}
            ${data.longevity.oldestLiving ? `<p class="small">在世最年长：<strong>${esc(data.longevity.oldestLiving.name)}</strong>（${data.longevity.oldestLiving.age} 岁）</p>` : ''}
            ${data.longevity.records.length ? `
              <div class="ins-life mt-16">
                ${data.longevity.records.filter((r) => !('__test' in r)).map((r) => {
                  const left = birth.from === null ? 0 : ((r.birthYear - birth.from) / spanSafe) * 100;
                  const width = Math.max(2, ((r.deathYear - r.birthYear) / spanSafe) * 100);
                  return `<div class="ins-life-row">
                    <span class="ins-life-name">${esc(r.name)}</span>
                    <span class="ins-life-bar"><i data-left="${Math.max(0, Math.min(96, left)).toFixed(1)}" data-w="${Math.min(100, width).toFixed(1)}"></i></span>
                    <span class="ins-life-age">${r.age}</span>
                  </div>`;
                }).join('')}
              </div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>地域分布</h3><span class="badge badge-muted">出生地</span></div>
          <div class="card-body">
            ${data.regions.length ? data.regions.map((r) => `
              <div class="ins-region">
                <span class="ins-region-name">${esc(r.place)}</span>
                <span class="ins-region-bar"><i data-w="${(r.count / maxRegion) * 100}"></i></span>
                <span class="ins-region-value">${r.count}</span>
              </div>`).join('') : '<div class="empty">尚未录入出生地，补录后可看地域分布</div>'}
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head"><h3>家族年表</h3><span class="badge badge-muted">最近 ${data.timeline.length} 条</span></div>
        <div class="card-body">
          ${data.timeline.length ? `<div class="ins-timeline">
            ${data.timeline.map((e) => `
              <div class="ins-tl-row ${e.kind}">
                <span class="ins-tl-year">${e.year}</span>
                <span class="ins-tl-dot"></span>
                <span class="ins-tl-text">
                  <a href="#/person/${esc(e.personId)}">${esc(e.text)}</a>
                  ${e.place ? `<span class="small muted">${esc(e.place)}</span>` : ''}
                </span>
              </div>`).join('')}
          </div>` : '<div class="empty">暂无年表数据</div>'}
        </div>
      </div>
    </div>`;

  // 用 CSSOM 设置宽度（CSP 禁止 style 属性，但允许 JS 改 style 对象）
  root.querySelectorAll('[data-w]').forEach((el) => {
    const w = Number(el.dataset.w);
    if (Number.isFinite(w)) el.style.width = `${Math.max(0, Math.min(100, w))}%`;
  });
  root.querySelectorAll('[data-left]').forEach((el) => {
    const l = Number(el.dataset.left);
    if (Number.isFinite(l)) el.style.left = `${Math.max(0, Math.min(96, l))}%`;
  });

  root.querySelector('#copy-summary').addEventListener('click', async () => {
    const lines = [
      `${data.total} 位成员 · ${data.generations} 世 · ${data.alive} 人在世`,
      `出生跨度 ${birth.from ?? '?'}–${birth.to ?? '?'}（${birth.span || 0} 年）`,
      data.zibei.message,
      data.longevity.oldest ? `最长寿：${data.longevity.oldest.name}（${data.longevity.oldest.age} 岁）` : '',
      data.regions.length ? `主要居住地：${data.regions.slice(0, 3).map((r) => `${r.place}（${r.count}）`).join('、')}` : '',
      data.generationStructure.map((g) => `${g.orderLabel}${g.mainGenerationName ? `「${g.mainGenerationName}」` : ''} ${g.total} 人`).join('；'),
    ].filter(Boolean);
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('摘要已复制', 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('摘要已复制', 'ok');
    }
  });
}