# Deltaray AI Plugins

Options Trading Research related AI plugins for **OpenAI Codex and Claude Code**, maintained by [Deltaray Research Ltd.](https://deltaray.io).

The **MesoSim** plugin uses [MesoSim](https://mesosim.io) to backtest and analyze Options Trading strategies. **AI Researcher** supports options strategy research for FundPro users.

Both plugins support Codex and Claude Code.

## Requirements

- Node.js **22 or later**, available to the assistant's execution environment.
- A Codex or Claude version with plugin support.
- A [MesoSim account with API access](https://mesosim.io/ai/agent) and an API key for authenticated operations.
- AI Researcher additionally requires FundPro access.

The API client uses Node built-ins. The same runtime runs on Windows, macOS, and Linux.
If the assistant runs inside WSL or remotely, Node and credentials must be available there.

## Install in Claude

From Claude Code, add the GitHub repository as a marketplace and install MesoSim. FundPro users can then install AI Researcher:

```text
/plugin marketplace add deltaray-io/ai-plugins
/plugin install mesosim@deltaray
/plugin install ai-researcher@deltaray
/reload-plugins
/mesosim:setup
```

## Install in Codex

From a terminal, add the GitHub marketplace and install MesoSim. FundPro users should install both plugins:

```sh
codex plugin marketplace add deltaray-io/ai-plugins
codex plugin add mesosim@deltaray
codex plugin add ai-researcher@deltaray
```

Start a **new Codex session** after installation. In the Codex app, open the Plugins browser to find the Deltaray marketplace and its plugins; reopen the app if the newly added marketplace is not yet visible.

Select **MesoSim** from the skill/plugin picker, or ask:

```text
Use MesoSim to check my setup.
Use MesoSim to list my last 20 backtests.
Use MesoSim to run this strategy: SPX Put Broken Wing Butterfly at 10 / 15 / 18 deltas at 60 DTE.
Use MesoSim to export the analytics NAVs for BACKTEST_ID to nav.csv.
Use AI Researcher to research an options strategy with FundPro.
```

Codex loads each plugin's skill through its manifest. All operations in the command table below are available through the MesoSim skill.
Claude Code's `/mesosim:*` syntax is its native plugin command namespace; those command files are not required for Codex operation.

The repository ships separate marketplace catalogs because the hosts use different source-entry schemas:

- `.agents/plugins/marketplace.json` for Codex.
- `.claude-plugin/marketplace.json` for Claude.

Each catalog resolves MesoSim and AI Researcher to its corresponding folder under `plugins/`.

## Credentials

On first startup, either plugin creates `.env.mesosim` in your operating system's home directory (`~/.env.mesosim` on macOS/Linux, normally `%USERPROFILE%\.env.mesosim` on Windows) with a blank API key. The `setup` command also prepares this file if needed. Existing files are preserved. Fill in the values locally:

```dotenv
MESOSIM_INSTANCE=https://mesosim.io
MESOSIM_API_KEY=your-api-key
```

Use `https://mesosim.io` for Retail. FundPro uses your portal's HTTPS origin, without `/api` or another path. Create keys on that instance's `/api/keys` page, subject to account access.

Keep the file private and outside version control. Never paste the key into chat.
The client loads the file internally, accepts BOM/CRLF, comments, literal quoted values and optional `export`, and never applies shell expansion or environment-variable overrides.
After filling in the file, reconnect MCP or start a new session to load the documentation tools. AI Researcher uses the same local setup.

## Commands and endpoint coverage

In Codex, request the operation through the MesoSim skill. In Claude, use the corresponding slash command:

| Claude Code command | Operation / endpoint |
| --- | --- |
| `/mesosim:setup` | Prepare missing configuration and check local readiness |
| `/mesosim:docs QUESTION` | Documentation MCP first, hosted docs fallback |
| `/mesosim:list` | `GET /api/v1/backtests` |
| `/mesosim:prepare strategy.json --output submission.json` | Save a new keyed request locally |
| `/mesosim:submit submission.json` | `PUT /api/v1/backtest/new` |
| `/mesosim:status ID` | `GET /api/v1/backtest/{id}/status` |
| `/mesosim:cancel ID` | `POST /api/v1/backtest/{id}/cancel`, then poll |
| `/mesosim:analytics ID` | `GET /api/v1/backtest/{id}/analytics` |
| `/mesosim:strategy ID` | `GET /api/v1/backtest/{id}/strategy-definition` |
| `/mesosim:events ID` | `GET /api/v1/backtest/{id}/events` |
| `/mesosim:navs ID --output nav.csv` | `GET /api/v1/backtest/{id}/navs` |
| `/mesosim:external-data ID --output data.zip` | `GET /api/v1/backtest/{id}/external-data` |
| `/mesosim:sharing ID [--enabled true\|false]` | `GET` or `POST /api/v1/backtest/{id}/sharing` |
| `/mesosim:delete ID --mode Soft\|Details\|Full` | `DELETE /api/v1/backtest/{id}` |

See the complete [API contract](plugins/mesosim/skills/mesosim/references/api.md) for filters, statuses, entitlements, idempotency, and deletion modes.

## License

Copyright 2026 Deltaray Research Ltd.

Original code and included documentation by Deltaray Research Ltd. are licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE). A copy of the license also ships with each plugin.

Commercial use is permitted. Redistribution and remote use of modified versions are subject to the license's corresponding-source and other requirements. The software is provided without warranty, as detailed in the license.

Bundled third-party components retain their respective licenses; see the MesoSim and AI Researcher third-party notice files in their plugin directories. This repository's license does not license the separately hosted MesoSim service, FundPro research guidance, or backend code; access to those services remains subject to their applicable terms.
