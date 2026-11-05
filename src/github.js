// Minimal GitHub client on fetch: GraphQL for reading pull requests, REST for labels
// and comments. No dependencies, so the Action runs without a build step.

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const GRAPHQL = process.env.GITHUB_GRAPHQL_URL ?? `${API}/graphql`;

export const createClient = (token) => {
  if (!token) throw new Error("A GitHub token is required.");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-triage",
  };

  const graphql = async (query, variables) => {
    const response = await fetch(GRAPHQL, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    const body = await response.json();
    if (!response.ok || body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    return body.data;
  };

  const rest = async (method, path, payload) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    return response.status === 204 ? null : response.json();
  };

  return { graphql, rest };
};

const PR_FIELDS = `
  number title state createdAt closedAt mergedAt
  authorAssociation isCrossRepository author { login }
  additions deletions body
  closingIssuesReferences(first: 10) { nodes { number } }
  commits(first: 50) { nodes { commit { message } } }
  files(first: 100) { nodes { path } }`;

export const toTriageInput = (node) => ({
  number: node.number,
  author: node.author?.login ?? "ghost",
  authorAssociation: node.authorAssociation,
  isFork: node.isCrossRepository,
  body: node.body ?? "",
  commitMessages: node.commits.nodes.map((c) => c.commit.message),
  files: node.files?.nodes.map((f) => f.path) ?? [],
  linkedIssues: node.closingIssuesReferences.nodes.map((i) => i.number),
  changedLines: node.additions + node.deletions,
  createdAt: node.createdAt,
  closedAt: node.closedAt,
  mergedAt: node.mergedAt,
  state: node.state,
});

export const fetchPullRequest = async (client, owner, name, number) => {
  const data = await client.graphql(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${PR_FIELDS} } } }`,
    { owner, name, number },
  );
  return toTriageInput(data.repository.pullRequest);
};

// Open pull requests, lightly: author and linked issues are all the rules need from them.
export const fetchOpenPullRequests = async (client, owner, name) => {
  const result = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const data = await client.graphql(
      `query($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequests(first: 100, after: $cursor, states: OPEN) {
            pageInfo { hasNextPage endCursor }
            nodes { number author { login } closingIssuesReferences(first: 10) { nodes { number } } } } } }`,
      { owner, name, cursor },
    );
    const connection = data.repository.pullRequests;
    for (const node of connection.nodes) {
      result.push({
        number: node.number,
        author: node.author?.login ?? "ghost",
        linkedIssues: node.closingIssuesReferences.nodes.map((i) => i.number),
      });
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return result;
};

// Recent pull requests from forks, with full fields, for the report.
export const fetchRecentForkPullRequests = async (client, owner, name, count, maxScan = 2000) => {
  const numbers = [];
  let cursor = null;
  let scanned = 0;
  while (numbers.length < count && scanned < maxScan) {
    const data = await client.graphql(
      `query($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequests(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            nodes { number isCrossRepository authorAssociation author { login } } } } }`,
      { owner, name, cursor },
    );
    const connection = data.repository.pullRequests;
    for (const node of connection.nodes) {
      scanned += 1;
      const login = node.author?.login ?? "";
      if (node.isCrossRepository && !["MEMBER", "OWNER", "COLLABORATOR"].includes(node.authorAssociation) && !login.endsWith("[bot]")) {
        numbers.push(node.number);
      }
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  const prs = [];
  for (const number of numbers.slice(0, count)) prs.push(await fetchPullRequest(client, owner, name, number));
  return { scanned, prs };
};
