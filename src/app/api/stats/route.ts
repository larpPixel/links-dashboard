import { NextResponse } from "next/server";
import { request } from "http";

export const dynamic = 'force-dynamic';

interface DockerStats {
  id: string;
  name: string;
  cpu_stats: {
    cpu_usage: {
      total_usage: number;
    };
    system_cpu_usage: number;
    online_cpus: number;
  };
  precpu_stats: {
    cpu_usage: {
      total_usage: number;
    };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
  };
  networks: Record<string, { rx_bytes: number; tx_bytes: number }>;
  pids_stats: {
    current: number;
  };
  blkio_stats: {
    io_service_bytes_recursive: Array<{ major: number; minor: number; op: string; value: number }>;
  };
}

// Helper to fetch JSON from Docker Socket
function fetchSocket(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: "/var/run/docker.sock",
      path,
      method: "GET",
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          if (res.statusCode === 200) resolve(JSON.parse(data));
          else reject(new Error(`Status ${res.statusCode}`));
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function calculateCPU(stats: DockerStats): string {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;

    if (systemDelta > 0 && cpuDelta > 0) {
        const ratio = (cpuDelta / systemDelta) * cpuCount * 100.0;
        return ratio.toFixed(2) + "%";
    }
    return "0.00%";
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0B";
    const sizes = ["B", "kB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1000));
    return parseFloat((bytes / Math.pow(1000, i)).toFixed(2)) + "" + sizes[i];
}

function formatMiB(bytes: number): string {
    const mib = bytes / 1024 / 1024;
    const gib = mib / 1024;
    if (gib >= 1) return gib.toFixed(3) + "GiB";
    return mib.toFixed(2) + "MiB";
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // 1. Get initial list of containers
      let containers: any[] = [];
      try {
        containers = await fetchSocket("/containers/json");
      } catch (e) {
        console.error("Failed to fetch containers list:", e);
        controller.close();
        return;
      }

      // 2. Loop and fetch stats for each container
      const fetchStats = async () => {
        if (isClosed) return;

        const promises = containers.map(async (c) => {
            try {
                // Fetch single-shot stats (stream=0)
                const stats: DockerStats = await fetchSocket(`/containers/${c.Id}/stats?stream=0`);
                
                // Transform to format expected by frontend
                // "BlockIO":"124MB / 748MB","CPUPerc":"0.50%","MemPerc":"0.38%","MemUsage":"29.78MiB / 7.686GiB","Name":"siyuan","NetIO":"21.7MB / 25.5MB","PIDs":"11"
                
                // Calculate NetIO
                let rx = 0, tx = 0;
                if (stats.networks) {
                    Object.values(stats.networks).forEach(n => {
                        rx += n.rx_bytes;
                        tx += n.tx_bytes;
                    });
                }

                // Calculate BlockIO
                let read = 0, write = 0;
                if (stats.blkio_stats?.io_service_bytes_recursive) {
                    stats.blkio_stats.io_service_bytes_recursive.forEach(io => {
                        if (io.op.toLowerCase() === 'read') read += io.value;
                        if (io.op.toLowerCase() === 'write') write += io.value;
                    });
                }

                const payload = {
                    ID: c.Id,
                    Name: c.Names[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
                    CPUPerc: calculateCPU(stats),
                    MemUsage: `${formatMiB(stats.memory_stats.usage)} / ${formatMiB(stats.memory_stats.limit)}`,
                    MemPerc: ((stats.memory_stats.usage / stats.memory_stats.limit) * 100).toFixed(2) + "%",
                    NetIO: `${formatBytes(rx)} / ${formatBytes(tx)}`,
                    BlockIO: `${formatBytes(read)} / ${formatBytes(write)}`,
                    PIDs: stats.pids_stats.current.toString()
                };

                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            } catch (e) {
                // Container might have stopped or error fetching stats
                // console.error(`Error stats for ${c.Names[0]}:`, e);
            }
        });

        await Promise.all(promises);
      };

      // Initial fetch
      await fetchStats();

      // Poll every 2 seconds
      const interval = setInterval(fetchStats, 2000);

      req.signal.addEventListener("abort", () => {
        isClosed = true;
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
