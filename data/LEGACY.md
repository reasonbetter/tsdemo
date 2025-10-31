This folder documents legacy assets used by the pre‑kernel flow and notes on migration.

- itemBank.json — LEGACY source for items and schema references. The new kernel loads from `data/modules/**/schemas/*.json` and `data/modules/**/items/**/*.json`.
- probeLibrary.json — REMOVED. Probe prompts now live at the item level under `Content.ProbeLibrary` per schema.
- config.json — REMOVED. Runtime configuration is handled via environment flags and driver/schema configs.
- data/items/ — REMOVED. Legacy flat item directory replaced by module‑scoped structure under `data/modules`.

Do not extend legacy assets; prefer adding proper schema/item JSON files under `data/modules`.
