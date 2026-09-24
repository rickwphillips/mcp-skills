// Mirror of the FleetPayload shape produced by src/lib/fleet.ts. Kept as a
// standalone copy so the iframe bundle does not reach into the server tree.
export interface FleetGit {
  branch: string | null;
  dirty: boolean;
  dirtyCount: number;
}

export interface FleetProjectStatus {
  name: string;
  localVersion: string | null;
  git: FleetGit | null;
  changelog?: { dev: string | null; prod: string | null };
  gap?: {
    localVsDev: string | null;
    localVsProd: string | null;
    devVsProd: string | null;
  };
  urls?: { dev?: string; prod?: string };
  notes: string[];
}

export interface FleetPayload {
  generatedAt: string;
  serverVersion: string;
  projects: FleetProjectStatus[];
}
