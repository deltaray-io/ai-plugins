---
name: mesosim
description: Use MesoSim to backtest options trading strategies. Submit and monitor runs, list backtests, retrieve strategies, analytics, events, NAVs and external data, manage cancellation, sharing and deletion, or consult MesoSim documentation. Supports Retail and FundPro with credentials in the home-directory .env.mesosim. Not for MesoLive trading.
---

# MesoSim

Use the bundled Node.js 22+ client at [../../scripts/mesosim.mjs](../../scripts/mesosim.mjs). It needs no npm dependencies, Python, or shell dotenv commands. Resolve its absolute path from this installed skill directory, then invoke `node "<absolute-plugin-root>/scripts/mesosim.mjs" ...`. Quote each path/argument for the active shell; never evaluate user text as shell code. On PowerShell, use literal single-quoted paths where needed. Never assume the working directory is the plugin root, and save artifacts in the user's workspace, outside the plugin cache.

## First use in each session

Before the first MesoSim task in a session, discover the configured `meso-doc` MCP server's tools/resources, select its `service` catalog using the discovered schema, and retrieve and read the complete **intro** and **guidelines** documents. Process their instructions and adhere to the applicable service guidance throughout the session, subject to higher-priority instructions and the user's authorized scope. Do this for every entry point, including backtest operations and documentation questions.

Keep the guidance and the fact that both documents were read in session context; do not fetch them again for each command or question. This is once per session, not once per installation or bridge process. If setup or MCP access prevents reading either document, complete the available setup steps, state that service guidance could not be loaded, and leave initialization pending. Read both documents when access becomes available; public documentation is not a substitute for the `service` guidance.

Before a multi-run batch, retrieve the complete `backtesting-capacity.md` document from the same `service` catalog, using `MESOSIM_BACKTEST_CAPACITY_V1` for search if needed. This is installation-specific guidance: do not infer a FundPro node count from public documentation or the plugin. If the document is unavailable, keep submissions sequential and state that capacity is unknown. Recheck it when beginning a later batch after a cluster configuration change.

## Commands in each host

In Claude, use `/mesosim:setup`, `/mesosim:list`, `/mesosim:submit`, and the other `/mesosim:*` commands. They load this shared workflow. In Codex, select the MesoSim skill from the skill picker or ask `Use MesoSim to ...`; interpret an operation following the skill name with the same command table below. The shared skill provides all operations without depending on Claude Code's command loader or shell variables.

Read [references/api.md](references/api.md) before choosing an endpoint. Do not invent a validation endpoint or additional routes.

| Operation | Client arguments | Behavior |
| --- | --- | --- |
| Setup | `setup` | Prepare missing config and check readiness; no network/authentication test |
| Docs | `docs` | Show docs endpoints; use the host's MCP client or browser to answer |
| List | `list --query page=0 --query pageSize=20` | List accessible backtests, newest first; defaults to 1970 through now |
| Prepare | `prepare strategy.json --output submission.json` | Persist a new UUID and complete strategy, private by default |
| Submit | `submit submission.json --output submission-response.json` | Submit or recover the saved request |
| Status | `status ID` | Read lightweight lifecycle state |
| Cancel | `cancel ID` | Request cancellation, then poll status |
| Analytics | `analytics ID` | Retrieve performance metrics |
| Strategy | `strategy ID --output strategy.json` | Retrieve v3 strategy definition |
| Events | `events ID --output events.json` | Retrieve events; optional simulation-time filters |
| NAVs | `navs ID --query view=analytics --output nav.csv` | Analytics NAV projection; omit view for generic CSV |
| External data | `external-data ID --output external-data.zip` | Download binary ZIP |
| Sharing | `sharing ID` / `sharing ID --enabled true` / `sharing ID --enabled false` | Read or change sharing |
| Delete | `delete ID --mode Soft` / `Details` / `Full` | Explicit deletion mode required |

Requests accept `--timeout SECONDS` (default 60, maximum 3600), `--output FILE`, and repeatable `--query KEY=VALUE` where the endpoint permits. Raw `GET`, `PUT`, `POST`, `DELETE` mode is available for the same documented routes; use `--body FILE` for raw submissions. Run `--help` for details. The client encodes IDs; supply an unencoded ID to named commands. In raw paths, URL-encode the ID as one segment.

## Credentials

The client reads the OS home directory's `.env.mesosim`: `~/.env.mesosim` on macOS/Linux or normally `%USERPROFILE%\.env.mesosim` on Windows. Both assignments are required:

```dotenv
MESOSIM_INSTANCE=https://mesosim.io
MESOSIM_API_KEY=your-api-key
```

Use `https://mesosim.io` for Retail. For FundPro, use the user's portal HTTPS origin without `/api` or another path; ask for that origin if unknown. The file supports BOM, CRLF, blank lines, comments, optional `export`, and literal quoted values. No shell expansion; environment variables never override the file.

First MCP startup and `setup` create a missing configuration file with a blank API key and preserve existing files. If config is incomplete or invalid, use the local `mesosim_setup` MCP tool or run `setup`, report the file path and next steps, and ask the user to fill in or correct it locally before authenticated calls. Keys are available at the configured instance's `/api/keys`, subject to access. Never ask for a key in chat, read the credential file into tool output, place its contents in artifacts, or pass keys in command arguments. `setup` checks configuration without printing the token. Keep credentials outside version control.

## Documentation: MCP first, hosted docs fallback

MesoSim's documentation MCP endpoint is `{MESOSIM_INSTANCE}/mcp/meso-docs`. Both hosts launch the bundled `meso-doc` stdio bridge, which reads `.env.mesosim` at startup and connects to that exact endpoint using Streamable HTTP. Retail and FundPro use the same automatic instance selection. Use the host's MCP discovery/client tools to find this server and its actual tools/resources. Do not guess tool names or send ordinary REST requests to `/mcp/meso-docs`.

The MCP server provides the `service` catalog and the documentation libraries below. Use the discovered tool schema for catalog/library selection:

| Library | Use for |
| --- | --- |
| `service` | Intro and guidelines on first use; installation-specific backtesting capacity before a multi-run batch |
| `mesosim-docs` | MesoSim documentation; default for MesoSim configuration and behavior questions |
| `mesolive-docs` | MesoLive documentation |
| `deltaray-blog` | Deltaray blog articles |
| `strategy-library` | Strategy examples and reference strategies |

List the server's available libraries through MCP discovery to check for newly added libraries beyond those listed here, and use any that are relevant to the question. Consult multiple libraries when the question spans these sources.

Run `setup` to inspect the configured endpoint without exposing the key. MCP always uses bearer authentication: the bridge sends the existing API key only to the configured MCP endpoint. Follow [references/setup.md](references/setup.md) for setup and troubleshooting. After file changes, reconnect MCP or restart the host session: a running bridge retains its startup configuration. Do not manually register a second MesoSim documentation connection; the installed AI Researcher plugin manages its own connection. With missing/invalid configuration, the bridge starts a local `mesosim_setup` tool without contacting an upstream server. Reconnect after configuration is complete to load documentation tools.

If the matching MCP server/client is absent, unreachable, denied, or returns no useful documentation, use the host's web tools on **<https://docs.mesosim.io>**. Public documentation works without API credentials. State when using public docs for a FundPro question and qualify deployment-specific behavior. Cite relevant documentation pages or MCP resource identifiers. If neither source is accessible, say what remains unverified rather than inventing an answer. Never forward the API bearer token to hosted docs or another host; the bundled MCP configuration contains no API credentials.

## Submission and lifecycle

For an authorized multi-run batch, use one account-wide dispatcher and keep the number of accepted, queued, running, or uncertain submissions within the loaded capacity. Count jobs from other API keys when known; if their occupancy is unknown, treat the documented number as a ceiling and adapt to `429` responses. Prepare each intended run as a separate saved keyed request. Refill slots when jobs reach a terminal state, while keeping status polling and retries finite. Do not start an independent full-capacity pool in each worker or agent.

Stay within the user's intended runs and dates. Obtain a complete v3 strategy from their file or an existing backtest. Preserve intended behavior. `prepare` performs only minimal shape checks, not full strategy validation. Keep `Shared: false` unless sharing was requested.

For an intended new run, `prepare` saves a request with a new UUID in `IdempotencyKey` and refuses to overwrite an existing file. It preserves original strategy text, including numeric spellings and unknown fields. Save the complete request before sending and retain it with the returned ID. A request to submit an existing keyed request uses that exact file; do not prepare a new one.

HTTP 201 means accepted. After submission, poll status at 5–10 second intervals with a finite budget (default 5 minutes unless the user provides another). Stop at `Finished`, `Failed`, or `Cancelled`. Report a still-running job at the budget limit; do not imply it completed. Cancellation acceptance also requires polling. Fetch only requested artifacts and include failure reasons when available. A missing export alone is not proof of failure.

The client makes one request without redirects or retries. On an uncertain submission, retry only the unchanged saved request with its original idempotency key. Never generate a new key to recover an uncertain result or conflict. Bound transient retries (at most three by default) and total waiting, honor `Retry-After` on 429/503 (seconds or HTTP date), and stop on 401/403 for credentials/access or 409/410 submission conflicts. Do not resubmit failed/cancelled work without an intended new run. Persist HTTP status/error details and report unresolved outcomes.

For listing, use finite page limits (default at most 10 pages of 100 if exhaustive listing is requested); stop on a short page and report truncation. List dates filter creation time; event dates concern simulated time. The named `list` command supplies missing bounds (1970-01-01 through now), page 0, and pageSize 20. Preserve explicit user filters and use the same date bounds across pages. Describe an empty array as no matching backtests in the queried range. Listed results may include shared backtests; do not infer ownership from listing alone. Prefer downloading events once to repeated server scans.

Submission, cancellation, sharing changes, and deletion require authorization for that action. Existing explicit authorization is sufficient; do not ask twice. Inspecting results does not authorize sharing/deletion. For deletion establish exact IDs and mode: `Soft` marks deleted, `Details` removes result artifacts while keeping the summary, `Full` removes both. Never rely on the server's destructive default.

Successful output is streamed verbatim. ZIP requires `--output`. File downloads use a temporary sibling file and replace the destination only after a complete transfer; failed transfers preserve any existing destination. Stdout may be partial on failure. Use distinct request/response files, and check exit status before consuming an artifact (0 success, 1 HTTP error, 2 input/transport error). Report backtest IDs, observed states, artifact paths, and any unresolved outcome without credentials.

Maintained by [Deltaray Research Ltd.](https://deltaray.io) for [MesoSim](https://mesosim.io).
