# Arc

Arc is an engine that runs a person's own copy of a fillable D&D 5e character record sheet in a normal browser, with the sheet's own scripts as its rules. The sheet then works on any machine, with no Windows computer and no Acrobat install.

Arc is not affiliated with or endorsed by MorePurpleMoreBetter, the author of the sheets. Arc ships no sheet: get the official sheets from the author's website, <https://www.flapkan.com/download/#charactersheets>, or the author's Patreon, <https://patreon.com/morepurplemorebetter>.

Arc does not run a sheet yet. This repository holds its workspace, the JavaScript engine a sheet's scripts will run on, and the checks every change passes.

The engine is Fabrice Bellard's [QuickJS](https://bellard.org/quickjs/), release 2026-06-04, kept unchanged in `engine/quickjs` under its MIT license and compiled to WebAssembly with [Emscripten](https://emscripten.org/).

## Build it yourself

These steps are the same on Windows, macOS and Linux.

1. Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) 26.13 or newer
2. Install [pnpm](https://pnpm.io/installation) 12.16.1 or newer as a program of its own, since Node 26 ships without Corepack
3. Install [Python](https://www.python.org/downloads/) 3, which runs the Emscripten SDK's installer; on Windows the SDK then brings a Python of its own
4. Clone this repository, open its folder and run `pnpm install`
5. Run `pnpm setup:engine`, which fetches the Emscripten SDK 6.0.13 into `.emsdk` in the repository's folder, about 2.1 GB; deleting that folder removes it
6. Run `pnpm build:engine`, which compiles the engine into `engine/dist`, and does nothing when nothing it reads has changed

## Check it

`pnpm check` runs the whole gate: the formatting check, both linters, the type check, the engine build, the boundary rules, the unit tests, and the names check, which keeps the working notes and the sheet's short name out of the repository.

## How Arc is built

AI agents write Arc's design and plans and prove each plan's code in a throwaway copy; the owner reviews every plan, then writes and commits the code.
