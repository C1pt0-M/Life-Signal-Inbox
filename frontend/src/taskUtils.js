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

export function calculateProgress(items) {
  const total = items.length;
  const done = items.filter((item) => item.status === "done").length;
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
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
    base_url: String(form.base_url || "https://api.openai.com/v1")
      .trim()
      .replace(/\/+$/, ""),
  };
}

export function buildManualTodoItem(form, options = {}) {
  const now = options.now ?? Date.now();
  const timezone = options.timezone || "Asia/Shanghai";
  const recurrence = buildRecurrence(form.recurrence);
  const start = buildIsoDateTime(form.date, form.startTime);
  const end = buildIsoDateTime(form.date, form.endTime || form.startTime);
  return {
    id: `manual-${now}`,
    title: String(form.title || "").trim(),
    time: {
      start,
      end: end || start,
      label: buildManualTimeLabel(form, recurrence),
    },
    location: String(form.location || "").trim(),
    materials: [],
    contacts: [],
    notes: String(form.notes || "").trim(),
    recurrence,
    evidence: "手动添加",
    source_type: "手动添加",
    confidence: 1,
    quadrant: QUADRANTS[form.quadrant] ? form.quadrant : "important_not_urgent",
    timezone,
    status: "todo",
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

function buildIsoDateTime(date, time) {
  if (!date || !time) return "";
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}+08:00`;
}

function buildManualTimeLabel(form, recurrence) {
  const timeRange = [form.startTime, form.endTime].filter(Boolean).join("-");
  const dateText = form.date || "日期待确认";
  return recurrence.type === "none" ? `${dateText} ${timeRange}`.trim() : `${recurrence.label} ${timeRange}`.trim();
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
    if ("start" in patch) next.time.start = patch.start;
    if ("end" in patch) next.time.end = patch.end;
    if ("materialsText" in patch) next.materials = parseMaterials(patch.materialsText);
    if ("contactsText" in patch) next.contacts = parseContacts(patch.contactsText);
    if (Object.keys(patch).length) next.confidence = Math.max(Number(next.confidence || 0), 0.8);
    return next;
  });
}

function buildAssistantNote(item) {
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
