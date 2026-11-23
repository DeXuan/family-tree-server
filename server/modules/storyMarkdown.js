/**
 * 故事正文的轻量 Markdown 渲染（借鉴常见族谱工具的"回忆录"排版需求）。
 * 安全优先：先整体转义 HTML，再只把白名单语法转成标签，避免 XSS。
 */

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * 支持：段落（空行分隔）、# 标题（1-3 级）、**粗体**、*斜体*、`代码`、
 * - 无序列表、> 引用、--- 分隔线、[文本](http(s) 链接)、![说明](media:uuid)。
 * @param {string} text
 * @param {Set<string>|null} allowedMedia 允许展示的媒体 id 集合；为 null 时不做过滤
 * @returns {string} HTML
 */

/** 媒体图片渲染：按 allowedMedia 过滤无权展示的图 */
/** 拆分表格行：把 "|a|b|" 拆成 ['a','b']（内容已在上游转义） */
function splitRow(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** 生成表格 HTML；对齐用 class 而非内联样式（CSP 友好） */
function buildTable(header, bodyRows, aligns) {
  const cls = (i) => (aligns[i] && aligns[i] !== 'left' ? ` class="ta-${aligns[i]}"` : '');
  const th = header.map((c, i) => `<th${cls(i)}>${c}</th>`).join('');
  const trs = bodyRows
    .map((cells) => '<tr>' + cells.map((c, i) => `<td${cls(i)}>${c}</td>`).join('') + '</tr>')
    .join('');
  return `<div class="story-table-wrap"><table class="story-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function mediaFigure(caption, id, allowedMedia) {
  if (allowedMedia && !allowedMedia.has(id)) {
    return '<p class="small muted">🔒 私密图片</p>';
  }
  return `<figure class="story-figure"><img loading="lazy" src="/api/media/${id}/file" alt="${caption}">`
    + `<figcaption>${caption}</figcaption></figure>`;
}

export function renderStoryMarkdown(text, { allowedMedia = null } = {}) {
  const safe = esc(text || '').replace(/\r\n/g, '\n');
  const lines = safe.split('\n');
  const out = [];
  let listOpen = false;
  let quoteOpen = false;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (listOpen) { out.push('</ul>'); listOpen = false; }
  };
  const closeQuote = () => {
    if (quoteOpen) { out.push('</blockquote>'); quoteOpen = false; }
  };

  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // 内嵌媒体：![说明](media:uuid) 或 ![说明](/api/media/uuid/file)
    .replace(/!\[([^\]]*)\]\(media:([0-9a-f-]{36})\)/gi, (full, caption, id) => mediaFigure(caption, id, allowedMedia))
    .replace(/!\[([^\]]*)\]\(\/api\/media\/([0-9a-f-]{36})\/file\)/gi, (full, caption, id) => mediaFigure(caption, id, allowedMedia));
  // 表格预处理：连续的 | ... | 行构成表格（支持 GFM 分隔行与对齐）
  const tableAt = new Map();
  {
    let i = 0;
    while (i < lines.length) {
      if (!/^\s*\|.*\|\s*$/.test(lines[i])) { i++; continue; }
      const idxs = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { idxs.push(i); i++; }
      if (idxs.length >= 2) {
        const rows = idxs.map((k) => lines[k]);
        const isSep = /^\s*\|[\s:|-]+\|\s*$/.test(rows[1]);
        const header = splitRow(rows[0]);
        const body = rows.slice(isSep ? 2 : 1).map(splitRow);
        const aligns = isSep
          ? rows[1].split('|').slice(1, -1).map((c) => {
              const t = c.trim();
              if (t.startsWith(':') && t.endsWith(':')) return 'center';
              if (t.endsWith(':')) return 'right';
              return 'left';
            })
          : [];
        tableAt.set(idxs[0], buildTable(header, body, aligns));
        for (const k of idxs.slice(1)) tableAt.set(k, null);
      }
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    if (tableAt.has(li)) {
      const html = tableAt.get(li);
      flushPara(); closeList(); closeQuote();
      if (html) out.push(html);
      continue;
    }
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara(); closeList(); closeQuote();
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      flushPara(); closeList(); closeQuote();
      out.push('<hr>');
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList(); closeQuote();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara(); closeQuote();
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    // 引用：转义后原文的 > 变成 &gt;，两种都要识别
    if (/^(?:&gt;|>)\s?/.test(trimmed)) {
      flushPara(); closeList();
      if (!quoteOpen) { out.push('<blockquote>'); quoteOpen = true; }
      out.push(`<p>${inline(trimmed.replace(/^(?:&gt;|>)\s?/, ''))}</p>`);
      continue;
    }
    closeList(); closeQuote();
    para.push(trimmed);
  }

  flushPara(); closeList(); closeQuote();
  return out.join('\n');
}

/** 纯文本摘要（列表页预览用） */
export function storyExcerpt(body, max = 120) {
  const plain = String(body || '')
    .replace(/[#>*`\-]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}