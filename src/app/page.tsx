"use client";

import { useEffect, useState, useCallback } from "react";

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: "running" | "paused" | "exited" | "created" | "dead";
  status: string;
  traefikUrl: string | null;
  cloudflareUrl: string | null;
  ports: string[];
  group: string | null;
}

interface ContainerGroup {
  name: string;
  containers: ContainerInfo[];
  runningCount: number;
  totalCount: number;
}

interface ApiResponse {
  groups?: ContainerGroup[];
  standalone?: ContainerInfo[];
  total?: number;
  running?: number;
  error?: string;
  message?: string;
}

function StatusDot({ state }: { state: ContainerInfo["state"] }) {
  const colors = {
    running: "bg-green-500",
    paused: "bg-amber-500",
    exited: "bg-red-500",
    created: "bg-blue-500",
    dead: "bg-red-500",
  };

  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colors[state]} ${state === "running" ? "pulse" : ""}`}
    />
  );
}

function ContainerRow({ container }: { container: ContainerInfo }) {
  const displayName = container.group
    ? container.name.replace(`${container.group}_`, "").replace(`${container.group}-`, "")
    : container.name;

  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <StatusDot state={container.state} />
        <span className="truncate">{displayName}</span>
      </div>

      <div className="flex items-center gap-3 text-xs shrink-0 text-[var(--muted)]">
        {container.traefikUrl && (
          <a
            href={container.traefikUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--fg)] transition-colors"
          >
            local
          </a>
        )}
        {container.cloudflareUrl && (
          <a
            href={container.cloudflareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--fg)] transition-colors"
          >
            tunnel
          </a>
        )}
      </div>
    </div>
  );
}

function GroupSection({ group }: { group: ContainerGroup }) {
  const [open, setOpen] = useState(false);

  // Find the main container (one with traefik/cloudflare URL)
  const mainContainer = group.containers.find((c) => c.traefikUrl || c.cloudflareUrl);

  return (
    <div className="border-b border-[var(--border)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-3 text-left hover:opacity-70 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}
          >
            ›
          </span>
          <span className="font-medium">{group.name}</span>
          <span className="text-xs text-[var(--muted)]">
            {group.runningCount}/{group.totalCount}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          {mainContainer?.traefikUrl && (
            <a
              href={mainContainer.traefikUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--fg)] transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              local
            </a>
          )}
          {mainContainer?.cloudflareUrl && (
            <a
              href={mainContainer.cloudflareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--fg)] transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              tunnel
            </a>
          )}
        </div>
      </button>

      {open && (
        <div className="pl-5 pb-3 border-l border-[var(--border)] ml-1.5">
          {group.containers.map((container) => (
            <ContainerRow key={container.id} container={container} />
          ))}
        </div>
      )}
    </div>
  );
}

function StandaloneRow({ container }: { container: ContainerInfo }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 min-w-0">
        <StatusDot state={container.state} />
        <span className="font-medium truncate">{container.name}</span>
      </div>

      <div className="flex items-center gap-3 text-xs shrink-0 text-[var(--muted)]">
        {container.traefikUrl && (
          <a
            href={container.traefikUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--fg)] transition-colors"
          >
            local
          </a>
        )}
        {container.cloudflareUrl && (
          <a
            href={container.cloudflareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--fg)] transition-colors"
          >
            tunnel
          </a>
        )}
        {!container.traefikUrl && !container.cloudflareUrl && "—"}
      </div>
    </div>
  );
}

export default function Home() {
  const [groups, setGroups] = useState<ContainerGroup[]>([]);
  const [standalone, setStandalone] = useState<ContainerInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch("/api/containers");
      const data: ApiResponse = await res.json();

      if (data.error) {
        throw new Error(data.message || data.error);
      }

      setGroups(data.groups || []);
      setStandalone(data.standalone || []);
      setTotal(data.total || 0);
      setRunning(data.running || 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 10000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  return (
    <main className="min-h-screen px-6 py-12 max-w-xl mx-auto">
      <header className="mb-8 fade-in">
        <h1 className="text-xl font-medium tracking-tight mb-0.5">Containers</h1>
        <p className="text-[var(--muted)] text-sm">
          {loading ? "Loading..." : `${running} of ${total} running`}
        </p>
      </header>

      {error ? (
        <div className="fade-in text-[var(--muted)] py-6">
          <p className="mb-3 text-sm">{error}</p>
          <button
            onClick={fetchContainers}
            className="text-xs underline underline-offset-4 hover:opacity-60 transition-opacity"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="py-6 fade-in">
          <div className="w-3 h-3 border border-[var(--border)] border-t-[var(--fg)] rounded-full animate-spin" />
        </div>
      ) : total === 0 ? (
        <p className="text-[var(--muted)] text-sm py-6 fade-in">No containers.</p>
      ) : (
        <div className="fade-in">
          {/* Groups */}
          {groups.length > 0 && (
            <div className="mb-6">
              <div className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">
                Stacks
              </div>
              <div className="border-t border-[var(--border)]">
                {groups.map((group) => (
                  <GroupSection key={group.name} group={group} />
                ))}
              </div>
            </div>
          )}

          {/* Standalone */}
          {standalone.length > 0 && (
            <div>
              {groups.length > 0 && (
                <div className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">
                  Services
                </div>
              )}
              <div className="border-t border-[var(--border)]">
                {standalone.map((container) => (
                  <StandaloneRow key={container.id} container={container} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
