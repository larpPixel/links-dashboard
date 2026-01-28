"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DockerStats {
  ID: string;
  Name: string;
  CPUPerc: string;
  MemUsage: string;
  NetIO: string;
  BlockIO: string;
  MemPerc: string;
  PIDs: string;
}

type SortKey = keyof DockerStats;
type SortDirection = 'asc' | 'desc';

const parseValue = (value: string) => {
    if (!value) return 0;
    // Remove percentage
    if (value.includes('%')) {
        return parseFloat(value.replace('%', ''));
    }
    
    // Handle "Value / Limit" format (take first part)
    const part = value.split('/')[0].trim();
    
    // Parse units
    const match = part.match(/^([\d.]+)([A-Za-z]+)$/);
    if (match) {
        const num = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        
        const multipliers: Record<string, number> = {
            b: 1,
            kb: 1000,
            kib: 1024,
            mb: 1000 * 1000,
            mib: 1024 * 1024,
            gb: 1000 * 1000 * 1000,
            gib: 1024 * 1024 * 1024,
            tb: 1000 * 1000 * 1000 * 1000,
            tib: 1024 * 1024 * 1024 * 1024
        };
        
        return num * (multipliers[unit] || 1);
    }
    
    const num = parseFloat(part);
    return isNaN(num) ? part : num;
};

export default function TopPage() {
  const [stats, setStats] = useState<Record<string, DockerStats>>({});
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'CPUPerc',
    direction: 'desc',
  });

  useEffect(() => {
    const eventSource = new EventSource("/api/stats");

    eventSource.onmessage = (event) => {
      if (!event.data) return;
      try {
        const data: DockerStats = JSON.parse(event.data);
        setStats((prev) => ({
          ...prev,
          [data.ID]: data,
        }));
      } catch (e) {
        // Only log if it's not empty/whitespace
        if (event.data.trim()) {
             console.error("Failed to parse stats:", event.data, e);
        }
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleSort = (key: SortKey) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortedStats = Object.values(stats).sort((a, b) => {
     const valA = parseValue(a[sortConfig.key]);
     const valB = parseValue(b[sortConfig.key]);
     
     if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
     if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
     return 0;
  });

  const SortHeader = ({ label, id }: { label: string; id: SortKey }) => (
    <th 
        className="p-3 font-medium uppercase tracking-wide text-xs cursor-pointer hover:text-[var(--foreground)] transition-colors select-none group"
        onClick={() => handleSort(id)}
    >
        <div className="flex items-center gap-1">
            {label}
            <span className={`transition-opacity ${sortConfig.key === id ? 'opacity-100' : 'opacity-20 group-hover:opacity-50'}`}>
                {sortConfig.key === id && sortConfig.direction === 'asc' ? '▲' : '▼'}
            </span>
        </div>
    </th>
  );

  return (
    <main className="min-h-screen px-6 py-12 max-w-6xl mx-auto">
        <header className="mb-8 fade-in">
            <div className="flex items-baseline gap-2 mb-0.5">
                <Link href="/" className="text-xl font-medium tracking-tight text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                    Overview
                </Link>
                <span className="text-xl text-[var(--muted)] font-light">|</span>
                <h1 className="text-xl font-medium tracking-tight text-[var(--foreground)]">Top</h1>
            </div>
             <p className="text-[var(--muted)] text-sm">Real-time resource usage via docker stats</p>
        </header>

        <div className="overflow-x-auto fade-in">
            <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                        <SortHeader label="Name" id="Name" />
                        <SortHeader label="CPU %" id="CPUPerc" />
                        <SortHeader label="Mem Usage" id="MemUsage" />
                        <SortHeader label="Mem %" id="MemPerc" />
                        <SortHeader label="Net I/O" id="NetIO" />
                        <SortHeader label="Block I/O" id="BlockIO" />
                        <SortHeader label="PIDs" id="PIDs" />
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                    {sortedStats.map(s => (
                        <tr key={s.ID} className="hover:bg-[var(--accent)]/5 transition-colors">
                            <td className="p-3 font-mono">{s.Name}</td>
                            <td className="p-3 font-mono text-green-500">{s.CPUPerc}</td>
                            <td className="p-3 font-mono">{s.MemUsage}</td>
                            <td className="p-3 font-mono">{s.MemPerc}</td>
                            <td className="p-3 font-mono text-[var(--muted)]">{s.NetIO}</td>
                            <td className="p-3 font-mono text-[var(--muted)]">{s.BlockIO}</td>
                            <td className="p-3 font-mono text-[var(--muted)]">{s.PIDs}</td>
                        </tr>
                    ))}
                    {sortedStats.length === 0 && (
                        <tr>
                            <td colSpan={7} className="p-6 text-center text-[var(--muted)]">
                                Connecting to Docker...
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </main>
  );
}
