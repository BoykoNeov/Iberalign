//! In-process external MSA backends for Iberalign, feature-gated.
//!
//! This crate stays **pure-Rust and builds nothing native** unless a backend
//! feature is enabled, so the default workspace build needs no C toolchain and
//! no vendored submodule. Enabling `kalign` compiles vendored KAlign v3
//! (Apache-2.0) in-process via `build.rs` and exposes [`kalign_align`].
//!
//! Backends return [`align_core::MsaResult`] (equal-width gapped rows in input
//! order) — the same currency `align_core::progressive_align` produces — so the
//! Tauri/CLI dispatch can treat every engine uniformly.

#[cfg(feature = "kalign")]
mod kalign;

#[cfg(feature = "kalign")]
pub use kalign::{kalign_align, ExternError};
