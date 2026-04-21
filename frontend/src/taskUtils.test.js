import test from "node:test";
import assert from "node:assert/strict";

import {
  applyQuadrantOverrides,
  calculateProgress,
  describeAiExtractor,
  buildAiConfigPayload,
  buildCalendarMonth,
  buildExtractionPayload,
  buildManualTodoItem,
  buildSaveableAssistantItems,
  buildTodoUpdate,
  calculateTodoOverview,
  expandCalendarItems,
  filterTodoItems,
  formatAssistantExtraction,
  getCalendarDayItems,
  groupByQuadrant,
  getDueReminders,
  getImageFileFromClipboardEvent,
  splitTodoItems,
  serializeContacts,
  serializeMaterials,
  todayInTimezone,
  updateEditableItem,
  updateQuadrantOverride,
} from "./taskUtils.js";

test("calculateProgress counts only items completed today", () => {
  const result = calculateProgress(
    [
      { status: "done", completed_at: "2026-04-21T09:00:00+08:00" },
      { status: "todo" },
      { status: "done", completed_at: "2026-04-20T19:00:00+08:00" },
    ],
    new Date("2026-04-21T20:13:00+08:00")
  );

  assert.deepEqual(result, { done: 1, total: 3, percent: 33 });
});

test("calculateTodoOverview counts pending time buckets", () => {
  const items = [
    { id: "overdue", status: "todo", time: { start: "2026-04-20T09:00:00+08:00" } },
    { id: "today", status: "todo", time: { start: "2026-04-20T21:00:00+08:00" } },
    { id: "week", status: "todo", time: { start: "2026-04-25T09:00:00+08:00" } },
    { id: "done-today", status: "done", time: { start: "2026-04-20T09:00:00+08:00" } },
    { id: "no-time", status: "todo", time: { start: "" } },
  ];

  assert.deepEqual(calculateTodoOverview(items, new Date("2026-04-20T10:00:00+08:00")), {
    today: 1,
    overdue: 1,
    week: 2,
    noTime: 1,
  });
});

test("filterTodoItems filters by query status quadrant and time scope", () => {
  const items = [
    {
      id: "1",
      title: "程序设计基础",
      location: "博达校区",
      notes: "带电脑",
      status: "todo",
      quadrant: "important_urgent",
      time: { start: "2026-04-20T09:00:00+08:00" },
    },
    {
      id: "2",
      title: "社区报名",
      location: "社区中心",
      notes: "",
      status: "done",
      quadrant: "not_important_urgent",
      time: { start: "2026-04-19T09:00:00+08:00" },
    },
    {
      id: "3",
      title: "无时间事项",
      status: "todo",
      quadrant: "important_not_urgent",
      time: { start: "" },
    },
  ];

  const result = filterTodoItems(
    items,
    {
      query: "程序",
      status: "todo",
      quadrant: "important_urgent",
      timeScope: "today",
    },
    new Date("2026-04-20T10:00:00+08:00")
  );

  assert.deepEqual(result.map((item) => item.id), []);
  assert.deepEqual(filterTodoItems(items, { timeScope: "no_time" }, new Date("2026-04-20T10:00:00+08:00")).map((item) => item.id), ["3"]);
  assert.deepEqual(filterTodoItems(items, { timeScope: "overdue" }, new Date("2026-04-20T10:00:00+08:00")).map((item) => item.id), ["1", "2"]);
  assert.deepEqual(filterTodoItems(items, { timeScope: "week" }, new Date("2026-04-20T10:00:00+08:00")).map((item) => item.id), []);
});

test("groupByQuadrant keeps every quadrant available", () => {
  const grouped = groupByQuadrant([
    { id: "1", quadrant: "important_urgent" },
    { id: "2", quadrant: "not_important_urgent" },
  ]);

  assert.equal(grouped.important_urgent.length, 1);
  assert.equal(grouped.important_not_urgent.length, 0);
  assert.equal(grouped.not_important_urgent.length, 1);
  assert.equal(grouped.not_important_not_urgent.length, 0);
});

test("applyQuadrantOverrides moves items into user-selected quadrants", () => {
  const items = [
    { id: "1", title: "家长会", quadrant: "important_urgent" },
    { id: "2", title: "志愿者报名", quadrant: "important_not_urgent" },
  ];

  const result = applyQuadrantOverrides(items, { 1: "not_important_not_urgent" });

  assert.equal(result[0].quadrant, "not_important_not_urgent");
  assert.equal(result[1].quadrant, "important_not_urgent");
  assert.notEqual(result[0], items[0]);
});

test("updateQuadrantOverride only accepts known quadrants", () => {
  assert.deepEqual(updateQuadrantOverride({}, "item-1", "not_important_urgent"), {
    "item-1": "not_important_urgent",
  });
  assert.deepEqual(updateQuadrantOverride({ "item-1": "important_urgent" }, "item-1", "bad"), {
    "item-1": "important_urgent",
  });
});

test("describeAiExtractor explains configured AI mode", () => {
  assert.equal(
    describeAiExtractor({ ai_extractor: { enabled: true, model: "demo-model", base_url: "https://example.test/v1" } }),
    "AI Harness：demo-model · https://example.test/v1"
  );
  assert.equal(describeAiExtractor({ ai_extractor: { enabled: false } }), "规则兜底：配置 backend/.env 启用模型");
});

test("buildAiConfigPayload trims runtime AI config form values", () => {
  assert.deepEqual(
    buildAiConfigPayload({
      provider: " openai-compatible ",
      api_key: " secret ",
      model: " demo-model ",
      base_url: " https://example.test/v1/ ",
    }),
    {
      provider: "openai-compatible",
      api_key: "secret",
      model: "demo-model",
      base_url: "https://example.test/v1",
    }
  );
});

test("todayInTimezone returns date in Asia Shanghai by default", () => {
  assert.equal(todayInTimezone(new Date("2026-04-20T16:30:00Z")), "2026-04-21");
});

test("buildExtractionPayload uses runtime current date instead of hardcoded date", () => {
  assert.deepEqual(
    buildExtractionPayload("明天上午10点开会", "微信群", new Date("2026-04-20T12:00:00+08:00")),
    {
      text: "明天上午10点开会",
      source_type: "微信群",
      current_date: "2026-04-20",
      timezone: "Asia/Shanghai",
    }
  );
});

test("getImageFileFromClipboardEvent returns first pasted image", () => {
  const image = new File(["image"], "paste.png", { type: "image/png" });
  const text = new File(["text"], "note.txt", { type: "text/plain" });
  const event = {
    clipboardData: {
      files: [text, image],
      items: [],
    },
  };

  assert.equal(getImageFileFromClipboardEvent(event), image);
});

test("getImageFileFromClipboardEvent supports clipboard items", () => {
  const image = new File(["image"], "clipboard.jpg", { type: "image/jpeg" });
  const event = {
    clipboardData: {
      files: [],
      items: [{ type: "image/jpeg", getAsFile: () => image }],
    },
  };

  assert.equal(getImageFileFromClipboardEvent(event), image);
});

test("formatAssistantExtraction renders fixed fields without contacts", () => {
  const summary = formatAssistantExtraction({
    items: [
      {
        title: "程序设计基础",
        time: { start: "2025-11-26T09:00:00+08:00", label: "2025年11月26日（具体节次待确认）" },
        location: "博达校区1号教学楼",
        materials: ["程序设计基础", "高等数学I"],
        notes: "由课表截图 OCR 生成，具体节次请核对原图。",
        evidence: "我的课表 2025-2026学年第一学期 第11周 程序设计基础 高等数学I",
        confidence: 0.62,
      },
    ],
    validation: {
      pending_confirmations: [
        { item_id: "item-1", field: "time" },
        { item_id: "item-1", field: "contacts" },
      ],
    },
  });

  assert.match(summary, /事件：程序设计基础/);
  assert.match(summary, /时间：2025年11月26日/);
  assert.match(summary, /地点：博达校区1号教学楼/);
  assert.match(summary, /备注：由课表截图 OCR 生成，具体节次请核对原图。；可信度：62%/);
  assert.doesNotMatch(summary, /联系人/);
});

test("formatAssistantExtraction keeps timetable notes concise", () => {
  const summary = formatAssistantExtraction({
    items: [
      {
        kind: "schedule_course",
        title: "算法设计与分析",
        time: { start: "2026-04-21T09:00:00+08:00", label: "2026年4月21日（具体节次待确认）" },
        location: "博达校区1号教学楼",
        notes: "具体节次请核对原图。",
        evidence: "很长很乱的 OCR 原文 我的课表 2025-2026 学年 第二学期 第8周 ...",
        confidence: 0.72,
      },
    ],
  });

  assert.match(summary, /事件：算法设计与分析/);
  assert.match(summary, /备注：具体节次请核对原图。/);
  assert.doesNotMatch(summary, /可信度/);
  assert.doesNotMatch(summary, /OCR 原文/);
});

test("buildManualTodoItem creates structured todo with recurrence and notes", () => {
  const item = buildManualTodoItem(
    {
      title: "程序设计基础",
      date: "2026-04-21",
      startTime: "09:00",
      endTime: "10:30",
      recurrence: "weekdays",
      reminder: "30",
      location: "博达校区1号教学楼",
      notes: "带电脑",
      quadrant: "important_urgent",
    },
    { now: 1234567890, timezone: "Asia/Shanghai" }
  );

  assert.equal(item.id, "manual-1234567890");
  assert.equal(item.title, "程序设计基础");
  assert.equal(item.time.start, "2026-04-21T09:00:00+08:00");
  assert.equal(item.time.end, "2026-04-21T10:30:00+08:00");
  assert.deepEqual(item.recurrence, {
    type: "weekdays",
    label: "每个工作日",
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  });
  assert.deepEqual(item.reminder, { minutes_before: 30, label: "提前30分钟" });
  assert.equal(item.location, "博达校区1号教学楼");
  assert.equal(item.notes, "带电脑");
  assert.equal(item.quadrant, "important_urgent");
  assert.equal(item.source_type, "手动添加");
  assert.equal(item.confidence, 1);
});

test("buildSaveableAssistantItems marks extracted items as todo", () => {
  const items = buildSaveableAssistantItems([
    { id: "ai-1", title: "报名确认", status: "pending" },
    { id: "ai-2", title: "课程提醒" },
  ]);

  assert.deepEqual(items.map((item) => item.status), ["todo", "todo"]);
});

test("buildCalendarMonth starts on Monday and includes surrounding dates", () => {
  const days = buildCalendarMonth(2026, 4);

  assert.equal(days.length, 42);
  assert.equal(days[0].iso, "2026-03-30");
  assert.equal(days[2].iso, "2026-04-01");
  assert.equal(days[2].inCurrentMonth, true);
  assert.equal(days[41].iso, "2026-05-10");
});

test("expandCalendarItems expands one-time and recurring items", () => {
  const items = [
    {
      id: "single",
      title: "一次事项",
      status: "done",
      time: { start: "2026-04-03T09:00:00+08:00" },
      recurrence: { type: "none" },
    },
    {
      id: "daily",
      title: "每天事项",
      status: "todo",
      time: { start: "2026-04-02T09:00:00+08:00" },
      recurrence: { type: "daily" },
    },
    {
      id: "weekdays",
      title: "工作日事项",
      status: "todo",
      time: { start: "2026-04-03T09:00:00+08:00" },
      recurrence: { type: "weekdays" },
    },
    {
      id: "holidays",
      title: "周末事项",
      status: "todo",
      time: { start: "2026-04-03T09:00:00+08:00" },
      recurrence: { type: "holidays" },
    },
  ];

  const expanded = expandCalendarItems(items, "2026-04-01", "2026-04-07");

  assert.deepEqual(getCalendarDayItems("2026-04-01", expanded).map((entry) => entry.item.id), []);
  assert.deepEqual(getCalendarDayItems("2026-04-02", expanded).map((entry) => entry.item.id), ["daily"]);
  assert.deepEqual(getCalendarDayItems("2026-04-03", expanded).map((entry) => entry.item.id), ["single", "daily", "weekdays"]);
  assert.deepEqual(getCalendarDayItems("2026-04-04", expanded).map((entry) => entry.item.id), ["daily", "holidays"]);
  assert.equal(getCalendarDayItems("2026-04-03", expanded)[0].item.status, "done");
});

test("splitTodoItems separates pending and completed items", () => {
  const grouped = splitTodoItems([
    { id: "1", status: "todo" },
    { id: "2", status: "done" },
    { id: "3" },
  ]);

  assert.deepEqual(grouped.pending.map((item) => item.id), ["1", "3"]);
  assert.deepEqual(grouped.completed.map((item) => item.id), ["2"]);
});

test("buildTodoUpdate edits fields and toggles completion", () => {
  const item = buildTodoUpdate(
    {
      id: "todo-1",
      title: "旧事件",
      time: { start: "2026-04-21T09:00:00+08:00", end: "2026-04-21T10:00:00+08:00", label: "" },
      location: "旧地点",
      notes: "",
      recurrence: { type: "none", label: "不重复", rrule: "" },
      quadrant: "important_not_urgent",
      status: "todo",
    },
    {
      title: "新事件",
      date: "2026-04-22",
      startTime: "13:30",
      endTime: "14:30",
      recurrence: "daily",
      reminder: "60",
      location: "新地点",
      notes: "带资料",
      quadrant: "important_urgent",
      status: "done",
    }
  );

  assert.equal(item.title, "新事件");
  assert.equal(item.time.start, "2026-04-22T13:30:00+08:00");
  assert.equal(item.time.end, "2026-04-22T14:30:00+08:00");
  assert.equal(item.recurrence.label, "每天");
  assert.equal(item.reminder.label, "提前1小时");
  assert.equal(item.location, "新地点");
  assert.equal(item.notes, "带资料");
  assert.equal(item.quadrant, "important_urgent");
  assert.equal(item.status, "done");
});

test("buildTodoUpdate preserves saved quadrant changes for planner sync", () => {
  const item = buildTodoUpdate(
    {
      id: "todo-1",
      title: "旧事件",
      time: { start: "2026-04-21T09:00:00+08:00", end: "2026-04-21T10:00:00+08:00", label: "" },
      recurrence: { type: "none", label: "不重复", rrule: "" },
      quadrant: "important_not_urgent",
      status: "todo",
    },
    {
      title: "旧事件",
      date: "2026-04-21",
      startTime: "09:00",
      endTime: "10:00",
      recurrence: "none",
      reminder: "0",
      quadrant: "not_important_urgent",
      status: "todo",
    }
  );

  const grouped = groupByQuadrant([item]);

  assert.equal(item.quadrant, "not_important_urgent");
  assert.equal(grouped.not_important_urgent[0].id, "todo-1");
});

test("getDueReminders returns reminders within current minute once", () => {
  const items = [
    {
      id: "todo-1",
      title: "程序设计基础",
      status: "todo",
      time: { start: "2026-04-21T09:30:00+08:00" },
      reminder: { minutes_before: 30, label: "提前30分钟" },
      location: "博达校区1号教学楼",
    },
    {
      id: "todo-2",
      title: "已完成事项",
      status: "done",
      time: { start: "2026-04-21T09:30:00+08:00" },
      reminder: { minutes_before: 30, label: "提前30分钟" },
    },
  ];

  const due = getDueReminders(items, new Date("2026-04-21T09:00:20+08:00"), new Set());

  assert.equal(due.length, 1);
  assert.equal(due[0].id, "todo-1");
  assert.equal(due[0].reminder_key, "todo-1:2026-04-21T09:30:00+08:00:30");
});

test("updateEditableItem updates nested editable fields", () => {
  const items = [
    {
      id: "item-1",
      title: "待确认事项",
      time: { start: "", end: "", label: "" },
      materials: [],
      contacts: [],
      confidence: 0.42,
    },
  ];

  const edited = updateEditableItem(items, "item-1", {
    title: "社区登记",
    start: "2026-04-20T09:00:00+08:00",
    location: "社区中心",
    materialsText: "身份证、水杯",
    contactsText: "王老师 13800138000",
  });

  assert.equal(edited[0].title, "社区登记");
  assert.equal(edited[0].time.start, "2026-04-20T09:00:00+08:00");
  assert.equal(edited[0].location, "社区中心");
  assert.deepEqual(edited[0].materials, ["身份证", "水杯"]);
  assert.deepEqual(edited[0].contacts, [{ name: "王老师", phone: "13800138000" }]);
  assert.equal(edited[0].confidence, 0.8);
});

test("serialize editable arrays for form fields", () => {
  assert.equal(serializeMaterials(["身份证", "水杯"]), "身份证、水杯");
  assert.equal(serializeContacts([{ name: "王老师", phone: "13800138000" }]), "王老师 13800138000");
});
