import { NextResponse } from "next/server";

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
  Ports: Array<{
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
  }>;
}

export interface ContainerInfo {
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

export interface ContainerGroup {
  name: string;
  containers: ContainerInfo[];
  runningCount: number;
  totalCount: number;
}

function extractTraefikUrl(labels: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(labels)) {
    if (key.includes("traefik") && key.includes("rule")) {
      const hostMatch = value.match(/Host\(`([^`]+)`\)/i);
      if (hostMatch) {
        return `https://${hostMatch[1]}`;
      }
    }
  }
  return null;
}

function extractCloudflareUrl(labels: Record<string, string>): string | null {
  const cfLabel = labels["cloudflare.tunnel.url"] || labels["cf.tunnel.url"];
  if (cfLabel) {
    return cfLabel.startsWith("http") ? cfLabel : `https://${cfLabel}`;
  }
  return null;
}

function extractGroup(name: string, labels: Record<string, string>): string | null {
  // Check for docker-compose project label first
  const composeProject = labels["com.docker.compose.project"];
  if (composeProject) {
    return composeProject;
  }

  // Check for custom group label
  const customGroup = labels["dashboard.group"];
  if (customGroup) {
    return customGroup;
  }

  // Infer from name patterns: stack_service or stack-service
  const underscoreMatch = name.match(/^([a-z0-9]+)_/i);
  if (underscoreMatch) {
    return underscoreMatch[1];
  }

  const dashMatch = name.match(/^([a-z0-9]+)-[a-z]/i);
  if (dashMatch && dashMatch[1].length > 2) {
    return dashMatch[1];
  }

  return null;
}

function formatPorts(ports: DockerContainer["Ports"]): string[] {
  return ports
    .filter((p) => p.PublicPort)
    .map((p) => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`);
}

function mapContainer(c: DockerContainer): ContainerInfo {
  const name = c.Names[0]?.replace(/^\//, "") || "unnamed";
  return {
    id: c.Id.slice(0, 12),
    name,
    image: c.Image.split(":")[0].split("/").pop() || c.Image,
    state: c.State as ContainerInfo["state"],
    status: c.Status,
    traefikUrl: extractTraefikUrl(c.Labels),
    cloudflareUrl: extractCloudflareUrl(c.Labels),
    ports: formatPorts(c.Ports),
    group: extractGroup(name, c.Labels),
  };
}

async function fetchContainersFromSocket(): Promise<ContainerInfo[]> {
  const socketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
  const response = await fetch(`http://localhost/containers/json?all=true`, {
    // @ts-expect-error - Node.js specific option for unix socket
    unix: socketPath,
  });

  if (!response.ok) {
    throw new Error(`Docker API error: ${response.status}`);
  }

  const containers: DockerContainer[] = await response.json();
  return containers.map(mapContainer);
}

async function fetchContainersViaCurl(): Promise<ContainerInfo[]> {
  const socketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const { stdout } = await execAsync(
    `curl -s --unix-socket ${socketPath} http://localhost/containers/json?all=true`
  );

  const containers: DockerContainer[] = JSON.parse(stdout);
  return containers.map(mapContainer);
}

function getMockContainers(): ContainerInfo[] {
  return [
    // Standalone services
    { id: "a1b2c3d4e5f6", name: "traefik", image: "traefik", state: "running", status: "Up 5 days", traefikUrl: null, cloudflareUrl: null, ports: ["80:80/tcp", "443:443/tcp"], group: null },
    { id: "b2c3d4e5f6g7", name: "portainer", image: "portainer-ce", state: "running", status: "Up 5 days", traefikUrl: "https://portainer.home.local", cloudflareUrl: "https://portainer.example.com", ports: ["9443:9443/tcp"], group: null },
    { id: "c3d4e5f6g7h8", name: "watchtower", image: "watchtower", state: "running", status: "Up 5 days", traefikUrl: null, cloudflareUrl: null, ports: [], group: null },
    
    // Nextcloud stack
    { id: "nc001", name: "nextcloud_app", image: "nextcloud", state: "running", status: "Up 3 days", traefikUrl: "https://cloud.home.local", cloudflareUrl: "https://cloud.example.com", ports: ["80:80/tcp"], group: "nextcloud" },
    { id: "nc002", name: "nextcloud_db", image: "mariadb", state: "running", status: "Up 3 days", traefikUrl: null, cloudflareUrl: null, ports: [], group: "nextcloud" },
    { id: "nc003", name: "nextcloud_redis", image: "redis", state: "running", status: "Up 3 days", traefikUrl: null, cloudflareUrl: null, ports: [], group: "nextcloud" },
    
    // Media stack
    { id: "med001", name: "media_jellyfin", image: "jellyfin", state: "running", status: "Up 2 days", traefikUrl: "https://media.home.local", cloudflareUrl: "https://media.example.com", ports: ["8096:8096/tcp"], group: "media" },
    { id: "med002", name: "media_sonarr", image: "sonarr", state: "running", status: "Up 2 days", traefikUrl: "https://sonarr.home.local", cloudflareUrl: null, ports: ["8989:8989/tcp"], group: "media" },
    { id: "med003", name: "media_radarr", image: "radarr", state: "running", status: "Up 2 days", traefikUrl: "https://radarr.home.local", cloudflareUrl: null, ports: ["7878:7878/tcp"], group: "media" },
    { id: "med004", name: "media_prowlarr", image: "prowlarr", state: "running", status: "Up 2 days", traefikUrl: "https://prowlarr.home.local", cloudflareUrl: null, ports: ["9696:9696/tcp"], group: "media" },
    { id: "med005", name: "media_qbittorrent", image: "qbittorrent", state: "running", status: "Up 2 days", traefikUrl: "https://qbit.home.local", cloudflareUrl: null, ports: ["8080:8080/tcp"], group: "media" },
    
    // Home automation
    { id: "ha001", name: "home_homeassistant", image: "home-assistant", state: "running", status: "Up 7 days", traefikUrl: "https://ha.home.local", cloudflareUrl: "https://ha.example.com", ports: ["8123:8123/tcp"], group: "home" },
    { id: "ha002", name: "home_mqtt", image: "mosquitto", state: "running", status: "Up 7 days", traefikUrl: null, cloudflareUrl: null, ports: ["1883:1883/tcp"], group: "home" },
    { id: "ha003", name: "home_zigbee2mqtt", image: "zigbee2mqtt", state: "running", status: "Up 7 days", traefikUrl: "https://z2m.home.local", cloudflareUrl: null, ports: ["8080:8080/tcp"], group: "home" },
    { id: "ha004", name: "home_nodered", image: "nodered", state: "running", status: "Up 7 days", traefikUrl: "https://nodered.home.local", cloudflareUrl: null, ports: ["1880:1880/tcp"], group: "home" },
    
    // Monitoring stack
    { id: "mon001", name: "monitoring_grafana", image: "grafana", state: "running", status: "Up 10 days", traefikUrl: "https://grafana.home.local", cloudflareUrl: null, ports: ["3000:3000/tcp"], group: "monitoring" },
    { id: "mon002", name: "monitoring_prometheus", image: "prometheus", state: "running", status: "Up 10 days", traefikUrl: null, cloudflareUrl: null, ports: ["9090:9090/tcp"], group: "monitoring" },
    { id: "mon003", name: "monitoring_loki", image: "loki", state: "running", status: "Up 10 days", traefikUrl: null, cloudflareUrl: null, ports: [], group: "monitoring" },
    { id: "mon004", name: "monitoring_promtail", image: "promtail", state: "running", status: "Up 10 days", traefikUrl: null, cloudflareUrl: null, ports: [], group: "monitoring" },
    
    // Network
    { id: "net001", name: "pihole", image: "pihole", state: "running", status: "Up 10 days", traefikUrl: "https://dns.home.local", cloudflareUrl: null, ports: ["53:53/udp"], group: null },
    { id: "net002", name: "vaultwarden", image: "vaultwarden", state: "running", status: "Up 14 days", traefikUrl: "https://vault.home.local", cloudflareUrl: "https://vault.example.com", ports: [], group: null },
    
    // Stopped
    { id: "old001", name: "old-backup-db", image: "postgres", state: "exited", status: "Exited (0) 2 weeks ago", traefikUrl: null, cloudflareUrl: null, ports: [], group: null },
  ];
}

function groupContainers(containers: ContainerInfo[]): { groups: ContainerGroup[]; standalone: ContainerInfo[] } {
  const groupMap = new Map<string, ContainerInfo[]>();
  const standalone: ContainerInfo[] = [];

  for (const container of containers) {
    if (container.group) {
      const existing = groupMap.get(container.group) || [];
      existing.push(container);
      groupMap.set(container.group, existing);
    } else {
      standalone.push(container);
    }
  }

  const groups: ContainerGroup[] = [];
  for (const [name, groupContainers] of groupMap) {
    // Only create group if more than 1 container
    if (groupContainers.length > 1) {
      groups.push({
        name,
        containers: groupContainers.sort((a, b) => a.name.localeCompare(b.name)),
        runningCount: groupContainers.filter((c) => c.state === "running").length,
        totalCount: groupContainers.length,
      });
    } else {
      standalone.push(...groupContainers);
    }
  }

  // Sort groups by name
  groups.sort((a, b) => a.name.localeCompare(b.name));
  
  // Sort standalone: running first, then by name
  standalone.sort((a, b) => {
    if (a.state === "running" && b.state !== "running") return -1;
    if (a.state !== "running" && b.state === "running") return 1;
    return a.name.localeCompare(b.name);
  });

  return { groups, standalone };
}

export async function GET() {
  const useMock = process.env.USE_MOCK_DATA === "true" || process.env.NODE_ENV === "development";

  try {
    let containers: ContainerInfo[];

    try {
      containers = await fetchContainersFromSocket();
    } catch {
      try {
        containers = await fetchContainersViaCurl();
      } catch {
        if (useMock) {
          containers = getMockContainers();
        } else {
          throw new Error("Cannot connect to Docker daemon");
        }
      }
    }

    const { groups, standalone } = groupContainers(containers);
    const running = containers.filter((c) => c.state === "running").length;

    return NextResponse.json({
      groups,
      standalone,
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
