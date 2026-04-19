import test from "node:test";
import assert from "node:assert/strict";

import { applyQuadrantOverrides, calculateProgress, groupByQuadrant, updateQuadrantOverride } from "./taskUtils.js";

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
