/* 时序 DayFlow — 日期 / 时间工具 */
(function () {
  'use strict';

  const DAY = 86400000;
  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

  const pad = (n) => String(n).padStart(2, '0');

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fromYmd(s) {
    const p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || p.some(Number.isNaN)) return new Date();
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function todayStr() {
    return ymd(new Date());
  }

  function addDays(dateStr, n) {
    const d = fromYmd(dateStr);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  function addMonths(dateStr, n) {
    const d = fromYmd(dateStr);
    d.setMonth(d.getMonth() + n);
    return ymd(d);
  }

  function diffDays(a, b) {
    return Math.round((fromYmd(a) - fromYmd(b)) / DAY);
  }

  function weekdayOf(dateStr) {
    return fromYmd(dateStr).getDay();
  }

  /** 周一为一周起点 */
  function mondayOf(dateStr) {
    const d = fromYmd(dateStr);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return ymd(d);
  }

  function weekdayCN(dateStr) {
    return WEEK_CN[weekdayOf(dateStr)];
  }

  function monthDayCN(dateStr) {
    const d = fromYmd(dateStr);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function relativeCN(dateStr) {
    const t = todayStr();
    const diff = diffDays(dateStr, t);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff === -1) return '昨天';
    if (diff === -2) return '前天';
    return '';
  }

  function fmtTime(min) {
    const m = Math.max(0, Math.min(1439, Math.round(min)));
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  function fmtDuration(min) {
    if (min < 60) return Math.round(min) + ' 分钟';
    const h = min / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + ' 小时';
  }

  function fmtDurationShort(min) {
    if (min < 60) return Math.round(min) + 'm';
    const h = min / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h';
  }

  function parseTimeStr(s) {
    if (!s) return NaN;
    const p = String(s).split(':').map(Number);
    if (p.length < 2 || p.some(Number.isNaN)) return NaN;
    return Math.max(0, Math.min(1439, p[0] * 60 + p[1]));
  }

  function toTimeStr(min) {
    return fmtTime(min);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (prefix || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  window.DayFlow = window.DayFlow || {};
  window.DayFlow.util = {
    pad, ymd, fromYmd, todayStr, addDays, addMonths, diffDays,
    weekdayOf, mondayOf, weekdayCN, monthDayCN, relativeCN,
    fmtTime, fmtDuration, fmtDurationShort, parseTimeStr, toTimeStr,
    escapeHTML, uid, clamp,
    WEEK_CN, WEEK_SHORT
  };
})();
