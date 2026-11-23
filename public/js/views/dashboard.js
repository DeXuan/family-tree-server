import { api } from '../api.js';
import { esc, fmtDate, ACTION, emptyState } from '../ui.js';

const ENTITY_LABEL = {
  person: '成员', family: '家族', user: '账户', user_role: '角色',
  user_person: '成员绑定', parent_child: '亲子关系', marriage: '婚姻记录',
};

/** 把审计记录翻译成一句人话 */
function describeActivity(r) {
  const after = r.after || {};
  const before = r.before || {};
  const name = after.family_name
    ? `${after.family_name}${after.given_name || ''}`
    : before.family_name
      ? `${before.family_name}${before.given_name || ''}`
      : after.username || before.username
        || after.event
        || '';
  const action = ACTION[r.action] || r.action;
  const entity = ENTITY_LABEL[r.entity_type] || r.entity_type;
  if (r.action === 'login') return '登录了系统';
  if (r.action === 'logout') return '退出了系统';
  if (r.action === 'privacy_change') return '调整了隐私可见范围';
  if (r.action === 'export') return `导出了${after.format ? after.format.toUpperCase() : ''}数据`;
  if (r.action === 'import') return `导入了 ${after.inserted ?? 0} 位成员`;
  return `${action}${entity}${name ? '「' + name + '」' : ''}`;
}
import { renderTreeNodes, wireTree } from '../components/tree.js';

export async function renderDashboard(root) {
  root.innerHTML = '<div class="content"><div class="empty">正在载入家族概览…</div></div>';
  let stats, tree;
  try {
    [stats, tree] = await Promise.all([
      api('/api/stats'),
      api('/api/tree?depth=2'),
    ]);
  } catch (err) {
    root.innerHTML = `<div class="content"><div class="notice">${esc(err.message)}</div></div>`;
    return;
  }

  const branches = stats.branches || [];
  const branchTotal = branches.reduce((s, b) => s + b.c, 0) || 1;

  root.innerHTML = `
    <div class="content">
      <div class="page-head">
        <div>
          <div class="row">
            <h1>家族概览</h1>
            ${stats.aliveGenerations >= 5 ? '<span class="badge badge-jade">五世同堂</span>' : ''}
          </div>
          <p class="page-sub">${esc(stats.familyName)} · 已录入 ${stats.total} 位成员 · 繁衍 ${stats.maxGeneration} 世 · ${stats.aliveGenerations} 代在世</p>
        </div>
        <div class="spacer"></div>
        <div class="btn-row">
          <a class="btn" href="#/tree">查看世系树</a>
          <a class="btn btn-primary" href="#/new">录入成员</a>
        </div>
      </div>

      <div class="grid grid-4">
        <div class="card stat">
          <span class="stat-label">成员总数</span>
          <span class="stat-value">${stats.total}</span>
          <span class="stat-sub">纳入谱系的在世与已故成员</span>
        </div>
        <div class="card stat stat-jade">
          <span class="stat-label">在世成员</span>
          <span class="stat-value">${stats.alive}</span>
          <span class="stat-sub">已故 ${stats.deceased} 人 · 在世 ${stats.aliveGenerations} 代</span>
        </div>
        <div class="card stat stat-accent">
          <span class="stat-label">传承世代</span>
          <span class="stat-value">${stats.maxGeneration}</span>
          <span class="stat-sub">自始祖起算${stats.aliveGenerations >= 5 ? ' · 五世同堂' : ''}</span>
        </div>
        <div class="card stat">
          <span class="stat-label">支系</span>
          <span class="stat-value">${branches.length}</span>
          <span class="stat-sub">${branches.map((b) => `${esc(b.branch)} ${b.c}`).join(' · ') || '尚未划分'}</span>
        </div>
      </div>

      <div class="grid grid-2-1 mt-16">
        <div class="card">
          <div class="card-head">
            <h3>世系一瞥</h3>
            <span class="badge badge-muted">前三代</span>
            <div class="spacer"></div>
            <a class="small" href="#/tree">完整族谱 →</a>
          </div>
          <div class="card-body tree-scroll" id="mini-tree">
            ${tree.roots.length ? renderTreeNodes(tree.roots, { mini: true }) : emptyState('尚未录入成员', '谱')}
          </div>
        </div>

        <div class="stack-16">
          <div class="card">
            <div class="card-head"><h3>支系分布</h3></div>
            <div class="card-body">
              ${branches.length ? branches.map((b) => `
                <div class="row-between py-1">
                  <span>${esc(b.branch)}</span>
                  <span class="muted small">${b.c} 人 · ${Math.round((b.c / branchTotal) * 100)}%</span>
                </div>`).join('') : '<p class="muted small">尚未设置支系</p>'}
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>最近动态</h3>
              <div class="spacer"></div>
              <a class="small" href="#/admin">审计日志 →</a>
            </div>
            <div class="card-body">
              ${(stats.recent || []).length ? stats.recent.map((r) => `
                <div class="row item-row">
                  <span class="badge badge-muted">${esc(ACTION[r.action] || r.action)}</span>
                  <div class="min-w-0">
                    <div class="small"><strong>${esc(r.actor_label || '系统')}</strong> ${esc(describeActivity(r))}</div>
                    <div class="muted small">${esc(fmtDate(r.created_at))}</div>
                  </div>
                </div>`).join('') : '<p class="muted small">暂无动态</p>'}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  wireTree(root.querySelector('#mini-tree'));
}
