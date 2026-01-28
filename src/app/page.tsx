"use client";

import { useEffect, useState, useCallback } from "react";

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: "running" | "paused" | "exited" | "created" | "dead";
  status: string;
  url: string | null;
  ports: string[];
  category: string | null;
  subgroup: string | null;
}

interface Subgroup {
  name: string;
  containers: ContainerInfo[];
  runningCount: number;
  totalCount: number;
  url: string | null;
}

interface Category {
  name: string;
  subgroups: Subgroup[];
  runningCount: number;
  totalCount: number;
}

interface ApiResponse {
  categories?: Category[];
  uncategorized?: ContainerInfo[];
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
    <div
      className={`w-1.5 h-1.5 rounded-full shrink-0 translate-y-[0.5px] ${colors[state]}`}
    />
  );
}

function getUrlLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `[${hostname}]`;
  } catch {
    return "[link]";
  }
}

function ContainerRow({ container }: { container: ContainerInfo }) {
  const displayName = container.subgroup
    ? container.name.replace(`${container.subgroup}_`, "").replace(`${container.subgroup}-`, "")
    : container.name;

  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot state={container.state} />
        <span className="truncate text-[var(--muted)]">{displayName}</span>
      </div>
      {container.url && (
        <a
          href={container.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--muted)] hover:text-[var(--fg)] transition-colors shrink-0"
        >
          {getUrlLabel(container.url)}
        </a>
      )}
    </div>
  );
}

function SubgroupItem({ subgroup }: { subgroup: Subgroup }) {
  const [open, setOpen] = useState(false);
  const hasMultiple = subgroup.containers.length > 1;
  const allRunning = subgroup.runningCount === subgroup.totalCount;
  const mainState = allRunning ? "running" : subgroup.runningCount > 0 ? "paused" : "exited";

  // Single container - show directly
  if (!hasMultiple) {
    const container = subgroup.containers[0];
    return (
      <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot state={container.state} />
          <span className="truncate">{subgroup.name}</span>
        </div>
        {subgroup.url && (
          <a
            href={subgroup.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors shrink-0"
          >
            {getUrlLabel(subgroup.url)}
          </a>
        )}
      </div>
    );
  }

  // Multiple containers - expandable
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 py-1.5 text-sm text-left hover:opacity-70 transition-opacity"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot state={mainState as ContainerInfo["state"]} />
          <span className="truncate">{subgroup.name}</span>
          <span className="text-xs text-[var(--muted)]">
            {subgroup.runningCount}/{subgroup.totalCount}
          </span>
          <span className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>
            ›
          </span>
        </div>
        <div className="flex items-center shrink-0">
          {subgroup.url && (
            <a
              href={subgroup.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {getUrlLabel(subgroup.url)}
            </a>
          )}
        </div>
      </button>

      {open && (
        <div className="pl-4 pb-1 border-l border-[var(--border)] ml-0.5">
          {subgroup.containers.map((container) => (
            <ContainerRow key={container.id} container={container} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryColumn({ category }: { category: Category }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="mb-3 pb-2 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          {category.name}
        </h2>
        <span className="text-xs text-[var(--muted)]">
          {category.runningCount}/{category.totalCount}
        </span>
      </div>
      <div className="space-y-0.5">
        {category.subgroups.map((subgroup) => (
          <SubgroupItem key={subgroup.name} subgroup={subgroup} />
        ))}
      </div>
    </div>
  );
}

function UncategorizedSection({ containers }: { containers: ContainerInfo[] }) {
  if (containers.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-[var(--border)]">
      <div className="text-xs text-[var(--muted)] mb-3 uppercase tracking-wide">
        Other
      </div>
      <div className="space-y-1">
        {containers.map((container) => (
          <div key={container.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot state={container.state} />
              <span className="truncate">{container.name}</span>
            </div>
            {container.url ? (
              <a
                href={container.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors shrink-0"
              >
                {getUrlLabel(container.url)}
              </a>
            ) : (
              <span className="text-xs text-[var(--muted)]">—</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [uncategorized, setUncategorized] = useState<ContainerInfo[]>([]);
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

      setCategories(data.categories || []);
      setUncategorized(data.uncategorized || []);
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
    <main className="min-h-screen px-6 py-12 max-w-6xl mx-auto">
      <header className="mb-8 fade-in">
        <div className="flex items-baseline gap-2 mb-0.5">
          <h1 className="text-xl font-medium tracking-tight text-[var(--foreground)]">Overview</h1>
          <span className="text-xl text-[var(--muted)] font-light">|</span>
          <Link href="/top" className="text-xl font-medium tracking-tight text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            Top
          </Link>
        </div>
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
          {/* 3-column layout for categories */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {categories.map((category) => (
              <CategoryColumn key={category.name} category={category} />
            ))}
          </div>
          
          <UncategorizedSection containers={uncategorized} />
        </div>
      )}
    </main>
  );
}
