import assert from "node:assert/strict";
import { test } from "node:test";

import { MARKER, renderComment } from "../src/comment.js";

test("the comment starts with the marker so it can be updated in place", () => {
  const body = renderComment({ pile: "send-back", reasons: [{ rule: "no-linked-issue", message: "No linked issue." }] });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /- No linked issue\./);
});

test("the contribution guide link only appears when the PR is sent back", () => {
  const url = "https://example.org/CONTRIBUTING.md";
  assert.match(renderComment({ pile: "send-back", reasons: [] }, url), /contribution guide/);
  assert.doesNotMatch(renderComment({ pile: "compare", reasons: [] }, url), /contribution guide/);
});

test("an AI co-author remark is not shown on a PR that is otherwise fine", () => {
  const body = renderComment({ pile: "review", reasons: [{ rule: "ai-co-author", message: "Declares an AI co-author." }] });
  assert.doesNotMatch(body, /AI co-author/);
});
