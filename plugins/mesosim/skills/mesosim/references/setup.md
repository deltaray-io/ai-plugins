# Setup and instance documentation

Install Node.js 22 or later where the host launches MCP processes. The plugin ships a self-contained bridge; no npm installation or build is needed for users. Windows uses the same `node` command as macOS/Linux. In WSL or a remote environment, configuration belongs in that environment's home directory.

First MCP startup and the `setup` command prepare a missing `.env.mesosim` with a blank key. Existing files are never overwritten. The file is created with mode 0600 on Unix; Windows uses the home directory's access controls. Fill in the API key locally. The API client and documentation MCP bridge read the same file:

```dotenv
MESOSIM_INSTANCE=https://mesosim.io
MESOSIM_API_KEY=your-api-key
```

Use your FundPro portal HTTPS origin when applicable. Both hosts launch the bundled bridge through `node`; it constructs `{MESOSIM_INSTANCE}/mcp/meso-docs` internally. No shell dotenv sourcing, host environment-variable interpolation, or manual registration of that endpoint is required.

Documentation MCP always requires bearer authentication. The bridge supplies `Authorization: Bearer {MESOSIM_API_KEY}` to that exact endpoint. Credentials remain in the home-directory file, never in plugin manifests or command arguments. REST API calls use the same bearer authentication.

Run `node "<plugin-root>/scripts/mesosim.mjs" setup`. This creates the template if missing and checks the file without making a network call or revealing the key. It returns JSON with `configuration: ready` (exit 0) or `configuration: needs_setup` (exit 2), the file path, and next steps. Ready configuration also includes the instance and derived MCP URL. A successful local check does not establish service access. If the user requests an API connection test, make a single `list --query pageSize=1` request.

Restart the host session or explicitly reconnect `meso-doc` after changing the file. Merely reloading unchanged plugin configuration may keep an existing connection alive. The bridge selects upstream or local setup mode once per process. While configuration is incomplete or invalid, it completes MCP initialization and exposes `mesosim_setup` for instructions and local readiness checks. Completing the file requires a reconnect to load documentation tools. If the user previously followed the old manual setup instructions, remove the obsolete `meso-doc-instance` connection through the host's MCP settings to avoid stale tools alongside the bridge.

## Troubleshooting

- Codex reports `connection closed: initialize response` immediately: refresh the plugin to a version whose Codex manifest uses `cwd: "."` and `./scripts/mesosim-mcp.mjs`. Earlier versions incorrectly used `${CLAUDE_PLUGIN_ROOT}` in Codex MCP arguments; Codex passed that placeholder literally, so Node exited before loading the bridge. Do not change credentials to work around this launch-path error.

- Missing/invalid config: call the local `mesosim_setup` tool or run `setup` and follow its instructions. If template creation fails, it reports the file path and asks the user to check permissions or create the file locally. Never ask for the key in chat. Hosted public docs remain usable without credentials.
- HTML/non-MCP response: check the intended portal origin and whether the deployment serves MCP at `/mcp/meso-docs`. The bridge reports a concise error instead of dumping the page.
- HTTP 401/403: resolve API-key validity and MCP access. Never print the key.
- Redirect: configure the final portal origin. The bridge refuses redirects even to the same origin and sends no credentials to another endpoint.
- Timeout/transport failure: reconnect after resolving availability. The bridge bounds initialization and HTTP header waiting and never replays requests automatically.
- Node missing: install Node.js 22+ where the host launches MCP, then restart the host so it sees the updated executable path.

When MCP access is unavailable or returns no useful documentation, use https://docs.mesosim.io through the host's web tools and identify public/deployment-specific limitations. Never forward the API key to hosted docs.
