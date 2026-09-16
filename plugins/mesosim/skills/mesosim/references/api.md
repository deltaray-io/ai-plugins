# Backtests API contract

Source: `src/mesosim.portal/Controllers/BacktestsApiController.cs`, associated portal DTOs and `OpsDbService` in the Meso repository. This reference reflects the working tree at skill creation; if the deployed instance differs, inspect its contract rather than inventing routes. Authentication is `Authorization: Bearer <MESOSIM_API_KEY>` for every route.

## Routes

All routes below start with `/api/v1`. URL-encode IDs as a single path segment. Supply query parameters via the helper's repeatable `--query key=value` option.

| Method | Route | Parameters / response |
| --- | --- | --- |
| GET | `/backtests` | **Required** `start`, `end` timestamps filtering `CreatedAt`, zero-based `page`; `pageSize` 1–1000 (default 1000), `includeAnalytics` default false, `status` All/Created/Started/Finished/Failed/Cancelled. Returns an array of accessible backtests, newest creation time first. |
| PUT | `/backtest/new` | JSON body described below. 201 returns `BacktestId`, `Name`. |
| GET | `/backtest/{id}/status` | Owner-only lightweight state, timestamps, and optional `FailureReason`. 404 includes missing, deleted or non-owned. |
| POST | `/backtest/{id}/cancel` | No body. 202 accepted, 200 already terminal. Poll status. 409 route unavailable/job not active; 503 disabled/backend unavailable. Retrying cancellation is safe. Never resubmit to recover backend ownership. |
| GET | `/backtest/{id}/analytics` | Performance metrics. 425 running; 405 failed; 409 cancelled. |
| GET | `/backtest/{id}/strategy-definition` | v3 strategy JSON. |
| GET | `/backtest/{id}/events` | JSON array; optional `start`, `end` filter **simulation time**, optional `eventType` from BlotterEventType. Server still scans compressed input; download once where practical. |
| GET | `/backtest/{id}/navs` | CSV text. Exact, case-sensitive `view=analytics` selects the analytics projection; omit for generic NAV export. |
| GET | `/backtest/{id}/external-data` | ZIP when present; save as binary using `--output`. |
| GET | `/backtest/{id}/sharing` | Owner-only; returns `SharingEnabled`. |
| POST | `/backtest/{id}/sharing` | Owner-only; **query** `sharingEnabled=true` or `false`, not JSON. |
| DELETE | `/backtest/{id}` | **Query** `deleteMode=Soft`, `Details`, or `Full`; always supply explicitly. |

The current list implementation includes owned and shared backtests. A listed backtest is not necessarily owned by the caller. Events, NAV and external-data routes explicitly allow owners or shared backtests. Sharing access does not imply owner-only status access. Missing exports can return 404; this alone does not establish failure. Use status to determine lifecycle.

Use ISO 8601 timestamps, `start <= end`, and finite page limits. Stop paging when a page contains fewer than the requested page size. List dates filter `CreatedAt` inclusively; event dates concern simulated time. Always send both list bounds: omitting them can return an empty array instead of an error. The named `list` command defaults to 1970-01-01 through the current UTC time, page 0, and 20 results; raw requests must supply both dates.

Deletion modes: `Soft` marks the record deleted, `Details` removes result artifacts and keeps the summary, and `Full` removes artifacts and the record. Omitted mode defaults to the enum's first value (`Full`) in the controller; do not rely on the service's different default.

## Submit body and idempotency

A request file contains this shape, with a **complete** strategy replacing the abbreviated object:

```json
{
  "StrategyDefinition": { "StrategyName": "...", "Backtest": { "Name": "..." } },
  "Shared": false,
  "IdempotencyKey": "a-unique-uuid-for-this-intended-run"
}
```

The abbreviated example is not runnable. Requires a v3 StrategyDefinition with Backtest, nonblank StrategyName (max 128 characters) and Backtest.Name (max 250). Retail requests have a 2 MiB body limit and JSON depth limit 64. Normal strategy/account entitlements apply.

Keys are case-sensitive, 1–128 ASCII letters, digits, dots, underscores, colons or hyphens. The key belongs in JSON, not a header. Persist the original strategy, sharing and key before sending. Replays return the original ID/name even if finished or failed, or new submissions are paused. Changed payload returns 409; a deleted backtest returns 410 and its key stays reserved. Preserve array order, strings, number spellings, property names and unknown strategy fields on retries; retain the original request file unchanged.

## Errors and limits

Inspect HTTP status and JSON ProblemDetails (including machine-readable code where returned). 400 indicates invalid input; 401 invalid authentication; 403 access/entitlement denial; 413 oversized input; 429 rate or concurrency limits; 503 unavailable/paused services. Honor Retry-After, which can be seconds or an HTTP date. Use bounded backoff for transient errors and stop when the task's time/run budget is exhausted. Do not retry validation/authentication errors unchanged or rotate keys to bypass limits.

Rate limits are deployment-dependent. Keep ordinary requests sequential by default. For an intended multi-run batch, parallel submissions may fill the installation-specific capacity documented in the MCP `service` catalog, or use a 50-submission account-wide ceiling if the capacity document is unavailable. One account-wide dispatcher must count accepted, queued, running, and uncertain submissions and back off on `429`. Use lightweight status polling instead of repeatedly exporting results. A network timeout on submission has an uncertain outcome; recover with the saved idempotency key and identical request.
