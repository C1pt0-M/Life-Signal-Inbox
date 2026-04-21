export const QUADRANTS = {
  important_urgent: {
    title: "重要且紧急",
    tone: "red",
  },
  important_not_urgent: {
    title: "重要但不紧急",
    tone: "yellow",
  },
  not_important_urgent: {
    title: "不重要但紧急",
    tone: "blue",
  },
  not_important_not_urgent: {
    title: "不重要且不紧急",
    tone: "green",
  },
};

export function calculateProgress(items, now = new Date()) {
  const total = items.length;
  const today = todayInTimezone(now);
  const done = items.filter((item) => item.status === "done" && completedDateKey(item) === today).length;
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

export function calculateTodoOverview(items, now = new Date()) {
  const pending = (items || []).filter((item) => item.status !== "done");
  const todayStr = todayInTimezone(now);
  const { start: weekStartStr, end: weekEndStr } = weekRangeForDate(todayStr);

  return pending.reduce(
    (summary, item) => {
      const startTime = itemStartDate(item);
      const endTime = itemEndDate(item) || startTime;

      if (!startTime || !endTime) {
        summary.noTime += 1;
        return summary;
      }

      const startStr = todayInTimezone(startTime);
      const endStr = todayInTimezone(endTime);

      // Overdue: The item's physical end time is in the past
      if (endTime.getTime() < now.getTime()) {
        summary.overdue += 1;
      } 
      // Today: Today falls on or between the start and end dates
      else if (todayStr >= startStr && todayStr <= endStr) {
        summary.today += 1;
      }

      // Week: The event's range overlaps with the current week's range
      // AND it's not fully in the past
      if (
        startStr <= weekEndStr &&
        endStr >= weekStartStr &&
        endTime.getTime() >= now.getTime()
      ) {
        summary.week += 1;
      }

      return summary;
    },
    { today: 0, overdue: 0, week: 0, noTime: 0 }
  );
}

export function filterTodoItems(items, filters = {}, now = new Date()) {
  const query = String(filters.query || "").trim().toLowerCase();
  return (items || []).filter((item) => {
    if (filters.status && filters.status !== "all") {
      const status = item.status === "done" ? "done" : "todo";
      if (status !== filters.status) return false;
    }
    if (filters.quadrant && filters.quadrant !== "all" && item.quadrant !== filters.quadrant) return false;
    if (filters.timeScope && filters.timeScope !== "all" && itemTimeScope(item, now) !== filters.timeScope) return false;
    if (!query) return true;
    const haystack = [item.title, item.location, item.notes, item.evidence].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function groupByQuadrant(items) {
  const grouped = Object.fromEntries(Object.keys(QUADRANTS).map((key) => [key, []]));
  for (const item of items) {
    const key = grouped[item.quadrant] ? item.quadrant : "important_not_urgent";
    grouped[key].push(item);
  }
  return grouped;
}

export function applyQuadrantOverrides(items, overrides) {
  return items.map((item) => {
    const quadrant = overrides[item.id];
    if (!QUADRANTS[quadrant]) return item;
    return { ...item, quadrant };
  });
}

export function updateQuadrantOverride(overrides, itemId, quadrant) {
  if (!itemId || !QUADRANTS[quadrant]) return overrides;
  return { ...overrides, [itemId]: quadrant };
}

export function describeAiExtractor(config) {
  const extractor = config?.ai_extractor;
  if (extractor?.enabled) {
    return `AI Harness：${extractor.model || "已启用"} · ${extractor.base_url || "默认接口"}`;
  }
  return "规则兜底：配置 backend/.env 启用模型";
}

export function buildAiConfigPayload(form) {
  return {
    provider: String(form.provider || "openai-compatible").trim(),
    api_key: String(form.api_key || "").trim(),
    model: String(form.model || "gpt-4o-mini").trim(),
    vision_model: String(form.vision_model || "").trim(),
    base_url: String(form.base_url || "https://api.openai.com/v1")
      .trim()
      .replace(/\/+$/, ""),
  };
}

export function todayInTimezone(now = new Date(), timezone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

export function buildExtractionPayload(text, sourceType, now = new Date(), timezone = "Asia/Shanghai") {
  return {
    text,
    source_type: sourceType,
    current_date: todayInTimezone(now, timezone),
    timezone,
  };
}

export function getImageFileFromClipboardEvent(event) {
  const files = Array.from(event?.clipboardData?.files || []);
  const fileImage = files.find((file) => file.type?.startsWith("image/"));
  if (fileImage) return fileImage;

  const items = Array.from(event?.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type?.startsWith("image/"));
  return imageItem?.getAsFile?.() || null;
}

export function buildManualTodoItem(form, options = {}) {
  const now = options.now ?? Date.now();
  const timezone = options.timezone || "Asia/Shanghai";
  const recurrence = buildRecurrence(form.recurrence);
  const reminder = buildReminder(form.reminder);
  const durationDays = normalizeDurationDays(form.durationDays);
  const start = buildIsoDateTime(form.date, form.startTime);
  const endDate = shiftDateString(form.date, durationDays - 1);
  const end = buildIsoDateTime(endDate, form.endTime || form.startTime);
  return {
    id: `manual-${now}`,
    title: String(form.title || "").trim(),
    time: {
      start,
      end: end || start,
      label: buildManualTimeLabel(form, recurrence, durationDays),
    },
    location: String(form.location || "").trim(),
    materials: [],
    contacts: [],
    notes: String(form.notes || "").trim(),
    recurrence,
    reminder,
    evidence: "手动添加",
    source_type: "手动添加",
    confidence: 1,
    quadrant: QUADRANTS[form.quadrant] ? form.quadrant : "important_not_urgent",
    duration_days: durationDays,
    timezone,
    status: "todo",
  };
}

export function buildSaveableAssistantItem(item) {
  return { ...item, status: "todo" };
}

export function buildSaveableAssistantItems(items) {
  return (items || []).map(buildSaveableAssistantItem);
}

export function removeAssistantItem(items, itemId) {
  return (items || []).filter((item) => item.id !== itemId);
}

export function buildTodoFormState(item, fallbackDate = todayInTimezone()) {
  const start = item.time?.start || "";
  const end = item.time?.end || "";
  const parseClock = (value, fallback) => (String(value || "").length >= 16 ? String(value).slice(11, 16) : fallback);
  const inferredDuration = inferDurationDays(start, end);
  return {
    title: item.title || "",
    date: start ? String(start).slice(0, 10) : fallbackDate,
    startTime: parseClock(start, "09:00"),
    endTime: parseClock(end, "10:00"),
    durationDays: String(item.duration_days || inferredDuration || 1),
    recurrence: item.recurrence?.type || "none",
    reminder: String(item.reminder?.minutes_before ?? 0),
    location: item.location || "",
    notes: item.notes || "",
    quadrant: item.quadrant || "important_not_urgent",
    status: item.status || "todo",
  };
}

export function buildTodoUpdate(item, form) {
  const recurrence = buildRecurrence(form.recurrence || item.recurrence?.type);
  const reminder = buildReminder(form.reminder ?? item.reminder?.minutes_before);
  const durationDays = normalizeDurationDays(form.durationDays ?? item.duration_days);
  const start = buildIsoDateTime(form.date, form.startTime);
  const endDate = shiftDateString(form.date, durationDays - 1);
  const end = buildIsoDateTime(endDate, form.endTime || form.startTime);
  return {
    ...item,
    title: String(form.title ?? item.title ?? "").trim(),
    time: {
      ...(item.time || {}),
      start: start || item.time?.start || "",
      end: end || item.time?.end || start || "",
      label: buildManualTimeLabel(form, recurrence, durationDays),
    },
    location: String(form.location ?? item.location ?? "").trim(),
    notes: String(form.notes ?? item.notes ?? "").trim(),
    recurrence,
    reminder,
    quadrant: QUADRANTS[form.quadrant] ? form.quadrant : item.quadrant || "important_not_urgent",
    duration_days: durationDays,
    status: form.status || item.status || "todo",
  };
}

export function buildCalendarMonth(year, month) {
  const firstDay = dateOnly(year, month, 1);
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = addDays(firstDay, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const current = addDays(gridStart, index);
    return {
      iso: formatDateOnly(current),
      day: current.getUTCDate(),
      month: current.getUTCMonth() + 1,
      year: current.getUTCFullYear(),
      inCurrentMonth: current.getUTCMonth() === month - 1,
    };
  });
}

export function expandCalendarItems(items, visibleStart, visibleEnd) {
  const start = parseDateOnly(visibleStart);
  const end = parseDateOnly(visibleEnd);
  if (!start || !end) return [];

  const occurrences = [];
  for (const item of items) {
    const itemDate = parseDateOnly(item.time?.start?.slice(0, 10));
    if (!itemDate) continue;
    const itemEndDate = parseDateOnly(item.time?.end?.slice(0, 10)) || itemDate;
    const recurrenceType = item.recurrence?.type || "none";
    if (recurrenceType === "none") {
      let cursor = itemDate > start ? itemDate : start;
      while (cursor <= end && cursor <= itemEndDate) {
        if (cursor >= itemDate) occurrences.push(buildOccurrence(item, cursor));
        cursor = addDays(cursor, 1);
      }
      continue;
    }

    let cursor = itemDate > start ? itemDate : start;
    while (cursor <= end) {
      if (cursor >= itemDate && matchesRecurrence(cursor, recurrenceType)) {
        for (let day = 0; day < normalizeDurationDays(item.duration_days); day += 1) {
          const occurrenceDate = addDays(cursor, day);
          if (occurrenceDate > end) break;
          occurrences.push(buildOccurrence(item, occurrenceDate));
        }
      }
      cursor = addDays(cursor, 1);
    }
  }

  return occurrences.sort((first, second) => {
    if (first.date !== second.date) return first.date.localeCompare(second.date);
    const firstTime = timeOfDay(first.item.time?.start);
    const secondTime = timeOfDay(second.item.time?.start);
    return firstTime.localeCompare(secondTime);
  });
}

export function getCalendarDayItems(date, expandedItems) {
  return expandedItems.filter((entry) => entry.date === date);
}

export function splitTodoItems(items) {
  return {
    pending: items.filter((item) => item.status !== "done"),
    completed: items.filter((item) => item.status === "done"),
  };
}

export function getDueReminders(items, now = new Date(), seenKeys = new Set()) {
  const currentMinute = Math.floor(now.getTime() / 60_000);
  return items
    .filter((item) => item.status !== "done")
    .map((item) => {
      const minutes = Number(item.reminder?.minutes_before || 0);
      const start = item.time?.start ? new Date(item.time.start) : null;
      if (!minutes || !start || Number.isNaN(start.getTime())) return null;
      const reminderMinute = Math.floor((start.getTime() - minutes * 60_000) / 60_000);
      const key = `${item.id}:${item.time.start}:${minutes}`;
      if (reminderMinute !== currentMinute || seenKeys.has(key)) return null;
      return { ...item, reminder_key: key };
    })
    .filter(Boolean);
}

function itemTimeScope(item, now) {
  const startTime = itemStartDate(item);
  const endTime = itemEndDate(item) || startTime;
  if (!startTime || !endTime) return "no_time";

  const startStr = todayInTimezone(startTime);
  const endStr = todayInTimezone(endTime);
  const todayStr = todayInTimezone(now);
  const { start: weekStartStr, end: weekEndStr } = weekRangeForDate(todayStr);

  if (endTime.getTime() < now.getTime()) return "overdue";
  
  // Is it happening today? (Crosses over today)
  if (todayStr >= startStr && todayStr <= endStr) return "today";
  
  // Does it overlap with the current week?
  if (startStr <= weekEndStr && endStr >= weekStartStr) return "week";
  
  return "future";
}

function itemDateKey(item) {
  const start = item?.time?.start;
  if (!start) return "";
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) return "";
  return todayInTimezone(parsed);
}

function completedDateKey(item) {
  const value = item?.completed_at;
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return todayInTimezone(parsed);
}

function itemStartDate(item) {
  const start = item?.time?.start;
  if (!start) return null;
  const parsed = new Date(start);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function itemEndDate(item) {
  const end = item?.time?.end;
  if (!end) return null;
  const parsed = new Date(end);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function weekRangeForDate(dateKey) {
  const date = parseDateOnly(dateKey);
  if (!date) return { start: dateKey, end: dateKey };
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return {
    start: formatDateOnly(addDays(date, -mondayOffset)),
    end: formatDateOnly(addDays(date, 6 - mondayOffset)),
  };
}

function buildRecurrence(type = "none") {
  const rules = {
    none: { type: "none", label: "不重复", rrule: "" },
    daily: { type: "daily", label: "每天", rrule: "FREQ=DAILY" },
    weekdays: { type: "weekdays", label: "每个工作日", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    holidays: { type: "holidays", label: "每个节假日", rrule: "FREQ=WEEKLY;BYDAY=SA,SU" },
  };
  return rules[type] || rules.none;
}

function buildReminder(value = "0") {
  const minutes = Number(value || 0);
  const labels = {
    0: "不提醒",
    5: "提前5分钟",
    15: "提前15分钟",
    30: "提前30分钟",
    60: "提前1小时",
    1440: "提前1天",
  };
  return {
    minutes_before: Number.isFinite(minutes) ? minutes : 0,
    label: labels[minutes] || `提前${minutes}分钟`,
  };
}

function dateOnly(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return dateOnly(Number(match[1]), Number(match[2]), Number(match[3]));
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateOnly(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWithinDateRange(date, start, end) {
  return date >= start && date <= end;
}

function matchesRecurrence(date, type) {
  const day = date.getUTCDay();
  if (type === "daily") return true;
  if (type === "weekdays") return day >= 1 && day <= 5;
  if (type === "holidays") return day === 0 || day === 6;
  return false;
}

function buildOccurrence(item, date) {
  const iso = formatDateOnly(date);
  return {
    id: `${item.id}:${iso}`,
    date: iso,
    item,
    isRecurring: (item.recurrence?.type || "none") !== "none",
  };
}

function timeOfDay(value) {
  return String(value || "").slice(11, 19);
}

function buildIsoDateTime(date, time) {
  if (!date || !time) return "";
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}+08:00`;
}

function buildManualTimeLabel(form, recurrence, durationDays = 1) {
  const timeRange = [form.startTime, form.endTime].filter(Boolean).join("-");
  const dateText = form.date || "日期待确认";
  if (durationDays > 1) {
    const endDate = shiftDateString(form.date, durationDays - 1);
    return `${dateText} 至 ${endDate} ${timeRange}`.trim();
  }
  return recurrence.type === "none" ? `${dateText} ${timeRange}`.trim() : `${recurrence.label} ${timeRange}`.trim();
}

function normalizeDurationDays(value) {
  const days = Number(value || 1);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 1;
}

function shiftDateString(dateString, offsetDays) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return dateString;
  return formatDateOnly(addDays(parsed, offsetDays));
}

function inferDurationDays(start, end) {
  const startDate = parseDateOnly(String(start || "").slice(0, 10));
  const endDate = parseDateOnly(String(end || "").slice(0, 10));
  if (!startDate || !endDate) return 1;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
}

export function formatAssistantExtraction(result) {
  const items = result?.items || [];
  if (!items.length) return "没有整理出可执行事项。\n\n时间：待确认\n地点：待确认（可选）\n事件：待确认\n备注：请补充更清晰的通知内容。";

  const blocks = items.map((item, index) => {
    const timeText = item.time?.label || formatDateTime(item.time?.start);
    const locationText = item.location || "待确认（可选）";
    const noteText = buildAssistantNote(item);
    return [`${index + 1}.`, `事件：${item.title || "待确认"}`, `时间：${timeText}`, `地点：${locationText}`, `备注：${noteText}`].join("\n");
  });

  return ["已整理为：", ...blocks].join("\n\n");
}

export function updateEditableItem(items, itemId, patch) {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    const next = { ...item, time: { ...(item.time || {}) } };
    if ("title" in patch) next.title = patch.title;
    if ("location" in patch) next.location = patch.location;
    if ("notes" in patch) next.notes = patch.notes;
    if ("start" in patch) next.time.start = patch.start;
    if ("end" in patch) next.time.end = patch.end;
    if ("materialsText" in patch) next.materials = parseMaterials(patch.materialsText);
    if ("contactsText" in patch) next.contacts = parseContacts(patch.contactsText);
    if (Object.keys(patch).length) next.confidence = Math.max(Number(next.confidence || 0), 0.8);
    return next;
  });
}

function buildAssistantNote(item) {
  if (item.kind === "schedule_course") return item.notes || "具体节次请核对原图。";
  const parts = [];
  if (item.notes) parts.push(item.notes);
  else if (item.materials?.length) parts.push(`课程/材料：${item.materials.join("、")}`);
  if (typeof item.confidence === "number") parts.push(`可信度：${Math.round(item.confidence * 100)}%`);
  if (!parts.length && item.evidence) parts.push(`依据：${truncateText(item.evidence, 48)}`);
  return parts.join("；") || "无";
}

function truncateText(text, maxLength) {
  const value = String(text || "").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function serializeMaterials(materials) {
  return (materials || []).join("、");
}

export function serializeContacts(contacts) {
  return (contacts || [])
    .map((contact) => [contact.name, contact.phone].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("、");
}

function parseMaterials(value) {
  return String(value || "")
    .split(/[、,，;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseContacts(value) {
  return String(value || "")
    .split(/[、,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const phone = part.match(/1[3-9]\d{9}/)?.[0] || "";
      const name = part.replace(phone, "").trim() || (phone ? "联系人" : part);
      return { name, phone };
    });
}

export function formatDateTime(value) {
  if (!value) return "待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatFullNow(now) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}
