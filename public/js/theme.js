/*
 * 主题初始化：在样式表生效前同步执行，避免深色系统下的白屏闪烁。
 * 非模块脚本、CSP 合规（同源外部脚本），逻辑仅设置 <html data-theme>。
 */
(function () {
  var KEY = 'ft_theme';
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem(KEY);
    var dark = saved
      ? saved === 'dark'
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    root.setAttribute('data-theme', 'light');
  }
})();