import { useRef, useState } from "react";
import { ScorecardView } from "../domain";
import type { Scorecard } from "../lib/contract";
import { parseScorecard } from "../lib/scorecard";
import { EmptyState, ErrorBanner, Page, PageHeader } from "../patterns";
import { Button, UploadIcon } from "../ui";

const LAST_KEY = "caramel.lastScorecard";

/** The last scorecard opened, so coming back to this page does not mean picking the file again. */
function remembered(): { name: string; scorecard: Scorecard } | null {
  try {
    const saved = localStorage.getItem(LAST_KEY);
    if (saved === null) return null;
    const { name, text } = JSON.parse(saved) as { name: string; text: string };
    return { name, scorecard: parseScorecard(text) };
  } catch {
    return null;
  }
}

/**
 * Benchmark results. The scorecard is read in the browser from a file the user picks, so the
 * server gains no route that reads arbitrary paths from disk.
 */
export function BenchmarksScreen() {
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(remembered);
  const [error, setError] = useState<string | null>(null);

  const open = (file: File) => {
    void file.text().then((text) => {
      try {
        const scorecard = parseScorecard(text);
        setLoaded({ name: file.name, scorecard });
        setError(null);
        try {
          localStorage.setItem(LAST_KEY, JSON.stringify({ name: file.name, text }));
        } catch {
          // Too large or storage blocked: the page still works, it just forgets on reload.
        }
      } catch (problem) {
        setError((problem as Error).message);
      }
    });
  };

  const pick = (
    <Button variant={loaded === null ? "primary" : "secondary"} icon={<UploadIcon size={18} />} onClick={() => input.current?.click()}>
      {loaded === null ? "Open scorecard.json" : "Open another"}
    </Button>
  );

  return (
    <Page>
      <PageHeader
        title="Benchmarks"
        subtitle={loaded === null ? "How each model did on the benchmark tasks, judged by hidden checks." : <>Showing <code>{loaded.name}</code></>}
        {...(loaded === null ? {} : { actions: pick })}
      />
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Scorecard file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) open(file);
          event.target.value = "";
        }}
      />
      {error === null ? null : <ErrorBanner message={error} />}
      {loaded === null ? (
        <EmptyState
          icon={<UploadIcon size={28} />}
          title="No scorecard open"
          message="Run bun run benchmark agent --output <folder> in the Caramel folder, then open the scorecard.json it writes there."
          action={pick}
        />
      ) : (
        <ScorecardView scorecard={loaded.scorecard} />
      )}
    </Page>
  );
}
