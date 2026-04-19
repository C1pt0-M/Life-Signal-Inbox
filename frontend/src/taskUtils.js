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
