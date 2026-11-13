// Usage (quota) text parsing — pure functions only (no DOM / app state),
// so it can be unit tested with `node --test tests/`.
//
// Every CLI prints a set of quota "windows" (5h session, weekly, weekly per model ...).
// The parser returns them as a list so the status bar shows exactly what the CLI shows:
//   { windows: [{ id, label, pct (used %), resetText, resetsAt }] }
// TUIs redraw the panel several times, so for each window the LAST occurrence wins.

// Strip ANSI escapes. CSI sequences become a space since TUIs use cursor moves as spacing.
export function stripAnsi(text) {
  return String(text || '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ' ')
    .replace(/\x1B[@-Z\\-_]/g, '');
}

const SEGMENT_MAX = 900; // max chars between a window header and its numbers (bars are long)

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, twelve: 12, 'twenty-four': 24, twentyfour: 24 };

// Period word -> short label ("5h", "Five Hour", "Weekly", "Current session" ...)
export function periodLabel(word) {
  let w = String(word || '').toLowerCase().replace(/\s+/g, '');
  w = w.replace(/^(twenty-?four|one|two|three|four|five|six|seven|eight|twelve)-?/, (m, n) => String(NUMBER_WORDS[n.replace('-', '')] || NUMBER_WORDS[n]));
  w = w.replace(/^(\d+)-/, '$1');
  let m = w.match(/^(\d+)(?:h|hr|hour|hours|-hour|시간)/);
  if (m) return `${m[1]}h`;
  m = w.match(/^(\d+)(?:d|day|days|-day|일)/);
  if (m) return `${m[1]}d`;
  if (/session|세션/.test(w)) return '5h';
  if (/week|주간|7d/.test(w)) return 'Wk';
  if (/daily|day|일간/.test(w)) return '1d';
  if (/month|월간/.test(w)) return 'Mo';
  return word ? String(word).trim().slice(0, 8) : '';
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Header definitions per CLI: regex (global) + function(match) -> { id, label }
// Earlier (more specific) definitions win when two headers overlap.
const HEADERS = {
  claude: [
    // "Current week (Sonnet only)", "Current week (Opus)" — before the generic week header
    {
      re: /Current\s*week\s*\(\s*(?!all\s*models)([A-Za-z0-9 .]+?)\s*(?:only)?\s*\)/gi,
      make: (m) => ({ id: `week-${slug(m[1])}`, label: `Wk·${m[1].trim()}` }),
    },
    { re: /Current\s*week\s*\(\s*all\s*models\s*\)|주간\s*·?\s*전체\s*모델/gi, make: () => ({ id: 'week', label: 'Wk' }) },
    { re: /Current\s*session|5\s*시간\s*한도|현재\s*세션/gi, make: () => ({ id: 'session', label: '5h' }) },
    { re: /주간\s*·?\s*(Sonnet|Opus)/gi, make: (m) => ({ id: `week-${slug(m[1])}`, label: `Wk·${m[1]}` }) },
  ],
  codex: [
    // "5h limit:", "Weekly limit:", "Daily limit:" ...
    {
      re: /(\d+\s*[hd]|Weekly|Daily|Monthly|Hourly)\s*limit\s*:/gi,
      make: (m) => ({ id: slug(periodLabel(m[1])), label: periodLabel(m[1]) }),
    },
  ],
  antigravity: [
    { re: /GEMINI\s*MODELS/gi, make: () => ({ id: 'gemini', label: 'Gem' }) },
    { re: /CLAUDE\s*(?:AND|&)\s*GPT\s*MODELS/gi, make: () => ({ id: 'claude-gpt', label: 'Cld' }) },
  ],
};

const PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*%\s*(used|left|remaining|사용|남음)?/i;
// "Resets Nov 16, 9pm (Asia/Seoul)" (claude) / "(resets 3:45 PM)" (codex).
// Group 1: reset text, group 2: time zone in parentheses (when there is one).
const RESET_RE = /(?:resets?|재설정|초기화)\s*(?:in|at|on|:)?\s*([^()\n\r│|]{1,48}?)(?:\s*\(([^)]*)\)(?=\s|$)|(?=\s{2,}|\)|│|\||\r|\n|$))/i;

// --- Reset text -> instant -----------------------------------------------------
// The CLIs print the reset as wall-clock text in the account's time zone ("Nov 16, 9pm",
// "3pm", "09:00 on 17 Nov", "in 2h 13m"). It is turned into an absolute time so the app can
// show the remaining time against the system clock.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const UNIT_MS = { d: 86400000, h: 3600000, m: 60000 };
const MINUTE_MS = 60000;

const zoneParts = (ms, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(ms);
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value);
  return { year: get('year'), month: get('month') - 1, day: get('day'), hour: get('hour') % 24, minute: get('minute') };
};

const validZone = (tz) => {
  if (!tz || !/\//.test(tz)) return null;
  try {
    zoneParts(0, tz);
    return tz;
  } catch (e) {
    return null;
  }
};

// Wall-clock time in a zone (or the local zone) -> epoch ms
function wallToEpoch({ year, month, day, hour, minute }, timeZone) {
  if (!timeZone) return new Date(year, month, day, hour, minute).getTime();
  const guess = Date.UTC(year, month, day, hour, minute);
  const offsetAt = (ms) => {
    const p = zoneParts(ms, timeZone);
    return Date.UTC(p.year, p.month, p.day, p.hour, p.minute) - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first); // second pass: correct across DST changes
}

const todayIn = (now, timeZone) => (timeZone
  ? zoneParts(now, timeZone)
  : (() => {
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  })());

/** Pure: reset text (+ optional IANA zone) -> epoch ms of the next such moment, or null */
export function parseResetTime(text, zone, now = Date.now()) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  const tz = validZone(zone);

  // "in 2h 13m", "3d 4h", "45 minutes"
  const UNIT_RE = /(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)\b/g;
  const units = [...s.matchAll(UNIT_RE)];
  const onlyUnits = s.replace(UNIT_RE, '').replace(/\b(in|and)\b|,/g, '').trim() === '';
  if (units.length && onlyUnits) {
    return now + units.reduce((sum, [, n, unit]) => sum + Number(n) * UNIT_MS[unit[0]], 0);
  }

  const clock = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!clock) return null;
  const hour12 = Number(clock[1]) % 12;
  const hour = clock[3] ? hour12 + (clock[3] === 'pm' ? 12 : 0) : Number(clock[1]);
  const minute = Number(clock[2] || 0);
  if (hour > 23 || minute > 59) return null;

  const monthFirst = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  const dayFirst = s.match(/\b(\d{1,2})\s+([a-z]{3})[a-z]*\b/);
  const date = monthFirst && MONTHS.includes(monthFirst[1]) ? { month: MONTHS.indexOf(monthFirst[1]), day: Number(monthFirst[2]) }
    : dayFirst && MONTHS.includes(dayFirst[2]) ? { month: MONTHS.indexOf(dayFirst[2]), day: Number(dayFirst[1]) }
      : null;

  const today = todayIn(now, tz);
  if (date) {
    const at = (year) => wallToEpoch({ year, month: date.month, day: date.day, hour, minute }, tz);
    const thisYear = at(today.year);
    return thisYear < now - UNIT_MS.d ? at(today.year + 1) : thisYear; // "Jan 2" seen in late December
  }
  const sameDay = wallToEpoch({ ...today, hour, minute }, tz);
  return sameDay > now ? sameDay : sameDay + UNIT_MS.d; // a bare time is the next one
}
// Sub-windows inside a model group (antigravity): "Weekly Limit Remaining", "Five Hour Limit Remaining"
const PERIOD_LIMIT_RE = /((?:\d+|one|two|three|four|five|six|seven|eight|twelve|twenty-?four)\s*-?\s*(?:h|hr|hours?|d|days?)|Weekly|Daily|Monthly)\s*(?:limit|quota)/gi;

function parseSegment(seg, now) {
  const pm = seg.match(PCT_RE);
  if (!pm) return null;
  const rm = seg.match(RESET_RE);
  // "63% left" or "Weekly Limit Remaining [████] 100.00%" -> value is what is left
  const before = seg.slice(0, pm.index);
  const remaining = /left|remaining|남음/i.test(pm[2] || '') || /remaining|남은/i.test(before);
  const v = parseFloat(pm[1]);
  const resetText = rm ? rm[1].trim().replace(/[.,]$/, '') : '';
  return {
    pct: clampPct(remaining ? 100 - v : v),
    resetText,
    resetsAt: resetText ? parseResetTime(resetText, rm[2], now) : null,
  };
}

// Header matches of all definitions; on overlap the earlier (more specific) definition wins.
// matchAll works on a copy of the regex, so the shared global regexes keep no state.
const findHeaders = (defs, text) => defs
  .flatMap((def) => [...text.matchAll(def.re)].map((m) => ({ start: m.index, end: m.index + m[0].length, ...def.make(m) })))
  .reduce((acc, h) => (acc.some((a) => h.start < a.end && h.end > a.start) ? acc : [...acc, h]), [])
  .sort((a, b) => a.start - b.start);

// Model groups (antigravity) may contain several period limits: "Weekly Limit ... 40%"
const periodWindows = (hit, seg, now) => {
  const marks = [...seg.matchAll(PERIOD_LIMIT_RE)].map((pm) => ({ start: pm.index, at: pm.index + pm[0].length, word: pm[1] }));
  return marks
    .map((mk, j) => ({ mk, parsed: parseSegment(seg.slice(mk.at, marks[j + 1] ? marks[j + 1].start : seg.length), now) }))
    .filter(({ parsed }) => parsed)
    .map(({ mk, parsed }) => {
      const per = periodLabel(mk.word);
      return { id: `${hit.id}-${slug(per)}`, label: `${hit.label}·${per}`, ...parsed };
    });
};

const segmentWindows = (cli, hit, seg, now) => {
  const subs = cli === 'antigravity' ? periodWindows(hit, seg, now) : [];
  if (subs.length) return subs;
  const parsed = parseSegment(seg, now);
  return parsed ? [{ id: hit.id, label: hit.label, ...parsed }] : [];
};

// Pure parser over ANSI-stripped text (`now` anchors relative / bare-time reset texts).
export function parseUsageText(cli, cleanText, now = Date.now()) {
  const text = String(cleanText || '');
  const hits = findHeaders(HEADERS[cli] || HEADERS.claude, text);

  // id -> window: the last occurrence wins, the order of first appearance is kept
  const byId = hits
    .flatMap((hit, i) => {
      const next = hits[i + 1] ? hits[i + 1].start : text.length;
      return segmentWindows(cli, hit, text.slice(hit.end, Math.min(next, hit.end + SEGMENT_MAX)), now);
    })
    .reduce((map, w) => {
      const prev = map.get(w.id);
      return map.set(w.id, {
        ...w,
        resetText: w.resetText || (prev && prev.resetText) || '',
        resetsAt: w.resetsAt || (prev && prev.resetsAt) || null,
      });
    }, new Map());

  const windows = [...byId.values()];
  return windows.length ? { windows } : {};
}

// Claude chat mode: rate_limit_event.rate_limit_info.unifiedWindows
const RATE_WINDOW_LABELS = {
  five_hour: '5h',
  seven_day: 'Wk',
  seven_day_opus: 'Wk·Opus',
  seven_day_sonnet: 'Wk·Sonnet',
};

// reset time: unix seconds / ms / ISO string -> ms
const toResetMs = (r) => {
  if (typeof r === 'number') return r < 1e12 ? r * 1000 : r;
  if (typeof r === 'string' && !Number.isNaN(Date.parse(r))) return Date.parse(r);
  return null;
};

export function parseRateLimitWindows(unifiedWindows) {
  const windows = Object.entries(unifiedWindows || {})
    .filter(([, w]) => w && typeof w.utilization === 'number')
    .map(([key, w]) => ({
      id: key === 'five_hour' ? 'session' : key === 'seven_day' ? 'week' : slug(key),
      label: RATE_WINDOW_LABELS[key]
        || key.replace(/^seven_day_?/, 'Wk·').replace(/^five_hour_?/, '5h·').replace(/·$/, ''),
      pct: clampPct(w.utilization <= 1 ? w.utilization * 100 : w.utilization),
      resetText: '',
      resetsAt: toResetMs(w.resets_at ?? w.resetsAt ?? w.reset_at),
    }));
  return windows.length ? { windows } : {};
}

// Merge new windows into the old list by id (a partial read keeps the other windows).
// Pure: returns a new list, the inputs are left untouched.
export function mergeWindows(oldList, newList) {
  const olds = oldList || [];
  const news = newList || [];
  const byId = new Map(news.map((w) => [w.id, w]));
  const updated = olds.map((o) => {
    const w = byId.get(o.id);
    return w ? { ...o, ...w, resetText: w.resetText || o.resetText, resetsAt: w.resetsAt || o.resetsAt } : { ...o };
  });
  const oldIds = new Set(olds.map((o) => o.id));
  return [...updated, ...news.filter((w) => !oldIds.has(w.id)).map((w) => ({ ...w }))];
}
