#!/usr/bin/env node
// Replays the triage rules on a repository's recent pull requests from forks and prints
// a short Markdown report: how each would have been sorted, against what really happened.
// usage: GITHUB_TOKEN=... node src/report.js owner/repo [count] [config.json]
import { readFileSync } from "node:fs";

import { createClient, fetchRecentForkPullRequests } from "./github.js";
import { triage } from "./rules.js";

const [repo, countArg = "100", configPath] = process.argv.slice(2);
if (!repo?.includes("/")) {
  console.error("usage: node src/report.js owner/repo [count] [config.json]");
  process.exit(2);
}
const [owner, name] = repo.split("/");
const config = configPath ? JSON.parse(readFileSync(configPath, "utf8")) : {};

const outcomeOf = (pr) => (pr.mergedAt ? "merged" : pr.state === "CLOSED" ? "closed" : "open");

// The pull requests that were open when `pr` was created, among the ones fetched.
const openAt = (prs, pr) =>
  prs.filter((other) => other.number !== pr.number && other.createdAt < pr.createdAt && (!other.closedAt || other.closedAt > pr.createdAt));

const client = createClient(process.env.GITHUB_TOKEN);
const { scanned, prs } = await fetchRecentForkPullRequests(client, owner, name, Number(countArg));
if (prs.length === 0) {
  console.log(`No pull requests from forks in the last ${scanned} of ${repo}.`);
  process.exit(0);
}

const rows = prs.map((pr) => ({ pr, outcome: outcomeOf(pr), result: triage(pr, openAt(prs, pr), config) }));
const count = (predicate) => rows.filter(predicate).length;
const piles = ["review", "send-back", "compare"];
const outcomes = ["merged", "closed", "open"];
const oldest = prs.at(-1).createdAt.slice(0, 10);
const newest = prs[0].createdAt.slice(0, 10);

const lines = [
  `# Pull request triage replay: ${repo}`,
  "",
  `The last ${prs.length} pull requests from forks, opened between ${oldest} and ${newest} (out of ${scanned} scanned). Each one is sorted with the rules as they would have run when it was opened, then set against what happened to it.`,
  "",
  `| Pile | PRs | merged | closed | still open |`,
  `|---|---|---|---|---|`,
];
for (const pile of piles) {
  const inPile = rows.filter((row) => row.result.pile === pile);
  lines.push(`| ${pile} | ${inPile.length} | ${outcomes.map((o) => inPile.filter((r) => r.outcome === o).length).join(" | ")} |`);
}
lines.push("");
const ruleCounts = {};
for (const row of rows) for (const reason of row.result.reasons) ruleCounts[reason.rule] = (ruleCounts[reason.rule] ?? 0) + 1;
lines.push("Rules that fired: " + Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).map(([rule, n]) => `${rule} ${n}`).join(", ") + ".");
lines.push("");
const compareExample = rows.find((row) => row.result.pile === "compare");
if (compareExample) {
  const siblings = compareExample.result.reasons.find((r) => r.rule === "competing-pr").siblings;
  lines.push(`Example to compare: #${compareExample.pr.number} and ${siblings.map((n) => `#${n}`).join(", ")} target the same issue.`);
}
const sendBack = rows.find((row) => row.result.pile === "send-back" && row.outcome === "closed");
if (sendBack) lines.push(`Example sent back: #${sendBack.pr.number}, ${sendBack.result.reasons.filter((r) => r.decisive).map((r) => r.rule).join(", ")}; it was later closed without merging.`);
lines.push("", `Still open today: ${count((row) => row.outcome === "open")} of ${rows.length}.`);
console.log(lines.join("\n"));
