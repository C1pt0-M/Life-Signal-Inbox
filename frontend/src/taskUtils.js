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
    return `AI Harness：${extractor.model || "已启用"}`;
  }
  return "规则兜底：未配置模型";
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
