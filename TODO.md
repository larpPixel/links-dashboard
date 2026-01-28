# Future Improvements

- [ ] **Refactor to Label-Based Discovery**: 
  - Remove hardcoded `SERVICE_MAPPING` and `services.yaml` parsing.
  - Implement logic to read `dashboard.category`, `dashboard.name`, and `dashboard.url` labels directly from containers.
  - Fallback to reading standard `traefik.http.routers.*.rule` labels on the container itself for URL discovery.

- [ ] **Architecture Debloat (Migration to Lightweight Stack)**:
  - **Goal:** Replace heavy Next.js framework with a minimal, resource-efficient stack (~150MB RAM -> ~20MB RAM).
  - **Backend:**
    - Create a single-file Node.js server (using `Fastify` or native `http` module).
    - API Endpoints:
      - `GET /api/containers`: Query Docker Socket directly for container list.
      - `GET /api/stats`: Stream real-time stats from Docker Socket (Server-Sent Events).
    - Serve static frontend assets directly.
  - **Frontend:**
    - Rewrite UI in **Vanilla JS** or **Alpine.js** (remove React/ReactDOM bundle).
    - Replace Tailwind CSS with a minimal raw CSS file (~200 lines).
    - Single `index.html` architecture.
  - **Benefits:**
    - Zero build time (no Webpack/Turbopack).
    - Minimal runtime dependencies.
    - Drastically reduced memory and CPU footprint.
