# Arc

Arc is an engine that runs a person's own copy of a fillable D&D 5e character record sheet in a normal browser, with the sheet's own scripts as its rules. The sheet then works on any machine, with no Windows computer and no Acrobat install.

Arc is not affiliated with or endorsed by MorePurpleMoreBetter, the author of the sheets. Arc ships no sheet: get the official sheets from the author's website, <https://www.flapkan.com/download/#charactersheets>, or the author's Patreon, <https://patreon.com/morepurplemorebetter>.

Arc does not run a sheet yet. This repository holds its workspace, the JavaScript engine a sheet's scripts will run on, and the checks every change passes.

The engine is Fabrice Bellard's [QuickJS](https://bellard.org/quickjs/), release 2026-06-04, kept unchanged in `engine/quickjs` under its MIT license and compiled to WebAssembly with [Emscripten](https://emscripten.org/).

The patches in `engine/patches` fix the memory-safety faults and leaks known in that release. The build applies them to a copy in `engine/dist/quickjs` and compiles the copy, so `engine/quickjs` stays as Bellard shipped it. Six patches come from Bellard's later commits, one comes from [quickjs-ng](https://github.com/quickjs-ng/quickjs) under the MIT license kept beside it in `engine/patches/LICENSE-quickjs-ng`, and one is Arc's own. Each patch names its source in its file.

Arc's own code is under the Apache License 2.0, in `LICENSE`.

## Build it yourself

These steps are the same on Windows, macOS and Linux.

1. Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) 26.13 or newer
2. Install [pnpm](https://pnpm.io/installation) 12.16.1 or newer as a program of its own, since Node 26 ships without Corepack
3. Install [Python](https://www.python.org/downloads/) 3, which runs the Emscripten SDK's installer; on Windows the SDK then brings a Python of its own
4. Clone this repository, open its folder and run `pnpm install`
5. Run `pnpm setup:engine`, which fetches the Emscripten SDK 6.0.13 into `.emsdk` in the repository's folder, about 2.1 GB; deleting that folder removes it
6. Run `pnpm build:engine`, which applies the patches and compiles the engine into `engine/dist`, and does nothing when nothing it reads has changed

## Check it

`pnpm check` runs the whole gate: the formatting check, both linters, the type check, the engine build, the boundary rules, the unit tests, and the names check, which keeps the working notes and the sheet's short name out of the repository.

The engine build also makes a fault build in `engine/dist/fault`, which only the engine's tests load. It can fail any one allocation on demand, so the tests reach each patched fault and show the engine ends the run with an error, leaks nothing, and answers the next run.

`pnpm engine:sweep <case>` runs one of the fault cases in `engine/scripts/faults.ts` once for every allocation it makes, failing that allocation, and prints each outcome. With `--without <patch>` it also builds the engine without that patch and marks every allocation where the two builds differ, which is how a case's trigger is found.

## Upgrade the engine

`pnpm engine:check-upgrade <candidate>` checks a candidate engine, either a QuickJS release tarball (`.tar.xz` or `.tar.gz`) or a folder holding a commit of Bellard's, and reports PASS, WARN or FAIL for each check:

- **Files:** the candidate holds every file `engine/release.json` lists, and any new file its sources include
- **Patches:** each patch applies, is already in the candidate, or no longer fits
- **Build:** the candidate builds with the patches that apply
- **Tests:** the engine tests pass on the candidate's builds
- **Triggers:** no fault case's allocation count moved
- **Size:** the wasm and its loader stay within 5% of `engine/size.json`, plain and with brotli
- **Time:** the engine tests run within 10% of their time on the pinned engine, a warning and never a failure

It writes only below `engine/dist/upgrade` and changes no tracked file. Switching to a candidate is a manual step:

1. Replace the files in `engine/quickjs` with the candidate's
2. Replace `engine/release.json` with the fresh record the command wrote to `engine/dist/upgrade/release.json`, and name the new release in this README
3. Delete each patch the report lists as already in the candidate, take it out of `engine/patches/index.ts`, and renumber the patches left from 01, since a test holds them to that order
4. For each moved trigger, run `pnpm engine:sweep <case> --without <patch>` to find it again, and update that case's allocations and triggers in `engine/scripts/faults.ts`
5. Run `pnpm build:engine`, then `pnpm engine:record-size`, which writes the new sizes to `engine/size.json`
6. Run `pnpm check`, then commit

## How Arc is built

AI agents write Arc's design and plans and prove each plan's code in a throwaway copy; the owner reviews every plan, then writes and commits the code.
