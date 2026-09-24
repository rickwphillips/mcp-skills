import { useState } from "preact/hooks";
import type { FunctionComponent } from "preact";
import type { FleetPayload } from "../types.js";
import { FleetTab } from "./FleetTab.js";

interface TabDef {
  id: string;
  label: string;
  component: FunctionComponent<{ data: FleetPayload | null }>;
}

// Future tabs (deploy, health, db) are one-line additions here.
const TABS: readonly TabDef[] = [
  { id: "fleet", label: "Fleet", component: FleetTab },
];

export const OpsConsole = ({
  data,
  refreshing,
  onRefresh,
}: {
  data: FleetPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
}) => {
  const [activeTab, setActiveTab] = useState(TABS[0].id);
  const Active =
    TABS.find((t) => t.id === activeTab)?.component ?? TABS[0].component;

  return (
    <div class="console">
      <div class="header">
        <h1>Ops Console</h1>
        {data && <span class="meta">mcp-skills v{data.serverVersion}</span>}
        {data && (
          <span class="meta">
            {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
        )}
        <span class="spacer" />
        <button class="refresh" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div class="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={t.id === activeTab ? "active" : ""}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Active data={data} />
    </div>
  );
};
