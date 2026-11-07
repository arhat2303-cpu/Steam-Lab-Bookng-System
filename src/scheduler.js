export const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseClock(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return fallback;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

function integer(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normaliseSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const workingDays = Array.isArray(source.workingDays)
    ? source.workingDays.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [1, 2, 3, 4, 5];
  const openMinutes = parseClock(source.openTime, 8 * 60);
  let closeMinutes = parseClock(source.closeTime, 17 * 60);
  if (closeMinutes <= openMinutes) closeMinutes = Math.min(23 * 60 + 59, openMinutes + 60);
  return {
    openTime: source.openTime || '08:00',
    closeTime: source.closeTime || '17:00',
    openMinutes,
    closeMinutes,
    workingDays: workingDays.length ? Array.from(new Set(workingDays)).sort((a, b) => a - b) : [1, 2, 3, 4, 5],
    slotMinutes: integer(source.slotMinutes, 5, 180, 30),
    restGapMinutes: integer(source.restGapMinutes, 0, 240, 30),
    dailyCapMinutes: integer(source.dailyCapMinutes, 30, 24 * 60, 420),
    minLeadMinutes: integer(source.minLeadMinutes, 0, 7 * 24 * 60, 720)
  };
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatShortDateTime(timestamp) {
  const date = new Date(timestamp);
  return `${WEEKDAYS[date.getDay()]} ${pad2(date.getDate())} ${MONTHS[date.getMonth()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDuration(minutes) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `${value}-min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}-h-${rest}-min` : `${hours}-h`;
}

function ceilToSlot(timestamp, settings) {
  const anchor = startOfDay(timestamp) + settings.openMinutes * 60000;
  const slotMs = settings.slotMinutes * 60000;
  if (timestamp <= anchor) return anchor;
  return anchor + Math.ceil((timestamp - anchor) / slotMs) * slotMs;
}

function listWords(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function nextWorkingOpenInfo(dayStart, settings) {
  let candidate = startOfDay(dayStart) + DAY_MS;
  const skipped = [];
  for (let i = 0; i < 21; i += 1) {
    const weekday = new Date(candidate).getDay();
    if (settings.workingDays.includes(weekday)) return { timestamp: candidate + settings.openMinutes * 60000, skipped };
    skipped.push(WEEKDAYS_LONG[weekday]);
    candidate += DAY_MS;
  }
  return { timestamp: candidate + settings.openMinutes * 60000, skipped };
}

function jumpToNextWorkingOpen(dayStart, settings, diagnostics, closedToday) {
  const jump = nextWorkingOpenInfo(dayStart, settings);
  const skipped = [];
  if (closedToday !== undefined) skipped.push(WEEKDAYS_LONG[closedToday]);
  for (const day of jump.skipped) if (!skipped.includes(day)) skipped.push(day);
  if (skipped.length) diagnostics.add(`skips ${listWords(skipped)} because the lab is closed`);
  return jump.timestamp;
}

function effectiveDurationMinutes(request) {
  const override = Number(request.adjustedMinutes);
  if (Number.isFinite(override) && override > 0) return override;
  const estimate = request.estimate && typeof request.estimate === 'object' ? request.estimate : {};
  const total = Number(estimate.totalMinutes);
  if (Number.isFinite(total) && total > 0) return total;
  const perCopy = Number(estimate.minutes) || 30;
  const copies = Math.max(1, Number(request.copies) || 1);
  return perCopy * copies;
}

function priorityRank(priority) {
  const index = PRIORITY_ORDER.indexOf(String(priority || 'normal').toLowerCase());
  return index < 0 ? 2 : index;
}

function validSegments(request) {
  const list = request && request.schedule && Array.isArray(request.schedule.segments) ? request.schedule.segments : [];
  return list
    .map((segment) => ({ start: Number(segment.start), end: Number(segment.end) }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);
}

function addDailyUse(dailyUsed, start, end) {
  let cursor = start;
  let guard = 0;
  while (cursor < end && guard < 40) {
    guard += 1;
    const dayEnd = startOfDay(cursor) + DAY_MS;
    const partEnd = Math.min(end, dayEnd);
    const key = dateKey(cursor);
    dailyUsed[key] = (dailyUsed[key] || 0) + (partEnd - cursor) / 60000;
    cursor = partEnd;
  }
}

function composeReason(firstStart, diagnostics, segmentCount, durationMinutes, priority) {
  const clauses = [];
  if (segmentCount > 1) {
    clauses.push(`split across ${segmentCount} working-day blocks so a ${formatDuration(durationMinutes)} job does not block the queue`);
  }
  for (const diagnostic of diagnostics) clauses.push(diagnostic);
  if (!clauses.length) clauses.push('earliest free slot inside lab hours');
  clauses.push(`${priority} priority, oldest first when priorities match`);
  return `${formatShortDateTime(firstStart)} — ${clauses.join('; ')}.`;
}

/**
 * Pure scheduling engine. It receives plain data and returns plain data; it never
 * reads the DOM, browser storage, or the clock unless `now` is omitted.
 */
export function scheduleRequests(input = {}) {
  const settings = normaliseSettings(input.settings);
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const requests = Array.isArray(input.requests) ? input.requests : [];
  const slotMs = settings.slotMinutes * 60000;
  const gapMs = settings.restGapMinutes * 60000;
  const placements = {};
  const reservations = [];
  const dailyUsed = {};
  const fixedJobs = [];
  const movableJobs = [];

  for (const request of requests) {
    if (!request || !request.id) continue;
    if (request.status === 'printing') {
      const segments = validSegments(request);
      if (segments.length) fixedJobs.push(request);
    } else if (request.status === 'approved') {
      movableJobs.push(request);
    }
  }

  for (const job of fixedJobs) {
    const segments = validSegments(job).map((segment) => ({
      start: segment.start,
      end: segment.end,
      coolEnd: segment.end + gapMs,
      minutes: Math.round((segment.end - segment.start) / 60000)
    }));
    let duration = 0;
    for (const segment of segments) {
      reservations.push({ id: job.id, start: segment.start, end: segment.end, fixed: true });
      addDailyUse(dailyUsed, segment.start, segment.end);
      duration += segment.minutes;
    }
    placements[job.id] = {
      id: job.id,
      fixed: true,
      priority: job.priority || 'normal',
      durationMinutes: duration,
      segments,
      reason: 'Locked while printing; the scheduler will not move this job.',
      diagnostics: ['printing job is never moved']
    };
  }
  reservations.sort((a, b) => a.start - b.start || a.end - b.end);

  movableJobs.sort((a, b) => {
    const rank = priorityRank(a.priority) - priorityRank(b.priority);
    if (rank) return rank;
    const submitted = (Number(a.submittedAt) || 0) - (Number(b.submittedAt) || 0);
    if (submitted) return submitted;
    return String(a.id).localeCompare(String(b.id));
  });

  for (const job of movableJobs) {
    const rawDuration = Math.max(1, effectiveDurationMinutes(job));
    const durationMinutes = Math.max(settings.slotMinutes, Math.ceil(rawDuration / settings.slotMinutes) * settings.slotMinutes);
    const approvedAt = Number(job.approvedAt) || Number(job.submittedAt) || now;
    const leadBoundary = approvedAt + settings.minLeadMinutes * 60000;
    const earliest = Math.max(now, leadBoundary);
    let cursor = ceilToSlot(earliest, settings);
    let remaining = durationMinutes;
    const segments = [];
    const diagnostics = new Set();
    if (leadBoundary > now) diagnostics.add(`starts after the ${formatDuration(settings.minLeadMinutes)} minimum lead time from approval`);
    let guard = 0;

    while (remaining > 0 && guard < 4000) {
      guard += 1;
      const dayStart = startOfDay(cursor);
      const weekday = new Date(dayStart).getDay();
      if (!settings.workingDays.includes(weekday)) {
        cursor = jumpToNextWorkingOpen(dayStart, settings, diagnostics, weekday);
        continue;
      }
      const windowStart = dayStart + settings.openMinutes * 60000;
      const windowEnd = dayStart + settings.closeMinutes * 60000;
      if (cursor < windowStart) {
        cursor = ceilToSlot(windowStart, settings);
        continue;
      }
      if (cursor >= windowEnd) {
        diagnostics.add(`moves to the next opening because the lab closes at ${settings.closeTime}`);
        cursor = jumpToNextWorkingOpen(dayStart, settings, diagnostics);
        continue;
      }
      const key = dateKey(dayStart);
      const usedToday = dailyUsed[key] || 0;
      const capRemaining = settings.dailyCapMinutes - usedToday;
      if (capRemaining < settings.slotMinutes) {
        diagnostics.add(`moves to the next working day because the ${formatDuration(settings.dailyCapMinutes)} daily printing cap is reached`);
        cursor = jumpToNextWorkingOpen(dayStart, settings, diagnostics);
        continue;
      }

      const expandedStart = cursor - gapMs;
      let overlap = null;
      let ahead = null;
      for (const reservation of reservations) {
        if (reservation.end <= expandedStart) continue;
        if (reservation.start < cursor) overlap = reservation;
        else ahead = reservation;
        break;
      }
      let limit = windowEnd;
      if (overlap) {
        diagnostics.add(`waits for the ${formatDuration(settings.restGapMinutes)} cool-down after the previous job`);
        cursor = Math.max(cursor + slotMs, ceilToSlot(overlap.end + gapMs, settings));
        continue;
      }
      if (ahead) {
        const beforeLimit = ahead.start - gapMs;
        if (beforeLimit <= cursor) {
          diagnostics.add(`waits for the ${formatDuration(settings.restGapMinutes)} cool-down after the previous job`);
          cursor = Math.max(cursor + slotMs, ceilToSlot(ahead.end + gapMs, settings));
          continue;
        }
        limit = Math.min(limit, beforeLimit);
      }

      const windowMinutes = Math.floor((limit - cursor) / 60000);
      const capMinutes = Math.floor(capRemaining / settings.slotMinutes) * settings.slotMinutes;
      const remainingMinutes = Math.floor(remaining / settings.slotMinutes) * settings.slotMinutes;
      let chunk = Math.floor(Math.min(windowMinutes, capMinutes, remainingMinutes) / settings.slotMinutes) * settings.slotMinutes;
      if (chunk < settings.slotMinutes) {
        if (ahead) {
          diagnostics.add(`waits for the ${formatDuration(settings.restGapMinutes)} cool-down around the next booked job`);
          cursor = Math.max(cursor + slotMs, ceilToSlot(ahead.end + gapMs, settings));
        } else {
          diagnostics.add(`moves to the next working day because only ${Math.max(0, windowMinutes)} minutes remain in this lab day`);
          cursor = jumpToNextWorkingOpen(dayStart, settings, diagnostics);
        }
        continue;
      }

      const end = cursor + chunk * 60000;
      const expandedEnd = end + gapMs;
      const conflict = reservations.find((reservation) => reservation.start < expandedEnd && reservation.end > expandedStart);
      if (conflict) {
        diagnostics.add(`waits for the ${formatDuration(settings.restGapMinutes)} cool-down around an existing job`);
        cursor = Math.max(cursor + slotMs, ceilToSlot(conflict.end + gapMs, settings));
        continue;
      }

      const segment = {
        start: cursor,
        end,
        coolEnd: expandedEnd,
        minutes: chunk
      };
      segments.push(segment);
      reservations.push({ id: job.id, start: cursor, end, fixed: false });
      reservations.sort((a, b) => a.start - b.start || a.end - b.end);
      dailyUsed[key] = usedToday + chunk;
      remaining -= chunk;
      cursor = ceilToSlot(end + gapMs, settings);
    }

    if (remaining > 0 || guard >= 4000) {
      placements[job.id] = {
        id: job.id,
        fixed: false,
        priority: job.priority || 'normal',
        durationMinutes,
        segments: [],
        unscheduled: true,
        reason: `Could not find ${formatDuration(durationMinutes)} of free printing time in the next three weeks.`,
        diagnostics: Array.from(diagnostics)
      };
      continue;
    }

    placements[job.id] = {
      id: job.id,
      fixed: false,
      priority: job.priority || 'normal',
      durationMinutes,
      segments,
      reason: composeReason(segments[0].start, diagnostics, segments.length, durationMinutes, job.priority || 'normal'),
      diagnostics: Array.from(diagnostics)
    };
  }

  const coolDowns = [];
  for (const placement of Object.values(placements)) {
    for (const segment of placement.segments) {
      if (settings.restGapMinutes > 0 && segment.coolEnd > segment.end) {
        coolDowns.push({ id: placement.id, start: segment.end, end: segment.coolEnd, type: 'cool-down' });
      }
    }
  }
  return {
    now,
    settings,
    placements,
    reservations,
    coolDowns,
    dailyUsed,
    unscheduled: Object.values(placements).filter((placement) => placement.unscheduled).map((placement) => placement.id)
  };
}

export function scheduleHasOverlaps(result) {
  const intervals = (result.reservations || []).slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i].start < intervals[i - 1].end) return true;
  }
  return false;
}
