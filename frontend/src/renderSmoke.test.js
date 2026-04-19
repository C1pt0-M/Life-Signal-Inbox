import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("App file imports React for JSX runtime compatibility", () => {
  const source = readFileSync(join(import.meta.dirname, "App.jsx"), "utf8");

  assert.match(source, /import\s+React\s*,\s*\{/);
});
