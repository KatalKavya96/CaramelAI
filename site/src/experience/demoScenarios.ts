export interface DemoScenario {
  id: string;
  label: string;
  title: string;
  prompt: string;
  file: string;
  testFile: string;
  before: string;
  after: string;
  testBefore: string;
  testAfter: string;
  steps: [string, string, string, string];
  tests: { file: string; count: number }[];
  duration: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "bug", label: "Fix a bug", title: "Fix the session timeout",
    prompt: "Increase the session timeout to 30 minutes and update the tests.",
    file: "src/auth.ts", testFile: "tests/session.test.ts",
    before: "export const DEFAULT_SESSION_TIMEOUT = 5 * 60 * 1000;",
    after: "export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;",
    testBefore: "expect(timeout).toBe(5 * MINUTE);", testAfter: "expect(timeout).toBe(30 * MINUTE);",
    steps: ["Read the session configuration and existing tests.", "Update the timeout and cover the change with a test.", "Updated src/auth.ts and the session timeout test.", "Ran the project's test suite on the final patch."],
    tests: [{file:"auth/session.test.ts",count:4},{file:"auth/middleware.test.ts",count:3},{file:"config/env.test.ts",count:2},{file:"utils/crypto.test.ts",count:3}], duration:"2.8s",
  },
  {
    id: "refactor", label: "Refactor", title: "Simplify the access check",
    prompt: "Make the permission check easier to read without changing its behavior.",
    file:"src/permissions.ts", testFile:"tests/permissions.test.ts",
    before:"export const canEdit = (role: string) => role === 'owner' ? true : role === 'editor' ? true : false;",
    after:"export const canEdit = (role: string) => ['owner', 'editor'].includes(role);",
    testBefore:"expect(canEdit('viewer')).toBe(false);", testAfter:"expect(['owner', 'editor', 'viewer'].map(canEdit)).toEqual([true, true, false]);",
    steps:["Read the permission helper and its callers.","Keep the public API and current behavior unchanged.","Simplified the helper and expanded role coverage.","Ran the permissions and project test suites."],
    tests:[{file:"permissions.test.ts",count:7},{file:"roles.test.ts",count:5},{file:"access.test.ts",count:6}],duration:"1.9s",
  },
  {
    id:"tests",label:"Add tests",title:"Cover empty search results",
    prompt:"Add coverage for empty results and case-insensitive matches in search.",
    file:"tests/search-empty.test.ts",testFile:"tests/search-case.test.ts",
    before:"// Empty-result coverage",after:"expect(search([], 'caramel')).toEqual([]);",
    testBefore:"// Case-insensitive coverage",testAfter:"expect(search(['Caramel'], 'caramel')).toEqual(['Caramel']);",
    steps:["Read the search helper and current test coverage.","Cover empty input and case-insensitive matching.","Added two focused search regression checks.","Ran all search tests without changing production code."],
    tests:[{file:"search-empty.test.ts",count:3},{file:"search-case.test.ts",count:3},{file:"search-order.test.ts",count:2}],duration:"0.8s",
  },
];
export function testCount(scenario: DemoScenario) { return scenario.tests.reduce((sum, test) => sum + test.count, 0); }
export function scenarioPatch(scenario: DemoScenario) {
  return [[scenario.file,scenario.before,scenario.after],[scenario.testFile,scenario.testBefore,scenario.testAfter]]
    .map(([file,before,after]) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${before}\n+${after}\n`).join("");
}
