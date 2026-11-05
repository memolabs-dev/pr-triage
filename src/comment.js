// Renders the single triage comment left on a pull request, and the labels per pile.

export const MARKER = "<!-- pr-triage -->";

export const LABELS = {
  review: { name: "triage: review", color: "0e8a16", description: "Ready for a maintainer to review" },
  "send-back": { name: "triage: send back", color: "d93f0b", description: "Needs changes from the author before review" },
  compare: { name: "triage: compare", color: "fbca04", description: "Another open PR targets the same issue" },
};

const HEADLINES = {
  review: "Thanks for the pull request. It's in the review queue.",
  "send-back": "Thanks for the pull request. Before a maintainer reviews it, a few things need fixing:",
  compare: "Thanks for the pull request. Another open pull request targets the same issue, so a maintainer will compare them:",
};

export const renderComment = (result, contributingUrl) => {
  const lines = [MARKER, HEADLINES[result.pile], ""];
  const shown = result.reasons.filter((reason) => result.pile !== "review" || reason.rule !== "ai-co-author");
  for (const reason of shown) lines.push(`- ${reason.message}`);
  if (contributingUrl && result.pile === "send-back") lines.push("", `See the [contribution guide](${contributingUrl}).`);
  lines.push("", "<sub>Sorted automatically by rules the maintainers set. A maintainer can override this label at any time.</sub>");
  return lines.join("\n");
};
