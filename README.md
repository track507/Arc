# Arc

Arc is an engine that runs a person's own copy of a fillable D&D 5e character record sheet in a normal browser, with the sheet's own scripts as its rules. The sheet then works on any machine, with no Windows computer and no Acrobat install.

Arc is not affiliated with or endorsed by MorePurpleMoreBetter, the author of the sheets. Arc ships no sheet: get the official sheets from the author's website, <https://www.flapkan.com/download/#charactersheets>, or the author's Patreon, <https://patreon.com/morepurplemorebetter>.

Arc does not run a sheet yet. This repository holds its workspace and the checks every change passes.

## Build it yourself

These steps are the same on Windows, macOS and Linux.

1. Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) 26.13 or newer
2. Install [pnpm](https://pnpm.io/installation) 12.16.1 or newer as a program of its own, since Node 26 ships without Corepack
3. Clone this repository, open its folder and run `pnpm install`

## Check it

`pnpm check` runs the whole gate: the formatting check, both linters, the type check, the boundary rules, the unit tests, and the names check, which keeps the working notes and the sheet's short name out of the repository.

## How Arc is built

AI agents write Arc's design and plans and prove each plan's code in a throwaway copy; the owner reviews every plan, then writes and commits the code.
