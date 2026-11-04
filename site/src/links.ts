/** Every outbound link on the page, in one place so a release only edits this file. */
export const LINKS = {
  github: "https://github.com/KatalKavya96/CaramelAI",
  // GitHub's "Watch > Custom > Releases" is the notification list.
  notify: "https://github.com/KatalKavya96/CaramelAI/releases",
  // Always resolves to the newest published release, so it never breaks on a version bump. The page
  // swaps it for the release's .dmg once the GitHub API answers (see useUpdates).
  download: "https://github.com/KatalKavya96/CaramelAI/releases/latest",
  docs: "https://github.com/KatalKavya96/CaramelAI#readme",
} as const;

/** Installs the newest release. curl leaves no quarantine flag, so Gatekeeper shows no prompt. */
export const INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/KatalKavya96/CaramelAI/main/scripts/install-desktop.sh | sh";
