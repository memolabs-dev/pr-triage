import assert from "node:assert/strict";
import { test } from "node:test";

import { globToRegExp, triage } from "../src/rules.js";

const pr = (overrides = {}) => ({
  number: 10,
  author: "outsider",
  authorAssociation: "CONTRIBUTOR",
  isFork: true,
  body: "Closes #1",
  commitMessages: ["fix: handle empty list"],
  files: ["src/list.ts"],
  linkedIssues: [1],
  changedLines: 12,
  ...overrides,
});

test("a clean outside PR goes to review", () => {
  assert.equal(triage(pr(), []).pile, "review");
});

test("team members and same-repo branches are skipped unless asked", () => {
  assert.equal(triage(pr({ authorAssociation: "MEMBER" }), []).pile, "skip");
  assert.equal(triage(pr({ isFork: false }), []).pile, "skip");
  assert.equal(triage(pr({ isFork: false }), [], { includeMembers: true }).pile, "review");
});

test("bots are skipped", () => {
  assert.equal(triage(pr({ author: "renovate[bot]" }), []).pile, "skip");
});

test("a third open PR from the same author is sent back", () => {
  const open = [
    { number: 3, author: "outsider", linkedIssues: [7] },
    { number: 4, author: "outsider", linkedIssues: [8] },
  ];
  const result = triage(pr(), open);
  assert.equal(result.pile, "send-back");
  assert.match(result.reasons.find((r) => r.rule === "open-limit").message, /3 pull requests open; the limit is 2/);
});

test("the PR being triaged is not counted twice in the open list", () => {
  const open = [{ number: 10, author: "outsider", linkedIssues: [1] }, { number: 4, author: "outsider", linkedIssues: [8] }];
  assert.equal(triage(pr(), open).pile, "review");
});

test("a PR without a linked issue is sent back, unless the rule is off", () => {
  assert.equal(triage(pr({ linkedIssues: [], body: "" }), []).pile, "send-back");
  assert.equal(triage(pr({ linkedIssues: [], body: "" }), [], { requireLinkedIssue: false }).pile, "review");
});

test("protected paths send the PR back and name the files", () => {
  const result = triage(pr({ files: ["packages/server/src/locales/generated/fr.ts", "src/a.ts"] }), [], {
    protectedPaths: ["**/locales/generated/**"],
  });
  assert.equal(result.pile, "send-back");
  assert.match(result.reasons[0].message, /locales\/generated\/fr\.ts/);
});

test("a PR on an issue another open PR already targets goes to compare", () => {
  const result = triage(pr(), [{ number: 9, author: "someone", linkedIssues: [1] }]);
  assert.equal(result.pile, "compare");
  assert.deepEqual(result.reasons.find((r) => r.rule === "competing-pr").siblings, [9]);
});

test("send-back wins over compare", () => {
  const result = triage(pr({ files: ["yarn.lock"] }), [{ number: 9, author: "someone", linkedIssues: [1] }], {
    protectedPaths: ["yarn.lock"],
  });
  assert.equal(result.pile, "send-back");
});

test("an AI co-author is a remark by default and decisive only when configured", () => {
  const withAi = pr({ commitMessages: ["fix\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"] });
  assert.equal(triage(withAi, []).pile, "review");
  assert.ok(triage(withAi, []).reasons.some((r) => r.rule === "ai-co-author"));
  assert.equal(triage(withAi, [], { aiCoAuthor: "send-back" }).pile, "send-back");
});

test("a review bot's ai-generated marker is not an AI co-author", () => {
  const coderabbit = pr({ body: "Closes #1\n<!-- coderabbit-ai-generated:v1 -->" });
  assert.ok(!triage(coderabbit, []).reasons.some((r) => r.rule === "ai-co-author"));
});

test("large changes get a remark but stay in review", () => {
  const result = triage(pr({ changedLines: 4000 }), []);
  assert.equal(result.pile, "review");
  assert.ok(result.reasons.some((r) => r.rule === "large-change"));
});

test("globs match nested paths and single segments", () => {
  assert.ok(globToRegExp("**/locales/generated/**").test("packages/a/src/locales/generated/fr.ts"));
  assert.ok(globToRegExp("*.lock").test("yarn.lock"));
  assert.ok(!globToRegExp("*.lock").test("deep/yarn.lock"));
});
