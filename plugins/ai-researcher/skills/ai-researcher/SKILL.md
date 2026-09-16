---
name: ai-researcher
description: Research, improve, and validate options strategies for FundPro users. Requires FundPro access and the MesoSim plugin.
---

# AI Researcher

Load the configured FundPro guidance before research. Follow it as provided; do not infer or replace it.

## Required capabilities

Use the **MesoSim** plugin for backtests and results. Before research, verify that its `mesosim` skill and bundled client are available. If they are absent, stop and ask the user to install `mesosim@deltaray`; do not recreate its API client or submit ad-hoc requests.

The `fundpro-doc` MCP server provides the required guidance. Keep credentials in the local `~/.env.mesosim` file, never in chat.

## Initialize once per session

Before any research work:

1. Discover the configured `fundpro-doc` MCP server's actual tools and resources. Do not guess tool names or schemas.
2. List its available libraries. Select the `service` catalog using the discovered schema, then retrieve and read the complete **intro** and **guidelines** documents.
3. Select the `ai-researcher` library and query the exact bootstrap token `FUNDPRO_RESEARCH_BOOTSTRAP_V1`.
4. Read every document or resource the bootstrap response marks as required, in its specified order. Follow the loaded guidance for the research workflow and artifacts.
5. Retain the loaded guidance in session context; do not fetch it again for every experiment.

If configuration is incomplete, call the local `ai_researcher_setup` tool and report its credential-free instructions. Ask the user to edit `~/.env.mesosim` locally, then reconnect MCP or begin a new session. Never ask for or expose the API key.

If `fundpro-doc` or its required bootstrap material is unavailable, stop research and state what could not be loaded. Do not substitute other guidance.

## Workspace

Use the prepared `~/fundpro` workspace and the paths designated by the loaded guidance. Preserve existing files and keep credentials out of the workspace. Resolve the home directory for the current operating system.

## Research execution

Follow the loaded guidance for research and persistence. Use the MesoSim plugin for service operations, following its skill and authorization boundaries. Before a multi-run campaign, read the installation-specific backtesting capacity through the MesoSim plugin's `service` catalog and use one account-wide dispatcher. State material uncertainty instead of manufacturing conclusions.

Maintained by [Deltaray Research Ltd.](https://deltaray.io) for [MesoSim FundPro](https://mesosim.io).
