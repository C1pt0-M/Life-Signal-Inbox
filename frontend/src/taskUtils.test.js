import test from "node:test";
import assert from "node:assert/strict";

import {
  applyQuadrantOverrides,
  calculateProgress,
  describeAiExtractor,
  buildAiConfigPayload,
  buildManualTodoItem,
  formatAssistantExtraction,
  groupByQuadrant,
  serializeContacts,
  serializeMaterials,
  updateEditableItem,
  updateQuadrantOverride,
} from "./taskUtils.js";

test("calculateProgress returns completed count and percentage", () => {
  const result = calculateProgress([
    { status: "done" },
    { status: "todo" },
    { status: "done" },
  ]);

  assert.deepEqual(result, { done: 2, total: 3, percent: 67 });
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

test("buildManualTodoItem creates structured todo with recurrence and notes", () => {
  const item = buildManualTodoItem(
    {
      title: "程序设计基础",
      date: "2026-04-21",
      startTime: "09:00",
      endTime: "10:30",
      recurrence: "weekdays",
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
  assert.equal(item.location, "博达校区1号教学楼");
  assert.equal(item.notes, "带电脑");
  assert.equal(item.quadrant, "important_urgent");
  assert.equal(item.source_type, "手动添加");
  assert.equal(item.confidence, 1);
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
