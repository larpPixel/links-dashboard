import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { parse as parseYaml } from "yaml";

const TRAEFIK_CONFIG_PATH = process.env.TRAEFIK_CONFIG_PATH || "/home/pico/server/infra/traefik/config/dynamic/services.yaml";

// Mapping: container pattern -> [category, subgroup]
// Subgroup is used to group related containers (e.g., gitea + gitea-runner)
const SERVICE_MAPPING: Record<string, [string, string]> = {
  // infra/
  "traefik": ["infra", "traefik"],
  "cloudflared": ["infra", "cloudflared"],
  "postgres": ["infra", "databases"],
  "mariadb": ["infra", "databases"],
  "mysql": ["infra", "databases"],
  "redis": ["infra", "databases"],
  
  // devops/
  "gitea": ["devops", "gitea"],
  "runner": ["devops", "gitea"],
  "renovate": ["devops", "renovate"],
  
  // dapps/
  "glance": ["dapps", "glance"],
  "portainer": ["dapps", "portainer"],
  "jellyfin": ["dapps", "jellyfin"],
  "swingmusic": ["dapps", "swingmusic"],
  "qbittorrent": ["dapps", "qbittorrent"],
  "openwebui": ["dapps", "openwebui"],
  "big-bear-open-webui": ["dapps", "openwebui"],
  "excalidraw": ["dapps", "excalidraw"],
  "vidown": ["dapps", "vidown"],
  "anyconv": ["dapps", "anyconverter"],
  "convertx": ["dapps", "convertx"],
  "filemanager": ["dapps", "filemanager"],
  "steam": ["dapps", "steam-headless"],
  "affine": ["dapps", "affine"],
  "gitlab": ["devops", "gitlab"],
  "gitlab-runner": ["devops", "gitlab"],
};

export interface ContainerInfo {
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

export interface Subgroup {
  name: string;
  containers: ContainerInfo[];
  runningCount: number;
  totalCount: number;
  url: string | null; // Main URL for the subgroup
}

export interface Category {
  name: string;
  subgroups: Subgroup[];
  runningCount: number;
  totalCount: number;
}

interface TraefikRouter {
  rule: string;
  service: string;
  entryPoints?: string[];
  middlewares?: string[];
}

interface TraefikService {
  loadBalancer?: {
    servers: Array<{ url: string }>;
  };
}

interface TraefikConfig {
  http?: {
    routers?: Record<string, TraefikRouter>;
    services?: Record<string, TraefikService>;
  };
}

interface DockerCLIOutput {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
  Labels: string;
  Ports: string;
}

// Parse Traefik config to build a map of container -> URL
async function parseTraefikConfig(): Promise<Map<string, { traefikUrl: string; serviceName: string }>> {
  const urlMap = new Map<string, { traefikUrl: string; serviceName: string }>();
  
  try {
    const configContent = await readFile(TRAEFIK_CONFIG_PATH, "utf-8");
    const config: TraefikConfig = parseYaml(configContent);
    
    if (!config.http?.routers || !config.http?.services) {
      return urlMap;
    }
    
    // Build router -> host mapping
    const routerHosts = new Map<string, string>();
    for (const [, router] of Object.entries(config.http.routers)) {
      // Extract first host from rule like: Host(`home.jr4.in`) || Host(`glance.jr4.in`)
      const hostMatch = router.rule.match(/Host\(`([^`]+)`\)/);
      if (hostMatch) {
        routerHosts.set(router.service, `http://${hostMatch[1]}`);
      }
    }
    
    // Build container name -> URL mapping from services
    for (const [serviceName, service] of Object.entries(config.http.services)) {
      if (service.loadBalancer?.servers?.[0]?.url) {
        const backendUrl = service.loadBalancer.servers[0].url;
        // Extract container name from URL like http://glance:8080 or http://host.docker.internal:9000
        const urlMatch = backendUrl.match(/https?:\/\/([^:\/]+)/);
        if (urlMatch) {
          const containerName = urlMatch[1];
          const traefikUrl = routerHosts.get(serviceName);
          if (traefikUrl && containerName !== "host.docker.internal" && !containerName.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            urlMap.set(containerName.toLowerCase(), { traefikUrl, serviceName });
          } else if (traefikUrl) {
            // For host.docker.internal entries, store by service name
            urlMap.set(serviceName.toLowerCase(), { traefikUrl, serviceName });
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to parse Traefik config:", error);
  }
  
  return urlMap;
}

function parseLabels(labelsStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!labelsStr) return labels;
  
  // Split by comma, but be careful about commas in values? 
  // Docker format is usually key=value,key2=value2
  // We'll assume simple splitting for now as complex labels are rare in this context
  const parts = labelsStr.split(",");
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex !== -1) {
      const key = part.substring(0, eqIndex).trim();
      const value = part.substring(eqIndex + 1).trim();
      labels[key] = value;
    }
  }
  return labels;
}

function parsePorts(portsStr: string): string[] {
    if (!portsStr) return [];
    // 0.0.0.0:80->80/tcp, :::80->80/tcp
    return portsStr.split(",")
        .map(p => p.trim())
        .filter(p => p.includes("->"))
        .map(p => {
            // Extract "80" from "0.0.0.0:80->80/tcp"
            // Or "8080" from "0.0.0.0:8080->80/tcp"
            const match = p.match(/:(\d+)->/);
            if (match) {
                const port = match[1];
                const proto = p.includes("/udp") ? "udp" : "tcp";
                return `${port}:${port}/${proto}`; // Simplified for display
            }
            return "";
        })
        .filter(Boolean);
}

function extractCategoryAndSubgroup(name: string, labels: Record<string, string>): [string | null, string | null] {
  // Check for custom labels first
  const customCategory = labels["dashboard.category"];
  const customSubgroup = labels["dashboard.subgroup"];
  if (customCategory) {
    return [customCategory, customSubgroup || name];
  }

  const lowerName = name.toLowerCase();
  
  // Check against our service mapping
  for (const [pattern, [category, subgroup]] of Object.entries(SERVICE_MAPPING)) {
    if (lowerName.includes(pattern)) {
      return [category, subgroup];
    }
  }

  // Fallback: Check for docker-compose project label
  const composeProject = labels["com.docker.compose.project"];
  if (composeProject) {
    const projectLower = composeProject.toLowerCase();
    
    // Determine category
    let category = "dapps";
    if (projectLower.includes("gitea") || projectLower.includes("renovate")) {
      category = "devops";
    } else if (projectLower.includes("traefik") || projectLower.includes("cloudflare") || projectLower.includes("database")) {
      category = "infra";
    }
    
    return [category, composeProject];
  }

  return [null, null];
}

function findTraefikUrl(
  containerName: string, 
  traefikMap: Map<string, { traefikUrl: string; serviceName: string }>
): string | null {
  const lowerName = containerName.toLowerCase();
  
  // Direct match
  if (traefikMap.has(lowerName)) {
    return traefikMap.get(lowerName)!.traefikUrl;
  }
  
  // Try to match by checking if container name contains service name or vice versa
  for (const [key, value] of traefikMap) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      return value.traefikUrl;
    }
    // Also check if container name matches service name pattern
    if (lowerName.includes(value.serviceName.toLowerCase())) {
      return value.traefikUrl;
    }
  }
  
  return null;
}

function mapCLIContainer(
  c: DockerCLIOutput, 
  traefikMap: Map<string, { traefikUrl: string; serviceName: string }>
): ContainerInfo {
  const name = c.Names; // Docker CLI Names is a single string (e.g. "container_name")
  const url = findTraefikUrl(name, traefikMap);
  const labels = parseLabels(c.Labels);
  const [category, subgroup] = extractCategoryAndSubgroup(name, labels);
  
  return {
    id: c.ID.slice(0, 12),
    name,
    image: c.Image.split(":")[0].split("/").pop() || c.Image,
    state: c.State as ContainerInfo["state"],
    status: c.Status,
    url,
    ports: parsePorts(c.Ports),
    category,
    subgroup,
  };
}

async function fetchContainersViaCLI(): Promise<DockerCLIOutput[]> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    // --no-trunc is important for full labels
    const { stdout } = await execAsync(
      `docker ps -a --no-trunc --format "{{json .}}"`
    );

    return stdout
        .trim()
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
  } catch (e) {
    console.error("Docker CLI error:", e);
    throw e;
  }
}

function organizeContainers(containers: ContainerInfo[]): { categories: Category[]; uncategorized: ContainerInfo[] } {
  // Category order
  const categoryOrder = ["dapps", "devops", "infra"];
  
  // Build nested structure: category -> subgroup -> containers
  const categoryMap = new Map<string, Map<string, ContainerInfo[]>>();
  const uncategorized: ContainerInfo[] = [];

  for (const container of containers) {
    if (container.category && container.subgroup) {
      if (!categoryMap.has(container.category)) {
        categoryMap.set(container.category, new Map());
      }
      const subgroupMap = categoryMap.get(container.category)!;
      if (!subgroupMap.has(container.subgroup)) {
        subgroupMap.set(container.subgroup, []);
      }
      subgroupMap.get(container.subgroup)!.push(container);
    } else {
      uncategorized.push(container);
    }
  }

  // Build category objects in order
  const categories: Category[] = [];
  
  for (const categoryName of categoryOrder) {
    const subgroupMap = categoryMap.get(categoryName);
    if (!subgroupMap || subgroupMap.size === 0) continue;
    
    const subgroups: Subgroup[] = [];
    let categoryRunning = 0;
    let categoryTotal = 0;
    
    // Sort subgroups alphabetically
    const sortedSubgroups = Array.from(subgroupMap.entries()).sort((a, b) => 
      a[0].localeCompare(b[0])
    );
    
    for (const [subgroupName, subgroupContainers] of sortedSubgroups) {
      const running = subgroupContainers.filter(c => c.state === "running").length;
      const total = subgroupContainers.length;
      
      // Find the main URL for this subgroup (first container with a URL)
      const mainUrl = subgroupContainers.find(c => c.url)?.url || null;
      
      subgroups.push({
        name: subgroupName,
        containers: subgroupContainers.sort((a, b) => a.name.localeCompare(b.name)),
        runningCount: running,
        totalCount: total,
        url: mainUrl,
      });
      
      categoryRunning += running;
      categoryTotal += total;
    }
    
    categories.push({
      name: categoryName,
      subgroups,
      runningCount: categoryRunning,
      totalCount: categoryTotal,
    });
    
    categoryMap.delete(categoryName);
  }
  
  // Add any remaining categories
  for (const [categoryName, subgroupMap] of categoryMap) {
    const subgroups: Subgroup[] = [];
    let categoryRunning = 0;
    let categoryTotal = 0;
    
    for (const [subgroupName, subgroupContainers] of subgroupMap) {
      const running = subgroupContainers.filter(c => c.state === "running").length;
      const total = subgroupContainers.length;
      const mainUrl = subgroupContainers.find(c => c.url)?.url || null;
      
      subgroups.push({
        name: subgroupName,
        containers: subgroupContainers.sort((a, b) => a.name.localeCompare(b.name)),
        runningCount: running,
        totalCount: total,
        url: mainUrl,
      });
      
      categoryRunning += running;
      categoryTotal += total;
    }
    
    categories.push({
      name: categoryName,
      subgroups: subgroups.sort((a, b) => a.name.localeCompare(b.name)),
      runningCount: categoryRunning,
      totalCount: categoryTotal,
    });
  }
  
  // Sort uncategorized
  uncategorized.sort((a, b) => {
    if (a.state === "running" && b.state !== "running") return -1;
    if (a.state !== "running" && b.state === "running") return 1;
    return a.name.localeCompare(b.name);
  });

  return { categories, uncategorized };
}

export async function GET() {
  try {
    // Parse Traefik config to get URL mappings
    const traefikMap = await parseTraefikConfig();
    
    // Fetch running containers
    const rawContainers = await fetchContainersViaCLI();
    const containers = rawContainers.map((c) => mapCLIContainer(c, traefikMap));

    const { categories, uncategorized } = organizeContainers(containers);
    const running = containers.filter((c) => c.state === "running").length;

    return NextResponse.json({
      categories,
      uncategorized,
      total: containers.length,
      running,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Failed to fetch containers:", error);
    return NextResponse.json(
      {
        error: "Failed to connect to Docker",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
