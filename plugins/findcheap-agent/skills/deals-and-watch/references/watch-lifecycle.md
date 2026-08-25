# Watch lifecycle

Read only for pause, resume, delete, or `LEGACY_UNVERIFIED` reconciliation.

- `LEGACY_UNVERIFIED`: find existing Codex Automation referencing returned Watch ID, then call `bind_watch_automation`. Create no duplicate unless reconciliation proves none exists.
- Pause/resume: call `list_watches`, update bound Automation first, then call `pause_watch` with same `automationId`. Roll back Automation change if Watch update fails.
- Delete: call `list_watches`, delete bound Automation first, then call `delete_watch` with same `automationId`.
- Never claim state changed until both Automation and Watch agree.
- Automated Watch checks never use Chrome and never purchase, reserve, submit forms, checkout, or pay.
