import test from "node:test";
import assert from "node:assert/strict";

import {
  applyQuadrantOverrides,
  calculateProgress,
  describeAiExtractor,
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
    describeAiExtractor({ ai_extractor: { enabled: true, model: "demo-model" } }),
    "AI Harness：demo-model"
  );
  assert.equal(describeAiExtractor({ ai_extractor: { enabled: false } }), "规则兜底：未配置模型");
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
