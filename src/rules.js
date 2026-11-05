// Deterministic triage of one pull request. No model and no network: every decision
// comes from a rule a maintainer can re-check by hand.

export const DEFAULT_CONFIG = {
  maxOpenPerAuthor: 2,
  requireLinkedIssue: true,
  maxChangedLines: 1000,
  protectedPaths: [],
  aiCoAuthor: "note", // "note" adds a remark, "send-back" returns the PR
  skipAuthors: [],
  includeMembers: false,
};

const AI_CO_AUTHOR =
  /co-authored-by:[^\n]*(claude|anthropic|cursor|copilot|openai|codex|gemini|devin|aider)|generated with \[?(claude|cursor|codex|copilot|devin|aider|gemini)|created (with|by) devin/i;

const MEMBER_ASSOCIATIONS = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);

export const globToRegExp = (glob) => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${pattern}$`);
};

// pr: { number, author, authorAssociation, isFork, body, commitMessages[], files[], linkedIssues[], changedLines }
// openPrs: other pull requests open at the same moment: { number, author, linkedIssues[] }
export const triage = (pr, openPrs, userConfig = {}) => {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const reasons = [];

  if (config.skipAuthors.includes(pr.author) || pr.author.endsWith("[bot]")) {
    return { pile: "skip", reasons: [{ rule: "skipped-author", message: `Author ${pr.author} is skipped.` }] };
  }
  if (!config.includeMembers && (MEMBER_ASSOCIATIONS.has(pr.authorAssociation) || !pr.isFork)) {
    return { pile: "skip", reasons: [{ rule: "maintainer", message: "Opened by the team, not triaged." }] };
  }

  const others = openPrs.filter((other) => other.number !== pr.number);
  const sameAuthorOpen = others.filter((other) => other.author === pr.author).length + 1;
  if (sameAuthorOpen > config.maxOpenPerAuthor) {
    reasons.push({
      rule: "open-limit",
      decisive: true,
      message: `${pr.author} has ${sameAuthorOpen} pull requests open; the limit is ${config.maxOpenPerAuthor}. Please finish or close one first.`,
    });
  }

  if (config.requireLinkedIssue && pr.linkedIssues.length === 0) {
    reasons.push({
      rule: "no-linked-issue",
      decisive: true,
      message: "No linked issue. Please add `Closes #<issue>` to the description so the change can be checked against a reported problem.",
    });
  }

  const protectedRegexps = config.protectedPaths.map(globToRegExp);
  const touched = pr.files.filter((path) => protectedRegexps.some((regexp) => regexp.test(path)));
  if (touched.length > 0) {
    reasons.push({
      rule: "protected-path",
      decisive: true,
      message: `Changes files that contributors should not edit: ${touched.slice(0, 5).join(", ")}${touched.length > 5 ? "…" : ""}.`,
    });
  }

  if (pr.changedLines > config.maxChangedLines) {
    reasons.push({
      rule: "large-change",
      decisive: false,
      message: `${pr.changedLines} changed lines; a maintainer should agree on the approach before review.`,
    });
  }

  const text = `${pr.body ?? ""}\n${pr.commitMessages.join("\n")}`;
  if (AI_CO_AUTHOR.test(text)) {
    reasons.push({
      rule: "ai-co-author",
      decisive: config.aiCoAuthor === "send-back",
      message: "Declares an AI co-author.",
    });
  }

  const siblings = others.filter((other) => other.linkedIssues.some((issue) => pr.linkedIssues.includes(issue)));
  if (siblings.length > 0) {
    reasons.push({
      rule: "competing-pr",
      decisive: false,
      message: `Targets the same issue as ${siblings.map((s) => `#${s.number}`).join(", ")}. Compare before reviewing.`,
      siblings: siblings.map((s) => s.number),
    });
  }

  if (reasons.some((reason) => reason.decisive)) return { pile: "send-back", reasons };
  if (reasons.some((reason) => reason.rule === "competing-pr")) return { pile: "compare", reasons };
  return { pile: "review", reasons };
};
