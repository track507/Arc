# CLAUDE.md

Rules for agents working in Arc's repository

## What Arc is

- An engine that runs a person's own copy of a fillable D&D 5e character record sheet in a normal browser, with the sheet's own scripts as its rules
- Never described as recreating Acrobat or any Adobe product

## Who writes the code

- The owner writes and commits Arc's code, from a plan the owner approved
- An agent writes specs and plans, answers questions and proves a plan's code in a throwaway copy, and commits nothing here

## The notes

- Specs, plans, decision records and research live in `docs/superpowers/`, a separate Git repository that `.gitignore` keeps out of this one
- No tracked file names that folder except `.gitignore` and this file, and none names the scratch folder or the sheet's short name; `pnpm names` enforces both

## Never

- Commit a sheet PDF or any code taken from a sheet, since a sheet is untrusted input
- Push, or skip a hook with `--no-verify`
- Install a toolchain globally, since every toolchain is a local copy that removes cleanly
- Run a browser executable directly

## The shape

- `packages/core` holds the model and the policy, with its ports; it does no I/O and reads time only through the Clock port
- `packages/worker` holds the engine Worker's entry, which chooses the adapters, and the adapters it chooses
- `tools/gate` holds the names check
- `pnpm boundaries` enforces the rules in `.dependency-cruiser.mjs`

## Before handing work over

- Run `pnpm check`, the whole gate
- Write each commit message as `commitlint.config.ts` requires, with no trailers and no mention of an AI or an agent

## Style

- A comment states what is true now and why: no history, no "now" or "previously", and no comments inside tests
- One sentence per line, never wrapped, and no period at the end of a comment line
- Markers: `!` for a hazard, `*` for a section, `?` for context, `TODO` for named deferred work
- American English, ASCII only, and impersonal comments with no "you" or "we"
- Cite a source a reader can open for anything that is not obvious
