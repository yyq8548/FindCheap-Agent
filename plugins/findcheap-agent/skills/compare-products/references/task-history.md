# Task history

After restart or missing current-task receipts, call `get_shopping_history` once. Preserve original IDs and timestamps. Prices and stock are historical; use `parentRenderId` for a fresh user-requested continuation. Never revive expired quotes or web permission. Different tasks cannot share references.

Only an explicit user request to erase shopping history permits `clear_shopping_history`. Watch rules and host schedules require separate pause/delete actions. Storage corruption, capacity exhaustion or concurrent-write conflicts are errors, not proof of no prior shopping. Confirmed archive seals shopping work; unknown host metadata is not a deletion receipt.
