#!/usr/bin/env node
// GitHub Action entry point. Reads the pull request from the event, loads the rules from
// the base branch (never from the pull request itself), sorts it, then sets one triage
// label and keeps a single comment up to date.
import { appendFileSync, readFileSync } from "node:fs";

import { LABELS, MARKER, renderComment } from "./comment.js";
import { createClient, fetchOpenPullRequests, fetchPullRequest } from "./github.js";
import { triage } from "./rules.js";

const input = (name, fallback = "") => process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`]?.trim() || fallback;

const loadConfig = async (client, owner, name, path, ref) => {
  const file = await client.rest("GET", `/repos/${owner}/${name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`);
  if (!file) return {};
  return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
};

const ensureLabel = async (client, owner, name, label) => {
  const existing = await client.rest("GET", `/repos/${owner}/${name}/labels/${encodeURIComponent(label.name)}`);
  if (!existing) await client.rest("POST", `/repos/${owner}/${name}/labels`, label);
};

const setPileLabel = async (client, owner, name, number, pile) => {
  const current = (await client.rest("GET", `/repos/${owner}/${name}/issues/${number}/labels`)) ?? [];
  for (const label of Object.values(LABELS)) {
    if (label.name !== LABELS[pile].name && current.some((c) => c.name === label.name)) {
      await client.rest("DELETE", `/repos/${owner}/${name}/issues/${number}/labels/${encodeURIComponent(label.name)}`);
    }
  }
  await ensureLabel(client, owner, name, LABELS[pile]);
  await client.rest("POST", `/repos/${owner}/${name}/issues/${number}/labels`, { labels: [LABELS[pile].name] });
};

const upsertComment = async (client, owner, name, number, body) => {
  const comments = (await client.rest("GET", `/repos/${owner}/${name}/issues/${number}/comments?per_page=100`)) ?? [];
  const mine = comments.find((comment) => comment.body?.startsWith(MARKER));
  if (mine) await client.rest("PATCH", `/repos/${owner}/${name}/issues/comments/${mine.id}`, { body });
  else await client.rest("POST", `/repos/${owner}/${name}/issues/${number}/comments`, { body });
};

const main = async () => {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (!event.pull_request) {
    console.log("Not a pull request event, nothing to do.");
    return;
  }
  const [owner, name] = process.env.GITHUB_REPOSITORY.split("/");
  const number = event.pull_request.number;
  const client = createClient(input("github-token", process.env.GITHUB_TOKEN));
  const dryRun = input("dry-run", "false") === "true";

  const config = await loadConfig(client, owner, name, input("config-path", ".github/pr-triage.json"), event.pull_request.base.ref);
  const pr = await fetchPullRequest(client, owner, name, number);
  const open = await fetchOpenPullRequests(client, owner, name);
  const result = triage(pr, open, config);

  console.log(`#${number} by ${pr.author}: ${result.pile}`);
  for (const reason of result.reasons) console.log(`  ${reason.rule}: ${reason.message}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pile=${result.pile}\n`);
  if (result.pile === "skip") return;

  const comment = renderComment(result, config.contributingUrl);
  if (dryRun) {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Dry run: #${number} would go to "${result.pile}"\n\n${comment}\n`);
    return;
  }
  await setPileLabel(client, owner, name, number, result.pile);
  if (result.pile !== "review" || config.commentOnReview) await upsertComment(client, owner, name, number, comment);
};

main().catch((error) => {
  console.log(`::error::${error.message}`);
  process.exitCode = 1;
});
