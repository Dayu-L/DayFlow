/* 时序 DayFlow — 界面逻辑 */
(function () {
  'use strict';

  const U = window.DayFlow.util;
  const store = window.DayFlow.store;
  const agent = window.DayFlow.agent;
  const CATEGORIES = window.DayFlow.CATEGORIES;

  let HOUR_H = 64;
  let PPM = HOUR_H / 60;
  let WEEK_HOUR_H = 56;
  let WEEK_PPM = WEEK_HOUR_H / 60;

  const EDIT_KEY = 'dayflow.editmode.v1';
  const COMPACT_KEY = 'dayflow.compact.v1';
  const FOLD_KEY = 'dayflow.folded.v1';
  const VIEW_KEY = 'dayflow.view.v1';
  const THEME_KEY = 'dayflow.theme.v1';

  const THEMES = {
    paper: { name: '纸白' },
    ink: { name: '墨夜' },
    sand: { name: '暖砂' },
    forest: { name: '松林' },
    glass: { name: '玻璃' },
    aurora: { name: '极光' },
    hud: { name: 'HUD' },
    parallax: { name: '视差' },
    spatial: { name: '空间' }
  };
  let currentTheme = 'hud';

  const DEFAULT_PERIODS = [
    { start: 8 * 60, end: 8 * 60 + 45 },
    { start: 8 * 60 + 55, end: 9 * 60 + 40 },
    { start: 10 * 60, end: 10 * 60 + 45 },
    { start: 10 * 60 + 55, end: 11 * 60 + 40 },
    { start: 14 * 60, end: 14 * 60 + 45 },
    { start: 14 * 60 + 55, end: 15 * 60 + 40 },
    { start: 16 * 60, end: 16 * 60 + 45 },
    { start: 16 * 60 + 55, end: 17 * 60 + 40 },
    { start: 19 * 60, end: 19 * 60 + 45 },
    { start: 19 * 60 + 55, end: 20 * 60 + 40 },
    { start: 20 * 60 + 50, end: 21 * 60 + 35 },
    { start: 21 * 60 + 45, end: 22 * 60 + 30 }
  ];

  const state = {
    date: U.todayStr(),
    typing: false,
    busy: false,
    imageBusy: false,
    editMode: false,
    pendingImages: [],
    editingId: null,
    editingDdlId: null,
    suppressClick: false,
    scrollOnRender: true,
    nextEventId: null,
    scheduleProposals: [],
    selectedId: null,
    compact: false,
    folded: false,
    view: 'day',
    mobileView: 'calendar',
    monthCursor: '',
    periodDraft: [],
    categoryDraft: []
  };

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  const MAX_IMAGES = 3;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

  const els = {};

  /* ------------------------------------------------------------------ */
  /* 启动                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    cacheEls();
    initTheme();
    initParallax();

    window.DayFlow.onEventsChanged = debounce(() => {
      syncReminders();
      syncWidgetSoon();
    }, 250);
    window.DayFlow.onTasksChanged = () => {
      updateTaskCounts();
      syncWidgetSoon();
      if (els.tasksDialog && els.tasksDialog.open) renderTasks();
    };
    window.DayFlow.onDdlChanged = () => {
      updateDdlCounts();
      syncWidgetSoon();
      if (state.view === 'week') {
        if (els.weekGrid) renderWeekView(false);
      } else if (els.blocks) {
        renderTimeline(false);
      }
      if (els.ddlListDialog && els.ddlListDialog.open) renderDdlList();
    };
    window.DayFlow.onFocusChanged = () => syncReminders();

    store.load();
    // 自动查重：同一件事记了两遍的，打开就并掉（同标题、同日 / 同星期、时间差 30 分钟内）
    state.autoDeduped = store.dedupeFuzzy();
    store.fixCourseTimes();
    state.compact = localStorage.getItem(COMPACT_KEY) === '1';
    state.editMode = localStorage.getItem(EDIT_KEY) === '1';
    state.view = localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'day';
    const storedFold = localStorage.getItem(FOLD_KEY);
    state.folded = storedFold !== null ? storedFold === '1'
      : window.matchMedia('(max-width: 900px)').matches;
    const seeded = store.seed();
    store.snapshotDaily();

    if (!store.messages.length) {
      store.messages.push(welcomeMessage(seeded));
      store.saveMessages();
    }
    maybeDailyBrief();

    buildCategoryOptions();
    buildHourGrid();
    hidePastNowLine();
    bindEvents();
    initVoice();
    renderChat();
    renderAll({ scroll: true });
    updateModePill();
    setEditMode(state.editMode, true);
    syncViewButtons();
    setFolded(state.folded, true);
    setMobileView('calendar', true);
    if (state.compact) requestAnimationFrame(() => applyDensity(false));
    renderAttachments();
    updateSendState();
    updateTaskCounts();
    updateDdlCounts();
    updateTimetableStatus();
    resumeFocus();
    syncReminders();
    updateNotificationButtons();
    updateFeatureCounts();
    syncWidget();
    if (state.autoDeduped > 0) {
      showToast('自动并掉 ' + state.autoDeduped + ' 条重复');
    }
    setInterval(updateNowLine, 30000);
    setInterval(updateFocusBar, 1000);
    setInterval(() => {
      if (!nativeHas('syncReminders')) scheduleWebReminders(buildReminderList());
    }, 30 * 60 * 1000);
    window.addEventListener('resize', debounce(() => {
      if (state.view === 'week') {
        renderHeader();
        renderWeekView(false);
      } else if (state.compact) {
        applyDensity(false);
      }
    }, 150));
  }

  function cacheEls() {
    [
      'app', 'chat', 'chatInput', 'composer', 'sendBtn', 'suggestions', 'clearChat',
      'settingsBtn', 'agentMode', 'modePill', 'dateTitle', 'dateSub', 'weekstrip',
      'stats', 'legend', 'timelineScroll', 'timeline', 'hours', 'blocks', 'nowLine',
      'nowFlag', 'emptyOverlay', 'prevDay', 'nextDay', 'todayBtn', 'newBtn', 'exportBtn',
      'eventDialog', 'eventForm', 'dialogTitle', 'fTitle', 'fDate',
      'fStart', 'fEnd', 'fCategory', 'fLocation', 'fNote', 'fDone', 'deleteEvent',
      'settingsDialog', 'settingsForm', 'sBaseUrl', 'sModel', 'sApiKey', 'llmFields', 'revealApiKey',
      'clearAll', 'toast', 'footCount', 'agentFab', 'editModeBtn', 'timelineHint',
      'attachBtn', 'imageInput', 'attachments', 'dateFinding',
      'focusBtn', 'tasksBtn', 'tasksCount', 'focusBar', 'focusBarTitle', 'focusClock',
      'focusStop', 'focusDialog', 'focusForm', 'focusTitle', 'focusDuration', 'focusEvent',
      'tasksDialog', 'taskForm', 'taskTitle', 'taskEstimate', 'taskPriority', 'taskDue',
      'taskList', 'taskEmpty', 'schedulePreview', 'scheduleRange', 'autoScheduleBtn',
      'applyScheduleBtn', 'fReminder', 'seriesScope', 'deleteSeries',
      'ddlBtn', 'ddlCount', 'ddlDialog', 'ddlForm', 'ddlDialogTitle', 'ddlTitle',
      'ddlDate', 'ddlTime', 'ddlNote', 'ddlHint', 'ddlDelete', 'ddlDoneWrap', 'ddlDone', 'ddlSubmit',
      'ddlListDialog', 'ddlListSummary', 'ddlList', 'ddlListEmpty', 'ddlNewBtn', 'ddlEstimate',
      'rolloverBtn', 'rolloverDialog', 'rolloverSub', 'rolloverList',
      'rolloverEmpty', 'rolloverTarget', 'rolloverApply',
      'voiceBtn', 'exportAllBtn', 'importAllBtn', 'importIcsBtn', 'importAllInput',
      'importIcsInput', 'snapshotSelect', 'snapshotHint', 'restoreSnapshotBtn',
      'categoryBtn', 'dedupeBtn', 'cleanSampleBtn', 'categoryDialog', 'categoryList', 'newCategoryName', 'newCategoryColor',
      'addCategoryBtn', 'saveCategoriesBtn', 'templateList', 'saveTemplateBtn',
      'templateSaveDialog', 'templateSaveForm', 'templateNameInput',
      'notificationPermissionBtn', 'exactAlarmBtn', 'batteryBtn', 'exactAlarmBtn2',
      'monthBtn', 'prevWeek', 'nextWeek', 'sectionTitle', 'viewStandard', 'viewCompact',
      'selectionBar', 'selectionDot', 'selectionLabel', 'selectionDone',
      'quickAddForm', 'quickAddInput', 'quickAddSubmit',
      'monthDialog', 'monthTitle', 'monthGrid', 'monthPrev', 'monthNext', 'monthToday',
      'eventMore', 'durationRow', 'submitEventBtn',
      'timetableBtn', 'timetableDialog', 'periodList', 'periodEmpty', 'periodAdd',
      'periodTemplate', 'periodClear', 'periodSave', 'periodHint', 'semesterStart', 'semesterHint',
      'sYanhektUrl', 'yanhektSyncBtn',
      'calendar', 'foldBtn', 'tabCalendar', 'tabFeatures', 'tabAgent',
      'featuresBtn', 'featuresBackBtn', 'featuresPage', 'featureTasksCount',
      'featureDdlCount',
      'featureTimetableMeta', 'featureNotifyMeta', 'featureThemeMeta',
      'themeBtn', 'themeSettingsBtn', 'themeDialog', 'themeGrid', 'themeCurrent',
      'timelineShell', 'weekShell', 'weekGridScroll', 'weekGrid', 'viewDay', 'viewWeek'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function welcomeMessage(seeded) {
    const h = new Date().getHours();
    const greet = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    return {
      role: 'agent',
      text: greet + '，我是时序。\n说时间、事项，或发我截图。',
      tip: seeded
        ? '今天放了几条示例日程，可以说「清空今天」重新开始。'
        : '例如：「明天下午 3 点产品评审 1 小时」。',
      ts: Date.now()
    };
  }

  function buildCategoryOptions() {
    els.fCategory.innerHTML = Object.keys(CATEGORIES)
      .map((name) => '<option value="' + name + '">' + name + '</option>')
      .join('');
  }

  function buildHourGrid() {
    const step = state.compact ? (HOUR_H < 22 ? 3 : 2) : 1;
    let html = '';
    for (let h = 0; h < 24; h++) {
      html += '<div class="hour" style="top:' + (h * HOUR_H) + 'px">' +
        '<span class="hour-label">' + (h % step === 0 ? U.pad(h) + ':00' : '') + '</span>' +
        '</div>';
    }
    els.hours.innerHTML = html;
    els.timeline.style.height = (1440 * PPM) + 'px';
    els.timeline.classList.toggle('compact', state.compact);
    if (els.app) els.app.style.setProperty('--hour-h', HOUR_H + 'px');
  }

  function syncViewButtons() {
    if (els.viewStandard) {
      els.viewStandard.classList.toggle('is-on', !state.compact);
      els.viewStandard.setAttribute('aria-pressed', state.compact ? 'false' : 'true');
    }
    if (els.viewCompact) {
      els.viewCompact.classList.toggle('is-on', state.compact);
      els.viewCompact.setAttribute('aria-pressed', state.compact ? 'true' : 'false');
    }
  }

  function applyDensity(scroll) {
    if (state.compact) {
      const available = Math.max(320, els.timelineScroll.clientHeight - 2);
      HOUR_H = Math.max(14, Math.min(34, available / 24));
    } else {
      HOUR_H = 64;
    }
    PPM = HOUR_H / 60;
    buildHourGrid();
    if (state.view === 'week') {
      renderWeekView(!!scroll);
      return;
    }
    renderTimeline(!!scroll);
  }

  function setCompact(on, silent) {
    state.compact = !!on;
    localStorage.setItem(COMPACT_KEY, state.compact ? '1' : '0');
    syncViewButtons();
    applyDensity(false);
    renderHeader();
    if (state.view === 'week') {
      requestAnimationFrame(scrollWeekToFocus);
    } else if (state.compact) {
      els.timelineScroll.scrollTop = 0;
    } else {
      requestAnimationFrame(scrollToFocus);
    }
    updateSelectionBar();
    updateTimelineHint();
    if (!silent) {
      showToast(state.compact
        ? (state.view === 'week' ? '缩略周视图 · 一屏看一周' : '缩略模式 · 一屏看完一天')
        : '已切回标准视图');
    }
  }

  function hidePastNowLine() {
    els.nowLine.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  function renderAll(opts) {
    const options = opts || {};
    renderHeader();
    renderWeek();
    renderStats();
    syncViewChrome();
    if (state.view === 'week') {
      renderWeekView(options.scroll);
    } else {
      renderTimeline(options.scroll);
    }
    syncRangeButtons();
  }

  function syncViewChrome() {
    const week = state.view === 'week';
    if (els.calendar) els.calendar.classList.toggle('week-view', week);
    if (els.timelineShell) els.timelineShell.hidden = week;
    if (els.weekShell) els.weekShell.hidden = !week;
    if (week && els.selectionBar) els.selectionBar.hidden = true;
    if (week && !els.nowLine.hidden) els.nowLine.hidden = true;
    if (week && els.emptyOverlay) els.emptyOverlay.hidden = true;
    updateTimelineHint();
  }

  function syncRangeButtons() {
    if (els.viewDay) {
      els.viewDay.classList.toggle('is-on', state.view === 'day');
      els.viewDay.setAttribute('aria-pressed', state.view === 'day' ? 'true' : 'false');
    }
    if (els.viewWeek) {
      els.viewWeek.classList.toggle('is-on', state.view === 'week');
      els.viewWeek.setAttribute('aria-pressed', state.view === 'week' ? 'true' : 'false');
    }
    const week = state.view === 'week';
    if (els.prevDay) {
      els.prevDay.title = week ? '上一周' : '前一天 (←)';
      els.prevDay.setAttribute('aria-label', week ? '上一周' : '前一天');
    }
    if (els.nextDay) {
      els.nextDay.title = week ? '下一周' : '后一天 (→)';
      els.nextDay.setAttribute('aria-label', week ? '下一周' : '后一天');
    }
  }

  function setView(view, silent) {
    const next = view === 'week' ? 'week' : 'day';
    if (state.view === next) return;
    state.view = next;
    state.selectedId = null;
    setEditMode(false, true);
    localStorage.setItem(VIEW_KEY, next);
    updateSelectionBar();
    renderAll({ scroll: true });
    if (!silent) showToast(next === 'week' ? '周视图 · 一屏看一周' : '日视图 · 一天时间轴');
  }

  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  function countOverlaps(events) {
    let count = 0;
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        if (overlaps(events[i], events[j])) count++;
      }
    }
    return count;
  }

  function findNextEvent(events, date) {
    const now = new Date();
    const isToday = date === U.ymd(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const active = events.filter((e) => !e.done);
    const pool = (isToday ? active.filter((e) => e.end > nowMin) : active)
      .slice()
      .sort((a, b) => a.start - b.start || a.end - b.end);
    return pool[0] || null;
  }

  function gapAfter(events, evt) {
    const after = events
      .filter((e) => e.start >= evt.end)
      .sort((a, b) => a.start - b.start)[0];
    const end = after ? Math.min(after.start, 22 * 60) : 22 * 60;
    const gap = end - evt.end;
    return gap >= 60 ? { start: evt.end, end } : null;
  }

  function renderHeader() {
    const now = new Date();
    const today = U.ymd(now);
    const currentYear = now.getFullYear();
    const week = state.view === 'week';
    const monday = U.mondayOf(state.date);
    const sunday = U.addDays(monday, 6);
    const isToday = week ? U.mondayOf(today) === monday : state.date === today;
    const evts = week ? store.between(monday, sunday) : store.byDate(state.date);

    if (week) {
      const startYear = U.fromYmd(monday).getFullYear();
      const endYear = U.fromYmd(sunday).getFullYear();
      const prefix = startYear !== currentYear ? startYear + '年' : '';
      const endPrefix = endYear !== startYear ? endYear + '年' : '';
      if (window.matchMedia('(max-width: 620px)').matches) {
        const md = (value) => (U.fromYmd(value).getMonth() + 1) + '/' + U.fromYmd(value).getDate();
        els.dateTitle.textContent = md(monday) + ' – ' + md(sunday);
      } else {
        els.dateTitle.textContent = prefix + U.monthDayCN(monday) + ' – ' + endPrefix + U.monthDayCN(sunday);
      }
      els.dateSub.textContent = '本周 · 7 天';

      const done = evts.filter((e) => e.done).length;
      const total = evts.reduce((sum, e) => sum + (e.end - e.start), 0);
      const ddls = store.ddls.filter((d) => !d.done && d.date >= monday && d.date <= sunday);
      const parts = [];
      if (evts.length) {
        parts.push('本周 ' + evts.length + ' 项安排');
        parts.push('已规划 ' + U.fmtDuration(total));
        parts.push('完成 ' + done + '/' + evts.length);
      }
      if (ddls.length) parts.push(ddls.length + ' 个 DDL');
      if (ddls.some((d) => { const risk = ddlRiskFor(d); return risk && risk.short; })) {
        parts.push('空档不足');
      }
      const finding = parts.length ? parts.join(' · ') : '本周还没有安排。';
      els.dateFinding.textContent = finding;
      els.dateFinding.title = finding;
      state.nextEventId = null;
      els.todayBtn.classList.toggle('is-current', isToday);
      if (els.sectionTitle) els.sectionTitle.textContent = '本周时间轴';
      els.footCount.textContent = '本周 · 7 天';
      return;
    }

    const date = state.date;
    const year = U.fromYmd(date).getFullYear();
    els.dateTitle.textContent = (year !== currentYear ? year + '年' : '') + U.monthDayCN(date);

    const rel = U.relativeCN(date);
    let sub = U.weekdayCN(date);
    if (rel) sub += ' · ' + rel;
    els.dateSub.textContent = sub;

    const active = evts.filter((e) => !e.done);
    const allDone = evts.length > 0 && active.length === 0;
    const next = findNextEvent(evts, date);
    state.nextEventId = next ? next.id : null;

    let finding = '';
    if (!evts.length) {
      finding = isToday ? '今天还没有安排，先放一件最重要的事。' : '这一天还没有安排。';
    } else if (allDone) {
      finding = (isToday ? '今天' : '这一天') + ' ' + evts.length + ' 项都完成了。';
    } else if (!next) {
      finding = isToday ? '今天已没有后续安排。' : '这一天没有待办安排。';
    } else {
      const overlapsCount = countOverlaps(evts);
      const gap = gapAfter(evts, next);
      finding = (isToday ? '下一项 ' : '第一项 ') + U.fmtTime(next.start) + ' ' + next.title;
      if (gap) finding += ' · ' + U.fmtTime(gap.start) + ' 后空 ' + U.fmtDuration(gap.end - gap.start);
      if (overlapsCount) finding = overlapsCount + ' 处时间重叠 · ' + finding;
    }

    const pendingDdl = store.ddlsByDate(date).filter((d) => !d.done);
    if (pendingDdl.length) {
      let ddlText;
      if (pendingDdl.length === 1) {
        ddlText = evts.length
          ? 'DDL ' + U.fmtTime(pendingDdl[0].time)
          : U.fmtTime(pendingDdl[0].time) + ' 「' + pendingDdl[0].title + '」DDL';
      } else {
        ddlText = pendingDdl.length + ' 个 DDL 待完成';
      }
      if (!evts.length) {
        finding = (isToday ? '今天' : '这一天') + '没有日程，' + ddlText + '。';
      } else {
        finding += ' · ' + ddlText;
      }
      if (pendingDdl.some((d) => { const risk = ddlRiskFor(d); return risk && risk.short; })) {
        finding += ' · 空档不足';
      }
    }

    els.dateFinding.textContent = finding;
    els.dateFinding.title = finding;

    els.todayBtn.classList.toggle('is-current', isToday);
    if (els.sectionTitle) els.sectionTitle.textContent = isToday ? '今日时间轴' : '当天时间轴';
    els.footCount.textContent = state.compact ? '缩略视图 · 24 小时' : '24 小时视图';
  }

  function renderWeek() {
    const monday = U.mondayOf(state.date);
    const today = U.todayStr();
    let html = '';
    for (let i = 0; i < 7; i++) {
      const date = U.addDays(monday, i);
      const evts = store.byDate(date);
      const active = date === state.date;
      const isToday = date === today;
      const dots = evts.slice(0, 3).map((e) => {
        const cat = CATEGORIES[e.category] || CATEGORIES['其他'];
        return '<i style="background:' + cat.color + '"></i>';
      }).join('');
      html += '<button class="week-day' + (active ? ' active' : '') + (isToday ? ' today' : '') + '" data-date="' + date + '">' +
        '<span class="wd">' + U.weekdayCN(date).replace('周', '') + '</span>' +
        '<span class="dn">' + U.fromYmd(date).getDate() + '</span>' +
        '<span class="dots">' + dots + '</span>' +
        '</button>';
    }
    els.weekstrip.innerHTML = html;
  }

  function openMonthDialog() {
    state.monthCursor = state.date.slice(0, 7);
    renderMonth();
    if (!els.monthDialog.open) els.monthDialog.showModal();
  }

  function shiftMonth(delta) {
    const parts = state.monthCursor.split('-').map(Number);
    if (parts.length < 2 || parts.some(Number.isNaN)) return;
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    state.monthCursor = U.ymd(d).slice(0, 7);
    renderMonth();
  }

  function renderMonth() {
    const parts = state.monthCursor.split('-').map(Number);
    if (parts.length < 2 || parts.some(Number.isNaN)) return;
    const year = parts[0];
    const month = parts[1];
    const first = new Date(year, month - 1, 1);
    const firstWeekday = (first.getDay() + 6) % 7;
    const start = U.addDays(U.ymd(first), -firstWeekday);
    const today = U.todayStr();
    const cells = [];

    for (let i = 0; i < 42; i++) {
      const date = U.addDays(start, i);
      const d = U.fromYmd(date);
      const inMonth = d.getMonth() === month - 1;
      const evts = store.byDate(date);
      const dots = evts.slice(0, 3).map((e) => {
        const cat = CATEGORIES[e.category] || CATEGORIES['其他'];
        return '<i style="background:' + cat.color + '"></i>';
      }).join('');
      const label = U.monthDayCN(date) + ' · ' + U.weekdayCN(date) +
        (evts.length ? ' · ' + evts.length + ' 项' : '');
      cells.push('<button type="button" class="month-day' +
        (inMonth ? '' : ' outside') +
        (date === today ? ' today' : '') +
        (date === state.date ? ' selected' : '') +
        '" data-month-date="' + date + '" aria-label="' + label + '" title="' + label + '">' +
        '<span class="md-num">' + d.getDate() + '</span>' +
        '<span class="md-dots">' + dots + '</span>' +
        '</button>');
    }

    els.monthTitle.textContent = year + '年' + month + '月';
    els.monthGrid.innerHTML = cells.join('');
  }

  function pickMonthDate(date) {
    els.monthDialog.close();
    setDate(date, true);
  }

  function renderStats() {
    const week = state.view === 'week';
    const evts = week
      ? store.between(U.mondayOf(state.date), U.addDays(U.mondayOf(state.date), 6))
      : store.byDate(state.date);
    const total = evts.reduce((sum, e) => sum + (e.end - e.start), 0);
    const done = evts.filter((e) => e.done).length;

    const h = total / 60;
    const hoursLabel = (Number.isInteger(h) ? h : h.toFixed(1)) + '<span class="unit">h</span>';

    els.stats.innerHTML = [
      '<div class="stat"><strong>' + evts.length + '</strong><span>项安排</span></div>',
      '<div class="stat"><strong>' + (total ? hoursLabel : '0<span class="unit">h</span>') + '</strong><span>已规划</span></div>',
      '<div class="stat"><strong>' + (evts.length ? done + '<span class="unit">/' + evts.length + '</span>' : '0') + '</strong><span>已完成</span></div>'
    ].join('');

    const counts = {};
    evts.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });
    const order = Object.keys(CATEGORIES).filter((name) => counts[name]);
    els.legend.innerHTML = order.length
      ? order.map((name) => {
        const cat = CATEGORIES[name];
        return '<span class="legend-item"><i style="background:' + cat.color + '"></i>' + name + ' <em>' + counts[name] + '</em></span>';
      }).join('')
      : '';
  }

  function setFolded(on, silent) {
    state.folded = !!on;
    if (!silent) localStorage.setItem(FOLD_KEY, state.folded ? '1' : '0');
    if (els.calendar) els.calendar.classList.toggle('folded', state.folded);
    if (els.foldBtn) {
      els.foldBtn.setAttribute('aria-expanded', state.folded ? 'false' : 'true');
      els.foldBtn.title = state.folded ? '展开顶部信息' : '收起顶部信息';
      const label = els.foldBtn.querySelector('.label');
      if (label) label.textContent = state.folded ? '展开' : '收起';
    }
    if (state.compact) requestAnimationFrame(() => applyDensity(false));
    if (!silent) showToast(state.folded ? '已收起顶部信息' : '已展开顶部信息');
  }

  function setMobileView(view, silent) {
    state.mobileView = view === 'agent' ? 'agent' : (view === 'features' ? 'features' : 'calendar');
    const agentView = state.mobileView === 'agent';
    const featuresView = state.mobileView === 'features';
    document.body.classList.toggle('view-agent', agentView);
    document.body.classList.toggle('view-features', featuresView);
    document.body.classList.toggle('view-calendar', !agentView && !featuresView);
    if (els.tabCalendar) {
      els.tabCalendar.classList.toggle('is-on', !agentView && !featuresView);
      els.tabCalendar.setAttribute('aria-selected', !agentView && !featuresView ? 'true' : 'false');
    }
    if (els.tabFeatures) {
      els.tabFeatures.classList.toggle('is-on', featuresView);
      els.tabFeatures.setAttribute('aria-selected', featuresView ? 'true' : 'false');
    }
    if (els.tabAgent) {
      els.tabAgent.classList.toggle('is-on', agentView);
      els.tabAgent.setAttribute('aria-selected', agentView ? 'true' : 'false');
    }
    if (agentView) {
      window.scrollTo({ top: 0, behavior: silent ? 'auto' : 'smooth' });
    } else {
      window.scrollTo(0, 0);
      if (!featuresView && state.compact) requestAnimationFrame(() => applyDensity(false));
    }
  }

  function setFeatureCount(el, count) {
    if (!el) return;
    el.textContent = count > 99 ? '99+' : String(count);
    el.hidden = !count;
  }

  function updateFeatureCounts() {
    setFeatureCount(els.featureTasksCount, store.inboxTasks().length);
    setFeatureCount(els.featureDdlCount, store.pendingDdls().length);

    if (els.featureTimetableMeta) {
      const periods = store.getTimetable();
      els.featureTimetableMeta.textContent = periods.length
        ? periods.length + ' 节 · 第 N 节 ↔ 具体时间'
        : '未设置 · 去录入节次';
    }
    if (els.featureNotifyMeta) {
      els.featureNotifyMeta.textContent = notificationGranted()
        ? '通知已开启 · 精确提醒设置'
        : '允许通知、精确提醒设置';
    }
  }

  let widgetSyncTimer = null;

  function widgetThemeColors(theme) {
    switch (theme) {
      case 'ink':
        return { dark: true, text: '#EEF1F4', muted: '#A4ADB8', accent: '#74A9FF' };
      case 'sand':
        return { dark: false, text: '#2A251F', muted: '#756A5C', accent: '#9A5B2E' };
      case 'forest':
        return { dark: false, text: '#14201A', muted: '#5D6E63', accent: '#2F6F4F' };
      case 'glass':
        return { dark: false, text: '#151B28', muted: '#5B6577', accent: '#3568E8' };
      case 'aurora':
        return { dark: true, text: '#EEF6FF', muted: '#A6B7CC', accent: '#5EEAD4' };
      case 'hud':
        return { dark: true, text: '#D9F7FF', muted: '#7FB4C9', accent: '#34E7FF' };
      case 'parallax':
        return { dark: true, text: '#F7EFE5', muted: '#C0B0A2', accent: '#E7A15C' };
      case 'spatial':
        return { dark: false, text: '#181D2C', muted: '#606A80', accent: '#5C6BFF' };
      default:
        return { dark: false, text: '#111315', muted: '#5F6368', accent: '#1D5FBF' };
    }
  }

  function widgetSnapshot() {
    const today = U.todayStr();
    const events = store.byDate(today).map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      time: U.fmtTime(e.start) + '–' + U.fmtTime(e.end),
      meta: e.location || e.category || '',
      done: !!e.done
    }));
    return Object.assign({
      date: today,
      dateLabel: U.monthDayCN(today) + ' ' + U.weekdayCN(today),
      events: events,
      counts: {
        ddl: store.pendingDdls().length,
        tasks: store.inboxTasks().length,
      }
    }, widgetThemeColors(currentTheme));
  }

  function syncWidget() {
    if (!nativeHas('updateWidget')) return;
    try {
      nativeCall('updateWidget', [JSON.stringify(widgetSnapshot())]);
    } catch (e) {
      /* 小组件不可用时不影响页面 */
    }
  }

  function syncWidgetSoon() {
    if (!nativeHas('updateWidget')) return;
    clearTimeout(widgetSyncTimer);
    widgetSyncTimer = setTimeout(syncWidget, 260);
  }

  function themeName(key) {
    return (THEMES[key] || THEMES.paper).name;
  }

  function updateThemeUI() {
    const name = themeName(currentTheme);
    if (els.themeCurrent) els.themeCurrent.textContent = name;
    if (els.themeSettingsBtn) els.themeSettingsBtn.textContent = name + ' · 切换';
    if (els.featureThemeMeta) els.featureThemeMeta.textContent = name + ' · 随时切换';
    if (els.themeGrid) {
      els.themeGrid.querySelectorAll('[data-theme]').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.theme === currentTheme);
      });
    }
  }

  function applyTheme(theme, persist) {
    currentTheme = THEMES[theme] ? theme : 'paper';
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (persist) {
      try { localStorage.setItem(THEME_KEY, currentTheme); } catch (e) { /* 忽略存储失败 */ }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', currentTheme === 'ink' ? '#101214'
        : currentTheme === 'sand' ? '#f4efe6'
          : currentTheme === 'forest' ? '#edf2ee'
            : currentTheme === 'glass' ? '#edf2fb'
              : currentTheme === 'aurora' ? '#080b16'
                : currentTheme === 'hud' ? '#03070f'
                : currentTheme === 'parallax' ? '#0d0b10'
                  : currentTheme === 'spatial' ? '#eef1ff'
                    : '#f2f4f7');
    }
    updateThemeUI();
    syncWidgetSoon();
  }

  function initTheme() {
    let saved = 'hud';
    try {
      saved = document.documentElement.getAttribute('data-theme') || localStorage.getItem(THEME_KEY) || 'hud';
    } catch (e) {
      saved = 'hud';
    }
    applyTheme(saved, false);
  }

  function openThemeDialog() {
    updateThemeUI();
    if (!els.themeDialog.open) els.themeDialog.showModal();
  }

  function initParallax() {
    if (initParallax.bound) return;
    initParallax.bound = true;
    let px = 0;
    let py = 0;
    let raf = 0;

    function apply() {
      raf = 0;
      document.documentElement.style.setProperty('--px', px.toFixed(3));
      document.documentElement.style.setProperty('--py', py.toFixed(3));
    }

    window.addEventListener('pointermove', (e) => {
      if (!/^(hud|parallax|spatial)$/.test(document.documentElement.getAttribute('data-theme') || '')) return;
      px = e.clientX / Math.max(1, window.innerWidth) - 0.5;
      py = e.clientY / Math.max(1, window.innerHeight) - 0.5;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });

    window.addEventListener('scroll', () => {
      if (!/^(hud|parallax|spatial)$/.test(document.documentElement.getAttribute('data-theme') || '')) return;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      document.documentElement.style.setProperty('--sy', Math.min(1, window.scrollY / max).toFixed(3));
    }, { passive: true });
  }

  function openFeature(name) {
    switch (name) {
      case 'tasks': openTasksDialog(); break;
      case 'ddl': openDdlListDialog(); break;
      case 'rollover': openRolloverDialog(); break;
      case 'focus': openFocusDialog(); break;
      case 'review':
        setMobileView('agent');
        send('本周复盘');
        break;
      case 'timetable': openTimetableEditor(); break;
      case 'categories': openCategoryDialog(); break;
      case 'templates': saveTodayAsTemplate(); break;
      case 'theme': openThemeDialog(); break;
      case 'widget':
        if (nativeHas('requestPinWidget') && nativeCall('requestPinWidget')) {
          showToast('请在桌面确认添加小组件');
        } else {
          showToast('长按桌面空白处 → 小组件 → 时序 · 今日日程');
        }
        break;
      case 'settings': openSettings(); break;
      case 'notifications': openSettings(); break;
      default: break;
    }
  }

  function setEditMode(on, silent) {
    state.editMode = !!on;
    localStorage.setItem(EDIT_KEY, state.editMode ? '1' : '0');
    if (els.timeline) els.timeline.classList.toggle('editing', state.editMode);
    if (els.editModeBtn) {
      els.editModeBtn.classList.toggle('is-on', state.editMode);
      els.editModeBtn.setAttribute('aria-pressed', state.editMode ? 'true' : 'false');
      const label = els.editModeBtn.querySelector('.label');
      if (label) label.textContent = state.editMode ? '调整中' : '调整';
      els.editModeBtn.title = state.editMode
        ? '调整模式已开启：先点色块选中，再拖动 (E)'
        : '调整模式：先点色块选中，再拖动 (E)';
    }
    updateTimelineHint();
    if (!silent) {
      if (state.editMode && state.compact) {
        showToast('缩略模式只能查看，拖动请切回标准视图');
      } else {
        showToast(state.editMode ? '调整模式已开启 · 先点色块，再拖动' : '已回到浏览模式');
      }
    }
  }

  function updateTimelineHint() {
    if (!els.timelineHint) return;
    if (state.view === 'week') {
      els.timelineHint.textContent = '周视图 · 点空白时间格新建 · 点色块编辑';
      return;
    }
    if (state.compact) {
      els.timelineHint.textContent = '缩略视图 · 点色块选中 · 切回标准后可拖动';
    } else if (state.selectedId) {
      els.timelineHint.textContent = state.editMode
        ? '拖动选中色块改时间 · 拉底边改时长 · 再点一次打开编辑'
        : '已选中 · 打开「调整」后可拖动 · 再点一次打开编辑';
    } else {
      els.timelineHint.textContent = state.editMode
        ? '先点色块选中，再拖动改时间'
        : '点色块选中 · 再点一次编辑 · 打开「调整」可拖动';
    }
  }

  function computeLanes(events) {
    const result = new Map();
    const sorted = events.slice().sort((a, b) =>
      a.start - b.start || b.end - a.end ||
      String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));
    const groups = [];
    let group = [];
    let groupEnd = -1;

    sorted.forEach((e) => {
      if (group.length && e.start >= groupEnd) {
        groups.push(group);
        group = [];
        groupEnd = -1;
      }
      group.push(e);
      groupEnd = Math.max(groupEnd, e.end);
    });
    if (group.length) groups.push(group);

    groups.forEach((g) => {
      const laneEnds = [];
      const assign = [];
      g.forEach((e) => {
        let lane = laneEnds.findIndex((end) => end <= e.start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(e.end);
        } else {
          laneEnds[lane] = e.end;
        }
        assign.push([e, lane]);
      });
      const total = laneEnds.length;
      assign.forEach(([e, lane]) => result.set(e.id, { lane, total }));
    });

    return result;
  }

  function renderTimeline(scroll) {
    const events = store.byDate(state.date);
    if (state.selectedId && !events.some((e) => e.id === state.selectedId)) {
      state.selectedId = null;
    }
    const lanes = computeLanes(events);
    const html = [];
    const anchors = [];

    events.forEach((e) => {
      const cat = CATEGORIES[e.category] || CATEGORIES['其他'];
      const lane = lanes.get(e.id) || { lane: 0, total: 1 };
      const top = e.start * PPM;
      const height = Math.max((e.end - e.start) * PPM - (state.compact ? 1 : 2), state.compact ? 7 : 12);
      const short = state.compact || (e.end - e.start) <= 45 || height < 50;
      const micro = !state.compact && height < 24;
      const width = 100 / lane.total;
      const left = lane.lane * width;
      const gap = lane.total > 1 ? 6 : 0;

      let inner;
      if (short) {
        inner = '<div class="evt-inline">' +
          '<span class="evt-time">' + U.fmtTime(e.start) + '</span>' +
          '<span class="evt-title">' + U.escapeHTML(e.title) + '</span>' +
          '</div>';
      } else {
        inner = '<div class="evt-top">' +
          '<span class="evt-time">' + U.fmtTime(e.start) + '–' + U.fmtTime(e.end) + '</span>' +
          '<span class="evt-dur">' + U.fmtDurationShort(e.end - e.start) + '</span>' +
          '</div>' +
          '<div class="evt-title">' + U.escapeHTML(e.title) + '</div>' +
          ((e.location || e.note || e.actualMinutes)
            ? '<div class="evt-meta">' +
              (e.location ? '<span class="evt-loc">' + U.escapeHTML(e.location) + '</span>' : '') +
              (e.note ? '<span class="evt-note">' + U.escapeHTML(e.note) + '</span>' : '') +
              (e.actualMinutes ? '<span class="evt-actual">实际 ' + U.fmtDurationShort(e.actualMinutes) + '</span>' : '') +
              '</div>'
            : '');
      }

      const aria = U.fmtTime(e.start) + ' 到 ' + U.fmtTime(e.end) + '，' + e.title + '，' + e.category +
        (e.done ? '，已完成' : '') +
        (e.id === state.selectedId ? '，已选中，按回车编辑' : '，按回车选中');

      html.push('<article class="event-block' + (short ? ' compact' : '') + (micro ? ' micro' : '') + (e.done ? ' done' : '') +
        (e.id === state.nextEventId ? ' next' : '') + (e.id === state.selectedId ? ' selected' : '') +
        '" data-id="' + e.id + '" tabindex="0" aria-label="' + U.escapeHTML(aria) + '"' +
        ' style="top:' + top + 'px;height:' + height + 'px;left:calc(' + left + '% + ' + (lane.total > 1 ? 3 : 0) + 'px);' +
        'width:calc(' + width + '% - ' + (lane.total > 1 ? gap : 0) + 'px);--c:' + cat.color + ';--c2:' + cat.dark +
        ';--c-soft:' + cat.soft + ';--c-ink:' + cat.text + '">' +
        inner +
        (e.id === state.selectedId
          ? '<button class="evt-done-btn" type="button" data-done-btn>' + (e.done ? '取消完成' : '完成') + '</button>'
          : '') +
        '<button class="evt-check" type="button" data-check title="' + (e.done ? '标记未完成' : '标记完成') + '" aria-label="标记完成">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>' +
        '</button>' +
        '<span class="evt-resize" title="拖动调整时长"></span>' +
        '</article>');

      if (!state.compact) {
        anchors.push('<span class="start-dot" style="top:' + top + 'px;background:' + cat.color + '" title="' + U.fmtTime(e.start) + ' 开始"></span>');
      }
    });

    const gapStart = 7 * 60;
    const gapEnd = 23 * 60;
    let gapCursor = gapStart;
    const gapWindows = [];
    events.forEach((e) => {
      if (e.end <= gapStart || e.start >= gapEnd) return;
      if (e.start > gapCursor) gapWindows.push([gapCursor, Math.min(e.start, gapEnd)]);
      gapCursor = Math.max(gapCursor, e.end);
    });
    if (gapEnd > gapCursor) gapWindows.push([gapCursor, gapEnd]);
    const gapMarkup = gapWindows
      .filter(([s, e]) => e - s >= 90)
      .map(([s, e]) =>
        '<div class="gap-label" style="top:' + (s * PPM) + 'px;height:' + ((e - s) * PPM) + 'px">' +
          '<span>空 ' + U.fmtDuration(e - s) + '</span>' +
        '</div>')
      .join('');

    const ddls = store.ddlsByDate(state.date);
    let lastChipTop = -Infinity;
    const ddlMarkup = ddls.map((d) => {
      const top = d.time * PPM;
      let shift = 0;
      if (top - lastChipTop < 22) shift = lastChipTop + 22 - top;
      lastChipTop = top + shift;
      // 靠近 00:00 / 24:00 时把旗标收回时间轴内，避免被裁掉
      const pad = state.compact ? 8 : 11;
      const center = U.clamp(top + shift, pad, 1440 * PPM - pad);
      shift = center - top;
      const tip = 'DDL · ' + U.monthDayCN(d.date) + ' ' + U.fmtTime(d.time) + ' · ' + d.title +
        (d.note ? ' · ' + d.note : '') + '（点击编辑）';
      return '<span class="ddl-line' + (d.done ? ' done' : '') + '" style="top:' + top + 'px"></span>' +
        '<button type="button" class="ddl-chip' + (d.done ? ' done' : '') + '" data-ddl-id="' + d.id + '"' +
          ' style="top:' + center + 'px" title="' + U.escapeHTML(tip) + '">' +
          '<span class="ddl-flag">DDL</span>' +
          '<span class="ddl-time">' + U.fmtTime(d.time) + '</span>' +
          '<span class="ddl-title">' + U.escapeHTML(d.title) + '</span>' +
        '</button>';
    }).join('');

    els.blocks.innerHTML = anchors.join('') + gapMarkup + html.join('') + ddlMarkup;
    els.timeline.style.height = (1440 * PPM) + 'px';
    els.emptyOverlay.hidden = events.length > 0 || ddls.length > 0;
    updateNowLine();
    updateSelectionBar();

    if (scroll) {
      if (state.compact) {
        els.timelineScroll.scrollTop = 0;
      } else {
        requestAnimationFrame(scrollToFocus);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 周视图                                                             */
  /* ------------------------------------------------------------------ */

  function weekHourHeight() {
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    const narrow = window.matchMedia('(max-width: 620px)').matches;
    if (state.compact) {
      const shell = els.weekShell ? els.weekShell.clientHeight : 0;
      const available = shell - (narrow ? 42 : 46) - 2;
      if (available > 240) return Math.max(10, available / 24);
      return mobile ? 16 : 20;
    }
    return mobile ? 34 : 56;
  }

  function weekAxisStep(hourHeight) {
    if (hourHeight < 22) return 3;
    if (hourHeight < 40) return 2;
    return 1;
  }

  function renderWeekView(scroll) {
    if (!els.weekGrid) return;
    const monday = U.mondayOf(state.date);
    const today = U.todayStr();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const prevScroll = els.weekGridScroll ? els.weekGridScroll.scrollTop : 0;
    WEEK_HOUR_H = weekHourHeight();
    WEEK_PPM = WEEK_HOUR_H / 60;
    const bodyH = 1440 * WEEK_PPM;
    const step = weekAxisStep(WEEK_HOUR_H);

    let head = '<div class="week-axis-head">时间</div>';
    let cols = '';
    let axis = '';

    for (let h = 0; h < 24; h++) {
      if (h % step !== 0) continue;
      const top = h === 0 ? 2 : h * WEEK_HOUR_H - 6;
      axis += '<span class="week-axis-label" style="top:' + top + 'px">' + U.pad(h) + ':00</span>';
    }

    for (let i = 0; i < 7; i++) {
      const date = U.addDays(monday, i);
      const evts = store.byDate(date);
      const isToday = date === today;
      const isActive = date === state.date;
      const isWeekend = i >= 5;
      head += '<button type="button" class="week-head-day' +
        (isToday ? ' today' : '') + (isActive ? ' active' : '') + (isWeekend ? ' weekend' : '') +
        '" data-week-date="' + date + '" aria-label="打开 ' + U.monthDayCN(date) + ' ' + U.weekdayCN(date) + '">' +
        '<span class="week-head-wd">' + U.weekdayCN(date).replace('周', '') + '</span>' +
        '<span class="week-head-dn">' + U.fromYmd(date).getDate() + '</span>' +
        (isToday ? '<span class="week-head-mark" aria-hidden="true"></span>' : '') +
      '</button>';

      let lines = '';
      for (let h = 0; h < 24; h++) {
        lines += '<span class="week-hour-line" style="top:' + (h * WEEK_HOUR_H) + 'px"></span>';
      }

      const lanes = computeLanes(evts);
      let evHtml = '';
      evts.forEach((e) => {
        const cat = CATEGORIES[e.category] || CATEGORIES['其他'];
        const lane = lanes.get(e.id) || { lane: 0, total: 1 };
        const top = e.start * WEEK_PPM;
        const height = Math.max((e.end - e.start) * WEEK_PPM - 1, state.compact ? 3 : 6);
        const width = 100 / lane.total;
        const left = lane.lane * width;
        const short = height < (state.compact ? 18 : 34);
        const tiny = height < (state.compact ? 10 : 20);
        const showLoc = !state.compact && height >= 46 && !!e.location;
        const aria = U.weekdayCN(date) + ' ' + U.fmtTime(e.start) + ' 到 ' + U.fmtTime(e.end) +
          '，' + e.title + (e.done ? '，已完成' : '') + '，点击编辑';
        evHtml += '<button type="button" class="week-event' +
          (short ? ' short' : '') + (tiny ? ' tiny' : '') + (e.done ? ' done' : '') +
          '" data-week-event="' + e.id + '" data-week-date="' + date + '"' +
          ' aria-label="' + U.escapeHTML(aria) + '"' +
          ' title="' + U.escapeHTML(U.fmtTime(e.start) + '–' + U.fmtTime(e.end) + ' ' + e.title) + '"' +
          ' style="top:' + top + 'px;height:' + height + 'px;left:calc(' + left + '% + ' + (lane.total > 1 ? 1 : 0) + 'px);' +
          'width:calc(' + width + '% - ' + (lane.total > 1 ? 2 : 0) + 'px);--c:' + cat.color +
          ';--c-soft:' + cat.soft + ';--c-ink:' + cat.text + '">' +
          '<span class="week-event-time">' + U.fmtTime(e.start) + '</span>' +
          '<span class="week-event-title">' + U.escapeHTML(e.title) + '</span>' +
          (showLoc ? '<span class="week-event-loc">' + U.escapeHTML(e.location) + '</span>' : '') +
        '</button>';
      });

      const ddls = store.ddlsByDate(date).filter((d) => !d.done);
      let ddlHtml = '';
      let lastChip = -Infinity;
      ddls.forEach((d) => {
        const top = d.time * WEEK_PPM;
        let shift = 0;
        if (top - lastChip < 18) shift = lastChip + 18 - top;
        lastChip = top + shift;
        const center = U.clamp(top + shift, 8, bodyH - 8);
        ddlHtml += '<span class="week-ddl-line" style="top:' + top + 'px"></span>' +
          '<button type="button" class="week-ddl-chip" data-ddl-id="' + d.id + '"' +
            ' style="top:' + center + 'px"' +
            ' title="' + U.escapeHTML('DDL ' + U.fmtTime(d.time) + ' ' + d.title) + '"' +
            ' aria-label="DDL ' + U.escapeHTML(d.title) + ' ' + U.fmtTime(d.time) + '，点击编辑">' +
            '<span class="week-ddl-word">DDL</span>' +
            '<span class="week-ddl-time">' + U.fmtTime(d.time) + '</span>' +
            '<span class="week-ddl-title">' + U.escapeHTML(d.title) + '</span>' +
          '</button>';
      });

      const nowHtml = isToday
        ? '<span class="week-now-line" style="top:' + (nowMin * WEEK_PPM) + 'px"></span>'
        : '';
      cols += '<div class="week-day-col' + (isToday ? ' today' : '') + (isActive ? ' active' : '') +
        (isWeekend ? ' weekend' : '') + '" data-week-date="' + date + '">' +
        lines + nowHtml + evHtml + ddlHtml +
        '</div>';
    }

    els.weekGrid.classList.toggle('compact', state.compact);
    els.weekGrid.innerHTML =
      '<div class="week-grid-head">' + head + '</div>' +
      '<div class="week-grid-body" style="height:' + bodyH + 'px">' +
        '<div class="week-axis">' + axis + '</div>' + cols +
      '</div>';

    if (scroll) {
      requestAnimationFrame(scrollWeekToFocus);
    } else if (els.weekGridScroll) {
      els.weekGridScroll.scrollTop = prevScroll;
    }
    updateWeekNowLine();
  }

  function updateWeekNowLine() {
    if (!els.weekGrid) return;
    const line = els.weekGrid.querySelector('.week-now-line');
    if (!line) return;
    const now = new Date();
    line.style.top = ((now.getHours() * 60 + now.getMinutes()) * WEEK_PPM) + 'px';
  }

  function scrollWeekToFocus() {
    if (!els.weekGridScroll) return;
    const scroll = els.weekGridScroll;
    const now = new Date();
    const today = U.todayStr();
    const monday = U.mondayOf(state.date);
    const inWeek = today >= monday && today <= U.addDays(monday, 6);
    const min = inWeek
      ? now.getHours() * 60 + now.getMinutes()
      : 8 * 60;
    const target = min * WEEK_PPM - 100;
    scroll.scrollTop = U.clamp(target, 0, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
  }

  function onWeekClick(e) {
    const headDay = e.target.closest('.week-head-day');
    if (headDay) {
      setDate(headDay.dataset.weekDate, false);
      setView('day');
      return;
    }
    const ddlEl = e.target.closest('[data-ddl-id]');
    if (ddlEl) {
      e.stopPropagation();
      openDdlDialog(ddlEl.dataset.ddlId);
      return;
    }
    const evtEl = e.target.closest('[data-week-event]');
    if (evtEl) {
      e.stopPropagation();
      openEditor(evtEl.dataset.weekEvent);
      return;
    }
    const col = e.target.closest('.week-day-col');
    if (!col) return;
    const rect = col.getBoundingClientRect();
    let min = U.clamp((e.clientY - rect.top) / WEEK_PPM, 0, 1439);
    min = Math.round(min / 15) * 15;
    if (min >= 1440) min = 1425;
    openCreateDialog(min, col.dataset.weekDate);
  }

  function updateSelectionBar() {
    if (!els.selectionBar) return;
    if (state.view === 'week') {
      els.selectionBar.hidden = true;
      return;
    }
    const wasHidden = els.selectionBar.hidden;
    const evt = state.selectedId ? store.get(state.selectedId) : null;
    if (!evt || evt.date !== state.date) {
      state.selectedId = null;
      els.selectionBar.hidden = true;
      updateTimelineHint();
      if (state.compact && !wasHidden) requestAnimationFrame(() => applyDensity(false));
      return;
    }

    const cat = CATEGORIES[evt.category] || CATEGORIES['其他'];
    els.selectionDot.style.background = cat.color;
    els.selectionLabel.innerHTML =
      '<strong>' + U.escapeHTML(evt.title) + '</strong>' +
      '<em>' + U.fmtTime(evt.start) + '–' + U.fmtTime(evt.end) + '</em>' +
      (evt.note ? '<span class="selection-note">备注 · ' + U.escapeHTML(evt.note) + '</span>' : '');
    els.selectionDone.textContent = evt.done ? '取消完成' : '完成';
    els.selectionBar.hidden = false;
    updateTimelineHint();
    if (state.compact && wasHidden) requestAnimationFrame(() => applyDensity(false));
  }

  function selectEvent(id, keepFocus) {
    if (!store.get(id)) return;
    state.selectedId = id;
    renderTimeline(false);
    if (keepFocus) {
      const el = els.blocks.querySelector('.event-block[data-id="' + id + '"]');
      if (el) el.focus();
    }
  }

  function clearSelection(render) {
    if (!state.selectedId) return;
    state.selectedId = null;
    if (render === false) updateSelectionBar();
    else renderTimeline(false);
  }

  function handleSelectionAction(action) {
    const evt = state.selectedId ? store.get(state.selectedId) : null;
    if (!evt) return;

    if (action === 'edit') {
      openEditor(evt.id);
      return;
    }
    if (action === 'done') {
      store.toggleDone(evt.id);
      renderAll({ scroll: false });
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('删除「' + evt.title + '」？')) return;
      state.selectedId = null;
      store.remove([evt.id]);
      renderAll({ scroll: false });
      showToast('已删除「' + evt.title + '」');
      return;
    }
    clearSelection();
  }

  function scrollToFocus() {
    if (state.compact) {
      els.timelineScroll.scrollTop = 0;
      return;
    }
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const events = store.byDate(state.date);
    let target;
    if (state.date === U.ymd(now)) {
      const first = events[0];
      const nearFirst = first && first.start <= nowMin + 60 && nowMin - first.start <= 300;
      target = nearFirst ? first.start * PPM - 24 : nowMin * PPM - 150;
    } else {
      target = 8 * 60 * PPM - 24;
    }
    const max = els.timelineScroll.scrollHeight - els.timelineScroll.clientHeight;
    els.timelineScroll.scrollTop = Math.min(Math.max(0, target), Math.max(0, max - 30));
  }

  function updateNowLine() {
    const now = new Date();
    const today = U.ymd(now);
    if (state.view === 'week') {
      els.nowLine.hidden = true;
      updateWeekNowLine();
      return;
    }
    if (state.date !== today) {
      els.nowLine.hidden = true;
      return;
    }
    const min = now.getHours() * 60 + now.getMinutes();
    els.nowLine.hidden = false;
    els.nowLine.style.top = (min * PPM) + 'px';
    els.nowFlag.textContent = '现在 ' + U.fmtTime(min);
  }

  /* ------------------------------------------------------------------ */
  /* 聊天                                                               */
  /* ------------------------------------------------------------------ */

  function renderChat() {
    const avatar = '<span class="msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"></circle><path d="M12 7.6V12l3.1 2"></path></svg></span>';

    let html = store.messages.map((m, idx) => {
      const fresh = idx === store.messages.length - 1 ? ' fresh' : '';
      if (m.role === 'user') {
        const images = (m.images || []).map((src) =>
          '<img class="msg-image" src="' + U.escapeHTML(src) + '" alt="图片附件" loading="lazy">'
        ).join('');
        return '<div class="msg user' + fresh + '"><div class="msg-body"><div class="bubble">' +
          (m.text ? U.escapeHTML(m.text).replace(/\n/g, '<br>') : '') +
          (images ? '<div class="msg-images">' + images + '</div>' : '') +
          '</div><span class="msg-time">' + timeOf(m.ts) + '</span></div></div>';
      }

      const items = (m.items || []).map((item) => {
        const cat = CATEGORIES[item.category] || CATEGORIES['其他'];
        return '<button class="msg-item" type="button" data-event="' + U.escapeHTML(item.id || '') + '">' +
          '<i style="background:' + cat.color + '"></i>' +
          '<span class="mi-time">' + U.escapeHTML(item.time) + '</span>' +
          '<span class="mi-title">' + U.escapeHTML(item.title) + '</span>' +
          '</button>';
      }).join('');

      return '<div class="msg assistant' + fresh + '">' + avatar +
        '<div class="msg-body"><div class="bubble">' +
        '<p>' + U.escapeHTML(m.text).replace(/\n/g, '<br>') + '</p>' +
        (items ? '<div class="msg-items">' + items + '</div>' : '') +
        (m.tip ? '<p class="msg-tip">' + U.escapeHTML(m.tip) + '</p>' : '') +
        '</div><span class="msg-time">' + timeOf(m.ts) + (m.mode === 'llm' ? ' · 大模型' : '') + '</span></div></div>';
    }).join('');

    if (state.typing) {
      html += '<div class="msg assistant typing fresh">' + avatar +
        '<div class="msg-body"><div class="bubble typing-dots"><i></i><i></i><i></i></div></div></div>';
    }

    els.chat.innerHTML = html;
    els.chat.scrollTop = els.chat.scrollHeight;
  }

  function timeOf(ts) {
    const d = new Date(ts || Date.now());
    return U.fmtTime(d.getHours() * 60 + d.getMinutes());
  }

  async function send(text) {
    const content = String(text || '').trim();
    const images = state.pendingImages.slice();
    if ((!content && !images.length) || state.busy) return;
    if (state.imageBusy) {
      showToast('图片还在处理中，稍等一下');
      return;
    }

    const hasVision = store.settings.mode === 'llm' && !!store.settings.baseUrl;
    if (images.length && !hasVision) {
      store.addMessage({
        role: 'agent',
        text: '图片识别需要支持视觉的大模型。\n当前是本地智能体，只能解析文字。请到设置里切换到大模型，并填写支持视觉的模型，例如 gpt-4o、qwen-vl-max、glm-4v。',
        tip: '图片还在输入框上方，配置好后可以直接发送。',
        ts: Date.now()
      });
      renderChat();
      showToast('识图需要视觉大模型');
      updateSendState();
      return;
    }

    state.busy = true;
    updateSendState();

    const thumbs = images.map((img) => img.thumb);
    const displayText = content || (images.length ? '请识别图片里的日程' : '');
    els.chatInput.value = '';
    autoGrow();
    state.pendingImages = [];
    renderAttachments();

    store.addMessage({
      role: 'user',
      text: displayText,
      images: thumbs,
      ts: Date.now()
    });
    state.typing = true;
    renderChat();

    const before = JSON.parse(JSON.stringify(store.events));
    const beforeSeries = JSON.parse(JSON.stringify(store.series));
    const beforeDdls = JSON.parse(JSON.stringify(store.ddls));
    const started = Date.now();
    let res;

    try {
      res = await agent.respond(
        content || (images.length ? '请识别图片中的日程，并整理成时间轴日程。' : ''),
        {
          now: new Date(),
          selectedDate: state.date,
          defaultDate: state.date,
          selectedId: state.selectedId
        },
        images.map((img) => img.full)
      );
    } catch (err) {
      res = { text: '我这边出了点问题：' + (err && err.message ? err.message : '未知错误'), items: [], changed: false };
    }

    const wait = Math.max(0, 520 - (Date.now() - started));
    if (wait) await new Promise((r) => setTimeout(r, wait));

    state.typing = false;
    const message = {
      role: 'agent',
      text: res.text || '已处理。',
      items: res.items || [],
      tip: res.tip || '',
      mode: res.mode || 'local',
      kind: res.kind || '',
      ts: Date.now()
    };
    store.addMessage(message);

    if (res.changed || res.ddlChanged) {
      const dates = (res.items || []).map((i) => i.date).filter(Boolean);
      const unique = dates.filter((d, i) => dates.indexOf(d) === i);
      let targetDate = '';
      if (res.changed && res.kind !== 'remove' && unique.length === 1) targetDate = unique[0];
      else if (res.ddlChanged && res.jumpDate) targetDate = res.jumpDate;

      if (targetDate && targetDate !== state.date) {
        state.date = targetDate;
        renderAll({ scroll: true });
      } else {
        renderAll({ scroll: false });
      }
      const labels = {
        add: 'DDL 已记录',
        done: 'DDL 已完成',
        update: 'DDL 已改期',
        remove: 'DDL 已删除'
      };
      const toastText = res.changed
        ? (res.kind === 'remove' ? '日程已删除' : '日程已更新')
        : (labels[res.ddlAction] || 'DDL 已更新');
      showToast(toastText, '撤销', () => {
        store.setEvents(before);
        store.series = beforeSeries;
        store.saveSeries();
        store.setDdls(beforeDdls);
        renderAll({ scroll: false });
        renderHeader();
      });
    }

    if (res.openTasks) {
      setTimeout(openTasksDialog, 60);
    }
    if (res.openRollover) {
      if (res.rolloverDate && res.rolloverDate !== state.date) {
        state.date = res.rolloverDate;
        renderAll({ scroll: false });
      }
      setTimeout(openRolloverDialog, 60);
    }
    if (res.openTimetable) {
      setTimeout(openTimetableEditor, 60);
    }

    renderChat();
    state.busy = false;
    updateSendState();
  }

  function updateSendState() {
    els.sendBtn.disabled = state.busy || state.imageBusy ||
      (!els.chatInput.value.trim() && !state.pendingImages.length);
    els.sendBtn.classList.toggle('loading', state.busy);
    if (els.attachBtn) els.attachBtn.disabled = state.imageBusy;
  }

  function autoGrow() {
    const el = els.chatInput;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 116) + 'px';
  }

  /* ------------------------------------------------------------------ */
  /* 语音输入                                                           */
  /* ------------------------------------------------------------------ */

  let voiceRecognition = null;
  let voiceListening = false;
  let voiceBase = '';

  function setVoiceState(listening) {
    voiceListening = listening;
    if (!els.voiceBtn) return;
    els.voiceBtn.classList.toggle('is-listening', listening);
    els.voiceBtn.setAttribute('aria-label', listening ? '停止语音输入' : '语音输入');
    els.voiceBtn.title = listening ? '停止语音输入' : '语音输入';
  }

  function initVoice() {
    if (!els.voiceBtn) return;
    // 这台手机（荣耀）没有给第三方用的语音识别引擎：系统标准入口没有 Activity，
    // MagicVoice 只是语音助手服务，com.hihonor.voiceengine 的离线 ASR 只对自家开放。
    // 原生桥（DayFlowNative.startVoice）还在，等接了云端 ASR 再把这里换成它。
    els.voiceBtn.hidden = true;
    return;
  }

  function initVoiceWeb() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !els.voiceBtn) {
      if (els.voiceBtn) els.voiceBtn.hidden = true;
      return;
    }
    try {
      voiceRecognition = new SpeechRecognition();
    } catch (err) {
      els.voiceBtn.hidden = true;
      return;
    }
    voiceRecognition.lang = 'zh-CN';
    voiceRecognition.interimResults = true;
    voiceRecognition.continuous = false;
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => setVoiceState(true);
    voiceRecognition.onend = () => setVoiceState(false);
    voiceRecognition.onerror = (event) => {
      setVoiceState(false);
      if (event && event.error === 'aborted') return;
      showToast(event && event.error === 'not-allowed'
        ? '需要麦克风权限才能语音输入'
        : '语音输入失败，请再试一次');
    };
    voiceRecognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      transcript = transcript.trim();
      if (!transcript) return;
      els.chatInput.value = (voiceBase ? voiceBase + ' ' : '') + transcript;
      autoGrow();
      updateSendState();
    };

    els.voiceBtn.addEventListener('click', () => {
      if (voiceListening) {
        try { voiceRecognition.stop(); } catch (err) { /* ignore */ }
        return;
      }
      voiceBase = els.chatInput.value.trim();
      try {
        voiceRecognition.start();
      } catch (err) {
        showToast('语音输入启动失败');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 图片附件                                                           */
  /* ------------------------------------------------------------------ */

  function renderAttachments() {
    const list = state.pendingImages;
    els.attachments.hidden = list.length === 0;
    els.attachments.innerHTML = list.map((img, idx) =>
      '<div class="attach-item">' +
        '<img src="' + U.escapeHTML(img.thumb) + '" alt="待发送图片">' +
        '<button class="attach-remove" type="button" data-remove-image="' + idx + '" aria-label="移除图片">×</button>' +
      '</div>'
    ).join('');
  }

  function resizeImage(img, maxSize, quality) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSize / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }

  function processImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode failed'));
        img.onload = () => {
          try {
            resolve({
              name: file.name || 'image',
              full: resizeImage(img, 1400, 0.84),
              thumb: resizeImage(img, 360, 0.72)
            });
          } catch (err) {
            reject(err);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.__dayflowNativeImage = function (dataUrl, name) {
    if (!dataUrl) return;
    if (state.pendingImages.length >= MAX_IMAGES) {
      showToast('最多添加 ' + MAX_IMAGES + ' 张图片');
      return;
    }
    if (state.imageBusy) {
      showToast('图片还在处理中');
      return;
    }
    state.imageBusy = true;
    updateSendState();
    const img = new Image();
    img.onload = function () {
      try {
        state.pendingImages.push({
          name: name || 'image',
          full: resizeImage(img, 1400, 0.84),
          thumb: resizeImage(img, 360, 0.72)
        });
        showToast('已添加图片');
      } catch (e) {
        showToast('无法读取图片');
      }
      state.imageBusy = false;
      renderAttachments();
      updateSendState();
    };
    img.onerror = function () {
      state.imageBusy = false;
      updateSendState();
      showToast('无法读取图片');
    };
    img.src = dataUrl;
  };

  async function addImages(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && (!f.type || /^image\//.test(f.type)));
    if (!files.length) return;
    if (state.imageBusy) {
      showToast('图片还在处理中');
      return;
    }
    const room = MAX_IMAGES - state.pendingImages.length;
    if (room <= 0) {
      showToast('最多添加 ' + MAX_IMAGES + ' 张图片');
      return;
    }
    if (files.length > room) {
      showToast('最多添加 ' + MAX_IMAGES + ' 张图片，已取前 ' + room + ' 张');
    }

    state.imageBusy = true;
    updateSendState();
    try {
      for (const file of files.slice(0, room)) {
        if (file.size > MAX_IMAGE_BYTES) {
          showToast('单张图片不能超过 12MB');
          continue;
        }
        try {
          state.pendingImages.push(await processImageFile(file));
        } catch (err) {
          showToast('无法读取这张图片');
        }
      }
    } finally {
      state.imageBusy = false;
      renderAttachments();
      updateSendState();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 时间轴交互                                                         */
  /* ------------------------------------------------------------------ */

  function startDrag(pointerEvent, block, mode) {
    if (!state.editMode) return;
    if (pointerEvent.button !== 0) return;
    const evt = store.get(block.dataset.id);
    if (!evt) return;

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();

    const startY = pointerEvent.clientY;
    const origin = { start: evt.start, end: evt.end };
    const duration = origin.end - origin.start;
    let delta = 0;
    let moved = false;
    const timeEl = block.querySelector('.evt-time');

    block.classList.add('dragging');

    function onMove(e) {
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 3) moved = true;
      const raw = Math.round(dy / PPM / 5) * 5;

      if (mode === 'move') {
        const nextStart = U.clamp(origin.start + raw, 0, 1440 - duration);
        delta = nextStart - origin.start;
        block.style.top = (nextStart * PPM) + 'px';
        if (timeEl) timeEl.textContent = U.fmtTime(nextStart) + '–' + U.fmtTime(nextStart + duration);
      } else {
        const nextEnd = U.clamp(origin.end + raw, origin.start + 15, 1440);
        delta = nextEnd - origin.end;
        block.style.height = ((nextEnd - origin.start) * PPM - 2) + 'px';
        if (timeEl) timeEl.textContent = U.fmtTime(origin.start) + '–' + U.fmtTime(nextEnd);
      }
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      block.classList.remove('dragging');

      if (moved && delta !== 0) {
        state.suppressClick = true;
        setTimeout(() => { state.suppressClick = false; }, 150);
        if (mode === 'move') {
          store.update(evt.id, { start: origin.start + delta, end: origin.end + delta });
        } else {
          store.update(evt.id, { end: origin.end + delta });
        }
        renderAll({ scroll: false });
        showToast('已改到 ' + U.fmtTime(store.get(evt.id).start) + '–' + U.fmtTime(store.get(evt.id).end));
      } else if (moved) {
        renderTimeline(false);
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onTimelinePointerDown(e) {
    const block = e.target.closest('.event-block');
    if (!block) return;

    // 只要手指 / 鼠标挪动过，就不要把这次手势当成点击。
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    function track(ev) {
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
    }
    function settle() {
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', settle);
      window.removeEventListener('pointercancel', settle);
      if (moved) {
        state.suppressClick = true;
        setTimeout(() => { state.suppressClick = false; }, 150);
      }
    }
    window.addEventListener('pointermove', track);
    window.addEventListener('pointerup', settle);
    window.addEventListener('pointercancel', settle);

    if (!state.editMode || state.compact) return;
    if (e.target.closest('.evt-check, .evt-done-btn')) return;
    if (block.dataset.id !== state.selectedId) return;
    if (e.target.closest('.evt-resize')) startDrag(e, block, 'resize');
    else startDrag(e, block, 'move');
  }

  function onTimelineClick(e) {
    if (state.suppressClick) return;

    const ddlEl = e.target.closest('[data-ddl-id]');
    if (ddlEl) {
      e.stopPropagation();
      openDdlDialog(ddlEl.dataset.ddlId);
      return;
    }

    const doneBtn = e.target.closest('[data-done-btn]');
    if (doneBtn) {
      const block = doneBtn.closest('.event-block');
      if (!block) return;
      e.stopPropagation();
      store.toggleDone(block.dataset.id);
      renderAll({ scroll: false });
      return;
    }

    const check = e.target.closest('[data-check]');
    if (check) {
      const block = check.closest('.event-block');
      if (!block) return;
      e.stopPropagation();
      store.toggleDone(block.dataset.id);
      renderAll({ scroll: false });
      return;
    }

    const block = e.target.closest('.event-block');
    if (block) {
      const id = block.dataset.id;
      if (state.selectedId !== id) {
        selectEvent(id);
        return;
      }
      openEditor(id);
      return;
    }

    if (state.selectedId) clearSelection();
    const rect = els.timeline.getBoundingClientRect();
    let min = U.clamp((e.clientY - rect.top) / PPM, 0, 1439);
    min = Math.round(min / 15) * 15;
    if (min >= 1440) min = 1425;
    openCreateDialog(min);
  }

  function onTimelineKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const block = e.target.closest('.event-block');
    if (!block) return;
    if (e.target.closest('.evt-check, .evt-done-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    const id = block.dataset.id;
    if (state.selectedId !== id) {
      selectEvent(id, true);
      return;
    }
    openEditor(id);
  }

  /* ------------------------------------------------------------------ */
  /* 编辑弹窗                                                           */
  /* ------------------------------------------------------------------ */

  function openCreateDialog(startMin, date) {
    const now = new Date();
    let start = startMin;
    let targetDate = date || state.date;
    if (start == null) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      start = Math.ceil((nowMin + 20) / 30) * 30;
      if (targetDate === U.todayStr() && start > 21 * 60) {
        targetDate = U.addDays(targetDate, 1);
        start = 9 * 60;
      } else if (start >= 1440) {
        start = 9 * 60;
      }
    }
    openDialog({
      id: null,
      title: '',
      date: targetDate,
      start,
      end: Math.min(1439, start + 60),
      category: '工作',
      location: '',
      note: '',
      done: false,
      reminder: 10
    });
  }

  function openEditor(id) {
    const evt = store.get(id);
    if (!evt) return;
    openDialog(evt);
  }

  function openDialog(evt) {
    state.editingId = evt.id || null;
    els.dialogTitle.textContent = evt.id ? '编辑日程' : '新建日程';
    els.fTitle.value = evt.title || '';
    els.fDate.value = evt.date || state.date;
    els.fStart.value = U.fmtTime(evt.start == null ? 9 * 60 : evt.start);
    els.fEnd.value = U.fmtTime(evt.end == null ? 10 * 60 : Math.min(evt.end, 1439));
    els.fCategory.value = CATEGORIES[evt.category] ? evt.category : '其他';
    els.fLocation.value = evt.location || '';
    els.fNote.value = evt.note || '';
    els.fDone.checked = !!evt.done;
    els.fDone.closest('.check').style.display = evt.id ? '' : 'none';
    els.deleteEvent.style.visibility = evt.id ? 'visible' : 'hidden';
    els.eventMore.open = !!(evt.location || evt.note);
    els.submitEventBtn.textContent = evt.id ? '保存' : '创建日程';
    setReminderSelect(evt.reminder);
    syncDurationChips();

    const series = evt.id && evt.seriesId ? store.getSeries(evt.seriesId) : null;
    els.seriesScope.hidden = !series;
    els.deleteSeries.hidden = !series;
    els.fDate.disabled = false;
    if (series) {
      const single = els.seriesScope.querySelector('input[name="editScope"][value="single"]');
      if (single) single.checked = true;
      const count = store.events.filter((e) => e.seriesId === series.id).length;
      els.deleteSeries.textContent = '删除系列（' + count + '）';
    } else {
      els.deleteSeries.textContent = '删除系列';
    }

    if (!els.eventDialog.open) els.eventDialog.showModal();
    setTimeout(() => {
      if (!evt.id) els.fTitle.focus();
    }, 60);
  }

  function submitEvent(e) {
    e.preventDefault();
    const title = els.fTitle.value.trim();
    if (!title) {
      showToast('给日程起个名字吧');
      els.fTitle.focus();
      return;
    }
    const date = els.fDate.value || state.date;
    const start = U.parseTimeStr(els.fStart.value);
    let end = U.parseTimeStr(els.fEnd.value);

    if (!Number.isFinite(start)) {
      showToast('开始时间格式不对');
      return;
    }
    if (!Number.isFinite(end)) end = Math.min(1439, start + 60);
    if (end <= start) {
      showToast('结束时间需要晚于开始时间');
      return;
    }

    const payload = {
      title,
      date,
      start,
      end,
      category: els.fCategory.value,
      location: els.fLocation.value.trim(),
      note: els.fNote.value.trim(),
      done: els.fDone.checked,
      reminder: els.fReminder.value === '' ? null : Number(els.fReminder.value)
    };

    const current = state.editingId ? store.get(state.editingId) : null;
    const scopeEl = els.seriesScope.querySelector('input[name="editScope"]:checked');
    const scope = scopeEl ? scopeEl.value : 'single';

    if (current && current.seriesId && scope === 'series') {
      const series = store.getSeries(current.seriesId);
      if (series) {
        store.updateSeries(series.id, {
          title,
          start,
          end,
          category: payload.category,
          location: payload.location,
          note: payload.note,
          reminder: payload.reminder
        });
        els.eventDialog.close();
        state.date = current.date;
        state.selectedId = current.id;
        renderAll({ scroll: false });
        showToast('整个系列已更新');
        state.editingId = null;
        return;
      }
    }

    if (current) {
      store.update(current.id, payload);
      state.selectedId = current.id;
    } else {
      const created = store.add(Object.assign({ source: 'manual' }, payload));
      state.selectedId = created.id;
    }

    els.eventDialog.close();
    state.date = date;
    renderAll({ scroll: false });
    showToast(current ? '日程已更新' : '日程已创建');
    state.editingId = null;
  }

  function syncDurationChips() {
    if (!els.durationRow) return;
    const start = U.parseTimeStr(els.fStart.value);
    const end = U.parseTimeStr(els.fEnd.value);
    const diff = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
    els.durationRow.querySelectorAll('[data-duration]').forEach((btn) => {
      btn.classList.toggle('is-on', Number(btn.dataset.duration) === diff);
    });
  }

  function applyDuration(minutes) {
    const start = U.parseTimeStr(els.fStart.value);
    if (!Number.isFinite(start)) return;
    const end = Math.min(1439, start + Number(minutes));
    if (end <= start) return;
    els.fEnd.value = U.fmtTime(end);
    syncDurationChips();
  }

  function deleteCurrent() {
    if (!state.editingId) return;
    const evt = store.get(state.editingId);
    if (!evt) return;
    if (!window.confirm('删除「' + evt.title + '」？')) return;
    store.remove([evt.id]);
    if (state.selectedId === evt.id) state.selectedId = null;
    els.eventDialog.close();
    state.editingId = null;
    renderAll({ scroll: false });
    showToast('已删除「' + evt.title + '」');
  }

  function deleteWholeSeries() {
    if (!state.editingId) return;
    const evt = store.get(state.editingId);
    if (!evt || !evt.seriesId) return;
    const series = store.getSeries(evt.seriesId);
    if (!series) return;
    const count = store.events.filter((e) => e.seriesId === series.id).length;
    if (!window.confirm('删除整个系列「' + series.title + '」？共 ' + count + ' 项日程。')) return;
    store.removeSeries(series.id);
    els.eventDialog.close();
    state.editingId = null;
    renderAll({ scroll: false });
    showToast('已删除整个系列');
  }

  function setReminderSelect(value) {
    const val = value === null || value === undefined || value === '' ? '' : String(value);
    let exists = false;
    Array.prototype.forEach.call(els.fReminder.options, (opt) => {
      if (opt.value === val) exists = true;
    });
    if (!exists && val !== '') {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = '提前 ' + val + ' 分钟';
      els.fReminder.appendChild(opt);
    }
    els.fReminder.value = val;
  }

  /* ------------------------------------------------------------------ */
  /* 提醒                                                               */
  /* ------------------------------------------------------------------ */

  const REMINDER_HORIZON_DAYS = 60;
  const webReminderTimers = [];
  const firedReminders = new Set();

  function nativeHas(name) {
    return !!(window.DayFlowNative && typeof window.DayFlowNative[name] === 'function');
  }

  function nativeCall(name, args) {
    if (!nativeHas(name)) return undefined;
    try {
      return window.DayFlowNative[name].apply(window.DayFlowNative, args || []);
    } catch (e) {
      return undefined;
    }
  }

  function reminderBody(evt) {
    return [U.fmtTime(evt.start), evt.location, evt.category].filter(Boolean).join(' · ');
  }

  function buildReminderList() {
    const now = Date.now();
    const horizon = now + REMINDER_HORIZON_DAYS * 24 * 60 * 60 * 1000;
    const list = [];

    store.events.forEach((e) => {
      if (e.reminder === null || e.reminder === undefined || e.done) return;
      const startAt = U.fromYmd(e.date).getTime() + e.start * 60000;
      const triggerAt = startAt - e.reminder * 60000;
      if (triggerAt < now - 60000 || triggerAt > horizon) return;
      list.push({
        key: 'evt:' + e.id + ':' + e.reminder,
        eventId: e.id,
        title: e.title,
        body: reminderBody(e),
        triggerAt
      });
    });

    const focus = store.focus;
    if (focus && focus.endAt > now - 60000) {
      list.push({
        key: 'focus:' + focus.id,
        eventId: focus.eventId || null,
        title: '专注结束',
        body: focus.title + ' · 该休息一下了',
        triggerAt: focus.endAt
      });
    }

    return list.sort((a, b) => a.triggerAt - b.triggerAt).slice(0, 400);
  }

  function syncReminders() {
    const list = buildReminderList();
    if (nativeHas('syncReminders')) {
      nativeCall('syncReminders', [JSON.stringify(list)]);
      webReminderTimers.forEach((timer) => clearTimeout(timer));
      webReminderTimers.length = 0;
    } else {
      scheduleWebReminders(list);
    }
    updateNotificationButtons();
  }

  function scheduleWebReminders(list) {
    webReminderTimers.forEach((timer) => clearTimeout(timer));
    webReminderTimers.length = 0;
    const now = Date.now();
    list.forEach((item) => {
      const delay = item.triggerAt - now;
      if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
      if (firedReminders.has(item.key)) return;
      webReminderTimers.push(setTimeout(() => fireWebReminder(item), delay));
    });
  }

  function fireWebReminder(item) {
    firedReminders.add(item.key);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const note = new Notification('时序 · ' + item.title, { body: item.body, tag: item.key });
        note.onclick = () => {
          window.focus();
          note.close();
        };
        return;
      } catch (e) {
        /* WebView 内可能不支持，回退页面提示 */
      }
    }

    showToast('提醒：' + item.title + (item.body ? ' · ' + item.body : ''), '查看', () => {
      if (!item.eventId) return;
      const evt = store.get(item.eventId);
      if (!evt) return;
      setDate(evt.date, true);
      openEditor(evt.id);
    });
  }

  function notificationGranted() {
    if (nativeHas('hasNotificationPermission')) {
      return !!nativeCall('hasNotificationPermission');
    }
    return 'Notification' in window && Notification.permission === 'granted';
  }

  function updateNotificationButtons() {
    if (!els.notificationPermissionBtn) return;
    const granted = notificationGranted();
    els.notificationPermissionBtn.textContent = granted ? '通知已开启' : '允许通知';
    els.notificationPermissionBtn.classList.toggle('is-on', granted);
    els.notificationPermissionBtn.disabled = granted;

    if (!els.exactAlarmBtn) return;
    let needs = false;
    if (nativeHas('needsExactAlarm')) {
      try {
        needs = !!window.DayFlowNative.needsExactAlarm();
      } catch (e) {
        needs = false;
      }
    }
    els.exactAlarmBtn.hidden = !needs;
    updateFeatureCounts();
  }

  function requestNotifications() {
    if (nativeHas('requestNotificationPermission')) {
      nativeCall('requestNotificationPermission');
      showToast('已请求通知权限');
      setTimeout(() => {
        updateNotificationButtons();
        syncReminders();
      }, 900);
      return;
    }

    if (!('Notification' in window)) {
      showToast('这个浏览器不支持系统通知');
      return;
    }

    Notification.requestPermission().then((permission) => {
      updateNotificationButtons();
      if (permission === 'granted') {
        showToast('通知已开启');
        syncReminders();
      } else {
        showToast('通知没有开启，仍会在页面内提醒');
      }
    }).catch(() => {
      showToast('无法请求通知权限');
    });
  }

  function openExactAlarmSettings() {
    if (nativeHas('openExactAlarmSettings')) {
      nativeCall('openExactAlarmSettings');
      return;
    }
    showToast('当前设备不需要单独设置');
  }

  /* ------------------------------------------------------------------ */
  /* 延河课堂 DDL（PC 巡检数据源）                                        */
  /* ------------------------------------------------------------------ */

  var YANHEKT_DEFAULT = 'https://ddltuisong.vercel.app/ddls.json';

  function yanhektUrl() {
    return (localStorage.getItem('dayflow.yanhektUrl') || '').trim() || YANHEKT_DEFAULT;
  }

  /* 数据源地址 → 真正请求的 URL。以 .json 结尾原样用（云端静态文件），否则补 /api/data（局域网 PC 服务）。 */
  function yanhektEndpoint(base) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    return /\.json$/i.test(b) ? b : b + '/api/data';
  }

  function syncYanhekt(silent) {
    const base = yanhektUrl();
    if (!base) {
      if (!silent) showToast('先填延河数据源地址（云端 ddls.json 或 http://电脑IP:8765）');
      return;
    }
    if (!silent) showToast('正在拉延河 DDL…');
    fetch(yanhektEndpoint(base))
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((d) => {
        const buckets = ['missed', 'urgent', 'week', 'later', 'unknown'];
        const exists = {};
        store.ddls.forEach((x) => { exists[x.date + '|' + x.title] = true; });

        const rowTitle = (row) =>
          String(row.course || '').trim() + ' · ' + String(row.title || '').trim();
        const rowWhen = (row) => {
          const end = String(row.end || '');
          if (end.length < 16) return null;
          return { date: end.slice(0, 10), time: end.slice(11, 16) };
        };

        let added = 0, doneN = 0;
        buckets.forEach((bk) => {
          (d[bk] || []).forEach((row) => {
            if (row.done || row.no_need) return;
            const when = rowWhen(row), title = rowTitle(row);
            if (!when || !title || title === ' · ') return;
            if (exists[when.date + '|' + title]) return;
            exists[when.date + '|' + title] = true;
            // note = 作业链接 + 老师说明（desc），详情拆开显示
            const url = row.url || '';
            const desc = String(row.desc || '').trim();
            const note = desc ? (url ? url + '\n\n' + desc : desc) : url;
            store.addDdl({
              title, date: when.date, time: when.time,
              note: note, source: 'yanhekt'
            });
            added++;
          });
        });

        const doneKeys = {};
        const collectDone = (row) => {
          const when = rowWhen(row);
          if (when) doneKeys[when.date + '|' + rowTitle(row)] = true;
        };
        (d.done || []).forEach(collectDone);
        buckets.forEach((bk) => {
          (d[bk] || []).forEach((row) => {
            if (row.done || row.no_need) collectDone(row);
          });
        });
        store.ddls.forEach((x) => {
          if (!x.done && doneKeys[x.date + '|' + x.title]) {
            store.updateDdl(x.id, { done: true });
            doneN++;
          }
        });

        (d.closes || []).forEach((c) => {
          if (c.passed) return;
          const date = String(c.end || '').slice(0, 10);
          const title = '关课 · ' + String(c.title || '').trim();
          if (!date || !title || exists[date + '|' + title]) return;
          exists[date + '|' + title] = true;
          store.addDdl({ title, date, time: '23:59', note: '课程关闭', source: 'yanhekt' });
          added++;
        });

        if (added || doneN) {
          renderDdlList();
          syncReminders();
          syncWidget();
          try { if (window.DayFlowNative && window.DayFlowNative.publishSync) window.DayFlowNative.publishSync(); } catch (e) { /* 桥不在就算了 */ }
        }
        if (!silent || added || doneN) {
          showToast(added === 0 && doneN === 0
            ? '延河没有新任务'
            : '延河 DDL：新增 ' + added + ' 条' + (doneN ? '，勾掉 ' + doneN + ' 条已交' : ''));
        }
      })
      .catch((e) => {
        if (!silent) showToast('连不上延河服务：' + (e && e.message ? e.message : '网络错误'));
      });
  }

  function maybeSyncYanhekt() {
    try {
      if (!yanhektUrl()) return;
      const last = +(localStorage.getItem('dayflow.yanhektLast') || 0);
      if (Date.now() - last < 6 * 3600e3) return;
      localStorage.setItem('dayflow.yanhektLast', String(Date.now()));
      syncYanhekt(true);
    } catch (e) { /* 静默 */ }
  }

  /* ------------------------------------------------------------------ */
  /* 每日简报                                                           */
  /* ------------------------------------------------------------------ */

  function maybeDailyBrief() {
    const today = U.todayStr();
    if (store.getBriefDate() === today) return;
    const now = new Date();
    if (now.getHours() < 5) return;
    store.setBriefDate(today);
    const res = agent.dailyBrief({ now });
    store.addMessage({
      role: 'agent',
      text: res.text,
      items: [],
      tip: res.tip,
      mode: 'local',
      kind: 'brief',
      ts: Date.now()
    });
  }

  /* ------------------------------------------------------------------ */
  /* 专注                                                               */
  /* ------------------------------------------------------------------ */

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return U.pad(Math.floor(total / 60)) + ':' + U.pad(total % 60);
  }

  function openFocusDialog() {
    if (store.focus) {
      updateFocusBar();
      showToast('专注进行中，先结束当前专注');
      return;
    }

    els.focusTitle.value = '';
    const today = U.todayStr();
    const events = store.byDate(today).filter((e) => !e.done);
    els.focusEvent.innerHTML = '<option value="">不关联</option>' +
      events.map((e) => '<option value="' + e.id + '">' +
        U.escapeHTML(U.fmtTime(e.start) + ' ' + e.title) + '</option>').join('');

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const current = events.find((e) => e.start <= nowMin && e.end > nowMin);
    if (current) {
      els.focusEvent.value = current.id;
      els.focusTitle.value = current.title;
    }
    els.focusDuration.value = '25';

    if (!els.focusDialog.open) els.focusDialog.showModal();
    setTimeout(() => els.focusTitle.focus(), 60);
  }

  function startFocus(e) {
    e.preventDefault();
    if (store.focus) {
      els.focusDialog.close();
      return;
    }

    const minutes = U.clamp(Number(els.focusDuration.value) || 25, 1, 480);
    const eventId = els.focusEvent.value || null;
    const evt = eventId ? store.get(eventId) : null;
    const title = els.focusTitle.value.trim() || (evt ? evt.title : '专注');
    const startAt = Date.now();

    store.focus = {
      id: U.uid('focus_'),
      title,
      eventId,
      plannedMinutes: minutes,
      startAt,
      endAt: startAt + minutes * 60000
    };
    store.saveFocus();
    els.focusDialog.close();
    state.date = U.todayStr();
    renderAll({ scroll: false });
    updateFocusBar();
    showToast('专注 ' + minutes + ' 分钟，开始');
  }

  function resumeFocus() {
    if (!store.focus) {
      updateFocusBar();
      return;
    }
    if (store.focus.endAt <= Date.now()) {
      completeFocus(true);
      return;
    }
    updateFocusBar();
  }

  function updateFocusBar() {
    const focus = store.focus;
    if (!focus) {
      els.focusBar.hidden = true;
      els.focusBtn.classList.remove('is-running');
      els.focusBtn.title = '开始专注';
      return;
    }

    const remain = focus.endAt - Date.now();
    if (remain <= 0) {
      completeFocus(true);
      return;
    }

    els.focusBar.hidden = false;
    els.focusBarTitle.textContent = focus.title;
    els.focusClock.textContent = formatCountdown(remain);
    els.focusBtn.classList.add('is-running');
    els.focusBtn.title = '专注中 · ' + formatCountdown(remain);
  }

  function completeFocus(auto) {
    const focus = store.focus;
    if (!focus) return;

    const elapsed = Math.max(1, Math.round((Date.now() - focus.startAt) / 60000));
    const actual = U.clamp(elapsed, 1, focus.plannedMinutes);

    store.focus = null;
    store.focusLog.push({
      id: focus.id,
      date: U.ymd(new Date(focus.startAt)),
      title: focus.title,
      eventId: focus.eventId,
      plannedMinutes: focus.plannedMinutes,
      actualMinutes: actual,
      completedAt: Date.now()
    });
    store.saveFocusLog();

    if (focus.eventId) {
      const evt = store.get(focus.eventId);
      if (evt) {
        evt.actualMinutes = (evt.actualMinutes || 0) + actual;
        store.save();
      }
    }
    store.saveFocus();

    renderTimeline(false);
    renderStats();
    updateFocusBar();
    showToast((auto ? '专注完成' : '专注结束') + ' · 实际 ' + U.fmtDuration(actual));
  }

  function stopFocus() {
    if (!store.focus) return;
    if (!window.confirm('结束这次专注吗？已专注的时间会被记录。')) return;
    completeFocus(false);
  }

  /* ------------------------------------------------------------------ */
  /* 任务收件箱                                                         */
  /* ------------------------------------------------------------------ */

  const SCHEDULE_WINDOWS = [
    [9 * 60, 12 * 60],
    [13 * 60, 18 * 60],
    [19 * 60, 21 * 60 + 30]
  ];

  function updateTaskCounts() {
    if (!els.tasksCount) return;
    const count = store.inboxTasks().length;
    els.tasksCount.textContent = String(count);
    els.tasksCount.hidden = count === 0;
    const label = count ? '任务收件箱，' + count + ' 项待安排' : '任务收件箱';
    els.tasksBtn.title = count ? '任务收件箱 · ' + count + ' 项待安排' : '任务收件箱';
    els.tasksBtn.setAttribute('aria-label', label);
    updateFeatureCounts();
  }

  function openTasksDialog() {
    renderTasks();
    resetSchedulePreview();
    if (!els.tasksDialog.open) els.tasksDialog.showModal();
    setTimeout(() => els.taskTitle.focus(), 60);
  }

  function renderTasks() {
    const tasks = store.inboxTasks();
    const today = U.todayStr();

    els.taskEmpty.hidden = tasks.length > 0;
    els.taskList.hidden = tasks.length === 0;
    els.taskList.innerHTML = tasks.map((t) => {
      const meta = [
        '<span>' + t.priority + '优先</span>',
        '<span>预计 ' + U.fmtDuration(t.estimate) + '</span>'
      ];
      if (t.due) {
        meta.push('<span class="task-due' + (t.due < today ? ' overdue' : '') + '">' +
          (t.due < today ? '已逾期 ' : '截止 ') + U.monthDayCN(t.due) + '</span>');
      }
      if (t.category) meta.push('<span>' + t.category + '</span>');

      return '<div class="task-item" data-task="' + t.id + '">' +
        '<div class="task-main">' +
          '<div class="task-item-title">' + U.escapeHTML(t.title) + '</div>' +
          '<div class="task-meta">' + meta.join('') + '</div>' +
        '</div>' +
        '<button type="button" class="task-remove" data-remove-task="' + t.id + '" aria-label="删除任务">×</button>' +
        '</div>';
    }).join('');

    updateTaskCounts();
  }

  function submitTask(e) {
    e.preventDefault();
    const title = els.taskTitle.value.trim();
    if (!title) {
      els.taskTitle.focus();
      return;
    }

    store.addTask({
      title,
      estimate: Number(els.taskEstimate.value) || 60,
      priority: els.taskPriority.value,
      due: els.taskDue.value || null,
      category: agent.detectCategory(title) || '其他',
      note: ''
    });

    els.taskTitle.value = '';
    els.taskDue.value = '';
    els.taskEstimate.value = '60';
    els.taskPriority.value = '中';
    resetSchedulePreview();
    renderTasks();
    els.taskTitle.focus();
    showToast('已加入收件箱');
  }

  function removeTask(id) {
    const task = store.getTask(id);
    if (!task) return;
    store.removeTask(id);
    resetSchedulePreview();
    renderTasks();
    showToast('已删除「' + task.title + '」');
  }

  function resetSchedulePreview() {
    state.scheduleProposals = [];
    if (els.schedulePreview) {
      els.schedulePreview.hidden = true;
      els.schedulePreview.innerHTML = '';
    }
    if (els.applyScheduleBtn) {
      els.applyScheduleBtn.hidden = true;
      els.applyScheduleBtn.textContent = '应用排程';
    }
  }

  function freeSlotsForDate(date, minStart) {
    const busy = store.byDate(date)
      .map((e) => [Math.max(0, e.start), Math.min(1440, e.end)])
      .filter(([s, e]) => e > minStart)
      .sort((a, b) => a[0] - b[0]);
    const slots = [];

    SCHEDULE_WINDOWS.forEach((win) => {
      let cursor = Math.ceil(Math.max(win[0], minStart) / 5) * 5;
      const limit = win[1];
      if (cursor >= limit) return;

      busy.forEach(([bs, be]) => {
        if (be <= cursor || bs >= limit) return;
        if (bs > cursor) slots.push([cursor, Math.min(bs, limit)]);
        if (be > cursor) cursor = be;
      });

      if (cursor < limit) slots.push([cursor, limit]);
    });

    return slots
      .map(([s, e]) => [Math.ceil(s / 5) * 5, e])
      .filter(([s, e]) => e - s >= 15)
      .sort((a, b) => a[0] - b[0]);
  }

  function buildScheduleProposals(days) {
    const now = new Date();
    const today = U.ymd(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const tasks = store.inboxTasks();
    const daySlots = [];

    for (let i = 0; i < days; i++) {
      const date = U.addDays(today, i);
      const minStart = date === today ? Math.max(nowMin + 10, 0) : 0;
      daySlots.push({ date, slots: freeSlotsForDate(date, minStart) });
    }

    return tasks.map((task) => {
      let placed = null;
      for (const day of daySlots) {
        if (task.due && day.date > task.due) break;
        for (const slot of day.slots) {
          const start = Math.ceil(slot[0] / 5) * 5;
          if (start + task.estimate <= slot[1]) {
            placed = { date: day.date, start, end: start + task.estimate };
            slot[0] = start + task.estimate;
            break;
          }
        }
        if (placed) break;
      }
      return { task, placed };
    });
  }

  function shortDateLabel(date) {
    return U.relativeCN(date) || (() => {
      const d = U.fromYmd(date);
      return (d.getMonth() + 1) + '/' + d.getDate();
    })();
  }

  function previewSchedule() {
    if (!store.inboxTasks().length) {
      resetSchedulePreview();
      showToast('收件箱里还没有任务');
      return;
    }

    const days = U.clamp(Number(els.scheduleRange.value) || 3, 1, 7);
    const proposals = buildScheduleProposals(days);
    state.scheduleProposals = proposals;
    const scheduled = proposals.filter((p) => p.placed);

    els.schedulePreview.hidden = false;
    els.schedulePreview.innerHTML =
      '<p class="preview-head">' +
        (scheduled.length
          ? '计划排入 ' + scheduled.length + ' 个任务，避开已有日程与午休。'
          : '当前范围内没有足够空档。') +
      '</p>' +
      proposals.map((p) => {
        if (!p.placed) {
          return '<div class="proposal-row unscheduled">' +
            '<span class="proposal-time">未排入</span>' +
            '<span class="proposal-title">' + U.escapeHTML(p.task.title) + '</span>' +
            '</div>';
        }
        return '<div class="proposal-row">' +
          '<span class="proposal-time">' + shortDateLabel(p.placed.date) + ' ' +
            U.fmtTime(p.placed.start) + '–' + U.fmtTime(p.placed.end) + '</span>' +
          '<span class="proposal-title">' + U.escapeHTML(p.task.title) + '</span>' +
          '</div>';
      }).join('');

    els.applyScheduleBtn.hidden = scheduled.length === 0;
    els.applyScheduleBtn.textContent = '应用排程（' + scheduled.length + '）';

    if (!scheduled.length) showToast('没有找到足够空档，试试更长的范围');
  }

  function applySchedule() {
    const scheduled = state.scheduleProposals.filter((p) => p.placed);
    if (!scheduled.length) {
      showToast('没有可应用的排程');
      return;
    }

    let firstDate = null;
    scheduled.forEach((p) => {
      store.scheduleTask(p.task.id, {
        title: p.task.title,
        date: p.placed.date,
        start: p.placed.start,
        end: p.placed.end,
        category: p.task.category,
        location: '',
        note: '',
        reminder: 10
      });
      if (!firstDate) firstDate = p.placed.date;
    });

    resetSchedulePreview();
    renderTasks();
    if (firstDate) state.date = firstDate;
    renderAll({ scroll: false });
    els.tasksDialog.close();
    showToast('已排入 ' + scheduled.length + ' 个任务', '查看', () => {
      if (firstDate) setDate(firstDate, true);
    });
  }

  /* ------------------------------------------------------------------ */
  /* DDL 截止事项                                                       */
  /* ------------------------------------------------------------------ */

  function ddlDueMs(date, time) {
    const d = U.fromYmd(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(),
      Math.floor(time / 60), time % 60, 0, 0).getTime();
  }

  function ddlCountdown(date, time) {
    const diff = ddlDueMs(date, time) - Date.now();
    const mins = Math.max(0, Math.floor(Math.abs(diff) / 60000));
    let text;
    if (mins < 60) text = mins + ' 分钟';
    else if (mins < 1440) text = Math.floor(mins / 60) + ' 小时';
    else text = Math.floor(mins / 1440) + ' 天';
    return diff >= 0 ? '还有 ' + text : '已逾期 ' + text;
  }

  function ddlRiskFor(ddl) {
    if (!ddl || !ddl.estimate || ddl.done) return null;
    const today = U.todayStr();
    if (U.diffDays(ddl.date, today) > 14) return null;
    if (ddlDueMs(ddl.date, ddl.time) <= Date.now()) return null;
    let available = 0;
    let date = today;
    let guard = 0;
    const now = new Date();
    while (date <= ddl.date && guard < 15) {
      const minStart = date === today
        ? now.getHours() * 60 + now.getMinutes() + 10
        : 0;
      freeSlotsForDate(date, Math.max(0, minStart)).forEach(([s, e]) => {
        const end = date === ddl.date ? Math.min(e, ddl.time) : e;
        if (end > s) available += end - s;
      });
      date = U.addDays(date, 1);
      guard++;
    }
    return { available, estimate: ddl.estimate, short: available < ddl.estimate };
  }

  function updateDdlCounts() {
    if (!els.ddlCount) return;
    const pending = store.pendingDdls();
    els.ddlCount.textContent = String(pending.length);
    els.ddlCount.hidden = pending.length === 0;
    const overdue = pending.some((d) => ddlDueMs(d.date, d.time) < Date.now());
    els.ddlBtn.classList.toggle('is-overdue', overdue);
    const label = pending.length
      ? 'DDL 截止事项，' + pending.length + ' 项未完成' + (overdue ? '，有逾期' : '')
      : 'DDL 截止事项';
    els.ddlBtn.title = label;
    els.ddlBtn.setAttribute('aria-label', label);
    updateFeatureCounts();
  }

  function ddlGroupOf(ddl, today, sunday) {
    if (ddl.done) return 'done';
    const due = ddlDueMs(ddl.date, ddl.time);
    if (due < Date.now()) return 'overdue';
    if (ddl.date === today) return 'today';
    if (ddl.date <= sunday) return 'week';
    return 'later';
  }

  function ddlRowHtml(ddl, group) {
    const title = U.escapeHTML(ddl.title);
    const overdue = !ddl.done && ddlDueMs(ddl.date, ddl.time) < Date.now();
    const state = ddl.done
      ? '已完成'
      : ddlCountdown(ddl.date, ddl.time);
    const rel = U.relativeCN(ddl.date);
    const when = (rel || (U.monthDayCN(ddl.date) + ' ' + U.weekdayCN(ddl.date))) + ' ' + U.fmtTime(ddl.time);
    const risk = ddlRiskFor(ddl);
    const estimate = risk
      ? '<span class="ddl-row-estimate">预计 ' + U.fmtDurationShort(risk.estimate) + '</span>'
      : '';
    const riskTag = risk && risk.short
      ? '<span class="ddl-row-risk" title="截止前可投入 ' + U.fmtDurationShort(risk.available) + '">空档不足</span>'
      : '';
    return '<div class="ddl-row' + (ddl.done ? ' done' : '') + (group === 'overdue' ? ' overdue' : '') + '">' +
      '<button type="button" class="ddl-row-check" data-ddl-check="' + ddl.id + '"' +
        ' aria-pressed="' + (ddl.done ? 'true' : 'false') + '"' +
        ' aria-label="' + (ddl.done ? '标记未完成' : '标记完成') + '：' + title + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>' +
      '</button>' +
      '<button type="button" class="ddl-row-main" data-ddl-open="' + ddl.id + '" aria-label="编辑 DDL：' + title + '">' +
        '<span class="ddl-row-title">' + title + '</span>' +
        '<span class="ddl-row-meta">' +
          '<span class="ddl-row-when">' + when + '</span>' +
          '<span class="ddl-row-state' + (overdue ? ' overdue' : '') + '">' + state + '</span>' +
          estimate + riskTag +
        '</span>' +
      '</button>' +
    '</div>';
  }

  function renderDdlList() {
    if (!els.ddlList) return;
    const now = new Date();
    const today = U.todayStr();
    const sunday = U.addDays(U.mondayOf(today), 6);
    const groups = [
      { id: 'overdue', label: '已逾期' },
      { id: 'today', label: '今天' },
      { id: 'week', label: '本周' },
      { id: 'later', label: '以后' },
      { id: 'done', label: '已完成' }
    ];

    const list = store.ddls.slice().sort((a, b) =>
      a.date.localeCompare(b.date) || a.time - b.time ||
      String(a.title).localeCompare(String(b.title)));

    const pending = list.filter((d) => !d.done);
    const overdue = pending.filter((d) => ddlDueMs(d.date, d.time) < now.getTime()).length;
    const risks = pending.filter((d) => {
      const risk = ddlRiskFor(d);
      return risk && risk.short;
    }).length;
    els.ddlListSummary.innerHTML = pending.length
      ? '未完成 ' + pending.length + ' 项' +
        (overdue ? ' · ' + overdue + ' 项已逾期' : '') +
        (risks ? ' · <span class="ddl-risk">' + risks + ' 个空档不足</span>' : '')
      : (list.length ? '全部完成' : '还没有 DDL');

    const empty = list.length === 0;
    els.ddlList.hidden = empty;
    els.ddlListEmpty.hidden = !empty;
    if (empty) {
      els.ddlList.innerHTML = '';
      return;
    }

    const parts = [];
    groups.forEach((group) => {
      let rows = list.filter((d) => ddlGroupOf(d, today, sunday) === group.id);
      if (!rows.length) return;
      if (group.id === 'done') rows = rows.slice().reverse();
      parts.push('<section class="ddl-group">' +
        '<h4 class="ddl-group-title">' + group.label + ' <em>' + rows.length + '</em></h4>' +
        rows.map((d) => ddlRowHtml(d, group.id)).join('') +
        '</section>');
    });
    els.ddlList.innerHTML = parts.join('');
  }

  function openDdlListDialog() {
    renderDdlList();
    if (!els.ddlListDialog.open) els.ddlListDialog.showModal();
    setTimeout(() => {
      const first = els.ddlList.querySelector('[data-ddl-open]');
      if (first) first.focus();
      else els.ddlNewBtn.focus();
    }, 60);
  }

  function newDdlFromList() {
    els.ddlListDialog.close();
    openDdlDialog(null);
  }

  function openDdlFromList(id) {
    const ddl = store.getDdl(id);
    if (!ddl) return;
    els.ddlListDialog.close();
    if (ddl.date !== state.date) state.date = ddl.date;
    renderAll({ scroll: false });
    openDdlDialog(id);
  }

  function toggleDdlFromList(id) {
    const active = document.activeElement && document.activeElement.getAttribute('data-ddl-check');
    store.toggleDdlDone(id);
    if (active) {
      const btn = els.ddlList.querySelector('[data-ddl-check="' + active + '"]');
      if (btn) btn.focus();
    }
  }

  function renderDdlHint() {
    if (!els.ddlHint) return;
    const date = els.ddlDate.value;
    const time = U.parseTimeStr(els.ddlTime.value);
    const estimate = Number(els.ddlEstimate.value) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time)) {
      els.ddlHint.textContent = '时间轴上会显示一条红色截止线和右端旗标。';
      els.ddlHint.classList.remove('overdue');
      return;
    }
    const overdue = ddlDueMs(date, time) < Date.now();
    let text = U.monthDayCN(date) + ' ' + U.weekdayCN(date) + ' ' +
      U.fmtTime(time) + ' 截止 · ' + ddlCountdown(date, time);
    const risk = ddlRiskFor({ date, time, estimate, done: false });
    if (risk) {
      text += risk.short
        ? ' · 空档不足（可投入 ' + U.fmtDurationShort(risk.available) + '）'
        : ' · 截止前可投入 ' + U.fmtDurationShort(risk.available);
    }
    els.ddlHint.textContent = text;
    els.ddlHint.classList.toggle('overdue', overdue || !!(risk && risk.short));
  }

  function openDdlDialog(id) {
    if (els.ddlListDialog && els.ddlListDialog.open) els.ddlListDialog.close();
    const ddl = id ? store.getDdl(id) : null;
    state.editingDdlId = ddl ? ddl.id : null;

    els.ddlDialogTitle.textContent = ddl ? '编辑 DDL' : '添加 DDL';
    els.ddlTitle.value = ddl ? ddl.title : '';
    els.ddlDate.value = ddl ? ddl.date : (state.date || U.todayStr());
    els.ddlTime.value = U.fmtTime(ddl ? ddl.time : 23 * 60 + 59);
    els.ddlEstimate.value = String(ddl ? (ddl.estimate || 0) : 0);
    els.ddlNote.value = ddl ? ddl.note : '';
    els.ddlDone.checked = ddl ? ddl.done : false;
    els.ddlDelete.hidden = !ddl;
    els.ddlDoneWrap.hidden = !ddl;
    els.ddlSubmit.textContent = ddl ? '保存' : '添加';
    renderDdlHint();

    if (!els.ddlDialog.open) els.ddlDialog.showModal();
    setTimeout(() => els.ddlTitle.focus(), 60);
  }

  function submitDdl(e) {
    e.preventDefault();
    const title = els.ddlTitle.value.trim();
    if (!title) {
      els.ddlTitle.focus();
      return;
    }
    const date = els.ddlDate.value;
    const time = U.parseTimeStr(els.ddlTime.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      els.ddlDate.focus();
      return;
    }
    if (!Number.isFinite(time)) {
      els.ddlTime.focus();
      return;
    }

    const editing = !!state.editingDdlId;
    let ddl;
    if (editing) {
      ddl = store.updateDdl(state.editingDdlId, {
        title,
        date,
        time,
        estimate: Number(els.ddlEstimate.value) || 0,
        note: els.ddlNote.value.trim(),
        done: els.ddlDone.checked
      });
    } else {
      ddl = store.addDdl({
        title,
        date,
        time,
        estimate: Number(els.ddlEstimate.value) || 0,
        note: els.ddlNote.value.trim()
      });
    }

    state.editingDdlId = null;
    els.ddlDialog.close();
    if (ddl) {
      if (ddl.date !== state.date) state.date = ddl.date;
      renderAll({ scroll: false });
      showToast(editing ? 'DDL 已更新' : '已添加 DDL「' + ddl.title + '」');
    }
  }

  function deleteDdl() {
    const id = state.editingDdlId;
    if (!id) return;
    const ddl = store.getDdl(id);
    if (!ddl) return;
    if (!window.confirm('删除 DDL「' + ddl.title + '」？')) return;
    store.removeDdl(id);
    state.editingDdlId = null;
    els.ddlDialog.close();
    renderAll({ scroll: false });
    showToast('已删除 DDL');
  }

  /* ------------------------------------------------------------------ */
  /* 顺延未完成                                                         */
  /* ------------------------------------------------------------------ */

  function findRolloverSlot(date, desiredStart, duration, reserved, excludeIds) {
    const busy = store.byDate(date)
      .filter((e) => !excludeIds.has(e.id))
      .map((e) => [e.start, e.end]);
    (reserved.get(date) || []).forEach((slot) => busy.push(slot));
    busy.sort((a, b) => a[0] - b[0]);

    const isFree = (start) => {
      const end = start + duration;
      if (start < 7 * 60 || end > 23 * 60) return false;
      return !busy.some(([s, e]) => start < e && s < end);
    };

    if (desiredStart != null && isFree(desiredStart)) return desiredStart;

    const now = new Date();
    const today = U.ymd(now);
    const minStart = date === today
      ? Math.max(7 * 60, now.getHours() * 60 + now.getMinutes() + 10)
      : 7 * 60;
    for (const [winStart, winEnd] of SCHEDULE_WINDOWS) {
      let cursor = Math.max(winStart, minStart);
      if (cursor + duration > winEnd) continue;
      busy.forEach(([s, e]) => {
        if (e <= cursor || s >= winEnd) return;
        if (s > cursor && s - cursor >= duration) return;
        if (e > cursor) cursor = e;
      });
      if (cursor + duration <= winEnd && isFree(cursor)) return cursor;
    }
    return null;
  }

  function renderRolloverList() {
    const evts = store.byDate(state.date).filter((e) => !e.done);
    els.rolloverEmpty.hidden = evts.length > 0;
    els.rolloverList.innerHTML = evts.map((e) =>
      '<label class="rollover-row">' +
        '<input type="checkbox" data-rollover-id="' + e.id + '" checked>' +
        '<span class="rollover-time">' + U.fmtTime(e.start) + '–' + U.fmtTime(e.end) + '</span>' +
        '<span class="rollover-title">' + U.escapeHTML(e.title) + '</span>' +
      '</label>').join('');
    els.rolloverApply.disabled = evts.length === 0;
  }

  function openRolloverDialog() {
    const evts = store.byDate(state.date).filter((e) => !e.done);
    if (!evts.length) {
      showToast('这一天没有未完成的日程');
      return;
    }
    renderRolloverList();
    const rel = U.relativeCN(state.date);
    els.rolloverSub.textContent = '把「' + (rel || U.monthDayCN(state.date)) +
      '」没做完的日程挪到明天或下一个空档。';
    if (!els.rolloverDialog.open) els.rolloverDialog.showModal();
  }

  function applyRollover() {
    const ids = new Set(Array.from(els.rolloverList.querySelectorAll('input:checked'))
      .map((input) => input.dataset.rolloverId));
    if (!ids.size) {
      showToast('先勾选要顺延的日程');
      return;
    }
    const mode = els.rolloverTarget.value === 'next' ? 'next' : 'tomorrow';
    const selected = store.byDate(state.date)
      .filter((e) => ids.has(e.id))
      .sort((a, b) => a.start - b.start);
    if (!selected.length) return;

    const before = JSON.parse(JSON.stringify(store.events));
    const reserved = new Map();
    const today = U.todayStr();
    let moved = 0;

    selected.forEach((evt) => {
      const duration = evt.end - evt.start;
      let targetDate = '';
      let start = null;

      if (mode === 'tomorrow') {
        targetDate = U.addDays(state.date, 1);
        start = findRolloverSlot(targetDate, evt.start, duration, reserved, ids);
      } else {
        const scanStart = state.date >= today ? state.date : today;
        for (let i = 0; i < 15; i++) {
          const date = U.addDays(scanStart, i);
          const slot = findRolloverSlot(date, null, duration, reserved, ids);
          if (slot != null) {
            targetDate = date;
            start = slot;
            break;
          }
        }
      }

      if (start == null || !targetDate) return;
      if (!reserved.has(targetDate)) reserved.set(targetDate, []);
      reserved.get(targetDate).push([start, start + duration]);
      evt.date = targetDate;
      evt.start = start;
      evt.end = start + duration;
      moved++;
    });

    if (!moved) {
      showToast('没有找到合适的空档');
      return;
    }

    store.save();
    state.selectedId = null;
    els.rolloverDialog.close();
    renderAll({ scroll: false });
    showToast('已顺延 ' + moved + ' 项日程', '撤销', () => {
      store.setEvents(before);
      renderAll({ scroll: false });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 课表节次                                                           */
  /* ------------------------------------------------------------------ */

  function defaultPeriods() {
    return DEFAULT_PERIODS.map((p) => ({ start: p.start, end: p.end }));
  }

  function updateTimetableStatus() {
    if (!els.timetableBtn) return;
    const count = store.getTimetable().length;
    els.timetableBtn.textContent = count ? count + ' 节 · 修改' : '未设置 · 去设置';
    updateFeatureCounts();
  }

  function openTimetableEditor() {
    const saved = store.getTimetable();
    state.periodDraft = saved.length ? saved : [];
    if (els.semesterStart) {
      els.semesterStart.value = store.getSemesterStart() || '';
    }
    if (els.semesterHint) {
      els.semesterHint.textContent = store.getSemesterStart()
        ? '「1-16 周」会从这天所在周的周一开始计算。'
        : '还没设置：带「1-16 周」的课会先提示你补填，避免从今天错位。';
    }
    if (els.periodHint) {
      els.periodHint.textContent = saved.length
        ? '第几节从 1 开始。改完点「保存课表」才会生效。'
        : '还没有设置节次。点「常用 12 节模板」快速开始，或手动添加；保存后才会生效。';
    }
    renderPeriodDraft();
    if (!els.timetableDialog.open) els.timetableDialog.showModal();
  }

  function renderPeriodDraft() {
    if (!els.periodList) return;
    const list = state.periodDraft;
    els.periodEmpty.hidden = list.length > 0;
    els.periodList.hidden = list.length === 0;
    els.periodList.innerHTML = list.map((p, i) =>
      '<div class="period-row">' +
        '<span class="period-index">第 ' + (i + 1) + ' 节</span>' +
        '<input type="time" step="300" data-period-start="' + i + '" value="' + U.fmtTime(p.start) + '" aria-label="第' + (i + 1) + '节开始时间">' +
        '<span class="period-dash">–</span>' +
        '<input type="time" step="300" data-period-end="' + i + '" value="' + U.fmtTime(p.end) + '" aria-label="第' + (i + 1) + '节结束时间">' +
        '<span class="period-dur">' + U.fmtDurationShort(p.end - p.start) + '</span>' +
        '<button type="button" class="period-remove" data-remove-period="' + i + '" aria-label="删除第' + (i + 1) + '节">×</button>' +
      '</div>'
    ).join('');
  }

  function syncPeriodDraftFromInputs() {
    const rows = Array.from(els.periodList.querySelectorAll('.period-row'));
    rows.forEach((row, i) => {
      const start = U.parseTimeStr(row.querySelector('[data-period-start]').value);
      const end = U.parseTimeStr(row.querySelector('[data-period-end]').value);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        state.periodDraft[i] = { start, end };
      }
    });
  }

  function refreshPeriodDurations() {
    Array.from(els.periodList.querySelectorAll('.period-row')).forEach((row) => {
      const start = U.parseTimeStr(row.querySelector('[data-period-start]').value);
      const end = U.parseTimeStr(row.querySelector('[data-period-end]').value);
      const label = row.querySelector('.period-dur');
      if (!label) return;
      label.textContent = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? U.fmtDurationShort(end - start)
        : '—';
    });
  }

  function addPeriod() {
    syncPeriodDraftFromInputs();
    if (state.periodDraft.length >= 24) {
      showToast('最多设置 24 节');
      return;
    }
    const last = state.periodDraft[state.periodDraft.length - 1];
    let start = last ? last.end + 5 : 8 * 60;
    if (start >= 1440) start = 8 * 60;
    let end = Math.min(1440, start + 45);
    if (end <= start) {
      start = 8 * 60;
      end = 9 * 60;
    }
    state.periodDraft.push({ start, end });
    renderPeriodDraft();
    requestAnimationFrame(() => {
      els.periodList.scrollTop = els.periodList.scrollHeight;
    });
  }

  function removePeriod(index) {
    syncPeriodDraftFromInputs();
    if (!Number.isInteger(index) || index < 0 || index >= state.periodDraft.length) return;
    state.periodDraft.splice(index, 1);
    renderPeriodDraft();
  }

  function fillPeriodTemplate() {
    state.periodDraft = defaultPeriods();
    renderPeriodDraft();
  }

  function clearPeriods() {
    state.periodDraft = [];
    renderPeriodDraft();
  }

  function savePeriods() {
    const rows = Array.from(els.periodList.querySelectorAll('.period-row'));
    const list = [];
    for (let i = 0; i < rows.length; i++) {
      const start = U.parseTimeStr(rows[i].querySelector('[data-period-start]').value);
      const end = U.parseTimeStr(rows[i].querySelector('[data-period-end]').value);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        showToast('第 ' + (i + 1) + ' 节的时间没填完整');
        return;
      }
      if (end <= start) {
        showToast('第 ' + (i + 1) + ' 节的结束时间要晚于开始时间');
        return;
      }
      list.push({ start, end });
    }

    store.saveTimetable(list);
    store.saveSemesterStart(els.semesterStart ? els.semesterStart.value : '');
    els.timetableDialog.close();
    updateTimetableStatus();
    showToast(list.length ? '课表已保存 · ' + list.length + ' 节' : '课表已清空');
  }

  /* ------------------------------------------------------------------ */
  /* 设置                                                               */
  /* ------------------------------------------------------------------ */

  function openSettings() {
    const s = store.settings;
    const radio = els.settingsForm.querySelector('input[name="mode"][value="' + s.mode + '"]');
    if (radio) radio.checked = true;
    els.sBaseUrl.value = s.baseUrl || '';
    els.sModel.value = s.model || '';
    els.sApiKey.value = s.apiKey || '';
    els.sYanhektUrl.value = localStorage.getItem('dayflow.yanhektUrl') || '';
    els.sApiKey.classList.remove('is-revealed');
    updateTimetableStatus();
    renderSnapshots();
    renderTemplates();
    els.revealApiKey.classList.remove('is-revealed');
    els.revealApiKey.setAttribute('aria-label', '显示 API Key');
    els.revealApiKey.title = '显示 API Key';
    toggleLlmFields();
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
  }

  function toggleLlmFields() {
    const mode = els.settingsForm.querySelector('input[name="mode"]:checked');
    els.llmFields.classList.toggle('disabled', !mode || mode.value !== 'llm');
  }

  function saveSettings(e) {
    e.preventDefault();
    const modeEl = els.settingsForm.querySelector('input[name="mode"]:checked');
    const mode = modeEl ? modeEl.value : 'local';
    const baseUrl = els.sBaseUrl.value.trim();
    const model = els.sModel.value.trim();
    const apiKey = els.sApiKey.value.trim();

    if (mode === 'llm' && !baseUrl) {
      showToast('使用大模型需要填写接口地址');
      els.sBaseUrl.focus();
      return;
    }

    store.settings = { mode, baseUrl, model, apiKey };
    store.saveSettings();
    localStorage.setItem('dayflow.yanhektUrl', els.sYanhektUrl.value.trim());
    updateModePill();
    els.settingsDialog.close();
    showToast(mode === 'llm' ? '已切换到大模型智能体' : '已切换到本地智能体');
  }

  function snapshotLabel(snapshot) {
    const d = new Date(snapshot.at || Date.now());
    return snapshot.date + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  function renderSnapshots() {
    const list = store.getSnapshots();
    const items = list.map((snapshot, index) => ({ snapshot, index })).reverse();
    els.snapshotSelect.innerHTML = items.length
      ? items.map((item) =>
        '<option value="' + item.index + '">' + snapshotLabel(item.snapshot) + '</option>').join('')
      : '<option value="">暂无快照</option>';
    els.snapshotSelect.disabled = items.length === 0;
    els.restoreSnapshotBtn.disabled = items.length === 0;
  }

  function renderTemplates() {
    const list = store.listTemplates();
    els.templateList.innerHTML = list.length
      ? list.map((tpl) =>
        '<div class="template-row">' +
          '<span class="template-name">' + U.escapeHTML(tpl.name) + '</span>' +
          '<span class="template-meta">' + tpl.items.length + ' 项</span>' +
          '<button type="button" class="text-btn accent" data-template-apply="' + tpl.id + '">套用</button>' +
          '<button type="button" class="cat-remove" data-template-remove="' + tpl.id + '" aria-label="删除模板">×</button>' +
        '</div>').join('')
      : '<div class="template-empty">还没有模板。把今天保存为模板，之后可以一键套用。</div>';
  }

  function saveTodayAsTemplate() {
    const evts = store.byDate(state.date);
    if (!evts.length) {
      showToast('这一天还没有日程');
      return;
    }
    els.templateNameInput.value = U.monthDayCN(state.date);
    if (!els.templateSaveDialog.open) els.templateSaveDialog.showModal();
    setTimeout(() => {
      els.templateNameInput.focus();
      els.templateNameInput.select();
    }, 60);
  }

  function submitTemplate(e) {
    e.preventDefault();
    const name = els.templateNameInput.value.trim();
    if (!name) {
      els.templateNameInput.focus();
      return;
    }
    const evts = store.byDate(state.date);
    if (!evts.length) {
      els.templateSaveDialog.close();
      showToast('这一天还没有日程');
      return;
    }
    store.addTemplate({
      name,
      items: evts.map((evt) => ({
        title: evt.title,
        start: evt.start,
        end: evt.end,
        category: evt.category,
        location: evt.location,
        note: evt.note,
        reminder: evt.reminder
      }))
    });
    els.templateSaveDialog.close();
    renderTemplates();
    showToast('已保存模板「' + name + '」');
  }

  function applyTemplate(id) {
    const tpl = store.listTemplates().find((t) => t.id === id);
    if (!tpl) return;
    const items = tpl.items.map((item) => Object.assign({}, item, {
      date: state.date,
      done: false,
      source: 'template'
    }));
    const added = store.addMany(items);
    if (els.settingsDialog.open) els.settingsDialog.close();
    renderAll({ scroll: false });
    showToast(added.length
      ? '已套用「' + tpl.name + '」，新增 ' + added.length + ' 项'
      : '模板里的日程当前已存在');
  }

  function removeTemplate(id) {
    const tpl = store.listTemplates().find((t) => t.id === id);
    if (!tpl) return;
    if (!window.confirm('删除模板「' + tpl.name + '」？')) return;
    store.removeTemplate(id);
    renderTemplates();
    showToast('已删除模板');
  }

  function openCategoryDialog() {
    state.categoryDraft = store.listCategories().map((cat) => ({
      original: cat.name,
      name: cat.name,
      color: cat.color
    }));
    renderCategoryDraft();
    els.newCategoryName.value = '';
    els.newCategoryColor.value = '#1d5fbf';
    if (els.settingsDialog.open) els.settingsDialog.close();
    if (!els.categoryDialog.open) els.categoryDialog.showModal();
    setTimeout(() => els.newCategoryName.focus(), 60);
  }

  function renderCategoryDraft() {
    els.categoryList.innerHTML = state.categoryDraft
      .map((cat, index) => ({ cat, index }))
      .filter((item) => !item.cat.removed)
      .map(({ cat, index }) => {
        const usage = cat.original ? store.categoryUsage(cat.original) : 0;
        return '<div class="category-row" data-cat-index="' + index + '">' +
          '<input type="color" value="' + cat.color + '" data-cat-color aria-label="分类颜色">' +
          '<input class="cat-name" maxlength="12" value="' + U.escapeHTML(cat.name) + '" data-cat-name aria-label="分类名称">' +
          '<span class="cat-count">' + (usage ? usage + ' 项' : '未使用') + '</span>' +
          '<button type="button" class="cat-remove" data-cat-remove aria-label="删除分类">×</button>' +
        '</div>';
      }).join('');
  }

  function syncCategoryDraftFromDom() {
    els.categoryList.querySelectorAll('.category-row').forEach((row) => {
      const index = Number(row.dataset.catIndex);
      const cat = state.categoryDraft[index];
      if (!cat) return;
      cat.name = row.querySelector('[data-cat-name]').value.trim();
      cat.color = row.querySelector('[data-cat-color]').value;
    });
  }

  function addCategoryDraft() {
    syncCategoryDraftFromDom();
    const name = els.newCategoryName.value.trim();
    const color = els.newCategoryColor.value || '#1d5fbf';
    if (!name) {
      els.newCategoryName.focus();
      return;
    }
    if (state.categoryDraft.some((cat) => !cat.removed && cat.name === name)) {
      showToast('已经有同名分类');
      return;
    }
    state.categoryDraft.push({ original: null, name, color });
    renderCategoryDraft();
    els.newCategoryName.value = '';
  }

  function saveCategoryDraft() {
    const rows = Array.from(els.categoryList.querySelectorAll('.category-row'));
    const next = rows.map((row) => {
      const index = Number(row.dataset.catIndex);
      const current = state.categoryDraft[index];
      return {
        original: current ? current.original : null,
        name: row.querySelector('[data-cat-name]').value.trim().slice(0, 12),
        color: row.querySelector('[data-cat-color]').value
      };
    });

    if (next.some((row) => !row.name)) {
      showToast('分类名称不能为空');
      return;
    }
    const names = next.map((row) => row.name);
    if (new Set(names).size !== names.length) {
      showToast('分类名称不能重复');
      return;
    }

    const nextOriginals = new Set(next.filter((row) => row.original).map((row) => row.original));
    for (const cat of state.categoryDraft) {
      if (cat.original && !nextOriginals.has(cat.original) && store.categoryUsage(cat.original) > 0) {
        cat.removed = false;
        renderCategoryDraft();
        showToast('「' + cat.original + '」正在使用，不能删除');
        return;
      }
    }

    for (const cat of state.categoryDraft) {
      if (cat.original && !nextOriginals.has(cat.original)) store.removeCategory(cat.original);
    }

    for (const row of next) {
      if (row.original && row.name !== row.original) {
        const result = store.renameCategory(row.original, row.name);
        if (!result.ok) {
          showToast(result.error === 'exists' ? '分类名重复' : '分类更新失败');
          return;
        }
      }
    }

    for (const row of next) {
      if (!row.original) {
        const result = store.addCategory(row.name, row.color);
        if (!result.ok) {
          showToast(result.error === 'exists' ? '分类名重复' : '分类添加失败');
          return;
        }
      } else {
        store.updateCategoryColor(row.name, row.color);
      }
    }

    buildCategoryOptions();
    els.categoryDialog.close();
    renderAll({ scroll: false });
    showToast('分类已更新');
  }

  function downloadFile(filename, mime, content) {
    if (window.DayFlowNative && typeof window.DayFlowNative.exportFile === 'function') {
      try {
        window.DayFlowNative.exportFile(filename, mime, content);
        showToast('请选择保存位置');
        return;
      } catch (err) {
        /* 原生桥不可用时回退浏览器下载 */
      }
    }
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('已导出 ' + filename);
  }

  function exportAllData() {
    downloadFile(
      'dayflow-backup-' + U.todayStr() + '.json',
      'application/json',
      JSON.stringify(store.exportAll(), null, 2)
    );
  }

  function importAllData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!window.confirm('导入会覆盖当前全部日程、任务、DDL、分类和模板，确定吗？')) return;
        store.importAll(data);
        buildCategoryOptions();
        renderSnapshots();
        renderTemplates();
        updateModePill();
        updateTaskCounts();
        updateDdlCounts();
        updateTimetableStatus();
        state.date = U.todayStr();
        renderAll({ scroll: false });
        els.settingsDialog.close();
        showToast('已导入全部数据');
      } catch (err) {
        showToast('导入失败：' + (err && err.message ? err.message : '文件格式不对'));
      } finally {
        els.importAllInput.value = '';
      }
    };
    reader.readAsText(file);
  }

  function restoreSnapshot() {
    const index = Number(els.snapshotSelect.value);
    const list = store.getSnapshots();
    const snapshot = list[index];
    if (!snapshot) {
      showToast('没有可恢复的快照');
      return;
    }
    if (!window.confirm('恢复 ' + snapshotLabel(snapshot) + ' 的快照？当前数据会被覆盖。')) return;
    store.restoreSnapshot(index);
    buildCategoryOptions();
    renderSnapshots();
    renderTemplates();
    updateModePill();
    updateTaskCounts();
    updateDdlCounts();
    updateTimetableStatus();
    state.date = U.todayStr();
    renderAll({ scroll: false });
    els.settingsDialog.close();
    showToast('已恢复快照');
  }

  function updateModePill() {
    const s = store.settings;
    if (s.mode === 'llm') {
      els.agentMode.textContent = s.model || '大模型';
      els.modePill.classList.add('is-llm');
      els.modePill.title = (s.baseUrl || '') + (s.model ? ' · ' + s.model : '');
    } else {
      els.agentMode.textContent = '本地';
      els.modePill.classList.remove('is-llm');
      els.modePill.title = '离线中文解析引擎';
    }
  }

  /* ------------------------------------------------------------------ */
  /* 导出 ICS                                                           */
  /* ------------------------------------------------------------------ */

  function icsDate(date, minutes) {
    const d = U.fromYmd(date);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return d.getFullYear() + U.pad(d.getMonth() + 1) + U.pad(d.getDate()) + 'T' + U.pad(h) + U.pad(m) + '00';
  }

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function exportIcs() {
    if (!store.events.length) {
      showToast('还没有日程可以导出');
      return;
    }
    const stamp = icsDate(U.todayStr(), new Date().getHours() * 60 + new Date().getMinutes());
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DayFlow//Time Management//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:时序 DayFlow'
    ];

    store.events.forEach((e) => {
      const end = Math.min(e.end, 1439);
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + e.id + '@dayflow.local',
        'DTSTAMP:' + stamp,
        'DTSTART:' + icsDate(e.date, e.start),
        'DTEND:' + icsDate(e.date, end),
        'SUMMARY:' + icsEscape(e.title),
        e.location ? 'LOCATION:' + icsEscape(e.location) : '',
        (e.note || e.category) ? 'DESCRIPTION:' + icsEscape((e.category ? '[' + e.category + '] ' : '') + e.note) : '',
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    });

    lines.push('END:VCALENDAR');
    const content = lines.filter(Boolean).join('\r\n');
    const filename = 'dayflow-' + U.todayStr() + '.ics';

    if (window.DayFlowNative && typeof window.DayFlowNative.exportFile === 'function') {
      try {
        window.DayFlowNative.exportFile(filename, 'text/calendar', content);
        showToast('请选择保存位置');
        return;
      } catch (err) {
        /* 原生桥不可用时回退浏览器下载 */
      }
    }

    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('已导出 ' + store.events.length + ' 项日程');
  }

  /* ------------------------------------------------------------------ */
  /* ICS 导入                                                           */
  /* ------------------------------------------------------------------ */

  function icsUnescape(value) {
    return String(value || '')
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  function parseIcsDateTime(value, params) {
    const raw = String(value || '').trim();
    const allDay = /VALUE=DATE/i.test(params || '') || /^\d{8}$/.test(raw);
    let m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      const second = Number(m[6] || 0);
      if (m[7]) {
        const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
        return {
          date: U.ymd(local),
          start: local.getHours() * 60 + local.getMinutes(),
          allDay: false
        };
      }
      return {
        date: year + '-' + U.pad(month) + '-' + U.pad(day),
        start: hour * 60 + minute,
        allDay: false
      };
    }
    m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return { date: m[1] + '-' + m[2] + '-' + m[3], start: 9 * 60, allDay: true };
    return null;
  }

  function expandIcsRecurrence(startDate, rule) {
    const parts = {};
    String(rule || '').split(';').forEach((piece) => {
      const i = piece.indexOf('=');
      if (i > 0) parts[piece.slice(0, i).toUpperCase()] = piece.slice(i + 1);
    });
    const freq = String(parts.FREQ || '').toUpperCase();
    const interval = Math.max(1, Number(parts.INTERVAL) || 1);
    const count = Number(parts.COUNT) || 0;
    let until = null;
    if (parts.UNTIL) {
      const u = parseIcsDateTime(parts.UNTIL, '');
      if (u) until = u.date;
    }
    const weekdays = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const byDays = String(parts.BYDAY || '')
      .split(',')
      .map((day) => weekdays[day.slice(-2).toUpperCase()])
      .filter((day) => day != null);
    if (freq === 'WEEKLY' && !byDays.length) byDays.push(U.weekdayOf(startDate));

    const dates = [];
    const maxDate = until || U.addDays(startDate, 365);
    const cursor = U.fromYmd(startDate);
    let guard = 0;
    while (guard < 800 && dates.length < (count || 120)) {
      const date = U.ymd(cursor);
      if (date > maxDate) break;
      if (freq === 'DAILY') {
        if (U.diffDays(date, startDate) % interval === 0) dates.push(date);
      } else if (freq === 'WEEKLY') {
        const weekDiff = Math.floor(U.diffDays(date, startDate) / 7);
        if (byDays.indexOf(cursor.getDay()) > -1 && weekDiff % interval === 0) dates.push(date);
      } else {
        break;
      }
      cursor.setDate(cursor.getDate() + 1);
      guard++;
    }
    return dates.length ? dates : [startDate];
  }

  function parseIcs(text) {
    const unfolded = String(text || '')
      .replace(/\r\n[ \t]/g, '')
      .replace(/\n[ \t]/g, '')
      .replace(/\r/g, '');
    const out = [];
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
    for (const block of blocks) {
      const body = block.split('END:VEVENT')[0];
      const props = {};
      body.split('\n').forEach((line) => {
        const index = line.indexOf(':');
        if (index < 0) return;
        const head = line.slice(0, index);
        const value = line.slice(index + 1);
        const parts = head.split(';');
        const key = parts.shift().toUpperCase();
        props[key] = { value, params: parts.join(';') };
      });
      if (!props.DTSTART) continue;
      if (props.STATUS && String(props.STATUS.value).toUpperCase() === 'CANCELLED') continue;
      const startInfo = parseIcsDateTime(props.DTSTART.value, props.DTSTART.params);
      if (!startInfo) continue;
      const endInfo = props.DTEND ? parseIcsDateTime(props.DTEND.value, props.DTEND.params) : null;
      let end = endInfo ? endInfo.start : startInfo.start + 60;
      if (end <= startInfo.start) end = Math.min(1440, startInfo.start + 60);
      const title = icsUnescape(props.SUMMARY ? props.SUMMARY.value : '') || '未命名日程';
      const location = icsUnescape(props.LOCATION ? props.LOCATION.value : '');
      let note = icsUnescape(props.DESCRIPTION ? props.DESCRIPTION.value : '');
      if (startInfo.allDay) note = (note ? note + ' · ' : '') + '全天事件';

      const freqMatch = props.RRULE ? String(props.RRULE.value).match(/FREQ=([^;]+)/i) : null;
      const freq = freqMatch ? freqMatch[1].toUpperCase() : '';
      if (props.RRULE && freq !== 'DAILY' && freq !== 'WEEKLY') {
        note = (note ? note + ' · ' : '') + '重复规则未展开，仅导入首次';
      }
      const dates = props.RRULE ? expandIcsRecurrence(startInfo.date, props.RRULE.value) : [startInfo.date];
      const category = agent.detectCategory(title) || '其他';

      dates.forEach((date) => {
        out.push({
          title,
          date,
          start: startInfo.start,
          end,
          category,
          location,
          note,
          reminder: 10,
          source: 'ics'
        });
      });
      if (out.length >= 500) break;
    }
    return out.slice(0, 500);
  }

  function importIcsFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const events = parseIcs(reader.result);
      if (!events.length) {
        showToast('没有找到可导入的日程');
        els.importIcsInput.value = '';
        return;
      }
      const before = JSON.parse(JSON.stringify(store.events));
      const added = store.addMany(events);
      renderAll({ scroll: false });
      els.settingsDialog.close();
      showToast(added.length ? '已导入 ' + added.length + ' 项日程' : '这些日程已经存在',
        added.length ? '撤销' : null,
        added.length ? () => {
          store.setEvents(before);
          renderAll({ scroll: false });
        } : null);
      els.importIcsInput.value = '';
    };
    reader.readAsText(file);
  }


  let toastTimer = null;

  function showToast(text, actionLabel, action) {
    els.toast.innerHTML = '<span>' + U.escapeHTML(text) + '</span>';
    if (actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => {
        action();
        hideToast();
      });
      els.toast.appendChild(btn);
    }
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2400);
  }

  function hideToast() {
    els.toast.classList.remove('show');
    clearTimeout(toastTimer);
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                           */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    els.composer.addEventListener('submit', (e) => {
      e.preventDefault();
      send(els.chatInput.value);
    });

    els.quickAddForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = els.quickAddInput.value.trim();
      if (!text) {
        els.quickAddInput.focus();
        return;
      }
      if (state.busy) {
        showToast('Agent 正在处理上一条，稍等一下');
        return;
      }
      els.quickAddInput.value = '';
      showToast('交给 Agent 解析…');
      send(text);
    });

    els.chatInput.addEventListener('input', () => {
      autoGrow();
      updateSendState();
    });

    els.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(els.chatInput.value);
      }
    });

    els.suggestions.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-say]');
      if (!chip) return;
      send(chip.dataset.say);
    });

    els.chat.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-event]');
      if (!btn) return;
      const evt = store.get(btn.dataset.event);
      if (!evt) {
        showToast('这项日程已经被删除了');
        return;
      }
      if (evt.date !== state.date) state.date = evt.date;
      setMobileView('calendar', true);
      renderAll({ scroll: false });
      openEditor(evt.id);
    });

    els.clearChat.addEventListener('click', () => {
      if (!window.confirm('清空对话记录？日程不会受影响。')) return;
      store.resetChat();
      store.messages.push(welcomeMessage(false));
      store.saveMessages();
      state.pendingImages = [];
      renderAttachments();
      updateSendState();
      renderChat();
    });

    els.editModeBtn.addEventListener('click', () => {
      setEditMode(!state.editMode);
    });

    els.attachBtn.addEventListener('click', () => {
      if (window.DayFlowNative && typeof window.DayFlowNative.pickImage === 'function') {
        try {
          window.DayFlowNative.pickImage();
          return;
        } catch (err) {
          /* 原生桥接不可用时回退到 WebView file input */
        }
      }
      els.imageInput.click();
    });

    els.imageInput.addEventListener('change', () => {
      const files = Array.from(els.imageInput.files || []);
      els.imageInput.value = '';
      addImages(files);
    });

    els.attachments.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-image]');
      if (!btn) return;
      const idx = Number(btn.dataset.removeImage);
      if (Number.isInteger(idx) && idx >= 0) {
        state.pendingImages.splice(idx, 1);
        renderAttachments();
        updateSendState();
      }
    });

    document.addEventListener('paste', (e) => {
      if (document.querySelector('dialog[open]')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (!files.length) return;
      e.preventDefault();
      addImages(files);
    });

    const agentPanel = document.querySelector('.agent');
    if (agentPanel) {
      let dragDepth = 0;
      const hasFileDrag = (e) => {
        const dt = e.dataTransfer;
        return !!dt && Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1;
      };
      agentPanel.addEventListener('dragenter', (e) => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        dragDepth++;
        agentPanel.classList.add('dragging-file');
      });
      agentPanel.addEventListener('dragover', (e) => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      agentPanel.addEventListener('dragleave', (e) => {
        if (!hasFileDrag(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) agentPanel.classList.remove('dragging-file');
      });
      agentPanel.addEventListener('drop', (e) => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        dragDepth = 0;
        agentPanel.classList.remove('dragging-file');
        addImages(e.dataTransfer.files);
      });
    }

    els.blocks.addEventListener('pointerdown', onTimelinePointerDown);
    els.timeline.addEventListener('click', onTimelineClick);
    els.timeline.addEventListener('keydown', onTimelineKeyDown);

    els.prevDay.addEventListener('click', () => shiftDate(-1));
    els.nextDay.addEventListener('click', () => shiftDate(1));
    els.prevWeek.addEventListener('click', () => shiftDate(-7));
    els.nextWeek.addEventListener('click', () => shiftDate(7));
    els.todayBtn.addEventListener('click', () => setDate(U.todayStr(), true));
    els.newBtn.addEventListener('click', () => openCreateDialog(null));
    els.exportBtn.addEventListener('click', () => {
      if (els.settingsDialog.open) els.settingsDialog.close();
      exportIcs();
    });
    els.exportAllBtn.addEventListener('click', exportAllData);
    els.importAllBtn.addEventListener('click', () => els.importAllInput.click());
    els.importIcsBtn.addEventListener('click', () => els.importIcsInput.click());
    els.importAllInput.addEventListener('change', () => {
      importAllData(els.importAllInput.files && els.importAllInput.files[0]);
    });
    els.importIcsInput.addEventListener('change', () => {
      importIcsFile(els.importIcsInput.files && els.importIcsInput.files[0]);
    });
    els.restoreSnapshotBtn.addEventListener('click', restoreSnapshot);
    els.categoryBtn.addEventListener('click', openCategoryDialog);
    if (els.cleanSampleBtn) {
      els.cleanSampleBtn.addEventListener('click', () => {
        if (!window.confirm('删掉自带的演示日程？\n\n晨间规划 / 产品周会 / 午餐 · 楼下小馆 / 需求评审 / 和设计师对齐改稿 / 健身 · 力量训练 / 阅读 · 《深度工作》 / 季度复盘\n\n你自己的日程和课程都不动。')) return;
        const n = store.removeSamples();
        renderAll({ scroll: false });
        els.cleanSampleBtn.textContent = n ? '已清掉 ' + n + ' 条' : '没有样例';
        setTimeout(() => { els.cleanSampleBtn.textContent = '清掉样例'; }, 2600);
      });
    }
    if (els.dedupeBtn) {
      els.dedupeBtn.addEventListener('click', () => {
        const n = store.dedupeFuzzy();
        renderAll({ scroll: false });
        updateDdlCounts();
        // 设置弹窗在顶层，Toast 会被它挡住，结果直接写在按钮上来
        const label = n ? '已并掉 ' + n + ' 条' : '没有发现重复';
        els.dedupeBtn.textContent = label;
        showToast(n ? '并掉了 ' + n + ' 条重复' : '没有发现重复');
        setTimeout(() => { els.dedupeBtn.textContent = '检查重复'; }, 2600);
      });
    }
    els.addCategoryBtn.addEventListener('click', addCategoryDraft);
    els.saveCategoriesBtn.addEventListener('click', saveCategoryDraft);
    els.categoryList.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-cat-remove]');
      if (!remove) return;
      const row = remove.closest('[data-cat-index]');
      if (!row) return;
      syncCategoryDraftFromDom();
      const cat = state.categoryDraft[Number(row.dataset.catIndex)];
      if (cat) cat.removed = true;
      renderCategoryDraft();
    });
    els.categoryDialog.addEventListener('click', (e) => {
      if (e.target === els.categoryDialog) els.categoryDialog.close();
    });
    els.saveTemplateBtn.addEventListener('click', saveTodayAsTemplate);
    els.templateSaveForm.addEventListener('submit', submitTemplate);
    els.templateSaveDialog.addEventListener('click', (e) => {
      if (e.target === els.templateSaveDialog) els.templateSaveDialog.close();
    });
    els.templateList.addEventListener('click', (e) => {
      const apply = e.target.closest('[data-template-apply]');
      if (apply) {
        applyTemplate(apply.dataset.templateApply);
        return;
      }
      const remove = e.target.closest('[data-template-remove]');
      if (remove) removeTemplate(remove.dataset.templateRemove);
    });

    els.monthBtn.addEventListener('click', openMonthDialog);
    els.dateTitle.addEventListener('click', openMonthDialog);
    els.dateTitle.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openMonthDialog();
    });
    els.monthPrev.addEventListener('click', () => shiftMonth(-1));
    els.monthNext.addEventListener('click', () => shiftMonth(1));
    els.monthToday.addEventListener('click', () => {
      els.monthDialog.close();
      setDate(U.todayStr(), true);
    });
    els.monthGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-month-date]');
      if (btn) pickMonthDate(btn.dataset.monthDate);
    });
    els.monthDialog.addEventListener('click', (e) => {
      if (e.target === els.monthDialog) els.monthDialog.close();
    });

    els.viewStandard.addEventListener('click', () => setCompact(false));
    els.viewCompact.addEventListener('click', () => setCompact(true));
    els.viewDay.addEventListener('click', () => setView('day'));
    els.viewWeek.addEventListener('click', () => setView('week'));
    els.weekGrid.addEventListener('click', onWeekClick);

    els.foldBtn.addEventListener('click', () => setFolded(!state.folded));
    els.tabCalendar.addEventListener('click', () => setMobileView('calendar'));
    els.tabFeatures.addEventListener('click', () => setMobileView('features'));
    els.tabAgent.addEventListener('click', () => setMobileView('agent'));
    els.featuresBtn.addEventListener('click', () => {
      setMobileView(state.mobileView === 'features' ? 'calendar' : 'features');
    });
    els.featuresBackBtn.addEventListener('click', () => setMobileView('calendar'));
    els.featuresPage.addEventListener('click', (e) => {
      const card = e.target.closest('[data-feature]');
      if (card) openFeature(card.dataset.feature);
    });
    els.themeBtn.addEventListener('click', openThemeDialog);
    els.themeSettingsBtn.addEventListener('click', () => {
      if (els.settingsDialog.open) els.settingsDialog.close();
      openThemeDialog();
    });
    els.themeGrid.addEventListener('click', (e) => {
      const option = e.target.closest('[data-theme]');
      if (option) applyTheme(option.dataset.theme, true);
    });
    els.themeDialog.addEventListener('click', (e) => {
      if (e.target === els.themeDialog) els.themeDialog.close();
    });

    els.selectionBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sel]');
      if (!btn) return;
      handleSelectionAction(btn.dataset.sel);
    });

    els.durationRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-duration]');
      if (!btn) return;
      applyDuration(btn.dataset.duration);
    });
    els.fStart.addEventListener('input', syncDurationChips);
    els.fEnd.addEventListener('input', syncDurationChips);

    els.agentFab.addEventListener('click', () => {
      const panel = document.querySelector('.agent');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        try { els.chatInput.focus({ preventScroll: true }); } catch (e) { els.chatInput.focus(); }
      }, 420);
    });

    if ('IntersectionObserver' in window) {
      const panel = document.querySelector('.agent');
      if (panel) {
        const observer = new IntersectionObserver((entries) => {
          els.agentFab.classList.toggle('is-hidden', entries[0].isIntersecting);
        }, { threshold: 0.12 });
        observer.observe(panel);
      }
    }

    els.weekstrip.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-date]');
      if (!btn) return;
      setDate(btn.dataset.date, false);
    });

    els.eventForm.addEventListener('submit', submitEvent);
    els.deleteEvent.addEventListener('click', deleteCurrent);

    els.eventDialog.addEventListener('click', (e) => {
      if (e.target === els.eventDialog) els.eventDialog.close();
    });

    els.settingsBtn.addEventListener('click', openSettings);
    els.settingsForm.addEventListener('submit', saveSettings);

    els.focusBtn.addEventListener('click', openFocusDialog);
    els.focusForm.addEventListener('submit', startFocus);
    els.focusStop.addEventListener('click', stopFocus);
    els.focusDialog.addEventListener('click', (e) => {
      if (e.target === els.focusDialog) els.focusDialog.close();
    });

    els.tasksBtn.addEventListener('click', openTasksDialog);
    els.taskForm.addEventListener('submit', submitTask);
    els.taskList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-task]');
      if (!btn) return;
      removeTask(btn.dataset.removeTask);
    });
    els.autoScheduleBtn.addEventListener('click', previewSchedule);
    els.applyScheduleBtn.addEventListener('click', applySchedule);
    els.scheduleRange.addEventListener('change', resetSchedulePreview);
    els.tasksDialog.addEventListener('click', (e) => {
      if (e.target === els.tasksDialog) els.tasksDialog.close();
    });

    els.ddlBtn.addEventListener('click', openDdlListDialog);
    els.ddlNewBtn.addEventListener('click', newDdlFromList);
    els.ddlList.addEventListener('click', (e) => {
      const check = e.target.closest('[data-ddl-check]');
      if (check) {
        toggleDdlFromList(check.dataset.ddlCheck);
        return;
      }
      const open = e.target.closest('[data-ddl-open]');
      if (open) openDdlFromList(open.dataset.ddlOpen);
    });
    els.ddlForm.addEventListener('submit', submitDdl);
    els.ddlDelete.addEventListener('click', deleteDdl);
    els.ddlDate.addEventListener('input', renderDdlHint);
    els.ddlTime.addEventListener('input', renderDdlHint);
    els.ddlEstimate.addEventListener('change', renderDdlHint);
    els.ddlDialog.addEventListener('click', (e) => {
      if (e.target === els.ddlDialog) els.ddlDialog.close();
    });
    els.ddlListDialog.addEventListener('click', (e) => {
      if (e.target === els.ddlListDialog) els.ddlListDialog.close();
    });

    els.rolloverBtn.addEventListener('click', openRolloverDialog);
    els.rolloverApply.addEventListener('click', applyRollover);
    els.rolloverDialog.addEventListener('click', (e) => {
      if (e.target === els.rolloverDialog) els.rolloverDialog.close();
    });

    els.deleteSeries.addEventListener('click', deleteWholeSeries);
    els.seriesScope.addEventListener('change', (e) => {
      if (e.target.name !== 'editScope') return;
      const series = e.target.value === 'series';
      els.fDate.disabled = series;
      if (series && state.editingId) {
        const evt = store.get(state.editingId);
        if (evt) els.fDate.value = evt.date;
      }
    });

    els.notificationPermissionBtn.addEventListener('click', requestNotifications);
    if (els.batteryBtn) {
      els.batteryBtn.addEventListener('click', () => {
        if (nativeHas('openAppSettings')) window.DayFlowNative.openAppSettings();
        else showToast('网页版没有系统设置，手机 App 里才能改');
      });
    }
    if (els.exactAlarmBtn2) {
      els.exactAlarmBtn2.addEventListener('click', () => {
        if (nativeHas('openExactAlarmSettings')) window.DayFlowNative.openExactAlarmSettings();
        else showToast('网页版不需要设置');
      });
    }
    els.exactAlarmBtn.addEventListener('click', openExactAlarmSettings);

    els.timetableBtn.addEventListener('click', () => {
      if (els.settingsDialog.open) els.settingsDialog.close();
      openTimetableEditor();
    });
    els.yanhektSyncBtn.addEventListener('click', () => {
      localStorage.setItem('dayflow.yanhektUrl', els.sYanhektUrl.value.trim());
      syncYanhekt(false);
    });
    els.periodAdd.addEventListener('click', addPeriod);
    els.periodTemplate.addEventListener('click', fillPeriodTemplate);
    els.periodClear.addEventListener('click', clearPeriods);
    els.periodSave.addEventListener('click', savePeriods);
    els.periodList.addEventListener('input', refreshPeriodDurations);
    els.periodList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-period]');
      if (btn) removePeriod(Number(btn.dataset.removePeriod));
    });
    els.timetableDialog.addEventListener('click', (e) => {
      if (e.target === els.timetableDialog) els.timetableDialog.close();
    });

    els.revealApiKey.addEventListener('click', () => {
      const revealed = els.sApiKey.classList.toggle('is-revealed');
      els.revealApiKey.classList.toggle('is-revealed', revealed);
      const label = revealed ? '隐藏 API Key' : '显示 API Key';
      els.revealApiKey.setAttribute('aria-label', label);
      els.revealApiKey.title = label;
    });

    els.settingsForm.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener('change', toggleLlmFields);
    });
    els.settingsDialog.addEventListener('click', (e) => {
      if (e.target === els.settingsDialog) els.settingsDialog.close();
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dlg = btn.closest('dialog');
        if (dlg) dlg.close();
      });
    });

    els.clearAll.addEventListener('click', () => {
      if (!window.confirm('确定清空全部日程吗？此操作不可撤销。')) return;
      store.clearEvents();
      els.settingsDialog.close();
      renderAll({ scroll: false });
      showToast('已清空全部日程');
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]')) return;
      if (document.body.classList.contains('view-features')) return;
      if (e.key === 'ArrowLeft') shiftDate(-1);
      else if (e.key === 'ArrowRight') shiftDate(1);
      else if (e.key === 't' || e.key === 'T') setDate(U.todayStr(), true);
      else if (e.key === 'e' || e.key === 'E') {
        if (state.view === 'week') {
          showToast('周视图不支持拖动，点色块直接编辑');
        } else {
          setEditMode(!state.editMode);
        }
      }
      else if (e.key === 'm' || e.key === 'M') openMonthDialog();
      else if (e.key === 'w' || e.key === 'W') setView('week');
      else if (e.key === 'd' || e.key === 'D') setView('day');
      else if (e.key === '/') {
        e.preventDefault();
        els.chatInput.focus();
      }
    });
  }

  function setDate(date, scroll) {
    state.date = date;
    state.selectedId = null;
    renderAll({ scroll: !!scroll });
  }

  function shiftDate(delta) {
    setDate(U.addDays(state.date, state.view === 'week' ? delta * 7 : delta), false);
  }

  function openEventById(id) {
    if (!id) return false;
    if (!store.events.length) store.load();
    const evt = store.get(id);
    if (!evt) return false;
    setMobileView('calendar', true);
    state.date = evt.date;
    state.selectedId = id;
    renderAll({ scroll: false });
    openEditor(id);
    return true;
  }

  window.__dayflowOpenEvent = openEventById;
  window.__dayflowHandleBack = function () {
    if (document.body.classList.contains('view-features')) {
      setMobileView('calendar');
      return true;
    }
    if (document.body.classList.contains('view-agent')) {
      setMobileView('calendar');
      return true;
    }
    return false;
  };
  window.DayFlow.onAppResume = function () {
    updateNotificationButtons();
    syncReminders();
    updateFocusBar();
    syncWidget();
    const before = store.messages.length;
    maybeDailyBrief();
    if (store.messages.length !== before) renderChat();
    maybeSyncYanhekt();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
