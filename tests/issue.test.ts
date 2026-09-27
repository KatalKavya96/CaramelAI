import { describe, expect, test } from "bun:test";
import { fetchGitHubIssueTask, formatIssueTask, normalizeIssueUrl, parseGitHubIssueUrl } from "../src/issue";

describe("GitHub issue tasks", () => {
  test("normalizes pasted Markdown issue links", () => {
    expect(normalizeIssueUrl("[https://github.com/SASTxNST/Website_SAST/issues/560](https://github.com/SASTxNST/Website_SAST/issues/560)")).toBe("https://github.com/SASTxNST/Website_SAST/issues/560");
  });

  test("parses GitHub issue URLs", () => {
    expect(parseGitHubIssueUrl("https://github.com/SASTxNST/Website_SAST/issues/378")).toEqual({
      owner: "SASTxNST",
      repo: "Website_SAST",
      number: "378",
    });
    expect(parseGitHubIssueUrl("[issue](https://github.com/SASTxNST/Website_SAST/issues/560)")).toEqual({
      owner: "SASTxNST",
      repo: "Website_SAST",
      number: "560",
    });
  });

  test("formats fetched issues as agent tasks", () => {
    expect(formatIssueTask({
      url: "https://github.com/o/r/issues/1",
      title: "Fix filters",
      body: "Expected outcome here.",
    })).toContain("Issue title: Fix filters\n\nIssue description and acceptance criteria:\nExpected outcome here.");
    expect(formatIssueTask({
      url: "https://github.com/o/r/issues/1",
      title: "Fix filters",
      body: "Expected outcome here.",
    })).toContain("Implement this issue as written");
  });

  test("falls back to public issue HTML when the API is blocked", async () => {
    const seen: string[] = [];
    const fetchIssue = async (url: string) => {
      seen.push(url);
      if (url.startsWith("https://api.github.com/")) {
        return new Response("rate limited", { status: 403 });
      }
      return new Response(`
        <html>
          <title>Broken responsive menu · Issue #560 · SASTxNST/Website_SAST</title>
          <bdi class="js-issue-title markdown-title">Broken responsive menu</bdi>
          <td class="d-block comment-body markdown-body js-comment-body"><p>Make it responsive.</p></td>
        </html>
      `, { status: 200, headers: { "content-type": "text/html" } });
    };

    await expect(fetchGitHubIssueTask("[issue](https://github.com/SASTxNST/Website_SAST/issues/560)", fetchIssue as typeof fetch)).resolves.toEqual({
      url: "https://github.com/SASTxNST/Website_SAST/issues/560",
      title: "Broken responsive menu",
      body: "Make it responsive.",
    });
    expect(seen).toEqual([
      "https://api.github.com/repos/SASTxNST/Website_SAST/issues/560",
      "https://github.com/SASTxNST/Website_SAST/issues/560",
    ]);
  });

  test("rejects non-issue URLs", () => {
    expect(() => parseGitHubIssueUrl("https://github.com/o/r/pull/1")).toThrow("Invalid GitHub issue URL");
    expect(() => parseGitHubIssueUrl("https://example.com/o/r/issues/1")).toThrow("GitHub issue URLs");
  });
});
