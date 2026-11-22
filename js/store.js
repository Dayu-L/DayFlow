/* 时序 DayFlow — 数据层 */
(function () {
  'use strict';

  const U = window.DayFlow.util;

  const DEFAULT_CATEGORIES = {
    '工作': { color: '#1d5fbf', dark: '#154a96', soft: '#d8e6fa', text: '#17498f' },
    '学习': { color: '#1b6e66', dark: '#14564f', soft: '#d6ece7', text: '#145650' },
    '运动': { color: '#2f7d5c', dark: '#236144', soft: '#dcefe2', text: '#236144' },
    '生活': { color: '#8f5b12', dark: '#6f470e', soft: '#f5e4c8', text: '#6f470e' },
    '社交': { color: '#963d60', dark: '#7a2f4d', soft: '#f2dce6', text: '#7a2f4d' },
    '休息': { color: '#5b6470', dark: '#4b535d', soft: '#e6ecf1', text: '#4b535d' },
    '其他': { color: '#6b6b6b', dark: '#555555', soft: '#e9edf1', text: '#555555' }
  };

  const CATEGORIES = {};
  Object.assign(CATEGORIES, DEFAULT_CATEGORIES);

  const KEYS = {
    events: 'dayflow.events.v1',
    settings: 'dayflow.settings.v1',
    chat: 'dayflow.chat.v1',
    seeded: 'dayflow.seeded.v1',
    tasks: 'dayflow.tasks.v1',
    series: 'dayflow.series.v1',
    focus: 'dayflow.focus.v1',
    focusLog: 'dayflow.focuslog.v1',
    brief: 'dayflow.brief.v1',
    timetable: 'dayflow.timetable.v1',
    semester: 'dayflow.semester.v1',
    ddl: 'dayflow.ddl.v1',
    categories: 'dayflow.categories.v1',
    templates: 'dayflow.templates.v1',
    snapshots: 'dayflow.snapshots.v1'
  };

  const DEFAULT_SETTINGS = {
    mode: 'local',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: ''
  };

  const PRIORITIES = ['高', '中', '低'];

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 存储空间不足时忽略 */
    }
  }

  function normalizeHex(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#6b6b6b';
  }

  function mixColor(color, target, amount) {
    const a = normalizeHex(color).slice(1);
    const b = normalizeHex(target).slice(1);
    const n = U.clamp(Number(amount) || 0, 0, 1);
    const out = [0, 1, 2].map((i) => {
      const av = parseInt(a.slice(i * 2, i * 2 + 2), 16);
      const bv = parseInt(b.slice(i * 2, i * 2 + 2), 16);
      return Math.round(av + (bv - av) * n).toString(16).padStart(2, '0');
    });
    return '#' + out.join('');
  }

  function makeCategory(color) {
    const base = normalizeHex(color);
    return {
      color: base,
      dark: mixColor(base, '#000000', 0.18),
      soft: mixColor(base, '#ffffff', 0.84),
      text: mixColor(base, '#000000', 0.28)
    };
  }

  function categoryColorOf(name) {
    return CATEGORIES[name] || CATEGORIES['其他'] || DEFAULT_CATEGORIES['其他'];
  }

  function eventKey(evt) {
    return String(evt.date || '') + '|' + String(evt.start) + '|' + String(evt.title || '').trim();
  }

  function mergeEvent(target, extra) {
    if (!target.location && extra.location) target.location = extra.location;
    if (!target.note && extra.note) target.note = extra.note;
    if (!target.seriesId && extra.seriesId) target.seriesId = extra.seriesId;
    target.done = !!target.done || !!extra.done;
    target.actualMinutes = Math.max(target.actualMinutes || 0, extra.actualMinutes || 0);
    if (target.reminder == null && extra.reminder != null) target.reminder = extra.reminder;
    target.end = Math.max(target.end, extra.end);
    if (extra.createdAt && (!target.createdAt || extra.createdAt < target.createdAt)) {
      target.createdAt = extra.createdAt;
    }
    return target;
  }

  function dedupeEvents(list) {
    const map = new Map();
    const out = [];
    (list || []).forEach((evt) => {
      const key = eventKey(evt);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, evt);
        out.push(evt);
      } else {
        mergeEvent(existing, evt);
      }
    });
    return out.sort((a, b) =>
      a.date.localeCompare(b.date) || a.start - b.start || b.end - a.end ||
      String(a.title).localeCompare(String(b.title)));
  }

  // ---------------------------------------------------------------- 自动查重

  const TITLE_DROP = /[\s\u3000·・\-—_/\\()（）\[\]【】:：.,，。!！?？"'“”‘’~～]/g;

  /** 标题归一：去掉空格和常见标点、统一小写。「数学分析 I06」→「数学分析i06」。 */
  function normTitle(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(TITLE_DROP, '');
  }

  /** 同一件事：标题一样，或短的那个是长的前缀（至少 3 个字）。 */
  function titleAlike(a, b) {
    const x = normTitle(a);
    const y = normTitle(b);
    if (x.length < 2 || y.length < 2) return false;
    if (x === y) return true;
    const short = x.length <= y.length ? x : y;
    const long = x.length <= y.length ? y : x;
    return short.length >= 3 && long.indexOf(short) === 0;
  }

  function weekdayOf(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return -1;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  }

  /** 同一天、标题同上、开始时间差 ≤30 分钟 → 并成一条（保留先建的那条）。 */
  function fuzzyDedupeEvents(list) {
    const days = new Map();
    (list || []).forEach((e) => {
      const bucket = days.get(e.date);
      if (bucket) bucket.push(e);
      else days.set(e.date, [e]);
    });
    const gone = new Set();
    let merged = 0;
    days.forEach((bucket) => {
      bucket.sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
      for (let i = 0; i < bucket.length; i++) {
        const keep = bucket[i];
        if (gone.has(keep.id)) continue;
        for (let j = i + 1; j < bucket.length; j++) {
          const other = bucket[j];
          if (gone.has(other.id)) continue;
          if (other.start - keep.start > 30) break;
          if (!titleAlike(keep.title, other.title)) continue;
          mergeEvent(keep, other);
          gone.add(other.id);
          merged++;
        }
      }
    });
    return { list: (list || []).filter((e) => !gone.has(e.id)), merged };
  }

  function mergeSeriesKeep(keep, other) {
    if (!keep.location && other.location) keep.location = other.location;
    if (!keep.note && other.note) keep.note = other.note;
    if (keep.reminder == null && other.reminder != null) keep.reminder = other.reminder;
    if (other.end > keep.end) keep.end = other.end;
    if (other.startDate && (!keep.startDate || other.startDate < keep.startDate)) {
      keep.startDate = other.startDate;
    }
    if (other.until && (!keep.until || other.until > keep.until)) keep.until = other.until;
    const a = (keep.rule && keep.rule.weeks) || [];
    const b = (other.rule && other.rule.weeks) || [];
    if (a.length || b.length) {
      const weeks = Array.from(new Set(a.concat(b))).sort((x, y) => x - y);
      keep.rule = Object.assign({}, keep.rule, { weeks });
    }
    if (other.createdAt && (!keep.createdAt || other.createdAt < keep.createdAt)) {
      keep.createdAt = other.createdAt;
    }
  }

  /** 同星期、起止都差 ≤30 分钟、标题同上 → 两组重复日程并成一组的。 */
  function fuzzyDedupeSeries(list) {
    const arr = (list || []).slice();
    const gone = new Set();
    const repoint = new Map();
    for (let i = 0; i < arr.length; i++) {
      const keep = arr[i];
      if (gone.has(keep.id)) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const other = arr[j];
        if (gone.has(other.id)) continue;
        const rk = keep.rule || {};
        const ro = other.rule || {};
        if (String(rk.type || '') !== String(ro.type || '')) continue;
        if (Math.abs(keep.start - other.start) > 30) continue;
        if (Math.abs(keep.end - other.end) > 30) continue;
        if ((rk.type === 'weeks' || rk.type === 'weekly') &&
            weekdayOf(keep.startDate) !== weekdayOf(other.startDate)) continue;
        if (!titleAlike(keep.title, other.title)) continue;
        mergeSeriesKeep(keep, other);
        gone.add(other.id);
        repoint.set(other.id, keep.id);
      }
    }
    return { list: arr.filter((s) => !gone.has(s.id)), repoint, merged: repoint.size };
  }

  /** 同一天、时间差 ≤30 分钟、标题同上 → 并成一个 DDL。 */
  function fuzzyDedupeDdls(list) {
    const arr = list || [];
    const gone = new Set();
    let merged = 0;
    for (let i = 0; i < arr.length; i++) {
      const keep = arr[i];
      if (gone.has(keep.id)) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const other = arr[j];
        if (gone.has(other.id)) continue;
        if (keep.date !== other.date) continue;
        if (Math.abs(keep.time - other.time) > 30) continue;
        if (!titleAlike(keep.title, other.title)) continue;
        if (!keep.note && other.note) keep.note = other.note;
        if (other.done) keep.done = true;
        gone.add(other.id);
        merged++;
      }
    }
    return { list: arr.filter((d) => !gone.has(d.id)), merged };
  }

  function normalizeEvent(input) {
    const start = U.clamp(Number(input.start) || 0, 0, 1439);
    let end = Number(input.end);
    if (!Number.isFinite(end)) end = start + 60;
    end = Math.min(1440, end);
    if (end <= start) end = Math.min(1440, start + 5);
    const category = CATEGORIES[input.category] ? input.category : '其他';
    const reminder = input.reminder === null || input.reminder === undefined || input.reminder === ''
      ? null
      : U.clamp(Number(input.reminder) || 0, 0, 10080);
    return {
      id: input.id || U.uid('evt_'),
      title: String(input.title || '未命名日程').slice(0, 80),
      date: input.date || U.todayStr(),
      start,
      end,
      category,
      location: String(input.location || '').slice(0, 60),
      note: String(input.note || '').slice(0, 240),
      done: !!input.done,
      reminder,
      actualMinutes: Math.max(0, Math.round(Number(input.actualMinutes) || 0)),
      seriesId: input.seriesId || null,
      source: input.source || 'manual',
      createdAt: input.createdAt || Date.now()
    };
  }

  function normalizeSeries(input) {
    return {
      id: input.id || U.uid('ser_'),
      title: String(input.title || '未命名系列').slice(0, 80),
      start: U.clamp(Number(input.start) || 0, 0, 1439),
      end: U.clamp(Number(input.end) || 0, 0, 1440),
      category: CATEGORIES[input.category] ? input.category : '其他',
      location: String(input.location || '').slice(0, 60),
      note: String(input.note || '').slice(0, 240),
      reminder: input.reminder === null || input.reminder === undefined ? null : Number(input.reminder),
      startDate: input.startDate || U.todayStr(),
      until: input.until || U.addDays(U.todayStr(), 365),
      rule: input.rule || { type: 'daily', weekdays: [] },
      createdAt: input.createdAt || Date.now()
    };
  }

  function normalizeTask(input) {
    return {
      id: input.id || U.uid('task_'),
      title: String(input.title || '未命名任务').slice(0, 80),
      estimate: U.clamp(Number(input.estimate) || 60, 5, 480),
      priority: PRIORITIES.indexOf(input.priority) > -1 ? input.priority : '中',
      due: /^\d{4}-\d{2}-\d{2}$/.test(input.due || '') ? input.due : null,
      category: CATEGORIES[input.category] ? input.category : '其他',
      note: String(input.note || '').slice(0, 240),
      status: input.status === 'scheduled' ? 'scheduled' : 'inbox',
      eventId: input.eventId || null,
      createdAt: input.createdAt || Date.now()
    };
  }

  function normalizeDdl(input) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : U.todayStr();
    let time = Number(input.time);
    if (!Number.isFinite(time)) time = 23 * 60 + 59;
    time = U.clamp(Math.round(time), 0, 1439);
    return {
      id: input.id || U.uid('ddl_'),
      title: String(input.title || '未命名 DDL').slice(0, 80),
      date,
      time,
      note: String(input.note || '').slice(0, 240),
      estimate: U.clamp(Number(input.estimate) || 0, 0, 480),
      done: !!input.done,
      source: input.source || 'manual',
      createdAt: input.createdAt || Date.now()
    };
  }

  function normalizeTemplate(input) {
    const items = Array.isArray(input.items) ? input.items.slice(0, 80).map((item) => {
      const start = U.clamp(Number(item.start) || 0, 0, 1439);
      let end = U.clamp(Number(item.end) || 0, 0, 1440);
      if (end <= start) end = Math.min(1440, start + 60);
      return {
        title: String(item.title || '未命名日程').slice(0, 80),
        start,
        end,
        category: CATEGORIES[item.category] ? item.category : '其他',
        location: String(item.location || '').slice(0, 60),
        note: String(item.note || '').slice(0, 240),
        reminder: item.reminder == null ? 10 : U.clamp(Number(item.reminder) || 0, 0, 10080)
      };
    }).filter((item) => item.end > item.start) : [];
    return {
      id: input.id || U.uid('tpl_'),
      name: String(input.name || '未命名模板').slice(0, 40),
      items,
      createdAt: input.createdAt || Date.now()
    };
  }

  function normalizePeriod(input) {
    if (!input || typeof input !== 'object') return null;
    const start = U.clamp(Number(input.start) || 0, 0, 1439);
    let end = U.clamp(Number(input.end) || 0, 0, 1440);
    if (end <= start) end = Math.min(1440, start + 45);
    if (end <= start) return null;
    return { start, end };
  }

  function normalizeTimetable(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 24).map(normalizePeriod).filter(Boolean);
  }

  function normalizeFocus(input) {
    if (!input || typeof input !== 'object') return null;
    const planned = U.clamp(Number(input.plannedMinutes) || 25, 1, 480);
    const startAt = Number(input.startAt) || Date.now();
    const endAt = Number(input.endAt) || (startAt + planned * 60000);
    return {
      id: input.id || U.uid('focus_'),
      title: String(input.title || '专注').slice(0, 80),
      eventId: input.eventId || null,
      plannedMinutes: planned,
      startAt,
      endAt
    };
  }

  function notify(name, payload) {
    try {
      if (typeof window.DayFlow[name] === 'function') window.DayFlow[name](payload);
    } catch (e) {
      /* 界面回调不应影响数据层 */
    }
  }

  const store = {
    events: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    messages: [],
    tasks: [],
    ddls: [],
    templates: [],
    series: [],
    focus: null,
    focusLog: [],
    timetable: [],
    semesterStart: '',

    load() {
      this.loadCategories();
      this.events = dedupeEvents((readJSON(KEYS.events, []) || []).map(normalizeEvent));
      this.settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(KEYS.settings, {}) || {});
      this.messages = readJSON(KEYS.chat, []) || [];
      this.tasks = (readJSON(KEYS.tasks, []) || []).map(normalizeTask);
      this.ddls = (readJSON(KEYS.ddl, []) || []).map(normalizeDdl);
      this.templates = (readJSON(KEYS.templates, []) || []).map(normalizeTemplate);
      this.series = (readJSON(KEYS.series, []) || []).map(normalizeSeries);
      this.focus = normalizeFocus(readJSON(KEYS.focus, null));
      this.focusLog = readJSON(KEYS.focusLog, []) || [];
      this.timetable = normalizeTimetable(readJSON(KEYS.timetable, []));
      this.semesterStart = localStorage.getItem(KEYS.semester) || '';
    },

    loadCategories() {
      Object.keys(CATEGORIES).forEach((name) => { delete CATEGORIES[name]; });
      Object.assign(CATEGORIES, DEFAULT_CATEGORIES);
      const saved = readJSON(KEYS.categories, null);
      if (!saved || typeof saved !== 'object') return;
      Object.keys(saved).forEach((name) => {
        const cat = saved[name];
        const key = String(name || '').trim().slice(0, 12);
        if (!key || !cat || !cat.color) return;
        const base = makeCategory(cat.color);
        CATEGORIES[key] = cat.dark && cat.soft && cat.text
          ? { color: normalizeHex(cat.color), dark: cat.dark, soft: cat.soft, text: cat.text }
          : base;
      });
      if (!Object.keys(CATEGORIES).length) Object.assign(CATEGORIES, DEFAULT_CATEGORIES);
    },

    save() {
      this.events = dedupeEvents(this.events);
      const activeSeries = new Set(this.events.map((e) => e.seriesId).filter(Boolean));
      const keptSeries = this.series.filter((s) => activeSeries.has(s.id));
      if (keptSeries.length !== this.series.length) {
        this.series = keptSeries;
        writeJSON(KEYS.series, this.series);
      }
      writeJSON(KEYS.events, this.events);
      notify('onEventsChanged', this.events);
    },

    saveSettings() {
      writeJSON(KEYS.settings, this.settings);
    },

    saveMessages() {
      const kept = this.messages.slice(-80);
      const trimmed = kept.map((m, idx) => {
        if (m.images && m.images.length && idx < kept.length - 20) {
          const copy = Object.assign({}, m);
          delete copy.images;
          return copy;
        }
        return m;
      });
      writeJSON(KEYS.chat, trimmed);
    },

    saveTasks() {
      writeJSON(KEYS.tasks, this.tasks);
      notify('onTasksChanged', this.tasks);
    },

    saveDdls() {
      writeJSON(KEYS.ddl, this.ddls);
      notify('onDdlChanged', this.ddls);
    },

    saveCategories() {
      writeJSON(KEYS.categories, CATEGORIES);
    },

    saveTemplates() {
      writeJSON(KEYS.templates, this.templates);
    },

    saveSeries() {
      writeJSON(KEYS.series, this.series);
    },

    /**
     * 按备注里的「第X-Y节」把开始/结束时间对齐到课表节次。
     * 修两件事：模型直接给了错的 HH:MM；旧数据里节次和实际时间对不上。
     * @returns {number} 改了几条
     */
    fixCourseTimes() {
      const periods = Array.isArray(this.timetable) ? this.timetable : [];
      if (!periods.length) return 0;
      const re = /第\s*(\d{1,2})\s*(?:[-–—~～到至]\s*(\d{1,2}))?\s*节/;
      let n = 0;
      const fixOne = (item) => {
        const m = re.exec(String(item.note || ''));
        if (!m) return false;
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : a;
        if (!(a >= 1) || a > periods.length) return false;
        const last = Math.min(Math.max(b, a), periods.length);
        const start = periods[a - 1].start;
        const end = periods[last - 1].end;
        if (item.start === start && item.end === end) return false;
        item.start = start;
        item.end = end;
        return true;
      };
      this.series.forEach((s) => {
        if (fixOne(s)) n++;
      });
      this.events.forEach((e) => {
        if (fixOne(e)) n++;
      });
      if (n) {
        writeJSON(KEYS.series, this.series);
        writeJSON(KEYS.events, this.events);
        notify('onEventsChanged', this.events);
      }
      return n;
    },

    clearSeries() {
      const ids = new Set(this.series.map((s) => s.id));
      if (!ids.size) return 0;
      const before = this.events.length;
      this.events = this.events.filter((e) => !(e.seriesId && ids.has(e.seriesId)));
      const n = ids.size;
      this.series = [];
      writeJSON(KEYS.series, []);
      this.save();
      if (before !== this.events.length) this.save();
      return n;
    },

    /**
     * 清掉自带样例日程（同一套演示文案），返回删掉的条数。
     */
    removeSamples() {
      const titles = [
        '晨间规划', '产品周会', '午餐 · 楼下小馆', '需求评审',
        '和设计师对齐改稿', '健身 · 力量训练', '阅读 · 《深度工作》', '季度复盘'
      ];
      const before = this.events.length;
      this.events = this.events.filter((e) => titles.indexOf(String(e.title || '').trim()) < 0);
      const n = before - this.events.length;
      if (n) this.save();
      return n;
    },

    /**
     * 自动查重：把「同一件事被记了两遍」并成一条。
     * 日程同一天、DDL 同一天、重复日程同星期，标题相同（或一个是另一个的前缀），时间差 ≤30 分钟。
     * 合并时留先建的那条，缺的地点 / 备注 / 提醒补过来。
     * @returns {number} 合并掉的条数
     */
    dedupeFuzzy() {
      const ev = fuzzyDedupeEvents(this.events);
      this.events = dedupeEvents(ev.list);
      let merged = ev.merged;

      const sr = fuzzyDedupeSeries(this.series);
      if (sr.merged) {
        this.series = sr.list;
        writeJSON(KEYS.series, this.series);
        // 被并掉那组展开出来的日程别删，改挂到留下的那组上，再并一次同名同时间的
        this.events = this.events.map((e) => {
          const keepId = e.seriesId ? sr.repoint.get(e.seriesId) : null;
          return keepId ? Object.assign({}, e, { seriesId: keepId }) : e;
        });
        const again = fuzzyDedupeEvents(this.events);
        this.events = dedupeEvents(again.list);
        merged += again.merged;
      }

      const dd = fuzzyDedupeDdls(this.ddls);
      this.ddls = dd.list;
      merged += dd.merged;

      if (!merged) return 0;
      writeJSON(KEYS.events, this.events);
      writeJSON(KEYS.ddl, this.ddls);
      notify('onEventsChanged', this.events);
      notify('onDdlChanged', this.ddls);
      return merged;
    },

    saveFocus() {
      writeJSON(KEYS.focus, this.focus || null);
      notify('onFocusChanged', this.focus);
    },

    saveFocusLog() {
      writeJSON(KEYS.focusLog, this.focusLog.slice(-500));
    },

    getFocus() {
      return this.focus;
    },

    getTimetable() {
      return this.timetable.map((p) => ({ start: p.start, end: p.end }));
    },

    saveTimetable(list) {
      this.timetable = normalizeTimetable(list);
      writeJSON(KEYS.timetable, this.timetable);
      return this.getTimetable();
    },

    getSemesterStart() {
      return this.semesterStart || '';
    },

    saveSemesterStart(date) {
      const value = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : '';
      this.semesterStart = value;
      try {
        if (value) localStorage.setItem(KEYS.semester, value);
        else localStorage.removeItem(KEYS.semester);
      } catch (e) {
        /* 忽略存储失败 */
      }
      return this.semesterStart;
    },

    getBriefDate() {
      return localStorage.getItem(KEYS.brief) || '';
    },

    setBriefDate(date) {
      localStorage.setItem(KEYS.brief, date);
    },

    seed() {
      if (localStorage.getItem(KEYS.seeded)) return false;
      localStorage.setItem(KEYS.seeded, '1');
      if (this.events.length) return false;

      const today = U.todayStr();
      const tomorrow = U.addDays(today, 1);

      const seedEvents = [
        { title: '晨间规划', date: today, start: 8 * 60 + 30, end: 9 * 60, category: '生活', location: '', note: '写下今天最重要的三件事', done: true, reminder: 10 },
        { title: '产品周会', date: today, start: 10 * 60, end: 11 * 60, category: '工作', location: '3F 会议室 A', note: '同步本周进度与风险', done: true, reminder: 10 },
        { title: '午餐 · 楼下小馆', date: today, start: 11 * 60 + 30, end: 12 * 60 + 15, category: '生活', location: '园区东门', note: '', done: false, reminder: 10 },
        { title: '需求评审', date: today, start: 14 * 60, end: 15 * 60 + 30, category: '工作', location: '线上 · 腾讯会议', note: '带上下个版本的交互稿', done: false, reminder: 10 },
        { title: '和设计师对齐改稿', date: today, start: 16 * 60 + 30, end: 17 * 60 + 15, category: '工作', location: '4F 设计区', note: '', done: false, reminder: 10 },
        { title: '健身 · 力量训练', date: today, start: 19 * 60, end: 20 * 60, category: '运动', location: '楼下健身房', note: '', done: false, reminder: 10 },
        { title: '阅读 · 《深度工作》', date: today, start: 21 * 60 + 10, end: 21 * 60 + 50, category: '学习', location: '', note: '', done: false, reminder: 10 },
        { title: '季度复盘', date: tomorrow, start: 10 * 60, end: 11 * 60 + 30, category: '工作', location: '', note: '', done: false, reminder: 10 },
        { title: '阅读 · 《深度工作》', date: tomorrow, start: 20 * 60, end: 21 * 60, category: '学习', location: '', note: '', done: false, reminder: 10 }
      ];

      seedEvents.forEach((e) => {
        this.events.push(normalizeEvent(Object.assign({ source: 'sample' }, e)));
      });

      if (!this.tasks.length) {
        this.tasks.push(normalizeTask({
          title: '整理下周计划',
          estimate: 60,
          priority: '中',
          due: U.addDays(today, 2),
          category: '生活',
          note: '示例任务，可在收件箱里排进空档'
        }));
        this.saveTasks();
      }

      if (!this.ddls.length) {
        this.ddls.push(normalizeDdl({
          title: '提交实验报告',
          date: today,
          time: 17 * 60 + 30,
          note: '示例 DDL，点时间轴上的红色旗标可以改时间或标记完成'
        }));
        this.saveDdls();
      }

      this.save();
      return true;
    },

    add(input) {
      const evt = normalizeEvent(Object.assign({ source: 'agent' }, input));
      const existing = this.events.find((e) => eventKey(e) === eventKey(evt));
      if (existing) {
        mergeEvent(existing, evt);
        this.save();
        return existing;
      }
      this.events.push(evt);
      this.save();
      return evt;
    },

    addMany(list) {
      const seen = new Map(this.events.map((e) => [eventKey(e), e]));
      const evts = [];
      (list || []).forEach((input) => {
        const evt = normalizeEvent(Object.assign({ source: 'agent' }, input));
        const key = eventKey(evt);
        const existing = seen.get(key);
        if (existing) {
          mergeEvent(existing, evt);
          return;
        }
        seen.set(key, evt);
        evts.push(evt);
      });
      this.events.push.apply(this.events, evts);
      this.save();
      return evts;
    },

    addSeries(seriesInput, eventList) {
      const series = normalizeSeries(seriesInput);
      const existingKeys = new Set(this.events.map(eventKey));
      const evts = [];
      (eventList || []).forEach((input) => {
        const evt = normalizeEvent(Object.assign({
          source: 'agent',
          seriesId: series.id
        }, input));
        if (existingKeys.has(eventKey(evt))) return;
        existingKeys.add(eventKey(evt));
        evts.push(evt);
      });
      if (!evts.length) return { series: null, events: [] };
      series.startDate = evts[0].date;
      series.until = evts[evts.length - 1].date;
      this.series.push(series);
      this.events.push.apply(this.events, evts);
      this.saveSeries();
      this.save();
      return { series, events: evts };
    },

    getSeries(id) {
      return this.series.find((s) => s.id === id) || null;
    },

    updateSeries(id, patch) {
      const series = this.getSeries(id);
      if (!series) return null;
      const fields = {};
      ['title', 'start', 'end', 'category', 'location', 'note', 'reminder'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) fields[key] = patch[key];
      });
      Object.assign(series, fields);
      this.events.forEach((e) => {
        if (e.seriesId !== id) return;
        if (fields.title != null) e.title = String(fields.title).slice(0, 80);
        if (CATEGORIES[fields.category]) e.category = fields.category;
        if (fields.location != null) e.location = String(fields.location).slice(0, 60);
        if (fields.note != null) e.note = String(fields.note).slice(0, 240);
        if (fields.reminder !== undefined) e.reminder = fields.reminder;
        if (fields.start != null) e.start = U.clamp(Number(fields.start) || 0, 0, 1439);
        if (fields.end != null) e.end = U.clamp(Number(fields.end) || 0, 0, 1440);
        if (e.end <= e.start) e.end = Math.min(1440, e.start + 15);
      });
      this.saveSeries();
      this.save();
      return series;
    },

    removeSeries(id) {
      const removed = this.events.filter((e) => e.seriesId === id);
      this.events = this.events.filter((e) => e.seriesId !== id);
      this.series = this.series.filter((s) => s.id !== id);
      this.saveSeries();
      this.save();
      return removed;
    },

    listSeries() {
      return this.series.slice();
    },

    get(id) {
      return this.events.find((e) => e.id === id) || null;
    },

    update(id, patch) {
      const evt = this.get(id);
      if (!evt) return null;
      Object.assign(evt, patch);
      if (evt.end <= evt.start) evt.end = Math.min(evt.start + 15, 1440);
      this.save();
      return evt;
    },

    remove(ids) {
      const set = new Set([].concat(ids));
      const removed = this.events.filter((e) => set.has(e.id));
      this.events = this.events.filter((e) => !set.has(e.id));
      const seriesIds = new Set(removed.map((e) => e.seriesId).filter(Boolean));
      if (seriesIds.size) {
        this.series = this.series.filter((s) =>
          !seriesIds.has(s.id) || this.events.some((e) => e.seriesId === s.id));
        this.saveSeries();
      }
      this.save();
      return removed;
    },

    setEvents(list) {
      this.events = dedupeEvents((list || []).map(normalizeEvent));
      this.save();
    },

    byDate(date) {
      return this.events
        .filter((e) => e.date === date)
        .sort((a, b) => a.start - b.start || b.end - a.end || String(a.title).localeCompare(String(b.title)));
    },

    between(startDate, endDate) {
      return this.events.filter((e) => e.date >= startDate && e.date <= endDate);
    },

    countBetween(startDate, days) {
      const endDate = U.addDays(startDate, days - 1);
      return this.events.filter((e) => e.date >= startDate && e.date <= endDate).length;
    },

    toggleDone(id) {
      const evt = this.get(id);
      if (!evt) return;
      evt.done = !evt.done;
      this.save();
    },

    addTask(input) {
      const task = normalizeTask(Object.assign({ source: 'manual' }, input));
      this.tasks.push(task);
      this.saveTasks();
      return task;
    },

    getTask(id) {
      return this.tasks.find((t) => t.id === id) || null;
    },

    updateTask(id, patch) {
      const task = this.getTask(id);
      if (!task) return null;
      Object.assign(task, patch);
      this.saveTasks();
      return task;
    },

    removeTask(id) {
      this.tasks = this.tasks.filter((t) => t.id !== id);
      this.saveTasks();
    },

    inboxTasks() {
      return this.tasks
        .filter((t) => t.status !== 'scheduled')
        .sort((a, b) => {
          const rank = { '高': 0, '中': 1, '低': 2 };
          return (rank[a.priority] - rank[b.priority]) ||
            String(a.due || '9999').localeCompare(String(b.due || '9999')) ||
            b.estimate - a.estimate;
        });
    },

    scheduleTask(taskId, event) {
      const task = this.getTask(taskId);
      if (!task) return null;
      const evt = this.add(Object.assign({ source: 'task', reminder: 10 }, event));
      task.status = 'scheduled';
      task.eventId = evt.id;
      this.saveTasks();
      return evt;
    },

    addDdl(input) {
      const ddl = normalizeDdl(Object.assign({ source: 'manual' }, input));
      this.ddls.push(ddl);
      this.saveDdls();
      return ddl;
    },

    getDdl(id) {
      return this.ddls.find((d) => d.id === id) || null;
    },

    updateDdl(id, patch) {
      const ddl = this.getDdl(id);
      if (!ddl) return null;
      const fields = patch || {};
      if (fields.title != null) ddl.title = String(fields.title).slice(0, 80);
      if (/^\d{4}-\d{2}-\d{2}$/.test(fields.date || '')) ddl.date = fields.date;
      if (fields.time != null) {
        const t = typeof fields.time === 'string' ? U.parseTimeStr(fields.time) : Number(fields.time);
        if (Number.isFinite(t)) ddl.time = U.clamp(Math.round(t), 0, 1439);
      }
      if (fields.note != null) ddl.note = String(fields.note).slice(0, 240);
      if (fields.estimate != null) ddl.estimate = U.clamp(Number(fields.estimate) || 0, 0, 480);
      if (fields.done != null) ddl.done = !!fields.done;
      this.saveDdls();
      return ddl;
    },

    removeDdl(id) {
      const ddl = this.getDdl(id);
      if (!ddl) return null;
      this.ddls = this.ddls.filter((d) => d.id !== id);
      this.saveDdls();
      return ddl;
    },

    toggleDdlDone(id) {
      const ddl = this.getDdl(id);
      if (!ddl) return null;
      ddl.done = !ddl.done;
      this.saveDdls();
      return ddl;
    },

    ddlsByDate(date) {
      return this.ddls
        .filter((d) => d.date === date)
        .sort((a, b) => a.time - b.time || String(a.title).localeCompare(String(b.title)));
    },

    pendingDdls() {
      return this.ddls
        .filter((d) => !d.done)
        .sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time ||
          String(a.title).localeCompare(String(b.title)));
    },

    setDdls(list) {
      this.ddls = (list || []).map(normalizeDdl);
      this.saveDdls();
    },

    listCategories() {
      return Object.keys(CATEGORIES).map((name) => Object.assign({ name }, CATEGORIES[name]));
    },

    categoryUsage(name) {
      return this.events.filter((e) => e.category === name).length +
        this.series.filter((s) => s.category === name).length +
        this.tasks.filter((t) => t.category === name).length;
    },

    addCategory(name, color) {
      const key = String(name || '').trim().slice(0, 12);
      if (!key) return { ok: false, error: 'empty' };
      if (CATEGORIES[key]) return { ok: false, error: 'exists' };
      CATEGORIES[key] = makeCategory(color);
      this.saveCategories();
      return { ok: true, name: key };
    },

    updateCategoryColor(name, color) {
      if (!CATEGORIES[name]) return false;
      CATEGORIES[name] = makeCategory(color);
      this.saveCategories();
      return true;
    },

    renameCategory(oldName, newName) {
      if (!CATEGORIES[oldName]) return { ok: false, error: 'missing' };
      const key = String(newName || '').trim().slice(0, 12);
      if (!key) return { ok: false, error: 'empty' };
      if (key === oldName) return { ok: true, name: key };
      if (CATEGORIES[key]) return { ok: false, error: 'exists' };
      CATEGORIES[key] = CATEGORIES[oldName];
      delete CATEGORIES[oldName];
      this.events.forEach((e) => { if (e.category === oldName) e.category = key; });
      this.series.forEach((s) => { if (s.category === oldName) s.category = key; });
      this.tasks.forEach((t) => { if (t.category === oldName) t.category = key; });
      this.saveCategories();
      this.saveSeries();
      this.saveTasks();
      this.save();
      return { ok: true, name: key };
    },

    removeCategory(name) {
      if (!CATEGORIES[name]) return { ok: false, error: 'missing' };
      if (name === '其他') return { ok: false, error: 'reserved' };
      if (Object.keys(CATEGORIES).length <= 1) return { ok: false, error: 'last' };
      const used = this.categoryUsage(name);
      if (used) return { ok: false, error: 'used', count: used };
      delete CATEGORIES[name];
      this.saveCategories();
      return { ok: true };
    },

    listTemplates() {
      return this.templates.slice();
    },

    addTemplate(input) {
      const template = normalizeTemplate(input);
      this.templates.push(template);
      this.saveTemplates();
      return template;
    },

    removeTemplate(id) {
      this.templates = this.templates.filter((t) => t.id !== id);
      this.saveTemplates();
    },

    exportAll() {
      return {
        app: 'DayFlow',
        version: 1,
        exportedAt: new Date().toISOString(),
        events: JSON.parse(JSON.stringify(this.events)),
        series: JSON.parse(JSON.stringify(this.series)),
        tasks: JSON.parse(JSON.stringify(this.tasks)),
        ddls: JSON.parse(JSON.stringify(this.ddls)),
        templates: JSON.parse(JSON.stringify(this.templates)),
        focusLog: JSON.parse(JSON.stringify(this.focusLog)),
        timetable: JSON.parse(JSON.stringify(this.timetable)),
        semesterStart: this.semesterStart,
        categories: JSON.parse(JSON.stringify(CATEGORIES)),
        settings: {
          mode: this.settings.mode,
          baseUrl: this.settings.baseUrl,
          model: this.settings.model
        }
      };
    },

    importAll(data) {
      if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
        throw new Error('不是有效的 DayFlow 备份');
      }
      if (data.categories && typeof data.categories === 'object') {
        Object.keys(CATEGORIES).forEach((name) => { delete CATEGORIES[name]; });
        Object.assign(CATEGORIES, DEFAULT_CATEGORIES);
        Object.keys(data.categories).forEach((name) => {
          const cat = data.categories[name];
          const key = String(name || '').trim().slice(0, 12);
          if (!key || !cat || !cat.color) return;
          CATEGORIES[key] = cat.dark && cat.soft && cat.text
            ? { color: normalizeHex(cat.color), dark: cat.dark, soft: cat.soft, text: cat.text }
            : makeCategory(cat.color);
        });
        if (!Object.keys(CATEGORIES).length) Object.assign(CATEGORIES, DEFAULT_CATEGORIES);
        this.saveCategories();
      }
      this.events = dedupeEvents((data.events || []).map(normalizeEvent));
      this.series = (data.series || []).map(normalizeSeries);
      this.tasks = (data.tasks || []).map(normalizeTask);
      this.ddls = (data.ddls || []).map(normalizeDdl);
      this.templates = (data.templates || []).map(normalizeTemplate);
      this.focusLog = Array.isArray(data.focusLog) ? data.focusLog.slice(-500) : [];
      this.timetable = normalizeTimetable(data.timetable || []);
      this.semesterStart = /^\d{4}-\d{2}-\d{2}$/.test(data.semesterStart || '') ? data.semesterStart : '';
      if (data.settings && typeof data.settings === 'object') {
        this.settings.mode = data.settings.mode === 'llm' ? 'llm' : 'local';
        if (data.settings.baseUrl) this.settings.baseUrl = String(data.settings.baseUrl);
        if (data.settings.model) this.settings.model = String(data.settings.model);
      }
      writeJSON(KEYS.series, this.series);
      writeJSON(KEYS.focusLog, this.focusLog);
      writeJSON(KEYS.timetable, this.timetable);
      try {
        if (this.semesterStart) localStorage.setItem(KEYS.semester, this.semesterStart);
        else localStorage.removeItem(KEYS.semester);
      } catch (e) { /* ignore */ }
      this.saveSettings();
      this.save();
      this.saveTasks();
      this.saveDdls();
      this.saveTemplates();
      this.saveCategories();
      notify('onFocusChanged', this.focus);
      return true;
    },

    snapshotDaily(force) {
      const today = U.todayStr();
      const list = readJSON(KEYS.snapshots, []) || [];
      if (!force && list.length && list[list.length - 1].date === today) return false;
      list.push({ date: today, at: Date.now(), data: this.exportAll() });
      writeJSON(KEYS.snapshots, list.slice(-3));
      return true;
    },

    getSnapshots() {
      return readJSON(KEYS.snapshots, []) || [];
    },

    restoreSnapshot(index) {
      const list = this.getSnapshots();
      const snapshot = list[index];
      if (!snapshot || !snapshot.data) return false;
      this.importAll(snapshot.data);
      return true;
    },

    clearEvents() {
      this.events = [];
      this.series = [];
      this.saveSeries();
      this.save();
    },

    addMessage(msg) {
      this.messages.push(msg);
      this.saveMessages();
    },

    resetChat() {
      this.messages = [];
      this.saveMessages();
    }
  };

  window.DayFlow = window.DayFlow || {};
  window.DayFlow.CATEGORIES = CATEGORIES;
  window.DayFlow.store = store;
})();
