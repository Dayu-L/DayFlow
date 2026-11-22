/* 时序 DayFlow — 内置日程智能体
 * 本地模式：中文规则解析，离线可用
 * 大模型模式：OpenAI 兼容接口，失败自动回退
 */
(function () {
  'use strict';

  const U = window.DayFlow.util;
  const store = window.DayFlow.store;
  const CATEGORIES = window.DayFlow.CATEGORIES;

  const PERIOD_SRC = '凌晨|清晨|早上|早晨|上午|中午|午后|下午|傍晚|晚上|夜里|夜晚|今晚|明晚|今早|明早';
  const PERIOD_RE = new RegExp(PERIOD_SRC, 'g');
  const TIME_BODY = '(?:(?:' + PERIOD_SRC + ')\\s*)?(?:(?:\\d{1,2})|(?:[零一二两三四五六七八九十]{1,2}))\\s*(?:[:：]\\s*\\d{1,2}|点\\s*(?:半|一刻|三刻|\\d{1,2}\\s*分?|[一二三四五六七八九十]{1,2}\\s*分)?|(?<!小)时\\s*(?:半|一刻|三刻|\\d{1,2}\\s*分)?)';
  const COMMA_TIME_SPLIT = new RegExp(',(?=\\s*' + TIME_BODY + ')');
  const COMMA_PERIOD_SPLIT = /,(?=\s*第\s*(?:[0-9一二三四五六七八九十两]+\s*节|[0-9一二三四五六七八九十两]+\s*(?:-|到|至)\s*[0-9一二三四五六七八九十两]+\s*节))/;
  const DATE_HINT_RE = new RegExp('(?:大后天|后天|明天|明日|今天|今日|今晚|明晚|今早|明早|昨天|昨日|前天|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*[日号]|(?:下下|下|本|这)?\\s*(?:个)?\\s*(?:周|星期|礼拜)\\s*[一二三四五六日天1-7]|\\d+\\s*天\\s*(?:以)?后|(?:下|本|这)?\\s*个?\\s*周末)');

  const CN_NUM = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '半': 0.5
  };

  const WEEKDAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 0 };

  /* ------------------------------------------------------------------ */
  /* 文本工具                                                           */
  /* ------------------------------------------------------------------ */

  function normalizeText(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u3000/g, ' ')
      .replace(/[：]/g, ':')
      .replace(/[，、]/g, ',')
      .replace(/[；]/g, ';')
      .replace(/[。]/g, '.')
      .replace(/[－—–~～]/g, '-')
      .replace(/(\d{1,2})\s*-\s*(\d{1,2})(?=\s*[点时])/g, '$1点-$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function cnToNum(s) {
    if (s == null) return NaN;
    const t = String(s).replace(/\s|分/g, '');
    if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    if (t === '半') return 0.5;
    if (Object.prototype.hasOwnProperty.call(CN_NUM, t)) return CN_NUM[t];
    if (t.indexOf('十') > -1) {
      const parts = t.split('十');
      const tens = parts[0] ? (CN_NUM[parts[0]] || 0) : 1;
      const ones = parts[1] ? (CN_NUM[parts[1]] || 0) : 0;
      return tens * 10 + ones;
    }
    return NaN;
  }

  function overlap(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  function maskText(text, spans) {
    const keep = new Array(text.length).fill(true);
    spans.forEach((sp) => {
      const s = Math.max(0, sp[0]);
      const e = Math.min(text.length, sp[1]);
      for (let i = s; i < e; i++) keep[i] = false;
    });
    let out = '';
    for (let i = 0; i < text.length; i++) if (keep[i]) out += text[i];
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 日期                                                               */
  /* ------------------------------------------------------------------ */

  function extractDate(text, now) {
    const today = U.ymd(now);
    let m;

    m = text.match(/(大后天|后天|明天|明日|今天|今日|今晚|明晚|今早|明早|昨天|昨日|前天)/);
    if (m) {
      const offset = {
        '今天': 0, '今日': 0, '今晚': 0, '今早': 0,
        '明天': 1, '明日': 1, '明晚': 1, '明早': 1,
        '后天': 2, '大后天': 3,
        '昨天': -1, '昨日': -1, '前天': -2
      }[m[1]];
      return { date: U.addDays(today, offset), text: m[1], index: m.index };
    }

    m = text.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return { date: U.ymd(new Date(year, month - 1, day)), text: m[0], index: m.index };
      }
    }

    m = text.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (m) {
      const year = m[1] ? Number(m[1]) : now.getFullYear();
      let date = U.ymd(new Date(year, Number(m[2]) - 1, Number(m[3])));
      if (!m[1] && date < today) date = U.ymd(new Date(year + 1, Number(m[2]) - 1, Number(m[3])));
      return { date, text: m[0], index: m.index };
    }

    m = text.match(/(下下|下|本|这)?\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (m) {
      const prefix = m[1] || '';
      const target = WEEKDAY_MAP[m[2]];
      const monday = U.mondayOf(today);
      let weekStart;
      if (prefix === '下下') weekStart = U.addDays(monday, 14);
      else if (prefix === '下') weekStart = U.addDays(monday, 7);
      else weekStart = monday;
      let date = U.addDays(weekStart, target === 0 ? 6 : target - 1);
      if (!prefix) {
        if (date < today) date = U.addDays(date, 7);
      } else if (prefix === '本' || prefix === '这') {
        if (date < today) date = U.addDays(date, 7);
      }
      return { date, text: m[0], index: m.index };
    }

    m = text.match(/(\d+)\s*天\s*(?:以)?后/);
    if (m) return { date: U.addDays(today, Number(m[1])), text: m[0], index: m.index };

    m = text.match(/(下|本|这)?\s*个?\s*周末/);
    if (m) {
      let saturday = U.addDays(U.mondayOf(today), 5);
      if (m[1] === '下') saturday = U.addDays(saturday, 7);
      else if (!m[1] && saturday < today) saturday = U.addDays(saturday, 7);
      return { date: saturday, text: m[0], index: m.index };
    }

    m = text.match(/(下下|下|本|这)\s*个?\s*(?:周|星期|礼拜)(?![一二三四五六日天1-7])/);
    if (m) {
      const monday = U.mondayOf(today);
      const date = m[1] === '下下' ? U.addDays(monday, 14)
        : m[1] === '下' ? U.addDays(monday, 7)
          : monday;
      return { date, text: m[0], index: m.index };
    }

    m = text.match(/下个?月\s*(\d{1,2})\s*[日号]/);
    if (m) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, Number(m[1]));
      return { date: U.ymd(d), text: m[0], index: m.index };
    }

    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 时间                                                               */
  /* ------------------------------------------------------------------ */

  function buildTimeRegex() {
    return new RegExp(
      '(?:(' + PERIOD_SRC + ')\\s*)?' +
      '((?:\\d{1,2})|(?:[零一二两三四五六七八九十]{1,2}))\\s*' +
      '(?:' +
        '[:：]\\s*(\\d{1,2})' +
        '|点\\s*(半|一刻|三刻|\\d{1,2}\\s*分?|[一二三四五六七八九十]{1,2}\\s*分)?(?!点|儿)' +
        '|(?<!小)时\\s*(半|一刻|三刻|\\d{1,2}\\s*分)?' +
      ')',
      'g'
    );
  }

  function applyPeriod(hour, period) {
    if (!period) return hour;
    if (/^(凌晨|早上|早晨|清晨|上午|今早|明早)$/.test(period)) return hour === 12 ? 0 : hour;
    if (/^(中午)$/.test(period)) return hour < 11 ? hour + 12 : hour;
    if (/^(下午|午后|傍晚|晚上|夜里|夜晚|今晚|明晚)$/.test(period)) return hour < 12 ? hour + 12 : hour;
    return hour;
  }

  function parseMinuteSuffix(suffix) {
    if (!suffix) return 0;
    const t = suffix.replace(/\s|分/g, '');
    if (t === '半') return 30;
    if (t === '一刻') return 15;
    if (t === '三刻') return 45;
    const n = cnToNum(t);
    return Number.isFinite(n) ? n : 0;
  }

  function extractTimes(text) {
    const re = buildTimeRegex();
    const times = [];
    const spans = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      let hour = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : cnToNum(m[2]);
      if (!Number.isFinite(hour)) continue;
      let minute = m[3] != null ? parseInt(m[3], 10) : parseMinuteSuffix(m[4] != null ? m[4] : m[5]);
      if (!Number.isFinite(minute) || minute > 59) minute = 0;
      const period = m[1] || null;
      hour = applyPeriod(hour, period);
      if (hour > 23) continue;
      times.push({
        min: hour * 60 + minute,
        period,
        index: m.index,
        end: m.index + m[0].length,
        raw: m[0]
      });
      spans.push([m.index, m.index + m[0].length]);
    }
    return { times, spans };
  }

  function extractRange(text, times) {
    if (!times.length) return null;
    const first = times[0];
    let start = first.min;
    let end = null;

    if (times.length >= 2) {
      const second = times[1];
      end = second.min;
      if (end <= start) {
        if (!second.period && end + 720 <= 1439) end += 720;
        if (end <= start) end = 1439;
      }
    }

    return { start, end };
  }

  /* ------------------------------------------------------------------ */
  /* 时长                                                               */
  /* ------------------------------------------------------------------ */

  function extractDuration(text, timeSpans) {
    const re = /((?:\d+(?:\.\d+)?)|(?:[一二两三四五六七八九十半]{1,3}))\s*(?:个)?\s*(半)?\s*(小时|钟头|分钟|分|h|min)/gi;
    let m;
    let total = 0;
    let found = false;
    const spans = [];
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      const inside = timeSpans.some((sp) => m.index >= sp[0] && m.index < sp[1]);
      if (inside) continue;
      let value = cnToNum(m[1]);
      if (!Number.isFinite(value)) continue;
      if (m[2]) value += 0.5;
      const unit = m[3].toLowerCase();
      let minutes = unit === '分钟' || unit === '分' || unit === 'min' ? value : value * 60;
      if (!Number.isFinite(minutes) || minutes <= 0) continue;
      total += minutes;
      found = true;
      spans.push([m.index, m.index + m[0].length]);
    }
    if (total > 12 * 60) total = 12 * 60;
    return { minutes: found ? Math.round(total) : 0, spans };
  }

  function defaultDuration(title) {
    if (/聚餐|吃饭|午饭|晚饭|早餐|午餐|晚餐|下午茶|咖啡/.test(title)) return 90;
    if (/跑步|拉伸|冥想|午休|小憩|午睡/.test(title)) return 30;
    if (/健身|游泳|打球|瑜伽|训练|骑行/.test(title)) return 60;
    if (/面试|评审|汇报|周会|站会|会议|开会/.test(title)) return 60;
    if (/学习|复习|看书|阅读|作业|写|做|整理|复盘/.test(title)) return 60;
    return 60;
  }

  /** 「1.5 小时后」「30 分钟后」这种相对当前时刻的表达 */
  function extractOffset(text) {
    const m = text.match(/((?:\d+(?:\.\d+)?)|(?:[一二两三四五六七八九十半]{1,3}))\s*(?:个)?\s*(半)?\s*(小时|钟头|分钟|分|h|min)\s*(?:之后|以后|后)/i);
    if (!m) return null;
    let value = cnToNum(m[1]);
    if (!Number.isFinite(value)) return null;
    if (m[2]) value += 0.5;
    const isHour = /^(小时|钟头|h)$/i.test(m[3]);
    const minutes = isHour ? value * 60 : value;
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return { minutes: Math.round(minutes), index: m.index, end: m.index + m[0].length, text: m[0] };
  }

  /* ------------------------------------------------------------------ */
  /* 地点 / 重复 / 分类                                                 */
  /* ------------------------------------------------------------------ */

  function extractLocation(text, spans) {
    let m;
    m = text.match(/@\s*([^\s,.;:!?、，。；：！？]{1,20})/);
    if (m) {
      spans.push([m.index, m.index + m[0].length]);
      return m[1];
    }
    m = text.match(/(?:地点|地址)\s*:\s*([^\s,.;!?，。；]{1,30})/);
    if (m) {
      spans.push([m.index, m.index + m[0].length]);
      return m[1];
    }
    m = text.match(/(?<!现)(?<!正)在\s*([\u4e00-\u9fa5A-Za-z0-9·\-]{1,16})/);
    if (m) {
      let cand = m[1].split(/(?:开会|见面|见|吃饭|吃|聊天|聊|上课|健身|运动|学习|工作|讨论|面试|看|等)/)[0];
      if (cand.length >= 2 || /^(家|公司|学校|办公室)$/.test(cand)) {
        spans.push([m.index, m.index + 1 + cand.length]);
        return cand;
      }
    }
    return '';
  }

  function extractNote(text, spans) {
    let m = text.match(/备注\s*[:：]\s*([^;；\n]{1,120})/);
    if (!m) m = text.match(/备注\s*(?:是|为)\s*([^;；\n]{1,120})/);
    if (!m) return '';
    spans.push([m.index, m.index + m[0].length]);
    return m[1].replace(/[.;]+$/, '').trim();
  }

  function extractRepeat(text) {
    let m;
    m = text.match(/(每(?:天|日)|天天|每日|每一天)/);
    if (m) return { type: 'daily', weekdays: [], index: m.index, text: m[1] };
    m = text.match(/(工作日|每个工作日)/);
    if (m) return { type: 'weekdays', weekdays: [], index: m.index, text: m[1] };
    m = text.match(/每(?:个)?周末/);
    if (m) return { type: 'weekly', weekdays: [6, 0], index: m.index, text: m[0] };
    m = text.match(/每(?:周|星期|礼拜)/);
    if (m) {
      const days = [];
      const tokenRe = /^\s*(?:(?:周|星期|礼拜)\s*)?([一二三四五六日天1-7])(?![\d点:：])/;
      const sepRe = /^\s*(?:和|及|、|,|\s)\s*/;
      let cursor = m.index + m[0].length;

      while (true) {
        const tm = text.slice(cursor).match(tokenRe);
        if (!tm) break;
        const wd = WEEKDAY_MAP[tm[1]];
        if (days.indexOf(wd) === -1) days.push(wd);
        cursor += tm[0].length;

        const sep = text.slice(cursor).match(sepRe);
        if (!sep) break;
        const afterSep = text.slice(cursor + sep[0].length);
        if (!tokenRe.test(afterSep)) break;
        cursor += sep[0].length;
      }

      return { type: 'weekly', weekdays: days, index: m.index, text: text.slice(m.index, cursor) };
    }
    return null;
  }

  function extractPeriod(text) {
    const NUM = '[0-9一二三四五六七八九十两]+';
    const rangeRe = new RegExp('第?\\s*(' + NUM + ')\\s*节?\\s*(?:到|至|-|,|和|及)\\s*第?\\s*(' + NUM + ')\\s*节(?:课)?');
    const singleRe = new RegExp('第\\s*(' + NUM + ')\\s*节(?:课)?');
    let m = text.match(rangeRe);
    let first;
    let last;

    if (m) {
      first = cnToNum(m[1]);
      last = cnToNum(m[2]);
    } else {
      const pair = text.match(/第?\s*([一二三四五六七八九])([一二三四五六七八九])\s*节(?:课)?/);
      if (pair && cnToNum(pair[2]) === cnToNum(pair[1]) + 1) {
        m = pair;
        first = cnToNum(pair[1]);
        last = cnToNum(pair[2]);
      } else {
        m = text.match(singleRe);
        if (!m) return null;
        first = cnToNum(m[1]);
        last = first;
      }
    }

    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    first = Math.round(first);
    last = Math.round(last);
    if (first <= 0 || last <= 0) return null;
    if (first > last) {
      const swap = first;
      first = last;
      last = swap;
    }

    return {
      first,
      last,
      label: first === last ? '第' + first + '节' : '第' + first + '–' + last + '节',
      index: m.index,
      end: m.index + m[0].length
    };
  }

  function nextWeekday(weekday, now) {
    let date = U.ymd(now);
    for (let i = 0; i < 7; i++) {
      if (U.weekdayOf(date) === weekday) return date;
      date = U.addDays(date, 1);
    }
    return date;
  }

  function extractWeekRange(text) {
    const simpleRe = /(?:第)?\s*(\d{1,2})(?:\s*[-–—~～到至]\s*(\d{1,2}))?\s*周(?!后|以后|之后)/;
    const m = text.match(simpleRe);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(60, Math.max(a, b));
    let weeks = [];
    for (let i = lo; i <= hi; i++) weeks.push(i);
    if (!weeks.length) return null;

    let end = m.index + m[0].length;
    const modifier = text.slice(end).match(/^\s*(?:\(|（)?\s*(单周|双周|单数周|双数周|单|双)\s*(?:\)|）)?/);
    let parity = '';
    if (modifier && modifier[1]) {
      parity = /单/.test(modifier[1]) ? 'odd' : 'even';
      end += modifier[0].length;
    }
    if (parity === 'odd') weeks = weeks.filter((w) => w % 2 === 1);
    if (parity === 'even') weeks = weeks.filter((w) => w % 2 === 0);
    if (!weeks.length) return null;

    return {
      weeks,
      parity,
      label: m[0].replace(/\s/g, '') + (parity === 'odd' ? ' 单周' : parity === 'even' ? ' 双周' : ''),
      index: m.index,
      end
    };
  }

  function weekRangeDates(info, baseDate, now) {
    const today = U.ymd(now);
    const semester = store.getSemesterStart();

    // 课表周次必须从学期第 1 周开始算；不能用今天反推，否则整学期会错位。
    if (!semester) {
      return { dates: [], warning: '', missingSemester: true };
    }

    const base = baseDate || U.todayStr();
    const startMonday = U.mondayOf(semester);
    let warning = '';
    if (info.weeks.length) {
      const firstDate = U.addDays(startMonday, (info.weeks[0] - 1) * 7 + (U.weekdayOf(base) + 6) % 7);
      if (firstDate < today) warning = '已跳过已经过去的周次。';
    }

    const offset = (U.weekdayOf(base) + 6) % 7;
    const dates = info.weeks
      .map((week) => U.addDays(startMonday, (week - 1) * 7 + offset))
      .filter((date) => date >= today);

    return { dates, warning };
  }

  function periodWindow(info) {
    if (!info) return null;
    const periods = store.getTimetable();
    if (!periods.length || info.first < 1 || info.last > periods.length) return null;
    return { start: periods[info.first - 1].start, end: periods[info.last - 1].end };
  }

  function contextualEvent(ctx) {
    if (ctx && ctx.selectedId) {
      const selected = store.get(ctx.selectedId);
      if (selected) return selected;
    }
    const messages = store.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'agent' || !Array.isArray(m.items) || !m.items.length) continue;
      if (m.kind && m.kind !== 'add' && m.kind !== 'update') continue;
      const evts = m.items.map((item) => item.id ? store.get(item.id) : null).filter(Boolean);
      if (!evts.length) continue;
      if (evts.length === 1) return evts[0];
      const seriesId = evts[0].seriesId;
      if (seriesId && evts.every((e) => e.seriesId === seriesId)) return evts[0];
    }
    return null;
  }

  function applyLocalMemory(text, ctx) {
    if (!extractPeriod(text)) return text;
    const now = ctx.now || new Date();
    if (extractDate(text, now) || extractRepeat(text) || extractWeekRange(text)) return text;
    const prev = contextualEvent(ctx);
    if (!prev) return text;

    const series = prev.seriesId ? store.getSeries(prev.seriesId) : null;
    const rule = series && series.rule;
    let prefix = '';
    if (rule && rule.type === 'weeks') {
      prefix = (rule.label || '') + ' ';
    } else if (rule && rule.type === 'weekly') {
      return '每' + U.weekdayCN(prev.date) + ' ' + text;
    }
    prefix += U.weekdayCN(prev.date) + ' ';
    return prefix + text;
  }

  function repeatDates(baseDate, repeat, now) {
    const today = U.ymd(now);
    const endDate = U.addDays(baseDate, 365);
    const out = [];
    if (repeat.type === 'daily') {
      for (let i = 0; i <= 365 && out.length < 370; i++) {
        const d = U.addDays(baseDate, i);
        if (d > endDate) break;
        if (d >= today) out.push(d);
      }
    } else if (repeat.type === 'weekdays') {
      for (let i = 0; i <= 365 && out.length < 265; i++) {
        const d = U.addDays(baseDate, i);
        if (d > endDate) break;
        const w = U.weekdayOf(d);
        if (w >= 1 && w <= 5 && d >= today) out.push(d);
      }
    } else if (repeat.type === 'weekly') {
      const days = repeat.weekdays.length ? repeat.weekdays : [U.weekdayOf(baseDate)];
      for (let i = 0; i <= 365 && out.length < 210; i++) {
        const d = U.addDays(baseDate, i);
        if (d > endDate) break;
        if (days.indexOf(U.weekdayOf(d)) > -1 && d >= today) out.push(d);
      }
    }
    return out;
  }

  const CATEGORY_RULES = [
    { name: '工作', re: /会议|开会|评审|汇报|周会|站会|客户|项目|需求|方案|报告|周报|面试|上班|工作|邮件|ppt|复盘|对接|交付|答辩|讨论|同步|文档|排期|上线|招聘|加班|出差|预算|合同/i },
    { name: '学习', re: /学习|复习|预习|看书|阅读|背单词|单词|作业|考试|上课|课程|论文|刷题|讲座|培训|读书|自习|网课|英语|数学|高数|线代|线性代数|概率|物理|化学|生物|历史|地理|政治|语文|编程|实验课|专业课|课堂|课件|练习|笔记/i },
    { name: '运动', re: /跑步|健身|锻炼|游泳|瑜伽|骑行|打球|篮球|足球|羽毛球|网球|拉伸|散步|爬山|运动|训练|步|徒步|滑雪|拳击|体育/i },
    { name: '社交', re: /聚餐|吃饭|午饭|晚饭|早餐|咖啡|下午茶|朋友|聚会|生日|约会|见面|社交|喝酒|团建|家人|聊天|婚礼|拜访|同学|派对|请客/i },
    { name: '生活', re: /买菜|做饭|打扫|扫除|收拾|洗衣|洗碗|拖地|购物|超市|快递|缴费|看病|医院|理发|牙医|搬家|取件|办证|银行|整理|家务|宠物|体检|维修|还款|账单|买/i },
    { name: '休息', re: /午休|睡觉|休息|冥想|放松|小憩|午睡|躺|泡澡|护肤|放空|听歌|追剧|游戏|娱乐|休假/i }
  ];

  function detectCategory(text) {
    for (const rule of CATEGORY_RULES) if (rule.re.test(text)) return rule.name;
    const custom = Object.keys(CATEGORIES).find((name) => name !== '其他' && text.indexOf(name) > -1);
    return custom || '其他';
  }

  function cleanTitle(text, spans) {
    let title = maskText(text, spans);
    title = title.replace(/\s+/g, ' ').trim();
    title = title.replace(/^[\s\-–—•·*、,，.;。:：/|到至]+/, '');
    title = title.replace(/[\s\-–—•·*、,，.;。:：/|]+$/, '');
    for (let i = 0; i < 4; i++) {
      const before = title;
      title = title.replace(/^(?:帮我|请|麻烦|劳驾|给我|我想|我要|我打算|我需要|需要|记得|提醒我|提醒|安排一下|安排|添加|新增|再加|再添加|再记|加一个|加个|加|记录一下|记录|记一下|记|订个|约个|约|来一个|有个|有一个|今天要|要)+/, '');
      title = title.replace(/^[\s的得地了前把去在到至]+/, '');
      title = title.replace(/(?:吧|呀|啊|哦|呢|哈|啦|嘛|了|一下)$/, '');
      if (title === before) break;
    }
    title = title.replace(/\s+/g, ' ').trim();
    return title;
  }

  /* ------------------------------------------------------------------ */
  /* 空闲时间                                                           */
  /* ------------------------------------------------------------------ */

  function periodStartMinute(period) {
    if (!period) return null;
    if (/^(凌晨)$/.test(period)) return 6 * 60;
    if (/^(清晨|早上|早晨|上午|今早|明早)$/.test(period)) return 8 * 60;
    if (/^(中午)$/.test(period)) return 12 * 60;
    if (/^(下午|午后)$/.test(period)) return 14 * 60;
    if (/^(傍晚)$/.test(period)) return 18 * 60;
    if (/^(晚上|夜里|夜晚|今晚|明晚)$/.test(period)) return 19 * 60;
    return null;
  }

  function findFreeSlot(date, duration, now, preferredStart) {
    const busy = store.byDate(date);
    let cursor = preferredStart == null ? 9 * 60 : preferredStart;
    if (date === U.ymd(now)) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      cursor = Math.max(cursor, Math.ceil((nowMin + 10) / 30) * 30);
    }
    const latest = 22 * 60 - duration;
    for (; cursor <= latest; cursor += 30) {
      const probe = { start: cursor, end: cursor + duration };
      if (!busy.some((e) => overlap(e, probe))) return cursor;
    }
    return preferredStart == null ? 9 * 60 : preferredStart;
  }

  /* ------------------------------------------------------------------ */
  /* 分段                                                               */
  /* ------------------------------------------------------------------ */

  function baseSegments(raw) {
    const out = [];
    String(raw || '').replace(/\r/g, '').split(/\n+/).forEach((line) => {
      line.split(/;|(?<!\d)\.(?!\d)/).forEach((chunk) => {
        const t = chunk.replace(/^\s*(?:[-–—•·*]|\d{1,2}[.、)](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, '').trim();
        if (t) out.push(t);
      });
    });
    return out;
  }

  /** 在「逗号 + 新时间」处拆分，并让后一句继承日期 / 上下午 */
  function inheritLineContext(lines, now) {
    let ctxDate = null;
    let ctxRepeat = null;
    let ctxWeek = null;

    return lines.map((raw) => {
      const ownDate = extractDate(raw, now);
      const ownRepeat = extractRepeat(raw);
      const ownWeek = extractWeekRange(raw);
      const ownPeriod = extractPeriod(raw);
      const hasTime = !!ownPeriod || extractTimes(raw).times.length > 0;
      let line = raw;

      if (hasTime) {
        let prefix = '';
        if (ownPeriod && !ownWeek && ctxWeek) prefix += (ctxWeek.label || '') + ' ';
        if (!ownDate && !ownRepeat) {
          if (ctxRepeat) prefix += ctxRepeat.text + ' ';
          else if (ctxDate) prefix += ctxDate.text + ' ';
        }
        if (prefix) line = prefix + line;
      }

      if (ownDate) {
        ctxDate = ownDate;
        if (!ownRepeat) ctxRepeat = null;
      }
      if (ownRepeat) ctxRepeat = ownRepeat;
      if (ownWeek) ctxWeek = ownWeek;
      return line;
    });
  }

  function splitTimeClauses(line, now) {
    const pieces = [];
    line.split(COMMA_TIME_SPLIT).forEach((chunk) => {
      chunk.split(COMMA_PERIOD_SPLIT).forEach((piece) => pieces.push(piece));
    });
    if (pieces.length <= 1) return [line];

    const out = [pieces[0]];
    for (let i = 1; i < pieces.length; i++) {
      let piece = pieces[i].trim();
      if (!piece) continue;
      const prev = out[out.length - 1];
      const prevPeriod = (prev.match(PERIOD_RE) || [])[0] || '';
      const pieceHasPeriod = new RegExp(PERIOD_SRC).test(piece);
      const pieceHasDate = DATE_HINT_RE.test(piece);
      const pieceRepeat = extractRepeat(piece);

      if (!pieceHasPeriod && prevPeriod) piece = prevPeriod + piece;
      if (!pieceHasDate && !pieceRepeat) {
        const prevRepeat = extractRepeat(prev);
        if (prevRepeat) {
          piece = prevRepeat.text + piece;
        } else {
          const prevDate = extractDate(prev, now);
          if (prevDate) piece = prevDate.text + piece;
        }
      }
      out.push(piece);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 解析单句                                                           */
  /* ------------------------------------------------------------------ */

  function parseSegment(raw, ctx) {
    const now = ctx.now || new Date();
    const todayStr = U.ymd(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const text = normalizeText(raw);
    const spans = [];
    const warnings = [];

    const dateInfo = extractDate(text, now);
    let date = dateInfo ? dateInfo.date : (ctx.defaultDate || U.ymd(now));
    if (dateInfo) spans.push([dateInfo.index, dateInfo.index + dateInfo.text.length]);

    const repeatInfo = extractRepeat(text);
    let repeat = repeatInfo;
    if (repeatInfo) spans.push([repeatInfo.index, repeatInfo.index + repeatInfo.text.length]);
    if (repeatInfo && dateInfo && /(?:周|星期|礼拜)/.test(dateInfo.text) &&
      !/(下周|下下|本|这)/.test(dateInfo.text)) {
      date = ctx.defaultDate || U.ymd(now);
    }

    const periodInfo = extractPeriod(text);
    if (periodInfo) {
      spans.push([periodInfo.index, periodInfo.end]);
      const periods = typeof store.getTimetable === 'function' ? store.getTimetable() : (store.timetable || []);
      if (!periods.length) {
        return { error: 'timetable', raw, periodLabel: periodInfo.label };
      }
      if (periodInfo.last > periods.length) {
        return { error: 'period-range', raw, periodLabel: periodInfo.label };
      }
      periodInfo.start = periods[periodInfo.first - 1].start;
      periodInfo.end = periods[periodInfo.last - 1].end;
    }

    const weekInfo = extractWeekRange(text);
    if (weekInfo) spans.push([weekInfo.index, weekInfo.end]);
    let weekDates = null;
    if (weekInfo && (!repeatInfo || repeatInfo.type === 'weekly')) {
      let weekBase = dateInfo ? dateInfo.date : (ctx.defaultDate || U.ymd(now));
      if (!dateInfo && repeatInfo && repeatInfo.weekdays && repeatInfo.weekdays.length) {
        weekBase = nextWeekday(repeatInfo.weekdays[0], now);
      }
      const range = weekRangeDates(weekInfo, weekBase, now);
      if (range.missingSemester) {
        return { error: 'semester', raw, weekLabel: weekInfo.label };
      }
      if (!range.dates.length) {
        return { error: 'weeks', raw, weekLabel: weekInfo.label };
      }
      weekDates = range.dates;
      if (range.warning) warnings.push(range.warning);
      repeat = {
        type: 'weeks',
        weeks: weekInfo.weeks,
        label: weekInfo.label,
        parity: weekInfo.parity
      };
    }

    const timeInfo = extractTimes(text);
    timeInfo.spans.forEach((sp) => spans.push(sp));

    let loosePeriod = null;
    if (!timeInfo.times.length && !/(下午茶|上午茶)/.test(text)) {
      const pm = text.match(new RegExp(PERIOD_SRC));
      if (pm) {
        loosePeriod = pm[0];
        spans.push([pm.index, pm.index + pm[0].length]);
      }
    }

    const offsetInfo = timeInfo.times.length ? null : extractOffset(text);
    if (offsetInfo) spans.push([offsetInfo.index, offsetInfo.end]);

    const durationInfo = extractDuration(text, timeInfo.spans.concat(offsetInfo ? [[offsetInfo.index, offsetInfo.end]] : []));
    durationInfo.spans.forEach((sp) => spans.push(sp));

    const locationInfo = extractLocation(text, spans);
    const explicitNote = extractNote(text, spans);
    const title = cleanTitle(text, spans);
    if (!title) return { error: 'title', raw };

    const category = detectCategory(title + ' ' + text);
    const priority = /重要|紧急|必须|务必|deadline|ddl|截止|一定要|别忘了/i.test(text);

    let start;
    let end;
    let deadlineHit = false;
    const times = timeInfo.times;

    if (periodInfo) {
      start = periodInfo.start;
      end = periodInfo.end;
    } else if (times.length) {
      const range = extractRange(text, times);
      start = range.start;
      end = range.end;

      // 没写上午/下午、且时刻已经过去 3 小时以上，按更近的下午时段理解
      if (!repeat && !times[0].period && date === todayStr && nowMin < 18 * 60 && start < nowMin - 180 &&
        start >= 60 && start < 720 && start + 720 <= 1439) {
        start += 720;
        if (end != null && end + 720 <= 1440) end += 720;
        warnings.push('没写上午还是下午，按更近的下午时段理解。');
      }

      // 「下午5点前提交」→ 安排截止前的一小时
      const after = text.slice(times[0].end, times[0].end + 4);
      deadlineHit = times.length === 1 && !durationInfo.minutes && /^\s*(?:之前|以前|前|截止)/.test(after);
      if (deadlineHit) {
        end = start;
        start = Math.max(0, end - 60);
        warnings.push('按截止时间「' + U.fmtTime(end) + '」倒推安排在 ' + U.fmtTime(start) + '。');
      } else if (end == null) {
        const dur = durationInfo.minutes || defaultDuration(title);
        end = Math.min(1439, start + dur);
      } else if (durationInfo.minutes && end - start !== durationInfo.minutes) {
        end = Math.min(1439, start + durationInfo.minutes);
      }
    } else if (offsetInfo) {
      start = Math.ceil((nowMin + offsetInfo.minutes) / 5) * 5;
      if (start >= 1440) {
        date = U.addDays(date, 1);
        start -= 1440;
      }
      const dur = defaultDuration(title);
      end = Math.min(1439, start + dur);
      warnings.push('按「' + offsetInfo.text + '」安排在 ' + U.fmtTime(start) + '。');
    } else {
      const dur = durationInfo.minutes || defaultDuration(title);
      let preferred = periodStartMinute(loosePeriod);
      if (!preferred && /下午茶/.test(text)) preferred = 15 * 60;
      start = findFreeSlot(date, dur, now, preferred);
      end = Math.min(1439, start + dur);
      if (loosePeriod) {
        warnings.push('没有精确到几点，已按「' + loosePeriod + '」放入空档 ' + U.fmtTime(start) + '。');
      } else {
        warnings.push('没有识别到具体时刻，已放入当天最近的空档 ' + U.fmtTime(start) + '。');
      }
    }

    if (end <= start) end = Math.min(1440, start + 15);

    let note = explicitNote;
    if (priority) note = (note ? note + ' · ' : '') + '优先级高';
    if (deadlineHit) note = (note ? note + ' · ' : '') + '截止 ' + U.fmtTime(end);
    if (periodInfo) {
      note = (note ? note + ' · ' : '') + periodInfo.label;
      warnings.push('按课表 ' + periodInfo.label + ' 换算为 ' + U.fmtTime(start) + '–' + U.fmtTime(end) + '。');
    }

    const dates = weekDates || (repeat ? repeatDates(date, repeat, now) : [date]);
    if (!dates.length) dates.push(date);

    if (!weekInfo && !repeat && (date < todayStr || (date === todayStr && start < nowMin - 5))) {
      warnings.push('这个时刻已经过去了，要改时间可以直接拖动色块。');
    }

    return {
      title,
      dates,
      start,
      end,
      category,
      location: locationInfo,
      note,
      repeat,
      warnings,
      inferredTime: !times.length,
      raw
    };
  }

  /* ------------------------------------------------------------------ */
  /* 冲突 / 去重                                                        */
  /* ------------------------------------------------------------------ */

  function conflictsFor(evt, existing) {
    return existing.find((e) => e.id !== evt.id && e.date === evt.date && overlap(e, evt));
  }

  function buildEvents(segments, ctx) {
    const MAX_BATCH = 3000;
    const created = [];
    const pendingAdds = [];
    const warnings = [];
    const skipped = [];
    const repeatNotes = [];
    let needsTimetable = false;
    let needsSemester = false;
    let periodIssue = '';
    let weekIssue = '';
    let truncated = false;
    let planned = 0;
    const now = ctx.now || new Date();
    const todayStr = U.ymd(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const existingKeys = new Set();
    const addedKeys = new Set();
    const busyByDate = new Map();
    const remember = (candidate) => {
      addedKeys.add(candidate.date + '|' + candidate.start + '|' + candidate.title);
      const list = busyByDate.get(candidate.date) || [];
      list.push(candidate);
      busyByDate.set(candidate.date, list);
    };
    const findConflict = (candidate) =>
      (busyByDate.get(candidate.date) || []).find((e) => overlap(e, candidate));

    store.events.forEach((e) => {
      existingKeys.add(e.date + '|' + e.start + '|' + e.title);
      const list = busyByDate.get(e.date) || [];
      list.push(e);
      busyByDate.set(e.date, list);
    });

    segments.forEach((seg) => {
      const parsed = parseSegment(seg, ctx);
      if (parsed.error) {
        if (parsed.error === 'timetable') needsTimetable = true;
        else if (parsed.error === 'semester') needsSemester = true;
        else if (parsed.error === 'period-range') periodIssue = parsed.periodLabel || '这些节次';
        else if (parsed.error === 'weeks') weekIssue = parsed.weekLabel || '这些周次';
        skipped.push(parsed.raw);
        return;
      }
      const accepted = [];
      parsed.dates.forEach((date) => {
        if (planned >= MAX_BATCH) {
          truncated = true;
          return;
        }
        if (parsed.repeat && (date < todayStr || (date === todayStr && parsed.end <= nowMin))) return;
        const candidate = {
          title: parsed.title,
          date,
          start: parsed.start,
          end: parsed.end,
          category: parsed.category,
          location: parsed.location,
          note: parsed.note,
          reminder: 10,
          source: 'agent'
        };
        const key = candidate.date + '|' + candidate.start + '|' + candidate.title;
        if (existingKeys.has(key) || addedKeys.has(key)) {
          skipped.push(parsed.title);
          return;
        }
        const conflict = findConflict(candidate);
        if (conflict) warnings.push('「' + parsed.title + '」与「' + conflict.title + '」时间重叠。');
        accepted.push(candidate);
        remember(candidate);
        planned++;
      });

      if (parsed.repeat && accepted.length) {
        const seriesId = U.uid('ser_');
        const result = store.addSeries({
          id: seriesId,
          title: parsed.title,
          start: parsed.start,
          end: parsed.end,
          category: parsed.category,
          location: parsed.location,
          note: parsed.note,
          reminder: 10,
          startDate: accepted[0].date,
          until: accepted[accepted.length - 1].date,
          rule: parsed.repeat
        }, accepted.map((c) => Object.assign({}, c, { seriesId })));
        created.push.apply(created, result.events);
        repeatNotes.push(
          parsed.repeat.type === 'weeks' ? '已按 ' + parsed.repeat.label + ' 生成系列' :
          parsed.repeat.type === 'daily' ? '已按「每天」生成未来一年系列' :
          parsed.repeat.type === 'weekdays' ? '已按「工作日」生成未来一年系列' :
          '已按「每周」生成未来一年系列'
        );
      } else {
        pendingAdds.push.apply(pendingAdds, accepted);
      }
      parsed.warnings.forEach((w) => warnings.push(w));
    });

    if (pendingAdds.length) {
      const added = store.addMany(pendingAdds);
      created.push.apply(created, added);
    }

    return {
      created,
      warnings: dedupe(warnings),
      skipped,
      repeatNotes: dedupe(repeatNotes),
      needsTimetable,
      needsSemester,
      periodIssue,
      weekIssue,
      truncated,
      now
    };
  }

  function dedupe(list) {
    return list.filter((v, i) => list.indexOf(v) === i);
  }

  function itemsFromEvents(list) {
    return list.map((e) => ({
      id: e.id,
      time: U.fmtTime(e.start) + '–' + U.fmtTime(e.end),
      title: e.title,
      category: e.category,
      date: e.date
    }));
  }

  /* ------------------------------------------------------------------ */
  /* 意图                                                               */
  /* ------------------------------------------------------------------ */

  /** DDL 动作词只在句首 / DDL 词之后 / 句尾生效，避免标题里出现「删除」被误判 */
  function ddlHasEdgeAction(text, words) {
    const head = String(text || '')
      .replace(/^(?:帮我|请|麻烦|劳驾)?\s*/, '')
      .replace(/^(?:把|将)\s*/, '')
      .trim();
    const afterDdl = head.replace(/^(?:ddl|deadline|死线|截止(?:事项|日期)?)\s*[:：]?\s*/i, '');
    const tail = head.replace(/[了啦呀哦呢吧。.!！~～\s]+$/, '');

    function startsWithAction(s) {
      return words.some((w) => {
        if (s.indexOf(w) !== 0) return false;
        const rest = s.slice(w.length);
        return !rest || /^[\s,;:：]/.test(rest) || /^(?:ddl|deadline|死线)/i.test(rest);
      });
    }

    function endsWithAction(s) {
      return words.some((w) => {
        if (s.length < w.length || s.slice(-w.length) !== w) return false;
        const before = s.slice(0, -w.length);
        return !before || /[\s,;:：]$/.test(before) || w.length >= 2;
      });
    }

    return startsWithAction(head) || startsWithAction(afterDdl) || endsWithAction(tail);
  }

  function detectIntent(text) {
    const t = text.trim();    if (/^(你好|您好|hi|hello|嗨|在吗|哈喽|早上好|晚上好)/i.test(t)) return 'greet';
    if (/(怎么用|如何使用|帮助|help|能做什么|你会什么)/i.test(t) && t.length <= 30) return 'help';
    if (/^(?:谢谢|多谢|感谢|辛苦了|好的|好滴|好|收到|明白(?:了)?|知道了|没问题|可以|行|嗯+|哦+|哈哈+|笑死|太棒了|厉害|不错|ok|okay)[。.!！~～\s]*$/i.test(t)) return 'chat';
    if (/^(?:我)?(?:今天|明天)?(?:好累|累死|困了|好困|无聊|烦死|不开心|开心|高兴)[。.!！~～\s]*$/.test(t)) return 'chat';
    if (/(?:ddl|deadline|死线)/i.test(t) || /^(?:截止|ddl|deadline|死线)\s*:/.test(t)) {
      if (ddlHasEdgeAction(t, ['完成', '搞定', '做完', '交了', '提交了', '已交', '标记完成', '标记为完成'])) return 'ddlDone';
      if (ddlHasEdgeAction(t, ['删除', '删掉', '删了', '删', '取消', '移除', '去掉', '不要了'])) return 'ddlRemove';
      if (/(改到|改成|改为|推迟到|推迟|延后到|延后|提前到|延期到|延期|挪到|调整到|调整)/.test(t)) return 'ddlUpdate';
      if (/(哪些|有什么|有多少|列表|列出|看看|查一下|查查|什么时候|最近|几个|哪几|还有|啥时候|截止到)/.test(t)) return 'ddlQuery';
      const stripped = t.replace(/(?:ddl|deadline|死线)/gi, '')
        .replace(/[\s,;:我的所有全部这个那个]/g, '');
      if (!stripped) return 'ddlQuery';
      return 'ddl';
    }
    if (/(删除|删掉|删了|删|取消|撤掉|撤销|去掉|移除|清空|清除|不要了|不用了|算了|别去了|别安排|不开了|不去了|不上了)/.test(t)) return 'remove';
    if (/(顺延|挪到明天|推到明天|往后顺延)/.test(t)) return 'rollover';
    if (/(改到|改在|改至|改成|改为|改一下|调整到|调整|调到|换到|换成|换个时间|推迟到|推迟|延后到|延后|往后推|往后挪|推后|提前到|提前|提早|往前挪|挪到|挪至|移到|移去|再晚|再早|晚一点|早一点)/.test(t)) return 'update';
    if (/^(?:帮我)?(?:做|来|看|写)?(?:一下)?(?:本周|这周|这一周)?(?:复盘|回顾|总结)$/.test(t) ||
      (/(复盘|回顾|总结|盘点)/.test(t) && /(本周|这周|这一周|一周|最近|上周|下周|weekly)/i.test(t)) ||
      /(本周复盘|这周复盘|周复盘|本周总结|这周怎么样|weekly review)/i.test(t)) return 'review';
    if (/^(任务|待办)\s*[:：]/.test(t) || /^(?:帮我)?记(?:一个|一下|个)?任务/.test(t) ||
      /(?:放进|加到|放到|加入)(?:任务)?收件箱/.test(t) || /待办(?:里|中)/.test(t)) return 'task';
    if (/^(?:帮我)?记(?:一下|下|个)\s+/.test(t) &&
      !extractTimes(t).times.length && !extractDate(t, new Date())) return 'task';
    if ((/空档|空闲/.test(t) || /有空|能塞|塞下|排得下/.test(t)) &&
      /(哪里|哪儿|有没有|有多少|有几个|什么时候|哪一天|能塞|塞下|排得下|有空|多少小时|多久|吗|呢|？|\?)/.test(t)) return 'free';
    if (/(吗|呢|\?|？|有什么|有哪些|多少|几点|几节课|第几节|什么课|哪几节|课表|有课|的课|上课|什么时候|哪天|哪一天|几号|在哪|教室|地点|看看|查一下|查查|忙不忙|空闲|空档|安排是|列出|有没有|是不是|多久)/.test(t)) return 'query';
    return 'add';
  }

  function dateLabel(date) {
    const rel = U.relativeCN(date);
    return rel ? rel : U.monthDayCN(date) + ' ' + U.weekdayCN(date);
  }

  function titleMatches(term, title) {
    if (!term) return true;
    const q = String(term).toLowerCase().trim();
    const t = String(title || '').toLowerCase().trim();
    if (!q) return true;
    if (!t) return false;
    if (t.indexOf(q) > -1 || q.indexOf(t) > -1) return true;
    if (q.length < 2) return false;
    let i = 0;
    for (let j = 0; j < t.length; j++) {
      if (t[j] === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  }

  function removeIntent(text, ctx) {
    const now = ctx.now || new Date();
    const dateInfo = extractDate(text, now);
    const date = dateInfo ? dateInfo.date : null;
    const wantsAll = /(全部|所有|一切|都)/.test(text);
    const wantsClear = /(清空|清除|全删|都删|全部删除)/.test(text);
    const weekScope = /(本周|这周|这一周|下周|下星期|下礼拜|未来一周|最近一周)/.test(text);
    const asksTimetable = /(课表|节次|作息)/.test(text);
    const periodInfo = extractPeriod(text);
    const window = periodWindow(periodInfo);

    if (asksTimetable && (wantsClear || wantsAll)) {
      const alsoEvents = wantsAll && !/(只|仅)/.test(text);
      if (alsoEvents) store.clearEvents();
      store.saveTimetable([]);
      store.saveSemesterStart('');
      return {
        text: alsoEvents ? '已清空全部日程和课表节次。' : '已清空课表节次，日程没有动。',
        items: [],
        changed: alsoEvents,
        kind: 'remove'
      };
    }

    if (periodInfo && !window) {
      return {
        text: '我还不清楚「' + periodInfo.label + '」是几点。\n先到课表节次里补上这一节，再试一次。',
        items: [],
        changed: false,
        kind: 'info',
        openTimetable: true
      };
    }

    let term = text
      .replace(/^(?:帮我|请|麻烦)?\s*(?:把|将|给)?\s*/, '')
      .replace(/^(?:删除|删掉|删了|删|取消|去掉|移除|清空|清除|不要|不用)\s*/, '')
      .replace(/^我\s*/, '')
      .replace(/^(?:全部|所有|一切|都)\s*/, '')
      .replace(/(?:的)?(?:日程|安排|事件|提醒)$/, '')
      .replace(/(?:本周|这周|这一周|下周|下星期|下礼拜|未来一周|最近一周|今天|明天|后天|今日|明日|今晚|明晚|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月\d{1,2}[日号])/g, '')
      .replace(/(?:凌晨|清晨|早上|早晨|上午|中午|午后|下午|傍晚|晚上|夜里|夜晚|今早|明早)/g, '')
      .replace(/[?？。.!！,，的]/g, '')
      .trim();

    const termTimes = extractTimes(term);
    const termDur = extractDuration(term, termTimes.spans);
    if (termTimes.spans.length || termDur.spans.length) {
      term = maskText(term, termTimes.spans.concat(termDur.spans))
        .replace(/[的\s]/g, '')
        .replace(/^(?:在|到|于)/, '')
        .trim();
    }

    const termPeriod = extractPeriod(term);
    if (termPeriod) {
      term = maskText(term, [[termPeriod.index, termPeriod.end]])
        .replace(/[的\s]/g, '')
        .replace(/^(?:这节课|那节课|课|课程)/, '')
        .trim();
    }
    term = term
      .replace(/(?:不开了|不去了|不上了|不用了|取消了|算了|不要了|别去了|别安排|删了|删掉|删除|删|清空|清除|移除|取消|全删|都删)$/, '')
      .replace(/(?:的)?(?:日程|安排|事件|提醒)$/, '')
      .replace(/(?:了|吧|呀)$/, '')
      .replace(/^(?:这|那)?(?:节)?课$/, '')
      .trim();
    if (/^(?:(?:全部|所有|一切|都)?(?:清空|清除|删除|删掉|取消|移除|全删|都删|全清)?)$/.test(term)) term = '';
    const pronoun = /^(?:它|这个|这条|这项|刚才(?:的|那个)?|刚刚(?:的)?)$/.test(term);
    if (pronoun) term = '';

    const contextEvt = contextualEvent(ctx);
    let targets = [];

    if ((wantsClear || wantsAll) && weekScope && !term) {
      const monday = U.mondayOf(U.todayStr());
      let start;
      let end;
      let label;
      if (/(下周|下星期|下礼拜)/.test(text)) {
        start = U.addDays(monday, 7);
        end = U.addDays(monday, 13);
        label = '下周';
      } else if (/(未来一周|最近一周)/.test(text)) {
        start = U.todayStr();
        end = U.addDays(start, 6);
        label = '未来一周';
      } else {
        start = monday;
        end = U.addDays(monday, 6);
        label = '本周';
      }
      const weekEvents = store.events.filter((e) => e.date >= start && e.date <= end);
      if (!weekEvents.length) {
        return {
          text: label + '（' + U.monthDayCN(start) + '–' + U.monthDayCN(end) + '）本来就没有安排。',
          items: [],
          changed: false,
          kind: 'info'
        };
      }
      const removed = store.remove(weekEvents.map((e) => e.id));
      return {
        text: '已清空' + label + '（' + U.monthDayCN(start) + '–' + U.monthDayCN(end) + '）的 ' + removed.length + ' 项日程。',
        items: itemsFromEvents(removed),
        changed: true,
        kind: 'remove'
      };
    }

    const allEvents = (wantsClear || wantsAll) && !date && !term && !window;
    if (allEvents) {
      const wipeTimetable = /(?:全部|所有|全都|一切|都).{0,2}(?:清空|清除)|(?:清空|清除).{0,2}(?:全部|所有|全都|一切|都)|全清/.test(text) &&
        !/(日程|安排|事件|会议)/.test(text);
      store.clearEvents();
      if (wipeTimetable) {
        store.saveTimetable([]);
        store.saveSemesterStart('');
      }
      return {
        text: wipeTimetable ? '已清空全部日程和课表节次。' : '已清空全部日程。',
        items: [],
        changed: true,
        kind: 'remove'
      };
    }

    if (date) {
      const dayEvents = store.byDate(date);
      if (!term && !window) {
        if (wantsClear || wantsAll) {
          targets = dayEvents;
        } else if (dayEvents.length === 1) {
          targets = dayEvents;
        } else {
          return clarifyCandidates(dayEvents, '删除');
        }
      } else {
        targets = dayEvents.filter((e) => {
          const byTitle = !term || titleMatches(term, e.title);
          const byPeriod = !window || (e.start < window.end && e.end > window.start);
          return byTitle && byPeriod;
        });
      }
    } else if (term) {
      targets = store.events.filter((e) => {
        if (e.date < U.todayStr()) return false;
        const byTitle = titleMatches(term, e.title);
        const byPeriod = !window || (e.start < window.end && e.end > window.start);
        return byTitle && byPeriod;
      });
    } else if (window) {
      targets = store.events.filter((e) =>
        e.date >= U.todayStr() && e.start < window.end && e.end > window.start);
    } else if (contextEvt) {
      targets = [contextEvt];
    }

    if (!targets.length) {
      if (wantsClear || wantsAll) {
        return {
          text: term
            ? '没有找到匹配「' + term + '」的日程。'
            : (date ? dateLabel(date) + '本来就没有安排。' : '目前没有任何日程。'),
          items: [],
          changed: false
        };
      }
      return {
        text: '没有找到要删除的日程。可以带上日期、节次或标题再说一次，比如「删掉周三第1-2节的高数」。',
        items: [],
        changed: false
      };
    }

    if (targets.length > 1 && !wantsClear && !wantsAll) {
      return clarifyCandidates(targets, '删除');
    }

    const removed = store.remove(targets.map((e) => e.id));
    return {
      text: '已删除 ' + removed.length + ' 项日程：' + removed.map((e) => '「' + e.title + '」').join('、') + '。',
      items: itemsFromEvents(removed),
      changed: true,
      kind: 'remove'
    };
  }

  function freeWindows(date, now) {
    const evts = store.byDate(date);
    const windows = [];
    let cursor = 8 * 60;
    const endOfDay = 22 * 60;
    if (date === U.ymd(now)) cursor = Math.max(cursor, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
    evts.forEach((e) => {
      if (e.end <= cursor) return;
      if (e.start > cursor) windows.push({ start: cursor, end: Math.min(e.start, endOfDay) });
      cursor = Math.max(cursor, e.end);
    });
    if (cursor < endOfDay) windows.push({ start: cursor, end: endOfDay });
    return windows.filter((w) => w.end - w.start >= 30).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  }

  function stripForTerm(str, now) {
    const spans = [];
    const date = extractDate(str, now);
    if (date) spans.push([date.index, date.index + date.text.length]);
    const period = extractPeriod(str);
    if (period) spans.push([period.index, period.end]);
    const time = extractTimes(str);
    time.spans.forEach((sp) => spans.push(sp));
    const duration = extractDuration(str, time.spans);
    duration.spans.forEach((sp) => spans.push(sp));
    return { spans, date, period, times: time.times, duration: duration.minutes };
  }

  function clarifyCandidates(list, action) {
    return {
      text: '找到 ' + list.length + ' 项匹配，要' + action + '哪一项？可以补上日期、时间或更完整的标题。',
      items: itemsFromEvents(list.slice(0, 6)),
      changed: false,
      kind: 'info'
    };
  }

  function updateIntent(text, ctx) {
    const now = ctx.now || new Date();
    const today = U.ymd(now);
    const verb = text.match(/(改到|改在|改至|改一下|改成|改为|推迟到|推迟|延后到|延后|往后推|往后挪|推后|提前到|提前|提早|往前挪|挪到|挪至|移到|移去|调整到|调到|换成|换个时间|换到|再晚|再早|晚一点|早一点)/);
    if (!verb) return null;

    const left = text.slice(0, verb.index).trim();
    const right = text.slice(verb.index + verb[0].length).trim();
    const leftInfo = stripForTerm(left, now);
    const rightInfo = stripForTerm(right, now);
    const rightWindow = periodWindow(rightInfo.period);

    if (rightInfo.period && !rightWindow) {
      return {
        text: '我还不清楚「' + rightInfo.period.label + '」是几点。\n先到课表节次里补上这一节，再试一次。',
        items: [],
        changed: false,
        kind: 'info',
        openTimetable: true
      };
    }

    if (!rightInfo.date && !rightInfo.times.length && !rightInfo.duration && !rightWindow) {
      return {
        text: '要改到什么时候？可以这样说：「把下午 3 点的评审改到 4 点」「把高数改到周三第3-4节」或「把健身推迟半小时」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    let term = maskText(left, leftInfo.spans).replace(/\s+/g, '');
    term = term
      .replace(/^(?:帮我|请|麻烦|劳驾|我想|我要|我打算|我)?\s*(?:把|将|给)?\s*/, '')
      .replace(/(?:凌晨|清晨|早上|早晨|上午|中午|午后|下午|傍晚|晚上|夜里|夜晚|今晚|明晚|今早|明早)/g, '')
      .replace(/^[的]+/, '')
      .replace(/[的]/g, '')
      .replace(/(?:这节课|那节课|课程|课|日程|安排|事件|提醒)$/, '')
      .replace(/(?:一下|吧|呀)$/, '')
      .trim();

    const pronoun = /^(?:它|这个|这条|这项|刚才(?:的|那个)?|刚刚(?:的)?)$/.test(term);
    if (pronoun) term = '';

    let pool;
    if (leftInfo.date) pool = store.byDate(leftInfo.date.date);
    else pool = store.events.filter((e) => e.date >= today);
    pool = pool.slice().sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const activePool = pool.filter((e) => !e.done);
    if (activePool.length) pool = activePool;

    let byTime = [];
    if (leftInfo.times.length) {
      const marks = [leftInfo.times[0].min];
      if (leftInfo.times[0].min < 720) marks.push(leftInfo.times[0].min + 720);
      byTime = pool.filter((e) => marks.some((m) => Math.abs(e.start - m) <= 5));
    }

    const leftWindow = periodWindow(leftInfo.period);
    const byPeriod = leftWindow
      ? pool.filter((e) => e.start < leftWindow.end && e.end > leftWindow.start)
      : [];

    const byTitle = term
      ? pool.filter((e) => titleMatches(term, e.title))
      : [];

    let target = null;
    if (byTime.length) {
      if (byTitle.length) target = byTime.find((e) => byTitle.indexOf(e) > -1) || null;
      if (!target && byPeriod.length) target = byTime.find((e) => byPeriod.indexOf(e) > -1) || null;
      if (!target && byTime.length === 1) target = byTime[0];
      if (!target) return clarifyCandidates(byTime, '改');
    } else if (byPeriod.length) {
      if (byTitle.length) target = byPeriod.find((e) => byTitle.indexOf(e) > -1) || null;
      if (!target && byPeriod.length === 1) target = byPeriod[0];
      if (!target) return clarifyCandidates(byPeriod, '改');
    } else if (byTitle.length) {
      if (byTitle.length > 1 && !leftInfo.times.length && !leftInfo.period) {
        return clarifyCandidates(byTitle, '改');
      }
      target = byTitle[0];
    } else if ((!term && !leftInfo.times.length && !leftInfo.period && !leftInfo.date) || pronoun) {
      target = contextualEvent(ctx);
    }

    if (!target) {
      return {
        text: '没找到要改的日程。可以先点选时间轴上的色块，或者带上标题 / 原时间再说一次，比如「把下午 3 点的评审改到 4 点」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const oldDuration = target.end - target.start;
    let newStart = target.start;
    let newEnd = target.end;
    const newDate = rightInfo.date ? rightInfo.date.date : target.date;

    if (rightWindow) {
      newStart = rightWindow.start;
      newEnd = rightWindow.end;
    } else if (rightInfo.times.length) {
      newStart = rightInfo.times[0].min;
      if (!rightInfo.times[0].period) {
        if (!rightInfo.date) {
          if (target.start >= 720 && newStart < 720 && newStart + 720 <= 1439) newStart += 720;
          else if (newStart <= 360 && target.start >= 7 * 60) newStart += 720;
        } else if (newStart <= 360 && newStart + 720 <= 1439) {
          // 明确说了日期时，只有凌晨 / 清晨的模糊时刻默认按下午理解
          newStart += 720;
        }
      }
      newEnd = newStart + oldDuration;
    } else if (rightInfo.duration) {
      const sign = /(提前|提早|往前|再早|早一点)/.test(verb[0]) ? -1 : 1;
      newStart = U.clamp(target.start + sign * rightInfo.duration, 0, 1440 - oldDuration);
      newEnd = newStart + oldDuration;
    }

    newStart = U.clamp(newStart, 0, 1439);
    newEnd = U.clamp(newEnd, newStart + 15, 1440);
    const patch = { date: newDate, start: newStart, end: newEnd };
    if (rightInfo.period) {
      const oldNote = target.note || '';
      const replaced = oldNote.replace(/第\s*\d+(?:\s*[–-]\s*\d+)?\s*节/, rightInfo.period.label);
      patch.note = replaced === oldNote
        ? (oldNote ? oldNote + ' · ' : '') + rightInfo.period.label
        : replaced;
    }
    const updated = store.update(target.id, patch);
    if (!updated) {
      return { text: '这项日程已经不存在了。', items: [], changed: false, kind: 'info' };
    }

    const dateChanged = newDate !== target.date;
    const when = (dateChanged ? dateLabel(newDate) + ' ' : '') +
      U.fmtTime(updated.start) + '–' + U.fmtTime(updated.end);
    const shiftText = !rightInfo.times.length && !rightWindow && rightInfo.duration
      ? (/(提前|提早|往前|再早|早一点)/.test(verb[0]) ? '提前 ' : '推迟 ') + U.fmtDuration(rightInfo.duration) + '，'
      : '';
    const periodText = rightInfo.period ? '（' + rightInfo.period.label + '）' : '';
    const tip = updated.seriesId
      ? '这次只改了当前这一节；要改整个系列，点开日程后选「整个系列」。'
      : '';

    return {
      text: '已把「' + updated.title + '」' + shiftText + '改到 ' + when + periodText + '。',
      items: itemsFromEvents([updated]),
      tip,
      changed: true,
      kind: 'update'
    };
  }

  function isClassEvent(evt) {
    return /第\s*\d+(?:\s*[–\-]\s*\d+)?\s*节/.test(evt.note || '');
  }

  function classEventsFor(startDate, days) {
    return store.between(startDate, U.addDays(startDate, days - 1)).filter(isClassEvent);
  }

  function queryTitleTerm(text, now) {
    const spans = [];
    const date = extractDate(text, now);
    if (date) spans.push([date.index, date.index + date.text.length]);
    const period = extractPeriod(text);
    if (period) spans.push([period.index, period.end]);
    const time = extractTimes(text);
    time.spans.forEach((sp) => spans.push(sp));
    let q = maskText(text, spans);
    q = q.replace(/(?:帮我|请|麻烦|查一下|查查|看看|有没有|是什么|什么时候|几点|哪天|哪一天|几号|在哪(?:里|儿)?|哪个教室|教室|地点|有课吗|有课|上课吗|上课|课表|几节课|什么课|哪几节课|哪几节|这周|本周|这一周|下周|下星期|下礼拜|未来一周|最近一周|下次|下一次|最近一次|我的|这门|那门|有什么|有哪些|安排|日程|的|呢|吗|？|\?)/g, ' ');
    q = q.replace(/\s+/g, ' ').trim();
    q = q.replace(/^(?:我)+/, '').replace(/课$/, '').replace(/^有$/, '').trim();
    return q;
  }

  function queryIntent(text, ctx) {
    const now = ctx.now || new Date();
    const dateInfo = extractDate(text, now);
    const date = dateInfo ? dateInfo.date : (ctx.defaultDate || U.ymd(now));
    const label = dateLabel(date);
    const periodInfo = extractPeriod(text);

    if (periodInfo) {
      const window = periodWindow(periodInfo);
      if (!window) {
        return {
          text: '我还不清楚「' + periodInfo.label + '」是几点。\n先到课表节次里设置这一节的时间，我再告诉你。',
          items: [],
          changed: false,
          kind: 'info',
          openTimetable: true
        };
      }
      const windowText = U.fmtTime(window.start) + '–' + U.fmtTime(window.end);
      const matches = store.byDate(date).filter((e) => e.start < window.end && e.end > window.start);
      if (matches.length) {
        const titles = matches.map((e) => '「' + e.title + '」' + (e.location ? '（' + e.location + '）' : '')).join('、');
        return {
          text: label + periodInfo.label + '（' + windowText + '）是 ' + titles + '。',
          items: itemsFromEvents(matches),
          tip: matches.length > 1 ? '这个时段有多项安排。' : '',
          changed: false,
          kind: 'info'
        };
      }
      return {
        text: label + periodInfo.label + '是 ' + windowText + '，目前没有安排。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const titleTerm = queryTitleTerm(text, now);
    const askWhen = /(什么时候|几点|哪天|哪一天|几号|在哪(?:里|儿)?|哪个教室|教室|地点)/.test(text);
    if (askWhen && titleTerm.length >= 2) {
      const candidates = store.events
        .filter((e) => e.date >= U.todayStr() && (!dateInfo || e.date === date) && titleMatches(titleTerm, e.title))
        .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
      if (candidates.length) {
        const first = candidates[0];
        let text = '「' + first.title + '」在 ' + dateLabel(first.date) + ' ' +
          U.fmtTime(first.start) + '–' + U.fmtTime(first.end);
        if (first.location) text += '，地点 ' + first.location;
        text += '。';
        if (candidates.length > 1) text += '之后还有 ' + (candidates.length - 1) + ' 项。';
        return {
          text,
          items: itemsFromEvents(candidates.slice(0, 3)),
          tip: candidates.length > 3 ? '只列出了最近 3 项。' : '',
          changed: false,
          kind: 'info'
        };
      }
    }

    const asksClasses = /(课表|几节课|什么课|哪几节课|有课|的课|上课|课程安排)/.test(text);
    if (asksClasses) {
      if (titleTerm.length >= 2 && !dateInfo) {
        const upcoming = store.events
          .filter((e) => e.date >= U.todayStr() && titleMatches(titleTerm, e.title))
          .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
        if (upcoming.length) {
          const first = upcoming[0];
          return {
            text: '「' + first.title + '」下一次是 ' + dateLabel(first.date) + ' ' +
              U.fmtTime(first.start) + '–' + U.fmtTime(first.end) + '。',
            items: itemsFromEvents(upcoming.slice(0, 3)),
            tip: upcoming.length > 1 ? '之后还有 ' + (upcoming.length - 1) + ' 项。' : '',
            changed: false,
            kind: 'info'
          };
        }
        return {
          text: '接下来没有找到「' + titleTerm + '」的安排。',
          items: [],
          changed: false,
          kind: 'info'
        };
      }

      const weekMode = /(本周|这周|这一周|下周|下星期|下礼拜|未来一周|最近一周)/.test(text);
      if (weekMode) {
        const monday = U.mondayOf(date);
        const sunday = U.addDays(monday, 6);
        let classes = classEventsFor(monday, 7);
        if (titleTerm.length >= 2) classes = classes.filter((e) => titleMatches(titleTerm, e.title));
        if (classes.length) {
          const total = classes.reduce((sum, e) => sum + (e.end - e.start), 0);
          return {
            text: U.monthDayCN(monday) + '–' + U.monthDayCN(sunday) + ' 共 ' + classes.length +
              ' 节课，约 ' + U.fmtDuration(total) + '。',
            items: itemsFromEvents(classes),
            tip: '要改某一节，可以说「把周三第1-2节的高数改到第3-4节」。',
            changed: false,
            kind: 'info'
          };
        }
        return {
          text: '这一周没有记录课程。',
          items: [],
          changed: false,
          kind: 'info'
        };
      }

      let classes = classEventsFor(date, 1);
      if (titleTerm.length >= 2) classes = classes.filter((e) => titleMatches(titleTerm, e.title));
      if (classes.length) {
        const total = classes.reduce((sum, e) => sum + (e.end - e.start), 0);
        return {
          text: label + '有 ' + classes.length + ' 节课，共 ' + U.fmtDuration(total) +
            '：' + classes.map((e) => U.fmtTime(e.start) + ' ' + e.title).join('、') + '。',
          items: itemsFromEvents(classes),
          tip: '要改某一节，可以说「把周三第1-2节的高数改到第3-4节」。',
          changed: false,
          kind: 'info'
        };
      }

      const evts = store.byDate(date);
      if (evts.length) {
        return {
          text: label + '没有记录课程，但有 ' + evts.length + ' 项其他安排。',
          items: itemsFromEvents(evts),
          changed: false,
          kind: 'info'
        };
      }
      return {
        text: label + '没有课，也没有其他安排。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const evts = store.byDate(date);

    if (!evts.length) {
      return {
        text: label + '还没有安排，整天都是空的。要现在加一项吗？',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const total = evts.reduce((sum, e) => sum + (e.end - e.start), 0);
    const done = evts.filter((e) => e.done).length;
    let head = label + '共 ' + evts.length + ' 项安排，约 ' + U.fmtDuration(total) + '。';
    if (done) head += '已完成 ' + done + ' 项。';

    const next = evts.find((e) => !e.done && (date !== U.ymd(now) || e.end > now.getHours() * 60 + now.getMinutes()));
    if (next) head += '接下来是 ' + U.fmtTime(next.start) + ' 的「' + next.title + '」。';

    const free = freeWindows(date, now)[0];
    let tip = '';
    if (free) tip = '最长空档：' + U.fmtTime(free.start) + '–' + U.fmtTime(free.end) + '，可安排 ' + U.fmtDuration(free.end - free.start) + '。';

    return { text: head, items: itemsFromEvents(evts), tip, changed: false, kind: 'info' };
  }

  /* ------------------------------------------------------------------ */
  /* DDL 截止事项                                                       */
  /* ------------------------------------------------------------------ */

  function ddlDueAt(ddl) {
    const d = U.fromYmd(ddl.date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(),
      Math.floor(ddl.time / 60), ddl.time % 60, 0, 0);
  }

  function stripDdlPrefix(text) {
    return String(text || '')
      .replace(/^(?:帮我|请|麻烦|劳驾)?\s*/, '')
      .replace(/^(?:把|将)\s*/, '')
      .replace(/^(?:记|加|添加|创建|新建|建)(?:一个|个)?\s*(?:ddl|deadline|死线|截止(?:事项|日期)?)\s*[:：]?\s*/i, '')
      .replace(/^(?:ddl|deadline|死线)\s*[:：]?\s*/i, '')
      .replace(/^截止(?:事项|日期)?\s*[:：]\s*/, '')
      .trim();
  }

  function ddlKeyword(text) {
    return String(text || '')
      .replace(/(?:这个|那个|这条|那条)?\s*(?:ddl|deadline|死线)\s*[:：]?/gi, ' ')
      .replace(/^(?:帮我|请|麻烦|劳驾)?\s*/, '')
      .replace(/^(?:把|将)\s*/, '')
      .replace(/(?:标记为|标成|设为|改成)?\s*(?:已完成|完成|搞定|做完|交了|提交了|已交)/g, ' ')
      .replace(/(?:删除|删掉|删了|删|取消|移除|去掉|不要了)/g, ' ')
      .replace(/(?:改到|改成|改为|推迟到|推迟|延后到|延后|提前到|提前|延期到|延期|挪到|调整到|调整)/g, ' ')
      .replace(/(?:什么时候|几点|哪天|哪一天|有哪些|有什么|多少个|几个|列表|列出|看看|查一下|查查|最近|还有|啥时候|截止到|我的)/g, ' ')
      .replace(/[\s,;:。.!！?？、/|]+/g, ' ')
      .replace(/^(?:的|了)\s*/, '')
      .replace(/\s*(?:了|啦|呀|哦|呢|吧)$/, '')
      .trim();
  }

  function ddlMatches(ddl, keyword) {
    const q = String(keyword || '').toLowerCase().trim();
    if (!q) return true;
    const t = String(ddl.title || '').toLowerCase();
    return t.indexOf(q) > -1 || (t && q.indexOf(t) > -1);
  }

  function ddlTarget(text, now) {
    const dateInfo = extractDate(text, now);
    const timeInfo = extractTimes(text);
    const spans = [];
    if (dateInfo) spans.push([dateInfo.index, dateInfo.index + dateInfo.text.length]);
    timeInfo.spans.forEach((sp) => spans.push(sp));
    return {
      dateInfo,
      timeInfo,
      keyword: ddlKeyword(maskText(text, spans))
    };
  }

  function ddlIntent(text, ctx) {
    const now = ctx.now || new Date();
    const raw = stripDdlPrefix(text);
    const dateInfo = extractDate(raw, now);
    const timeInfo = extractTimes(raw);
    const spans = [];
    if (dateInfo) spans.push([dateInfo.index, dateInfo.index + dateInfo.text.length]);
    timeInfo.spans.forEach((sp) => spans.push(sp));
    const location = extractLocation(raw, spans);
    const title = cleanTitle(raw, spans)
      .replace(/^(?:重要|紧急|高优先|高优先级|低优先|低优先级)\s*/, '')
      .replace(/^(?:的|要)\s*/, '')
      .replace(/\s*(?:之前|以前|前|截止)$/, '')
      .replace(/^[\s,，、;；:：/|]+/, '')
      .replace(/[\s,，、;；:：/|]+$/, '')
      .trim();

    if (!title) return ddlQuery(text, ctx);

    if (!dateInfo) {
      return {
        text: '「' + title + '」哪天截止？补上日期就行，例如「ddl：' + title + ' 周五 23:59」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const time = timeInfo.times.length ? timeInfo.times[0].min : 23 * 60 + 59;
    const ddl = store.addDdl({
      title,
      date: dateInfo.date,
      time,
      note: location ? '地点：' + location : ''
    });

    return {
      text: '已记录 DDL：「' + ddl.title + '」，' + dateLabel(ddl.date) + ' ' +
        U.fmtTime(ddl.time) + ' 截止。',
      items: [],
      tip: '时间轴上会出现红色 DDL 标记，点它就能改时间或标记完成。',
      changed: false,
      ddlChanged: true,
      ddlAction: 'add',
      jumpDate: ddl.date,
      kind: 'ddl'
    };
  }

  function ddlQuery(text, ctx) {
    const now = ctx.now || new Date();
    const target = ddlTarget(text, now);
    let list = store.pendingDdls();
    if (target.dateInfo) list = list.filter((d) => d.date === target.dateInfo.date);
    list = list.filter((d) => ddlMatches(d, target.keyword));

    if (!list.length) {
      return {
        text: target.dateInfo
          ? dateLabel(target.dateInfo.date) + '没有未完成的 DDL。'
          : '现在没有未完成的 DDL。\n可以说「ddl：交实验报告 周五 23:59」加一个。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const lines = list.slice(0, 8).map((d) => {
      const overdue = ddlDueAt(d).getTime() < now.getTime();
      return '· ' + dateLabel(d.date) + ' ' + U.fmtTime(d.time) + ' ' + d.title +
        (overdue ? '（已逾期）' : '');
    });
    if (list.length > 8) lines.push('…还有 ' + (list.length - 8) + ' 个');

    return {
      text: '未完成 DDL 共 ' + list.length + ' 个：\n' + lines.join('\n'),
      items: [],
      tip: '说「完成 DDL：标题」可以勾掉，点时间轴上的红色标记也能编辑。',
      changed: false,
      kind: 'info'
    };
  }

  function ddlDoneIntent(text, ctx) {
    const now = ctx.now || new Date();
    const target = ddlTarget(text, now);
    const list = store.pendingDdls().filter((d) => ddlMatches(d, target.keyword));

    if (!list.length) {
      return {
        text: target.keyword
          ? '没有找到待完成的 DDL「' + target.keyword + '」。'
          : '现在没有待完成的 DDL。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }
    if (list.length > 1) {
      return {
        text: '找到 ' + list.length + ' 个匹配的 DDL，要完成哪一个？\n' +
          list.slice(0, 5).map((d) => '· ' + d.title + '（' + dateLabel(d.date) + ' ' + U.fmtTime(d.time) + '）').join('\n'),
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const ddl = store.updateDdl(list[0].id, { done: true });
    return {
      text: '已完成 DDL：「' + ddl.title + '」。',
      items: [],
      changed: false,
      ddlChanged: true,
      ddlAction: 'done',
      kind: 'ddl'
    };
  }

  function ddlRemoveIntent(text, ctx) {
    const now = ctx.now || new Date();
    const target = ddlTarget(text, now);
    const list = store.ddls.filter((d) => ddlMatches(d, target.keyword));

    if (!list.length) {
      return {
        text: target.keyword
          ? '没有找到 DDL「' + target.keyword + '」。'
          : '要删除哪个 DDL？可以说「删除 DDL：交实验报告」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }
    if (list.length > 1) {
      return {
        text: '找到 ' + list.length + ' 个匹配的 DDL，要删除哪一个？\n' +
          list.slice(0, 5).map((d) => '· ' + d.title + '（' + dateLabel(d.date) + ' ' + U.fmtTime(d.time) + '）').join('\n'),
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    store.removeDdl(list[0].id);
    return {
      text: '已删除 DDL：「' + list[0].title + '」。',
      items: [],
      changed: false,
      ddlChanged: true,
      ddlAction: 'remove',
      kind: 'ddl'
    };
  }

  function ddlUpdateIntent(text, ctx) {
    const now = ctx.now || new Date();
    const target = ddlTarget(text, now);
    const list = store.ddls.filter((d) => ddlMatches(d, target.keyword));

    if (!list.length) {
      return {
        text: target.keyword
          ? '没有找到 DDL「' + target.keyword + '」。'
          : '要改哪个 DDL？可以说「把 DDL：交实验报告 改到周五 18:00」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }
    if (list.length > 1) {
      return {
        text: '找到 ' + list.length + ' 个匹配的 DDL，要改哪一个？\n' +
          list.slice(0, 5).map((d) => '· ' + d.title + '（' + dateLabel(d.date) + ' ' + U.fmtTime(d.time) + '）').join('\n'),
        items: [],
        changed: false,
        kind: 'info'
      };
    }
    if (!target.dateInfo && !target.timeInfo.times.length) {
      return {
        text: '要改到什么时候？例如「把 DDL：交实验报告 改到周五 18:00」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const patch = {};
    if (target.dateInfo) patch.date = target.dateInfo.date;
    if (target.timeInfo.times.length) patch.time = target.timeInfo.times[0].min;
    const ddl = store.updateDdl(list[0].id, patch);
    return {
      text: '已改期：「' + ddl.title + '」现在 ' + dateLabel(ddl.date) + ' ' + U.fmtTime(ddl.time) + ' 截止。',
      items: [],
      changed: false,
      ddlChanged: true,
      ddlAction: 'update',
      kind: 'ddl'
    };
  }

  function dayPeriodRange(word) {
    if (!word) return null;
    if (/凌晨/.test(word)) return [6 * 60, 8 * 60];
    if (/清晨|早上|早晨|上午|今早|明早/.test(word)) return [8 * 60, 12 * 60];
    if (/中午/.test(word)) return [12 * 60, 14 * 60];
    if (/下午|午后/.test(word)) return [13 * 60, 18 * 60];
    if (/傍晚/.test(word)) return [17 * 60, 20 * 60];
    if (/晚上|夜里|夜晚|今晚|明晚/.test(word)) return [18 * 60, 22 * 60];
    return null;
  }

  function freeSlotIntent(text, ctx) {
    const now = ctx.now || new Date();
    const today = U.ymd(now);
    const timeInfo = extractTimes(text);
    const durationInfo = extractDuration(text, timeInfo.spans);
    const hasDuration = !!durationInfo.minutes;
    const duration = hasDuration ? durationInfo.minutes : 30;
    let dateInfo = extractDate(text, now);
    if (dateInfo && /^(?:本周|这周|这一周)$/.test(String(dateInfo.text || '').trim())) {
      dateInfo = null;
    }
    const periodWord = (text.match(PERIOD_SRC) || [])[0] || '';
    const periodRange = dayPeriodRange(periodWord);
    const dates = [];

    if (dateInfo) {
      dates.push(dateInfo.date);
    } else if (/(本周|这周|这一周)/.test(text)) {
      const monday = U.mondayOf(today);
      for (let i = 0; i < 7; i++) {
        const date = U.addDays(monday, i);
        if (date >= today) dates.push(date);
      }
    } else {
      for (let i = 0; i < 7; i++) dates.push(U.addDays(today, i));
    }

    const slots = [];
    dates.forEach((date) => {
      let windows = freeWindows(date, now);
      if (periodRange) {
        windows = windows
          .map((w) => ({ start: Math.max(w.start, periodRange[0]), end: Math.min(w.end, periodRange[1]) }))
          .filter((w) => w.end - w.start >= duration);
      }
      windows.sort((a, b) => a.start - b.start);
      windows.forEach((w) => {
        if (w.end - w.start >= duration) slots.push({ date, start: w.start, end: w.end });
      });
    });

    if (!slots.length) {
      const scope = dateInfo ? dateLabel(dateInfo.date) : '接下来 7 天';
      return {
        text: scope + '没有连续 ' + U.fmtDuration(duration) + ' 的空档。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const picked = slots.slice(0, 3);
    const lines = picked.map((slot) =>
      '· ' + dateLabel(slot.date) + ' ' + U.fmtTime(slot.start) + '–' + U.fmtTime(slot.end) +
      '（' + U.fmtDuration(slot.end - slot.start) + '）');
    return {
      text: (hasDuration ? '找到 ' + picked.length + ' 个 ' + U.fmtDuration(duration) + '空档：' : '这几个时段有空：') +
        '\n' + lines.join('\n'),
      items: [],
      tip: '要排进去，直接说「把…排到' + dateLabel(picked[0].date) + ' ' + U.fmtTime(picked[0].start) + '」。',
      changed: false,
      kind: 'info'
    };
  }

  function rolloverIntent(text, ctx) {
    const now = ctx && ctx.now ? ctx.now : new Date();
    const sourceDate = /今天/.test(text || '')
      ? U.ymd(now)
      : (ctx && ctx.selectedDate) || U.ymd(now);
    return {
      text: '好，打开顺延面板。勾选要挪的日程，再选「明天同一时间」或「下一个空档」。',
      items: [],
      changed: false,
      kind: 'info',
      openRollover: true,
      rolloverDate: sourceDate
    };
  }

  function taskIntent(text, ctx) {
    const now = ctx.now || new Date();
    const today = U.ymd(now);
    let raw = text
      .replace(/^(?:帮我|请|麻烦)?\s*/, '')
      .replace(/^(?:任务|待办)\s*[:：]\s*/, '')
      .replace(/^(?:把|将)\s*/, '')
      .replace(/(?:放进|加到|放到|加入)收件箱(?:里|中)?[。.!！]?$/, '')
      .replace(/^(?:记|加|添加|创建)(?:一个)?任务\s*[:：]?\s*/, '')
      .replace(/^(?:记住|记一下|记下|记个|记)\s*/, '')
      .trim();

    const dateInfo = extractDate(raw, now);
    const timeInfo = extractTimes(raw);
    const durationInfo = extractDuration(raw, timeInfo.spans);
    const spans = [];
    if (dateInfo) spans.push([dateInfo.index, dateInfo.index + dateInfo.text.length]);
    timeInfo.spans.forEach((sp) => spans.push(sp));
    durationInfo.spans.forEach((sp) => spans.push(sp));
    const location = extractLocation(raw, spans);
    let title = cleanTitle(raw, spans)
      .replace(/^(?:重要|紧急|高优先|高优先级|低优先|低优先级)\s*/, '')
      .replace(/^(?:的|要)\s*/, '')
      .replace(/\s*(?:之前|以前|前|截止)$/, '')
      .replace(/^[\s,，、;；:：/|]+/, '')
      .replace(/[\s,，、;；:：/|]+$/, '')
      .trim();
    if (!title) {
      return {
        text: '要记什么任务？比如「任务：写周报 2 小时，周五前」或「把买牛奶放进收件箱」。',
        items: [],
        changed: false
      };
    }

    const priority = /重要|紧急|高优先|马上|立刻|必须/.test(text) ? '高' : /不急|低优先|有空/.test(text) ? '低' : '中';
    const task = store.addTask({
      title,
      estimate: durationInfo.minutes || 60,
      priority,
      due: dateInfo ? dateInfo.date : null,
      category: detectCategory(title + ' ' + raw),
      note: location ? '地点：' + location : ''
    });

    return {
      text: '已放进收件箱：「' + task.title + '」' +
        (task.estimate ? '，预计 ' + U.fmtDuration(task.estimate) : '') +
        (task.due ? '，' + dateLabel(task.due) + '前' : '') + '。',
      items: [],
      tip: '点「自动排程」，我会避开已有日程和午休，把它放进空档。',
      changed: false,
      kind: 'task',
      openTasks: true
    };
  }

  function weekReview(text, ctx) {
    const now = ctx.now || new Date();
    const today = U.ymd(now);
    const monday = U.mondayOf(today);
    const sunday = U.addDays(monday, 6);
    const evts = store.between(monday, sunday);
    const planned = evts.reduce((sum, e) => sum + (e.end - e.start), 0);
    const done = evts.filter((e) => e.done).length;
    const focus = store.focusLog.filter((f) => f.date >= monday && f.date <= sunday);
    const actual = focus.reduce((sum, f) => sum + (Number(f.actualMinutes) || 0), 0);
    const focusPlanned = focus.reduce((sum, f) => sum + (Number(f.plannedMinutes) || 0), 0);
    const inbox = store.inboxTasks();
    const overdue = inbox.filter((t) => t.due && t.due < today).length;

    const byDate = {};
    evts.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    let conflicts = 0;
    Object.keys(byDate).forEach((date) => {
      const list = byDate[date];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) if (overlap(list[i], list[j])) conflicts++;
      }
    });

    const catTotals = {};
    evts.forEach((e) => { catTotals[e.category] = (catTotals[e.category] || 0) + (e.end - e.start); });
    const topCat = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a])[0];

    const lines = ['本周 · ' + U.monthDayCN(monday) + '–' + U.monthDayCN(sunday)];
    if (evts.length) {
      lines.push('安排 ' + evts.length + ' 项 · 计划 ' + U.fmtDuration(planned) + ' · 完成 ' + done + ' 项');
    } else {
      lines.push('本周还没有安排。');
    }
    if (focus.length) {
      lines.push('实际专注 ' + U.fmtDuration(actual) + '（计划 ' + U.fmtDuration(focusPlanned) + '）');
    }
    if (topCat) lines.push('时间最多：' + topCat + ' ' + U.fmtDuration(catTotals[topCat]));
    if (conflicts) lines.push(conflicts + ' 处时间重叠。');
    if (inbox.length) lines.push('收件箱还有 ' + inbox.length + ' 个任务' + (overdue ? '，' + overdue + ' 个已逾期' : '') + '。');

    let tip = '';
    if (overdue) tip = '先处理 ' + overdue + ' 个逾期任务，再排新的。';
    else if (inbox.length) tip = '把收件箱的 ' + inbox.length + ' 个任务排进下周空档。';
    else if (conflicts) tip = '处理这 ' + conflicts + ' 处重叠，能省出一段完整时间。';
    else if (evts.length && done < evts.length) tip = '还有 ' + (evts.length - done) + ' 项没完成，可以顺延到明天。';
    else tip = '这周节奏不错，保持。';

    return { text: lines.join('\n'), items: [], tip, changed: false, kind: 'review' };
  }

  function dailyBrief(ctx) {
    const now = ctx.now || new Date();
    const today = U.ymd(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const evts = store.byDate(today);
    const total = evts.reduce((sum, e) => sum + (e.end - e.start), 0);
    const next = evts
      .filter((e) => !e.done && e.end > nowMin)
      .sort((a, b) => a.start - b.start)[0];
    const free = freeWindows(today, now)[0];
    const inbox = store.inboxTasks();
    const overdue = inbox.filter((t) => t.due && t.due < today).length;

    const lines = [];
    if (evts.length) {
      lines.push('今天 ' + evts.length + ' 项 · ' + U.fmtDuration(total) +
        (next ? '，下一项 ' + U.fmtTime(next.start) + ' ' + next.title : '，已没有后续安排') + '。');
      if (free) lines.push('最长空档 ' + U.fmtTime(free.start) + '–' + U.fmtTime(free.end) + '。');
    } else {
      lines.push('今天还没有安排。');
    }
    if (inbox.length) {
      lines.push('收件箱还有 ' + inbox.length + ' 个任务' + (overdue ? '，' + overdue + ' 个已逾期' : '') + '。');
    }

    return {
      text: lines.join('\n'),
      items: [],
      tip: inbox.length ? '点顶部的「任务」或说「把收件箱排进明天」。' : '把会议、任务或截图发给我。',
      changed: false,
      kind: 'brief'
    };
  }

  function addResponse(result, ctx) {
    const created = result.created;
    if (!created.length) {
      if (result.needsTimetable) {
        return {
          text: '我还不清楚你们的第几节是几点。\n先把课表节次设置好，我就能把「周三第1到2节 高数」换算成具体时间。',
          items: [],
          changed: false,
          kind: 'info',
          openTimetable: true,
          tip: '点这里打开课表节次设置，填好每节课的开始 / 结束时间。'
        };
      }
      if (result.periodIssue) {
        return {
          text: '课表里只有 ' + (store.getTimetable().length) + ' 节，没有找到 ' + result.periodIssue + '。\n先到课表节次里补上这一节，再试一次。',
          items: [],
          changed: false,
          kind: 'info',
          openTimetable: true
        };
      }
      if (result.needsSemester) {
        return {
          text: '检测到课表周次，但还没设置「学期第 1 周周一」。\n如果按今天反推，整学期课程都会错位；先到课表节次里填好学期第 1 周，再发一次。',
          items: [],
          changed: false,
          kind: 'info',
          openTimetable: true
        };
      }
      if (result.weekIssue) {
        return {
          text: '「' + result.weekIssue + '」这些周次都已经过去了，或者学期第 1 周设置有误。\n到课表设置里检查「学期第 1 周周一」，或者直接说「每周三第1-2节 高数」按未来一年排。',
          items: [],
          changed: false,
          kind: 'info',
          openTimetable: true
        };
      }
      if (result.skipped.length) {
        return {
          text: '这些安排已经在时间轴上了，没有重复添加。',
          items: [],
          changed: false,
          kind: 'info'
        };
      }
      return {
        text: '这句话里我没找到可以落成日程的内容。试试带上「做什么 + 什么时候」，例如「明天下午 3 点产品评审 1 小时」。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    const total = created.reduce((sum, e) => sum + (e.end - e.start), 0);
    let text;
    if (created.length === 1) {
      const one = created[0];
      text = '已加入「' + one.title + '」，' + U.fmtTime(one.start) + '–' + U.fmtTime(one.end) +
        '，共 ' + U.fmtDuration(one.end - one.start) + '。';
    } else {
      text = '已加入 ' + created.length + ' 项日程，共 ' + U.fmtDuration(total) + '。';
    }
    if (result.repeatNotes.length) text += result.repeatNotes.join('，') + '。';

    const dates = dedupe(created.map((e) => e.date));
    if (dates.length === 1) {
      text += (created.length === 1 ? '安排在 ' : '都安排在 ') + dateLabel(dates[0]) + '。';
    } else {
      text += '分布在 ' + dateLabel(dates[0]) + ' 起的时间轴里。';
    }

    let tip = result.warnings.slice(0, 3).join(' ');
    if (result.needsTimetable) {
      tip += (tip ? ' ' : '') + '有节次还没设置课表时间，已跳过；设置后重新发一次即可。';
    } else if (result.needsSemester) {
      tip += (tip ? ' ' : '') + '有课表周次还没设置学期第 1 周，已跳过；设置后重新发一次即可。';
    } else if (result.periodIssue) {
      tip += (tip ? ' ' : '') + '课表里没有 ' + result.periodIssue + '，已跳过。';
    } else if (result.weekIssue) {
      tip += (tip ? ' ' : '') + '「' + result.weekIssue + '」没有可用的未来周次，已跳过。';
    } else if (result.skipped.length) {
      tip += (tip ? ' ' : '') + '有 ' + result.skipped.length + ' 项重复或信息不足，已跳过。';
    }
    if (result.truncated) {
      tip += (tip ? ' ' : '') + '单次最多处理 3000 项，超出的部分已截断；可以分几次发送。';
    }

    return {
      text,
      items: itemsFromEvents(created).slice(0, 20),
      tip: (tip ? tip + ' ' : '') + (created.length > 20 ? '聊天里只列出前 20 项，其余已在时间轴上。' : ''),
      changed: true,
      kind: 'add'
    };
  }

  /* ------------------------------------------------------------------ */
  /* 本地智能体                                                         */
  /* ------------------------------------------------------------------ */

  function localRespond(text, ctx, fallbackNote) {
    let t = String(text || '').trim();
    if (!t) return { text: '说点什么吧，我在听。', items: [], changed: false };
    t = normalizeText(t);

    const intent = detectIntent(t);
    if (intent === 'add') t = applyLocalMemory(t, ctx || {});

    if (intent === 'greet') {
      return {
        text: '你好，我是时序。把会议、任务、想法直接发给我，我会读懂日期和时刻，拆成时间轴上的色块。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    if (intent === 'help') {
      return {
        text: '你可以这样告诉我：\n· 明天下午 3 点产品评审 1 小时，在 3 楼会议室\n· 下周一早上 9 点汇报，1 个半小时\n· 每天 7 点跑步 30 分钟\n· 周三第1到2节 高等数学\n· 每周五第3-4节 大学物理\n· 周五前提交周报\n· ddl：交实验报告 周五 23:59\n· ddl 有哪些\n· 完成 DDL：交实验报告\n· 今天有什么安排？\n· 删掉明天 10 点的会议\n我会自动识别日期、时刻、时长、地点和分类；设置课表后，还能把「第几节」换算成具体时间。',
        items: [],
        changed: false,
        kind: 'info'
      };
    }

    if (intent === 'chat') {
      if (/(谢谢|多谢|感谢|辛苦)/.test(t)) {
        return { text: '不客气。要加日程、改时间或查安排，直接说就行。', items: [], changed: false, kind: 'info' };
      }
      if (/(累|困|无聊|烦|不开心)/.test(t)) {
        return {
          text: '先歇一会儿吧。要我把休息时间放进今天吗？',
          items: [],
          tip: '可以说「今天下午 4 点休息 30 分钟」。',
          changed: false,
          kind: 'info'
        };
      }
      return { text: '收到。接下来要做什么，直接告诉我。', items: [], changed: false, kind: 'info' };
    }

    if (intent === 'remove') {
      const res = removeIntent(t, ctx);
      if (fallbackNote) res.tip = fallbackNote;
      return res;
    }

    if (intent === 'update') {
      const res = updateIntent(t, ctx);
      if (fallbackNote) res.tip = fallbackNote;
      return res;
    }

    if (intent === 'review') return weekReview(t, ctx);
    if (intent === 'task') return taskIntent(t, ctx);
    if (intent === 'free') return freeSlotIntent(t, ctx);
    if (intent === 'rollover') return rolloverIntent(t, ctx);
    if (intent === 'ddl') return ddlIntent(t, ctx);
    if (intent === 'ddlQuery') return ddlQuery(t, ctx);
    if (intent === 'ddlDone') return ddlDoneIntent(t, ctx);
    if (intent === 'ddlRemove') return ddlRemoveIntent(t, ctx);
    if (intent === 'ddlUpdate') return ddlUpdateIntent(t, ctx);

    if (intent === 'query') {
      const res = queryIntent(t, ctx);
      if (fallbackNote) res.tip = fallbackNote;
      return res;
    }

    const now = ctx.now || new Date();
    const lines = inheritLineContext(baseSegments(t), now);
    const segments = [];
    lines.forEach((line) => {
      splitTimeClauses(line, now).forEach((piece) => segments.push(piece));
    });

    const result = buildEvents(segments, Object.assign({}, ctx, { now }));
    const res = addResponse(result, ctx);
    if (fallbackNote) res.tip = (res.tip ? res.tip + ' ' : '') + fallbackNote;
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* 大模型                                                             */
  /* ------------------------------------------------------------------ */

  function parseJSONLoose(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(text);
    } catch (e) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start > -1 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e2) { /* noop */ }
      }
    }
    return null;
  }

  function recentHistory(limit) {
    const all = store.messages || [];
    let src = all;
    if (src.length && src[src.length - 1].role === 'user') src = src.slice(0, -1);
    return src.slice(-limit).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.text || '').slice(0, 800)
    })).filter((m) => m.content.trim());
  }

  function systemPrompt(ctx) {
    const now = ctx.now || new Date();
    const today = U.ymd(now);
    const time = U.fmtTime(now.getHours() * 60 + now.getMinutes());
    const start = U.addDays(today, -1);
    const end = U.addDays(today, 21);
    const existing = store.events
      .filter((e) => e.date >= start && e.date <= end)
      .slice(0, 240)
      .map((e) => ({
        id: e.id, title: e.title, date: e.date,
        start: U.fmtTime(e.start), end: U.fmtTime(e.end),
        category: e.category, location: e.location, done: e.done
      }));
    const timetable = store.getTimetable().map((p, i) => ({
      period: i + 1,
      start: U.fmtTime(p.start),
      end: U.fmtTime(p.end)
    }));
    const focusEvent = contextualEvent(ctx);
    const ddls = store.pendingDdls().slice(0, 50).map((d) => ({
      id: d.id, title: d.title, date: d.date, time: U.fmtTime(d.time), note: d.note
    }));

    return [
      '你是「时序 DayFlow」的日程智能体，负责把用户的自然语言整理成日程。',
      '当前时间：' + today + ' ' + time + '（' + U.weekdayCN(today) + '）。用户正在查看：' + (ctx.selectedDate || today) + '。',
      '最近对话已附在用户消息之前，请结合上下文理解省略、指代和连续追问。',
      '学期第 1 周周一：' + (store.getSemesterStart() || '未设置'),
      '已有日程（JSON）：' + JSON.stringify(existing),
      '课表节次（JSON）：' + (timetable.length ? JSON.stringify(timetable) : '未设置'),
      '未完成 DDL（JSON）：' + (ddls.length ? JSON.stringify(ddls) : '无'),
      '当前选中 / 最近操作的日程：' + (focusEvent
        ? JSON.stringify({
          id: focusEvent.id,
          title: focusEvent.title,
          date: focusEvent.date,
          start: U.fmtTime(focusEvent.start),
          end: U.fmtTime(focusEvent.end),
          note: focusEvent.note
        })
        : '无'),
      '',
      '只输出一个 JSON 对象，不要输出 markdown 代码块或多余解释，格式：',
      '{"reply":"给用户的中文回复，简洁自然","actions":[...]}',
      'action 支持以下类型：',
      '{"type":"add","title":"标题","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","category":"工作","location":"","note":""}',
      '{"type":"addSeries","title":"高等数学","date":"第一周上课日","start":"HH:MM","end":"HH:MM","category":"学习","location":"","note":"","repeat":{"type":"weekly","weekdays":[3]},"until":"学期结束日期"}',
      '课表周次也可以用 repeat：{"type":"weeks","weeks":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]}',
      '{"type":"remove","id":"已有日程的 id"} 或 {"type":"remove","date":"YYYY-MM-DD","title":"标题关键词"}',
      '{"type":"update","id":"已有日程的 id","date":"可选","start":"可选","end":"可选","title":"可选","note":"可选"}',
      '{"type":"addDdl","title":"交实验报告","date":"YYYY-MM-DD","time":"HH:MM","note":""}',
      '{"type":"doneDdl","id":"已有 DDL 的 id"} 或 {"type":"doneDdl","title":"标题关键词"}',
      '{"type":"removeDdl","id":"已有 DDL 的 id"} 或 {"type":"removeDdl","title":"标题关键词"}',
      '{"type":"updateDdl","id":"已有 DDL 的 id","date":"可选","time":"可选","title":"可选","note":"可选"}',
      '',
      '规则：',
      '1. category 只能是：工作、学习、运动、生活、社交、休息、其他。',
      '2. 时间用 24 小时制 HH:MM，日期用 YYYY-MM-DD。',
      '3. 用户没有给具体时间时，请选择当天 09:00–22:00 的空档，并在 reply 中说明是智能排入。',
      '4. 用户说「每天/每周」、整张课表、或「1-16周」这类固定课程时，用 addSeries：一门课只生成一个 action，repeat 用 weekly 或 weeks，不要逐周生成 add；until 可以指定学期末。只有一次性安排才用 add。',
      '5. 用户只是想查询时，actions 为空数组，把日程概括写进 reply。',
      '6. 不要编造用户没说的安排；删除、修改要精确匹配已有日程 id。',
      '7. 如果用户上传图片，请识别图片中的日期、时间、事项、地点、课程表、聊天截图或海报内容，整理成 actions；不要编造图片里没有的信息。',
      '8. 图片可能没有附带文字，此时直接根据图片生成日程；无法确定的内容写进 reply。',
      '9. 用户说「第N节」「第N到M节」时，必须用上面的课表节次换算成具体 start/end；课表未设置或没有对应节次时，不要猜时间，actions 留空并在 reply 里请用户先在设置里填写课表节次。',
      '13. 用户给出整学期课表时，优先用 addSeries 一门课一个 action；不要只排一周，也不要把同一门课拆成几十个 add。',
      '10. 用户说「改成…」「推迟半小时」「取消它」但没有明确标题时，优先操作「当前选中 / 最近操作的日程」；如果有多个候选，先在 reply 里问清楚，actions 留空。',
      '11. 用户问「第N节几点」「这周几节课」「周三有什么课」时，直接回答，不要新增日程。',
      '12. 尽量理解口语、省略、代词和连续对话；不确定就追问一句，不要猜。',
      '14. 图片或长文本里出现「1-16周」「第1-16周」「单双周」时，必须以「学期第 1 周周一」为基准换算；未设置学期第 1 周时不要用今天反推，不要让第 1 周对齐到今天，actions 留空并在 reply 里请用户先设置。',
      '15. 「DDL / deadline / 截止」是截止事项，不是日程：用 addDdl / doneDdl / removeDdl / updateDdl，不要用 add 把它排成一段时间。DDL 只记录截止日期、时刻和标题。',
      '16. 用户说「完成 DDL：标题」时用 doneDdl；说「删除 DDL：标题」时用 removeDdl；说「把 DDL：标题 改到周五 18:00」时用 updateDdl。',
      '17. 识别课程表时逐格照抄，不许概括、简写或改字：',
      '   · location 必须是完整的「楼名 + 房间号」，例如「文萃楼F504」不能写成「萃楼F504」「东楼504」，「理教楼308」不能写成「教楼308」，「教A106」「综教A303」「工训楼915」原样保留。',
      '   · note 写成「周次 + 星期 + 节次」，例如「1-16周 周一第1-2节」；周次分段照抄，如「1-7,9-16周」「9-13周」。',
      '   · 一门课的每个上课日各生成一条 addSeries（不同星期、不同教室分别一条），repeat 用 weeks，weeks 填这一格的周次。',
      '   · start/end 用课表节次换算；某一格没有节次或表里没写，就不要猜，留空并在 reply 里说明。',
      '18. 用户一次发整张课程表时，直接给出全量 addSeries（通常 ≥5 条）；系统会先清空旧课程表再按新的重建，不会叠成两份。',
      '19. 课表里的「调课信息」只影响个别周，不改变常规周次：常规课按表里写的周次排，调课单独用 add 加某一天。',
      '20. 图片是一整张课程表时，不要用 add/addSeries，改用结构化动作：',
      '{"type":"courses","items":[{"title":"数学分析 I06","weekday":1,"periodStart":1,"periodEnd":2,"weeks":"1-16","room":"文萃楼F504"}]}',
      '   · weekday 用 1-7（周一=1），按这一格所在的「列」算；表格有合并单元格时，不要把课复制到相邻的列。',
      '   · periodStart / periodEnd 填节次数字（1/2、3/5、8/10、11/13），不要填钟点。',
      '   · weeks 写周次字符串，如 "1-16"、"1-7,9-16"、"14"。',
      '   · room 原样抄「楼名 + 房间号」，看不清就留空，不要猜、不要缩写。',
      '   · 同一门课有几个上课日就写几条；同一格跨多行（不同周次或不同教室）也要分开写。',
      '   · 不要给 start/end，时间由程序按课表节次换算。'
    ].join('\n');
  }

  function parseWeeks(text) {
    const raw = String(text == null ? '' : text).replace(/周/g, ' ').trim();
    const out = [];
    raw.split(/[，,、;；\s]+/).forEach((part) => {
      if (!part) return;
      const m = /^(\d{1,2})\s*[-–—~～至到]\s*(\d{1,2})$/.exec(part);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
          if (w >= 1 && w <= 60 && out.indexOf(w) < 0) out.push(w);
        }
        return;
      }
      const one = Number(part);
      if (Number.isInteger(one) && one >= 1 && one <= 60 && out.indexOf(one) < 0) out.push(one);
    });
    return out.sort((a, b) => a - b);
  }

  function weekLabelOf(weeks) {
    if (!weeks.length) return '';
    const parts = [];
    let s = weeks[0];
    let p = weeks[0];
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i] === p + 1) {
        p = weeks[i];
        continue;
      }
      parts.push(s === p ? String(s) : s + '-' + p);
      s = p = weeks[i];
    }
    parts.push(s === p ? String(s) : s + '-' + p);
    return parts.join(',') + '周';
  }

  /** 整张课程表（结构化）→ series + 日程，时间全部按课表节次算，不采信模型给的时间。 */
  function applyCourseTable(items) {
    const warnings = [];
    const periods = store.getTimetable();
    const semester = store.getSemesterStart();
    const today = U.todayStr();
    const CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    if (!periods.length) {
      return { cleared: 0, warnings: ['课表节次还没设置，先到「课表节次」里填好每节课的时间。'] };
    }
    if (!semester) {
      return { cleared: 0, warnings: ['还没设置学期第 1 周，先到课表设置里填好。'] };
    }
    const cleared = store.clearSeries();
    if (cleared) warnings.push('已替换旧的 ' + cleared + ' 组课程。');

    const placed = [];
    const byDay = {};
    let n = 0;
    items.forEach((it) => {
      const wd = Number(it.weekday);
      const p1 = Number(it.periodStart);
      const p2 = Number(it.periodEnd) || p1;
      if (!(wd >= 1 && wd <= 7) || !(p1 >= 1) || p1 > periods.length) return;
      const last = Math.min(Math.max(p2, p1), periods.length);
      const weeks = Array.isArray(it.weeks) ? it.weeks.map(Number) : parseWeeks(it.weeks);
      if (!weeks.length) return;
      const title = String(it.title || '').trim();
      if (!title) return;

      const clash = placed.find((p) => p.wd === wd && p.p1 === p1 && p.p2 === last
        && p.weeks.some((w) => weeks.indexOf(w) > -1));
      if (clash) {
        warnings.push(CN[wd] + '第' + (p1 === last ? p1 : p1 + '-' + last) + '节「' + title
          + '」和「' + clash.title + '」周次重叠，可能是同一格被读成了两门课。');
      }
      placed.push({ wd, p1, p2: last, weeks, title });

      const dates = weeks
        .map((w) => U.addDays(semester, (w - 1) * 7 + (wd - 1)))
        .filter((d) => d >= today)
        .sort();
      if (!dates.length) return;
      const start = periods[p1 - 1].start;
      const end = periods[last - 1].end;
      const note = weekLabelOf(weeks) + ' ' + CN[wd]
        + '第' + (p1 === last ? p1 : p1 + '-' + last) + '节';
      const room = String(it.room || '').trim();
      const res = store.addSeries({
        title,
        start,
        end,
        category: '学习',
        location: room,
        note,
        reminder: 10,
        startDate: dates[0],
        until: dates[dates.length - 1],
        rule: { type: 'weeks', weeks }
      }, dates.map((date) => ({
        title,
        date,
        start,
        end,
        category: '学习',
        location: room,
        note,
        reminder: 10
      })));
      if (res && res.series) {
        n++;
        byDay[wd] = (byDay[wd] || 0) + 1;
      }
    });
    const summary = Object.keys(byDay).sort((a, b) => a - b)
      .map((k) => CN[k] + byDay[k]).join(' · ');
    warnings.push('按课程表写入 ' + n + ' 条' + (summary ? '（' + summary + '）' : ''));
    return { cleared, warnings };
  }

  function applyActions(actions) {
    const now = new Date();
    const added = [];
    let needsSemester = false;
    const addCandidates = [];
    const changedItems = [];
    const removed = [];
    const changedDdls = [];
    const warnings = [];

    const seriesCount = (actions || []).filter((a) => a && a.type === 'addSeries').length;
    const courseItems = [];
    (actions || []).forEach((a) => {
      if (!a || a.type !== 'courses') return;
      (a.items || []).forEach((it) => {
        if (it && it.title) courseItems.push(it);
      });
    });
    let clearedSeries = 0;
    if (seriesCount >= 5) {
      // 一次给整张课程表：先把旧的课程表清掉，避免新旧两套叠在一起
      clearedSeries = store.clearSeries();
      if (clearedSeries) warnings.push('已按新课程表替换旧的 ' + clearedSeries + ' 组重复日程。');
    }

    (actions || []).forEach((action) => {
      if (!action || !action.type) return;

      if (action.type === 'add') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(action.date || '') ? action.date : U.todayStr();
        let start = U.parseTimeStr(action.start);
        if (!Number.isFinite(start)) start = 9 * 60;
        let end = U.parseTimeStr(action.end);
        if (!Number.isFinite(end) || end <= start) end = Math.min(1439, start + 60);
        const category = CATEGORIES[action.category] ? action.category : detectCategory(action.title || '');
        const candidate = {
          title: action.title || '新日程',
          date,
          start,
          end,
          category,
          location: action.location || '',
          note: action.note || '',
          source: 'agent'
        };
        const conflict = conflictsFor(candidate, store.events);
        if (conflict) warnings.push('「' + candidate.title + '」与「' + conflict.title + '」时间重叠。');
        addCandidates.push(candidate);
      }

      if (action.type === 'addSeries') {
        const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(action.date || '') ? action.date : U.todayStr();
        let start = U.parseTimeStr(action.start);
        if (!Number.isFinite(start)) start = 9 * 60;
        let end = U.parseTimeStr(action.end);
        if (!Number.isFinite(end) || end <= start) end = Math.min(1439, start + 60);
        const category = CATEGORIES[action.category] ? action.category : detectCategory(action.title || '');
        let repeat = action.repeat;
        if (typeof repeat === 'string') repeat = { type: repeat, weekdays: [] };
        if (!repeat || !repeat.type) repeat = { type: 'weekly', weekdays: [U.weekdayOf(baseDate)] };
        if (repeat.type === 'weekly' && (!Array.isArray(repeat.weekdays) || !repeat.weekdays.length)) {
          repeat.weekdays = [U.weekdayOf(baseDate)];
        }

        let dates = [];
        if (repeat.type === 'weeks' && Array.isArray(repeat.weeks) && repeat.weeks.length) {
          const weeks = repeat.weeks.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
          const info = {
            weeks,
            label: repeat.label || (weeks.length ? weeks[0] + '-' + weeks[weeks.length - 1] + '周' : '周次'),
            parity: repeat.parity || ''
          };
          const range = weekRangeDates(info, baseDate, now);
          dates = range.dates;
          if (range.missingSemester) {
            needsSemester = true;
            warnings.push('还没设置学期第 1 周，无法按周次排课。');
          } else if (range.warning) {
            warnings.push(range.warning);
          }
        } else {
          dates = repeatDates(baseDate, repeat, now);
        }
        if (action.until && /^\d{4}-\d{2}-\d{2}$/.test(action.until)) {
          dates = dates.filter((date) => date <= action.until);
        }
        if (!dates.length) {
          warnings.push('「' + (action.title || '这项') + '」没有可用的未来日期，已跳过。');
          return;
        }

        const result = store.addSeries({
          title: action.title || '新日程',
          start,
          end,
          category,
          location: action.location || '',
          note: action.note || '',
          reminder: 10,
          startDate: dates[0],
          until: dates[dates.length - 1],
          rule: repeat
        }, dates.map((date) => ({
          title: action.title || '新日程',
          date,
          start,
          end,
          category,
          location: action.location || '',
          note: action.note || '',
          reminder: 10,
          source: 'agent'
        })));
        added.push.apply(added, result.events);
        changedItems.push.apply(changedItems, result.events);
      }

      if (action.type === 'remove') {
        let targets = [];
        if (action.id) {
          const evt = store.get(action.id);
          if (evt) targets = [evt];
        } else if (action.title) {
          const pool = action.date ? store.byDate(action.date) : store.events;
          targets = pool.filter((e) => e.title.indexOf(action.title) > -1 || action.title.indexOf(e.title) > -1);
        }
        if (targets.length) {
          removed.push.apply(removed, store.remove(targets.map((e) => e.id)));
        }
      }

      if (action.type === 'update' && action.id) {
        const evt = store.get(action.id);
        if (!evt) return;
        const patch = {};
        if (/^\d{4}-\d{2}-\d{2}$/.test(action.date || '')) patch.date = action.date;
        const newStart = U.parseTimeStr(action.start);
        const newEnd = U.parseTimeStr(action.end);
        if (Number.isFinite(newStart)) patch.start = newStart;
        if (Number.isFinite(newEnd)) patch.end = newEnd;
        if (patch.start != null && patch.end == null) {
          patch.end = Math.min(1439, patch.start + (evt.end - evt.start));
        }
        if (action.title) patch.title = action.title;
        if (action.note != null) patch.note = action.note;
        if (CATEGORIES[action.category]) patch.category = action.category;
        const updated = store.update(evt.id, patch);
        if (updated) changedItems.push(updated);
      }

      if (action.type === 'addDdl') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(action.date || '') ? action.date : U.todayStr();
        let time = U.parseTimeStr(action.time);
        if (!Number.isFinite(time)) time = 23 * 60 + 59;
        const ddl = store.addDdl({
          title: action.title || '新 DDL',
          date,
          time,
          note: action.note || '',
          source: 'agent'
        });
        changedDdls.push(ddl);
      }

      if (action.type === 'doneDdl' || action.type === 'removeDdl' || action.type === 'updateDdl') {
        let target = action.id ? store.getDdl(action.id) : null;
        if (!target && action.title) {
          const pool = store.ddls.filter((d) =>
            d.title.indexOf(action.title) > -1 || action.title.indexOf(d.title) > -1);
          if (pool.length === 1) target = pool[0];
          else if (pool.length > 1) {
            warnings.push('找到多个匹配的 DDL，已跳过「' + action.title + '」。');
            return;
          }
        }
        if (!target) {
          warnings.push('没有找到 DDL「' + (action.title || action.id || '') + '」。');
          return;
        }
        if (action.type === 'doneDdl') {
          changedDdls.push(store.updateDdl(target.id, { done: true }));
        } else if (action.type === 'removeDdl') {
          store.removeDdl(target.id);
          changedDdls.push(target);
        } else {
          const patch = {};
          if (/^\d{4}-\d{2}-\d{2}$/.test(action.date || '')) patch.date = action.date;
          if (action.time) patch.time = action.time;
          if (action.title) patch.title = action.title;
          if (action.note != null) patch.note = action.note;
          changedDdls.push(store.updateDdl(target.id, patch));
        }
      }
    });

    if (addCandidates.length) {
      const evts = store.addMany(addCandidates);
      added.push.apply(added, evts);
      changedItems.push.apply(changedItems, evts);
    }

    if (courseItems.length) {
      const built = applyCourseTable(courseItems);
      built.warnings.forEach((w) => warnings.push(w));
      clearedSeries = Math.max(clearedSeries, built.cleared || 0);
    }
    if (seriesCount) store.fixCourseTimes();
    return { added, removed, changedItems, changedDdls, clearedSeries, warnings: dedupe(warnings), needsSemester };
  }

  function isCourseTableRequest(text) {
    return /(课表|课程表|课程安排|上课时间|我的课|本学期课|排课)/.test(String(text || ''));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读不出来'));
      img.src = dataUrl;
    });
  }

  /** 按「节次标签列 + 星期二那一列」裁成 7 条竖条，消掉列对齐歧义。 */
  async function columnStrips(dataUrl, days) {
    const img = await loadImage(dataUrl);
    const W = img.width;
    const H = img.height;
    if (!W || !H) throw new Error('图片尺寸不对');
    const labelW = Math.max(1, Math.round(W * 0.085));
    const colW = Math.max(1, Math.round((W - labelW) / days));
    const th = Math.min(H, 2600);
    const scale = th / H;
    const out = [];
    for (let i = 0; i < days; i++) {
      const sx = labelW + i * colW;
      const sw = Math.max(1, Math.min(colW, W - sx));
      const lw = Math.max(1, Math.round(labelW * scale));
      const cw = lw + Math.max(1, Math.round(sw * scale));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = th;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cw, th);
      g.drawImage(img, 0, 0, labelW, H, 0, 0, lw, th);
      g.drawImage(img, sx, 0, sw, H, lw, 0, cw - lw, th);
      out.push(c.toDataURL('image/jpeg', 0.92));
    }
    return out;
  }

  function parseJSONArrayLoose(text) {
    const s = String(text || '').replace(/```json|```/g, '').trim();
    const a = s.indexOf('[');
    const b = s.lastIndexOf(']');
    if (a < 0 || b <= a) return null;
    try {
      const arr = JSON.parse(s.slice(a, b + 1));
      return Array.isArray(arr) ? arr : null;
    } catch (e) {
      return null;
    }
  }

  /** 一次只喂一列，模型没有「这一格属于哪一天」的猜测空间。 */
  async function llmCourseTable(imgs, onStep) {
    const strips = await columnStrips(imgs[0], 7);
    const CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const items = [];
    for (let i = 0; i < strips.length; i++) {
      if (onStep) onStep(CN[i], i + 1, strips.length);
      const raw = await postChat(
        '你是课程表转录器。只输出 JSON 数组，不要解释，不要 markdown。',
        [
          {
            type: 'text',
            text: '这张图是从同一张课程表裁出来的：左边窄条是「节次」，右边是「' + CN[i] + '」那一整列。\n'
              + '逐格读出这一列的所有课程，每门输出 {"title":"","periodStart":1,"periodEnd":2,"weeks":"1-16","room":""}\n'
              + '规则：标题去掉 (本) 和课程代码前缀；节次写数字；周次写成 1-16 / 1-7,9-16 / 14；\n'
              + '教室原样抄「楼名+房间号」，看不清就写空字符串；这一列没有课就输出 []。'
          },
          { type: 'image_url', image_url: { url: strips[i] } }
        ]
      );
      const arr = parseJSONArrayLoose(raw);
      (arr || []).forEach((it) => {
        if (it && it.title) {
          items.push(Object.assign({}, it, { weekday: i + 1 }));
        }
      });
    }
    return items;
  }

  async function postChat(system, userContent) {
    const s = store.settings;
    if (!s.baseUrl) throw new Error('缺少 Base URL');
    const base = s.baseUrl.replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (s.apiKey) headers['Authorization'] = 'Bearer ' + s.apiKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: s.model || 'deepseek-chat',
          temperature: 0.1,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent }
          ]
        })
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('接口返回 ' + res.status + (body ? '：' + body.slice(0, 100) : ''));
    }
    const data = await res.json();
    return data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || '')
      : '';
  }

  async function llmRespond(text, ctx, images) {
    const s = store.settings;
    if (!s.baseUrl) throw new Error('缺少 Base URL');

    const imgs = Array.isArray(images)
      ? images.filter((url) => typeof url === 'string' && url.indexOf('data:image/') === 0).slice(0, 3)
      : [];

    const base = s.baseUrl.replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (s.apiKey) headers['Authorization'] = 'Bearer ' + s.apiKey;

    let userContent = text;
    if (imgs.length) {
      userContent = [{ type: 'text', text: text || '请识别图片中的日程，并整理成时间轴日程。' }];
      imgs.forEach((image) => {
        userContent.push({ type: 'image_url', image_url: { url: image } });
      });
    }

    const history = recentHistory(8);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: s.model || 'deepseek-chat',
          temperature: 0.2,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt(ctx) },
            ...history,
            { role: 'user', content: userContent }
          ]
        })
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('接口返回 ' + res.status + (body ? '：' + body.slice(0, 120) : ''));
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const json = parseJSONLoose(content);
    if (!json) throw new Error('模型没有返回可解析的 JSON');

    const applied = applyActions(Array.isArray(json.actions) ? json.actions : []);
    const items = applied.changedItems.map((e) => ({
      id: e.id,
      time: U.fmtTime(e.start) + '–' + U.fmtTime(e.end),
      title: e.title,
      category: e.category,
      date: e.date
    }));
    let tip = applied.warnings.slice(0, 2).join(' ');
    if (items.length > 20) tip += (tip ? ' ' : '') + '聊天里只列出前 20 项，其余已在时间轴上。';

    const ddlChanged = applied.changedDdls.length > 0;
    if (applied.needsSemester && !applied.changedItems.length && !applied.removed.length && !ddlChanged) {
      return {
        text: '检测到课表周次，但还没设置「学期第 1 周周一」。\n先设置学期第 1 周，否则整学期课程会错位。',
        items: [],
        tip,
        changed: false,
        mode: 'llm',
        openTimetable: true
      };
    }

    return {
      text: json.reply || '已经更新日程。',
      items: items.slice(0, 20),
      tip,
      changed: !!(applied.changedItems.length || applied.removed.length),
      ddlChanged,
      kind: ddlChanged ? 'ddl' : '',
      mode: 'llm'
    };
  }

  /* ------------------------------------------------------------------ */
  /* 对外                                                               */
  /* ------------------------------------------------------------------ */

  async function respond(text, ctx, images) {
    const settings = store.settings;
    const imgs = Array.isArray(images)
      ? images.filter((url) => typeof url === 'string' && url.indexOf('data:image/') === 0).slice(0, 3)
      : [];

    const intent = detectIntent(String(text || ''));
    if (!imgs.length && intent === 'review') return weekReview(text, ctx || {});
    if (!imgs.length && intent === 'task') return taskIntent(text, ctx || {});
    if (!imgs.length && intent === 'free') return freeSlotIntent(text, ctx || {});
    if (!imgs.length && intent === 'rollover') return rolloverIntent(text, ctx || {});
    if (!imgs.length && intent.indexOf('ddl') === 0) return localRespond(text, ctx || {});
    const clearCommand = /(清空|清除|全删|都删|全清)/.test(text) ||
      /(?:全部|所有|一切|都).{0,8}(?:删|清|取消|移除)|(?:删|清|取消|移除).{0,8}(?:全部|所有|一切|都)/.test(text);
    if (!imgs.length && intent === 'remove' && clearCommand) {
      return localRespond(text, ctx || {});
    }

    if (!imgs.length && store.getTimetable().length === 0) {
      const periodProbe = extractPeriod(normalizeText(text));
      if (periodProbe) {
        return {
          text: '我还不清楚你们的第几节是几点。\n先把课表节次设置好，我就能把「周三第1到2节 高数」换算成具体时间。',
          items: [],
          changed: false,
          kind: 'info',
          openTimetable: true,
          tip: '点这里打开课表节次设置，填好每节课的开始 / 结束时间。'
        };
      }
    }

    if (imgs.length && settings.mode === 'llm' && settings.baseUrl && isCourseTableRequest(text)) {
      try {
        const items = await llmCourseTable(imgs, (label, i, total) => {
          if (typeof callbacks.update === 'function') {
            callbacks.update({ checking: true, progress: '正在识别 ' + label + '（' + i + '/' + total + '）' });
          }
        });
        if (items.length) {
          const built = applyCourseTable(items);
          const byDay = {};
          items.forEach((it) => {
            const d = Number(it.weekday) || 0;
            if (d) byDay[d] = (byDay[d] || 0) + 1;
          });
          const CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
          const summary = Object.keys(byDay).sort((a, b) => a - b)
            .map((k) => CN[k] + byDay[k]).join(' · ');
          return {
            text: '按课程表写入 ' + items.length + ' 条（' + summary + '）。\n逐列识别的，周二没课就不会凭空多出来。',
            items: [],
            tip: built.warnings.slice(0, 3).join(' '),
            changed: true,
            mode: 'llm'
          };
        }
      } catch (err) {
        /* 切图失败就退回整图识别 */
      }
    }

    if (settings.mode === 'llm' && settings.baseUrl) {
      try {
        return await llmRespond(text, ctx || {}, imgs);
      } catch (err) {
        const reason = err && err.name === 'AbortError' ? '请求超时' : (err.message || '网络错误');
        if (imgs.length) {
          return {
            text: '图片识别失败：' + reason + '。\n当前模型：' + (settings.model || '未填')
              + '\n纯文本模型（例如 deepseek-chat）看不到图片，要换成多模态的，如 qwen-vl-max / glm-4v / gpt-4o。',
            items: [],
            tip: '图片没有写入日程；换成多模态模型后可以重发这张图。',
            changed: false,
            mode: 'llm'
          };
        }
        const note = '大模型连接失败（' + reason + '），已用本地智能体处理。';
        return localRespond(text, ctx || {}, note);
      }
    }

    if (imgs.length) {
      return {
        text: '图片识别需要支持视觉的大模型。\n当前是本地离线模式，只能解析文字。请到设置里切换到大模型，并填写支持视觉的模型，例如 gpt-4o、qwen-vl-max、glm-4v。',
        items: [],
        tip: '图片还在输入框上方，配置好后可以直接发送。',
        changed: false
      };
    }

    return localRespond(text, ctx || {});
  }

  window.DayFlow.agent = {
    respond,
    localRespond,
    parseSegment,
    detectIntent,
    detectCategory,
    dailyBrief,
    weekReview,
    taskIntent,
    extractPeriod,
    applyActions
  };
})();
