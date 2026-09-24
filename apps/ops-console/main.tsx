import { render } from "preact";
import { App } from "@modelcontextprotocol/ext-apps";
import { OpsConsole } from "./components/OpsConsole.js";
import type { FleetPayload } from "./types.js";
import "./styles.css";

const app = new App({ name: "ops-console", version: "1.0.0" });

let data: FleetPayload | null = null;
let refreshing = false;

const root = document.getElementById("root")!;
const rerender = () =>
  render(
    <OpsConsole data={data} refreshing={refreshing} onRefresh={refresh} />,
    root,
  );

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  rerender();
  try {
    const result = await app.callServerTool({
      name: "ops_console",
      arguments: {},
    });
    if (!result.isError && result.structuredContent) {
      data = result.structuredContent as unknown as FleetPayload;
    }
  } catch {
    // Transport failure: keep showing the last payload.
  } finally {
    refreshing = false;
    rerender();
  }
}

// Initial payload arrives from the host after the ops_console tool completes.
app.addEventListener("toolresult", (params) => {
  const sc = (params as { structuredContent?: unknown }).structuredContent;
  if (sc) {
    data = sc as FleetPayload;
    rerender();
  }
});

rerender(); // shell renders immediately; fleet fills in when data lands
void app.connect().catch((err: unknown) => {
  console.error("ops-console: host handshake failed", err);
});
