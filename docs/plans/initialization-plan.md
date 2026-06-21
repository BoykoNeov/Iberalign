# Initialization — Plan (M0)

**Goal:** stand up the project from the handoff spec — a building M0 scaffold,
the curated best-practices subset, and a public GitHub repo. *Not* the MVP.

## Decisions (confirmed with the user)

| Decision        | Choice        | Notes |
|-----------------|---------------|-------|
| Project name    | **Iberalign** | repo + product name; crates stay `align-core`/`align-cli`. Originally "IberPrime" (the spec's working name), but that GitHub repo name was already taken by the user's unrelated 2019 primer-design project, so the project was renamed to Iberalign. The local folder + `iberprime-spec.md` keep their original names. |
| Frontend        | **React + TS**| spec default; best canvas/ecosystem fit |
| License         | **Apache-2.0**| permissive + patent grant |

## Deviations from the spec (deliberate)

1. **Frontend at repo root, not `frontend/`.** The JS project (package.json,
   index.html, vite/ts config) lives at the repo root — the idiomatic Tauri
   layout where the CLI runs and `beforeDevCommand` executes. The spec's module
   separation is preserved via `src/{ipc,model,render,state,ui}/`. Running Tauri
   from a `frontend/` subdir means fighting the CLI's project-root assumptions.
2. **M0 ships genuinely green, not red.** The spec's first-commit recipe suggests
   `todo!()` stubs + red proptests. Since the repo is public from day one, M0 is
   green instead: a real (basic-but-correct) FASTA parser + the coordinate API
   are implemented and tested; only later-milestone functions are `todo!()` and
   are not wired into commands or tests.

## Approach (ordered, per advisor)

1. Build the dependency-light engine crates first (`align-core`, `align-cli`) to
   shake out the MSVC linker before the heavy Tauri build.
2. Generate a known-good Tauri v2 baseline with `create-tauri-app`, then
   restructure into the workspace layout — do not author v2 config from memory.
3. `.gitignore` before any `git add`; create the repo *after* the first commit.
4. CI: realistic day-one bar — fmt/clippy/test on engine + frontend typecheck/
   build (ubuntu), plus a Windows job that compiles the full Tauri shell.

## Best-practices subset applied (curated for this project)

Concise `CLAUDE.md`; `docs/plans` three-file pattern; `.gitignore`/`LICENSE`/
`NOTICE`/`README`; Conventional Commits; a `.claude/settings.json` permission
allowlist; light TDD (coordinate round-trip + parser tests first).
Skipped as not reasonable here: GraphQL/Relay, PM2, headless fan-out,
blocking commit hooks, auto-format hooks, multi-Claude verification.

## Acceptance (M0)

- `cargo test --workspace` green; `cargo fmt --check` + clippy clean.
- `npm run build` (tsc + vite) green.
- Full workspace (incl. Tauri shell) compiles and links.
- `parse_summary` command registered; core path verified via `align-cli`.
- Public repo created and pushed with green-able CI.
