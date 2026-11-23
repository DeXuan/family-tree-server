import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStoryMarkdown, storyExcerpt } from '../server/modules/storyMarkdown.js';

test('段落与标题', () => {
  const html = renderStoryMarkdown('第一段\n\n## 小标题\n\n第二段');
  assert.match(html, /<p>第一段<\/p>/);
  assert.match(html, /<h2>小标题<\/h2>/);
  assert.match(html, /<p>第二段<\/p>/);
});

test('列表、引用、分隔线', () => {
  const html = renderStoryMarkdown('- 甲\n- 乙\n\n> 一句引文\n\n---');
  assert.match(html, /<ul>\s*<li>甲<\/li>\s*<li>乙<\/li>\s*<\/ul>/);
  assert.match(html, /<blockquote>\s*<p>一句引文<\/p>\s*<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('行内粗体/斜体/代码/链接', () => {
  const html = renderStoryMarkdown('有**重点**和*轻点*以及`code`，见[资料](https://example.com)。');
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<em>轻点<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">资料<\/a>/);
});

test('XSS：标签被转义为文本，不产生可执行元素', () => {
  const html = renderStoryMarkdown('<script>alert(1)</' + 'script>' + String.fromCharCode(10,10) + '<img src=x onerror=alert(1)>');
  assert.ok(!/<script/i.test(html), '不应出现真实 script 标签');
  assert.ok(!/<img/i.test(html), '不应出现真实 img 标签');
  assert.ok(html.includes('&lt;script&gt;'), '原始尖括号应被转义');
});

test('XSS：javascript: 链接不被转成 a 标签', () => {
  const html = renderStoryMarkdown('[点我](javascript:alert(1))');
  assert.ok(!html.includes('href="javascript:'));
});

test('摘要去除标记并截断', () => {
  const text = '## 标题\n\n这是**正文**内容，' + '很长的描述'.repeat(30);
  const ex = storyExcerpt(text, 40);
  assert.ok(!ex.includes('#'));
  assert.ok(!ex.includes('**'));
  assert.ok(ex.endsWith('…'));
  assert.ok(ex.length <= 41);
});

test('内嵌媒体图片：media: 语法', () => {
  const html = renderStoryMarkdown('![全家福](media:123e4567-e89b-12d3-a456-426614174000)');
  assert.match(html, /<figure class="story-figure">/);
  assert.match(html, /src="\/api\/media\/123e4567-e89b-12d3-a456-426614174000\/file"/);
  assert.match(html, /<figcaption>全家福<\/figcaption>/);
});

test('内嵌媒体：完整 URL 形式', () => {
  const html = renderStoryMarkdown('![旧照](/api/media/123e4567-e89b-12d3-a456-426614174000/file)');
  assert.match(html, /<figure class="story-figure">/);
});

test('无效媒体 ID 不生成 img', () => {
  const html = renderStoryMarkdown('![x](media:not-a-uuid)');
  assert.ok(!html.includes('<img'));
});

test('Markdown 表格：表头 + 分隔行 + 数据行', () => {
  const md = '| 世代 | 姓名 |\n|---|---|\n| 一 | 王守仁 |\n| 二 | 王德昌 |';
  const html = renderStoryMarkdown(md);
  assert.match(html, /<table class="story-table">/);
  assert.match(html, /<th>世代<\/th><th>姓名<\/th>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});

test('Markdown 表格：列对齐', () => {
  const md = '| 左 | 中 | 右 |\n|:---|:---:|---:|\n| a | b | c |';
  const html = renderStoryMarkdown(md);
  assert.ok(html.includes('ta-center'));
  assert.ok(html.includes('ta-right'));
});

test('Markdown 表格：无分隔行也能渲染', () => {
  const md = '| a | b |\n| 1 | 2 |';
  const html = renderStoryMarkdown(md);
  assert.match(html, /<table/);
});

test('Markdown 表格：单元格内 HTML 被转义', () => {
  const md = '| a | b |\n|---|---|\n| <script> | x |';
  const html = renderStoryMarkdown(md);
  assert.ok(!/<script>/i.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('单个管道行不误判为表格', () => {
  const html = renderStoryMarkdown('| 只是一行 |');
  assert.ok(!html.includes('<table'));
});
