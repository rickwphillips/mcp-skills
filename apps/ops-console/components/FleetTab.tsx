import type { FleetPayload, FleetProjectStatus } from "../types.js";

const gapBadge = (p: FleetProjectStatus) => {
  if (!p.gap) return null;
  const behind = [p.gap.localVsDev, p.gap.localVsProd, p.gap.devVsProd].filter(
    (g) => g !== null && g !== "equal",
  );
  if (behind.length === 0) return <span class="badge ok">in sync</span>;
  return <span class="badge warn">version gap</span>;
};

const GitBadge = ({ p }: { p: FleetProjectStatus }) => {
  if (!p.git) return <span class="badge warn">git unknown</span>;
  return p.git.dirty ? (
    <span class="badge bad">dirty ({p.git.dirtyCount})</span>
  ) : (
    <span class="badge ok">clean</span>
  );
};

const ProjectCard = ({ p }: { p: FleetProjectStatus }) => (
  <div class="card">
    <div class="title-row">
      <h2>{p.name}</h2>
      {p.localVersion && <span class="chip">v{p.localVersion}</span>}
      <GitBadge p={p} />
      {gapBadge(p)}
    </div>
    <div class="row">
      <span class="label">branch</span>
      <span>{p.git?.branch ?? "—"}</span>
    </div>
    {p.changelog && (
      <>
        <div class="row">
          <span class="label">dev DB</span>
          <span>{p.changelog.dev ?? "—"}</span>
        </div>
        <div class="row">
          <span class="label">prod DB</span>
          <span>{p.changelog.prod ?? "—"}</span>
        </div>
      </>
    )}
    {p.urls && (p.urls.dev || p.urls.prod) && (
      <div class="links">
        {p.urls.dev && (
          <a href={p.urls.dev} target="_blank" rel="noreferrer">
            dev ↗
          </a>
        )}
        {p.urls.prod && (
          <a href={p.urls.prod} target="_blank" rel="noreferrer">
            prod ↗
          </a>
        )}
      </div>
    )}
    {p.notes.length > 0 && (
      <ul class="notes">
        {p.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    )}
  </div>
);

export const FleetTab = ({ data }: { data: FleetPayload | null }) => {
  if (!data) {
    return <div class="skeleton">Waiting for fleet data…</div>;
  }
  return (
    <div class="fleet">
      {data.projects.map((p) => (
        <ProjectCard key={p.name} p={p} />
      ))}
    </div>
  );
};
