# Initialization — Context

Key files and decisions a future session needs to pick up M1.

## Where things live

- **Workspace root** `Cargo.toml` — members: `crates/align-core`,
  `crates/align-cli`, `src-tauri`. `[profile.release]` (lto=thin) is here.
- **Engine** `crates/align-core/src/`:
  - `model.rs` — `Alphabet`, `Sequence`, `AlignedRow`, `Alignment`. Lazy
    coordinate indexes are `OnceCell` on `AlignedRow`; per-column caches
    (`consensus`, `conservation`) are `OnceCell` on `Alignment`.
  - `coords.rs` — `col_to_seq_pos` / `seq_pos_to_col` (impl on `AlignedRow`),
    `is_gap`. Round-trip property-tested in `tests/coords_proptest.rs`.
  - `parse.rs` — tolerant FASTA (`parse_fasta`), `summarize` → `Summary`,
    alphabet inference. Tests in `tests/parse_tests.rs`.
  - `align.rs` `analyze.rs` `edit.rs` — types fixed, bodies `todo!("Mx: …")`.
  - `io.rs` — `write_fasta` implemented; clustal/phylip stubbed.
- **Shell** `src-tauri/src/`:
  - `lib.rs` — `run()`: builder, `manage(Mutex<AppState>)`, `generate_handler!`.
  - `commands.rs` — `parse_summary(bytes, state) -> Result<SummaryDto, String>`.
    `SummaryDto` is the serde mirror of `align_core::Summary` (keeps the engine
    serde-free).
  - `state.rs` — `AppState { sequences }` (placeholder until `Alignment` lands).
  - `tauri.conf.json` — identifier `io.github.boykoneov.iberalign`, productName
    `Iberalign`, `frontendDist: ../dist`, devUrl `:1420`.
  - `capabilities/default.json` — `core:default` only (opener plugin removed).
- **Frontend** `src/`:
  - `ipc/commands.ts` — typed `invoke` wrappers (`parseSummary`); the only place
    that imports `@tauri-apps/api`.
  - `ui/App.tsx` — M0 demo: textarea → `parseSummary` → summary table.
  - `main.tsx` — mounts `ui/App`. `model/ render/ state/` are empty (M1+).

## Toolchain (verified on this machine)

rustc/cargo 1.94, node 24, npm 11, git 2.53, gh 2.92 (auth: BoykoNeov, ssh).
`cargo-tauri` not installed globally — the Tauri CLI comes via the local
`@tauri-apps/cli` dev dep (`npm run tauri …`). `mafft` not installed (M6 only).

## Gotchas

- `generate_context!` embeds `../dist`; build the frontend before a raw
  `cargo build` of the shell, or the macro errors on the missing dist.
- src-tauri `[lib] name = "iberalign_lib"` (distinct from the `iberalign` bin —
  Windows cargo quirk). `main.rs` calls `iberalign_lib::run()`.
- Engine stays serde-free; add IPC DTOs in `src-tauri`, not `align-core`.

## Open decisions deferred to later

- Run-length gap map vs gapped `Vec<u8>` — staying with `Vec<u8>` until
  profiling demands otherwise (spec §4).
- WebGL/pixi renderer — M7; Canvas2D first.
