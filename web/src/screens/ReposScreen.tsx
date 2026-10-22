import { useNavigate } from "react-router-dom";
import { useRuns } from "../data";
import { StatusIcon } from "../domain";
import type { RunView } from "../lib/contract";
import { formatWhen, repoLabel, sourceUrl, taskTitle } from "../lib/format";
import { EmptyState, ErrorBanner, Page, PageHeader, Skeleton } from "../patterns";
import { Button, FolderIcon, PlusIcon } from "../ui";
import styles from "./screens.module.css";

/** Repositories you have run against, each with its runs; reuses the mockup's project page layout. */
export function ReposScreen() {
  const runs = useRuns();
  const navigate = useNavigate();
  const byRepo = new Map<string, RunView[]>();
  for (const run of runs.data ?? []) {
    const url = sourceUrl(run.request.repo);
    byRepo.set(url, [...(byRepo.get(url) ?? []), run]);
  }
  return (
    <Page>
      <PageHeader title="Repositories" subtitle="Every repository you have run Caramel against." />
      {runs.isLoading ? <Skeleton lines={5} /> : null}
      {runs.isError ? <ErrorBanner message="Could not load your runs." onRetry={() => void runs.refetch()} /> : null}
      {runs.isSuccess && byRepo.size === 0 ? (
        <EmptyState icon={<FolderIcon size={28} />} title="No repositories yet" message="Start a run and its repository shows up here." action={<Button variant="primary" icon={<PlusIcon size={18} />} onClick={() => navigate("/")}>New run</Button>} />
      ) : null}
      <div className={styles.repoGrid}>
        {[...byRepo.entries()].map(([url, list]) => (
          <section key={url} className={styles.repoCard} aria-label={repoLabel(url)}>
            <header className={styles.repoHead}>
              <FolderIcon size={20} />
              <h2 className={styles.repoName}>{repoLabel(url)}</h2>
              <Button size="sm" variant="secondary" icon={<PlusIcon size={16} />} onClick={() => navigate(`/?repo=${encodeURIComponent(url)}`)}>New run</Button>
            </header>
            <ul className={styles.repoRuns}>
              {list.slice(0, 6).map((run) => (
                <li key={run.id}>
                  <a href={`/runs/${run.id}`} onClick={(event) => { event.preventDefault(); navigate(`/runs/${run.id}`); }}>
                    <StatusIcon status={run.status} />
                    <span className={styles.repoTask}>{taskTitle(run.request.task, 70)}</span>
                    <time dateTime={run.createdAt}>{formatWhen(run.createdAt)}</time>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}
