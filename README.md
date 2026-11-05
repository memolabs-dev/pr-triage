# pr-triage

Sort outside pull requests into three piles before a maintainer opens them:

- **review**: linked to an issue, within the author's open-PR limit, nothing in protected paths;
- **send back**: the author gets the reason in one comment (too many open PRs, no linked issue, protected files changed);
- **compare**: another open PR targets the same issue, so both are named side by side.

Every decision comes from a rule you can check by hand. No model runs on your code, and the pull request's own code is never checked out.

## Use it as a GitHub Action

```yaml
# .github/workflows/pr-triage.yml
name: PR triage
on:
  pull_request_target:
    types: [opened, reopened, synchronize, edited]
permissions:
  contents: read
  pull-requests: write
  issues: write
jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: guillaume-flambard/pr-triage@v0
```

`pull_request_target` gives the job a token that can label pull requests from forks. That is safe here because the action only reads the pull request through the API; never add a step that checks out the pull request's head.

Rules live in `.github/pr-triage.json` on the base branch, so a pull request cannot change the rules it is judged by:

```json
{
  "maxOpenPerAuthor": 2,
  "requireLinkedIssue": true,
  "protectedPaths": ["**/locales/generated/**", "yarn.lock"],
  "maxChangedLines": 1000,
  "aiCoAuthor": "note",
  "skipAuthors": ["renovate[bot]"],
  "contributingUrl": "https://github.com/OWNER/REPO/blob/main/CONTRIBUTING.md"
}
```

Set `dry-run: "true"` on the step to see decisions in the job summary without labelling anything.

## Replay it on a repository's history

```bash
GITHUB_TOKEN=$(gh auth token) node src/report.js owner/repo 100 [rules.json]
```

It takes the last pull requests from forks, sorts each one as the rules would have when it was opened, and sets the result against what happened to it.

## Develop

```bash
npm test
```

Node 22 or later, no dependencies.

## License

MIT
