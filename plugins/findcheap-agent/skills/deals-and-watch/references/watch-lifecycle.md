# Watch lifecycle

Read for pause, resume, delete, `STOP_REQUIRED`, or `LEGACY_UNVERIFIED` reconciliation.

- BOUND/ACTIVE describe local state only. An Automation ID is an unverified reference, not proof of host ownership, scope, execution or notification delivery.
- Stop: call `list_watches`; local pause/delete first via `pause_watch` or `delete_watch`, using the exact Watch ID. An omitted Automation ID allows local stopping; an explicitly mismatched ID must be corrected, not ignored. Legacy rules can also be stopped locally without binding first.
- Then use the real host interface to verify Automation ownership and scope against this task and exact Watch. Only stop that verified Automation. Never act on a model-supplied ID alone or create a substitute bridge. Failure leaves local checks disabled; never roll back into ACTIVE.
- `STOP_REQUIRED` persists after completion, expiry, pause or deletion. Recover it from `list_watches.pendingStops` or the tool result; it contains no shopping data. STOP_REQUIRED is not a host ACK. Do not claim synchronized/stopped until actual host evidence proves it; this plugin has no ACK-clearing API.
- Resume: COMPLETED/EXPIRED cannot resume. Any pending stop or unreconciled legacy rule returns `AUTOMATION_SYNC_REQUIRED`; do not retry with the same ID as approval. Ordinary unbound PAUSED rules without a stop intent can resume locally, not automatically on the host.
- `LEGACY_UNVERIFIED`: inspect the real host for an existing Automation referencing the exact Watch ID before binding. Binding only records the reference; binding a paused rule requests its stop. Never create a duplicate to bypass missing evidence.
- `TRIGGERED` is notification eligibility, not guaranteed delivery. Deduplicate `completionEventId`; repeated COMPLETED/EXPIRED/PAUSED/NOT_FOUND checks must not issue a product alert. Host stopping and crash-between-save-and-notify remain separate verification gates.
- Automated Watch checks never use Chrome and never purchase, reserve, submit forms, checkout, or pay.
