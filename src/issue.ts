export interface IssueTask {
  url: string;
  title: string;
  body: string;
}

export type IssueFetcher = (url: string) => Promise<IssueTask>;

interface GitHubIssueResponse {
  html_url?: unknown;
  title?: unknown;
  body?: unknown;
  number?: unknown;
  state?: unknown;
}

export type FetchLike = typeof fetch;

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function firstMatch(value: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const group = match?.[1]?.trim();
    if (group) return group;
  }
  return undefined;
}

export function normalizeIssueUrl(input: string): string {
  const trimmed = input.trim();
  const markdown = trimmed.match(/^\[([^\]]+)\]\((https:\/\/github\.com\/[^\s)]+)\)$/);
  if (markdown?.[2]) return markdown[2];

  const angleWrapped = trimmed.match(/^<([^>]+)>$/);
  if (angleWrapped?.[1]) return angleWrapped[1].trim();

  const embedded = trimmed.match(/https:\/\/github\.com\/[^\s)]+/);
  return embedded?.[0] ?? trimmed;
}

export function formatIssueTask(issue: IssueTask): string {
  return [
    "GitHub issue implementation contract",
    `Source issue: ${issue.url}`,
    `Issue title: ${issue.title}`,
    "",
    "Issue description and acceptance criteria:",
    issue.body.trim() || "(No issue body provided. Infer only the minimum change required by the title and repository evidence.)",
    "",
    "Execution requirement:",
    "Implement this issue as written. Preserve its constraints, avoid unrelated changes, verify the requested behavior, and review the final diff against this contract before finishing.",
  ].join("\n");
}

export function parseGitHubIssueUrl(url: string): { owner: string; repo: string; number: string } {
  const normalizedUrl = normalizeIssueUrl(url);
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error(`Invalid issue URL: ${url}`);
  }
  if (parsed.hostname !== "github.com") {
    throw new Error("--issue currently supports GitHub issue URLs.");
  }
  const [owner, repo, issues, number] = parsed.pathname.split("/").filter(Boolean);
  if (owner === undefined || repo === undefined || issues !== "issues" || number === undefined || !/^\d+$/.test(number)) {
    throw new Error(`Invalid GitHub issue URL: ${url}`);
  }
  return { owner, repo, number };
}

async function fetchGitHubIssueFromPage(url: string, fetchImpl: FetchLike): Promise<IssueTask> {
  const response = await fetchImpl(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Dinner-AI-Coding-Harness",
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch issue ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rawTitle = firstMatch(html, [
    /<bdi[^>]*class="[^"]*js-issue-title[^"]*"[^>]*>([\s\S]*?)<\/bdi>/i,
    /<span[^>]*class="[^"]*js-issue-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<title>([\s\S]*?)<\/title>/i,
  ]);
  const rawBody = firstMatch(html, [
    /<td[^>]*class="[^"]*comment-body[^"]*"[^>]*>([\s\S]*?)<\/td>/i,
    /<div[^>]*class="[^"]*comment-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ]);

  const title = rawTitle === undefined
    ? ""
    : stripHtml(rawTitle).replace(/\s*·\s*Issue #\d+.*$/i, "").trim();
  const body = rawBody === undefined ? "" : stripHtml(rawBody);
  if (title === "") throw new Error(`Fetched issue has no title: ${url}`);
  return { url, title, body };
}

export async function fetchGitHubIssueTask(url: string, fetchImpl: FetchLike = fetch): Promise<IssueTask> {
  const normalizedUrl = normalizeIssueUrl(url);
  const { owner, repo, number } = parseGitHubIssueUrl(normalizedUrl);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
  const response = await fetchImpl(apiUrl, {
    headers: {
      "accept": "application/vnd.github+json",
      "user-agent": "Dinner-AI-Coding-Harness",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    return fetchGitHubIssueFromPage(normalizedUrl, fetchImpl);
  }
  const issue = await response.json() as GitHubIssueResponse;
  const title = typeof issue.title === "string" ? issue.title.trim() : "";
  const body = typeof issue.body === "string" ? issue.body : "";
  const htmlUrl = typeof issue.html_url === "string" ? issue.html_url : normalizedUrl;
  if (title === "") throw new Error(`Fetched issue has no title: ${normalizedUrl}`);
  return { url: htmlUrl, title, body };
}
