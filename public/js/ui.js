// UI 基础组件：转义、格式化、提示、弹窗、空状态
export {
  esc, cnNum, fmtDate, fmtYear, lifespan, initials, dash, genLabel,
} from './lib/format.js';
import { esc } from './lib/format.js';

export const GENDER = { male: '男', female: '女', unknown: '未知' };
export const RELATION = { biological: '生', adopted: '养', step: '继', foster: '抚', acknowledged: '认' };
export const CERTAINTY = { confirmed: '确证', probable: '存疑', disputed: '有争议' };
export const PRECISION = { exact: '确切日期', year: '仅知年份', about: '大约', range: '区间', unknown: '不详' };

export const EVENT_TYPE = {
  birth: '出生', adoption: '收养', marriage: '婚姻', divorce: '离异',
  education: '求学', career: '职业', migration: '迁徙', military: '军旅',
  award: '荣誉', residence: '居住', death: '去世', burial: '安葬', custom: '其他',
};
export const VISIBILITY_LABEL = { L0: '公开', L1: '族内', L2: '私密' };

export const ACTION = {
  create: '新增', update: '修改', delete: '删除', login: '登录', logout: '退出',
  export: '导出', import: '导入', privacy_change: '隐私变更', grant: '授权',
};

export function toast(message, type = '') {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? 'toast-ok' : type === 'error' ? 'toast-error' : ''}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

/**
 * 打开弹窗。layered=true 时叠加在当前弹窗之上（关闭只移除自己）。
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openModal({ title, body = '', footer = '', onClose, layered = false } = {}) {
  const host = document.getElementById('modal-host');

  const markup = `
    <div class="modal-backdrop${layered ? ' modal-layered' : ''}">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="modal-close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;

  let backdrop;
  if (layered) {
    const wrap = document.createElement('div');
    wrap.innerHTML = markup;
    backdrop = wrap.firstElementChild;
    host.appendChild(backdrop);
  } else {
    host.innerHTML = markup;
    backdrop = host.firstElementChild;
  }

  const close = () => {
    if (backdrop && backdrop.parentNode) backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  return { el: backdrop.querySelector('.modal'), close };
}

/** 确认框，返回 Promise<boolean> */
export function confirmDialog(message, { title = '请确认', okText = '确认', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      m.close();
    };
    const m = openModal({
      title,
      body: `<p class="small">${esc(message)}</p>`,
      footer: `<button class="btn" data-act="cancel" type="button">取消</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(okText)}</button>`,
      onClose: () => finish(false),
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
    m.el.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
  });
}

export function emptyState(text, mark = '谱') {
  return `<div class="empty"><div class="empty-mark">${esc(mark)}</div>${esc(text)}</div>`;
}

export function badge(text, kind = '') {
  return `<span class="badge ${kind ? 'badge-' + kind : ''}">${esc(text)}</span>`;
}

export function debounce(fn, ms = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}