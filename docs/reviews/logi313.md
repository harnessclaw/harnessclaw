# HarnessClaw Windows onboarding review

Author: @logi313

## Scenario

I tested HarnessClaw from the point of view of a developer who wants to clone the
desktop app, verify that it builds on Windows, and understand the first-run
setup path before using it as an agent workspace. My environment was Windows 11
Pro 64-bit, Node.js v24.15.0, and Yarn 1.22.22.

## What I tried

I cloned the repository, installed dependencies with `corepack yarn install
--frozen-lockfile`, ran a production build with `corepack yarn build`, ran the
advertised lint command with `corepack yarn lint`, and launched the development
app with `corepack yarn dev`.

The install path was mostly smooth. Yarn resolved and fetched packages, then the
postinstall step rebuilt Electron native dependencies for Windows. In my run,
`electron-builder install-app-deps` installed the prebuilt `better-sqlite3`
binary for `win32 x64`, so I did not have to install a local compiler toolchain.
That is a good first impression for a desktop app that depends on SQLite.

The production build also worked. `electron-vite build` produced the main,
preload, and renderer bundles successfully. The renderer build is not tiny, but
the output was clear and the build completed without manual changes. The only
warning I saw during the build was Tailwind reporting that `delay-[100ms]` is
ambiguous. That warning did not block the build, but it is the kind of small
polish issue I would fix because new contributors tend to treat warnings as
possible setup mistakes.

For runtime, `corepack yarn dev` opened an Electron window titled
`HarnessClaw`. The app stayed running as expected for an Electron dev process,
so I stopped it after verifying that the desktop shell launched. This is enough
to show that the basic Windows clone-install-build-launch path works locally.

## What felt good

The repository is easy to orient in. The split between `src/main`,
`src/preload`, and `src/renderer` follows the standard Electron mental model,
and the React pages are named by product areas such as `ProjectsPage`,
`SessionsPage`, `AgentsPage`, `SkillsPage`, and `SettingsPage`. That made it
quick to understand where onboarding, session management, and agent-related
features live.

I also liked that the README includes both user-facing positioning and developer
commands. The reward workflow section is practical: it explains how reward
issues, linked PRs, tags, and monthly summaries fit together. For contributors,
that reduces uncertainty about whether a merged PR is enough to trigger the
reward process.

The bundled template and runtime-path files are useful design choices. A desktop
agent manager often becomes hard to debug when it hides too much filesystem
state. Here, files such as `resources/templates/harnessclaw-engine.yaml`,
`src/main/runtime-paths.ts`, and `src/renderer/src/lib/runtimePaths.ts` make the
runtime model easier to inspect from the codebase.

## Friction points

The biggest concrete issue in my run was `corepack yarn lint`. The README and
`package.json` expose a lint script, but ESLint failed because it could not find
a configuration file. This is not a product runtime failure, but it is a
contributor onboarding problem. After a successful build, I expected lint to be
the second quick confidence check. Instead, it looks like either the config file
is missing, the script is stale, or the project has moved away from ESLint
without updating the package script.

The install step took several minutes on my machine. That is not surprising for
an Electron app with native dependencies, but it would help to set expectations
in the README. A short note such as "the first install may take a few minutes
while Electron native dependencies are prepared" would prevent users from
assuming the install is stuck.

The build warning for `delay-[100ms]` is small, but it appears every time during
the normal build path. Replacing it with the escaped form suggested by Tailwind,
or otherwise making the intent explicit, would make the build output cleaner.

## Suggestions

I would prioritize three small improvements:

1. Add or restore the ESLint configuration, or remove/update the `lint` script
   if linting is not currently maintained.
2. Add a short Windows onboarding note to the README covering Node/Yarn,
   native dependency preparation, and expected first install time.
3. Clean up the Tailwind ambiguous utility warning so a fresh build has no
   avoidable warnings.

Overall, the Windows developer path is close to solid: install completed,
native dependencies resolved without manual work, production build passed, and
the Electron shell launched. The remaining rough edges are mostly around
confidence signals for contributors rather than core functionality.
