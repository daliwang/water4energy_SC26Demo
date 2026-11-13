# Public source integration verification · v0.15.1

Checked 13 November 2026 on the integration branch based on public upstream commit `d0199a817ddbfa0fbf65c9e81d9fcc53081611ee`.

- All **155 JavaScript tests passed**, including context isolation, draft/session restoration, live artifact scoping, manual evidence selection, actual displayed figures, malformed-response handling and guarded question preparation.
- All **75 Python tests passed**, including the local VISTA adapter, port-collision handling, 29 synthetic installer tests and five source-launcher checks. The installer tests use an isolated fake VISTA, not the live science backend.
- An actual temporary-port Mac launcher smoke test passed: health version 0.15.1, pinned VISTA project, page, new scripts/styles and a supplied figure all loaded; the temporary preview was stopped. All 102 source-manifest hashes were verified.
- The public source launcher opens the interface with the pinned local backend/project fields without creating a setup object, starting VISTA or modifying a project. Setup-only fails clearly when the payload is absent. An unmanifested local backend is refused before any backend call.
- The all-in-one release builder refuses an absent private payload before modifying metadata or claiming to create an archive.
- The five supplied PNG figures retain the hashes and dimensions recorded from public upstream. Branding, prompt catalog, hypothesis steps and April evidence fields retain their original content; the case's version string is historical metadata, separate from the interface version.
- The regenerated source manifest covers repository application files only. Private backend snapshots, evidence/migration archives, paper PDFs, credentials, runtime state and new private-data screenshots are absent from this public branch.

The development and October cards use facts already in the public root project summary. Exact local review details are requested from the authorized VISTA project rather than reconstructed on public cards. This check does not re-score a scientific model or claim the remote machines are currently ready. Live saved-answer replay and the full private combined ZIP retain their separate validation records.
