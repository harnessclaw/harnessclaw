# HarnessClaw review — dependency install and production build flow

This review is based on a source checkout of `harnessclaw/harnessclaw` at commit `1f1c7e8` on 2026-05-22, using a Linux container with Node.js `v22.22.2` and Corepack Yarn `1.22.22`. I focused on the first contributor/operator path: clone the project, install dependencies, and produce a production build before trying any deeper agent workflow.

## Scenario tested

Commands run:

```bash
git clone https://github.com/harnessclaw/harnessclaw.git
cd harnessclaw
corepack yarn install --frozen-lockfile
corepack yarn build
```

I did not run the Electron desktop window because the test environment has no graphical display, so the notes below are specifically about the repository onboarding/build experience and what is visible from the source tree.

## What worked well

- The repository layout is easy to understand: Electron main/preload code is separated from the React renderer, and `resources/templates/harnessclaw-engine.yaml` makes the bundled engine idea discoverable.
- `yarn install --frozen-lockfile` completed successfully. The native `better-sqlite3` dependency installed through Electron Builder without requiring manual system-package debugging.
- `yarn build` completed quickly and generated `out/main`, `out/preload`, and `out/renderer` artifacts. That is a good baseline for contributors because they can verify a change without packaging a full desktop app.
- The README gives the minimum happy path and the reward workflow section is unusually clear: linked PR closes issue, workflow tags reward, monthly aggregation publishes statistics.

## Friction points

- The README says to use `yarn`, but a fresh Node environment may not have the `yarn` binary installed. `corepack yarn install` worked immediately for me, so adding Corepack as an alternative would reduce first-run friction.
- The production build emitted a Tailwind warning for `delay-[100ms]` being ambiguous. The build still succeeded, but the warning can hide more important build output over time.
- For headless/server users, there is no short note explaining which flows can be validated without launching Electron. A small “headless verification” section with `yarn install --frozen-lockfile` and `yarn build` would help CI-oriented contributors.
- The first-run app/agent configuration path is not obvious from the README alone. Screenshots or a short sequence like “create/select agent → configure engine → open session → use skills” would make the value proposition easier to evaluate before installing the desktop app.

## Suggested improvements

1. Update the install block to mention Corepack:

```bash
corepack enable
corepack yarn install --frozen-lockfile
```

2. Add a contributor verification command:

```bash
corepack yarn build
```

3. Add one paragraph describing how HarnessClaw stores local sessions/configuration and how ClawHub skills connect to an agent. The feature list names these concepts, but a concrete first workflow would help new users understand what to try first.

## Overall impression

The build path is solid and fast, which is a strong sign for a young Electron agent-management project. The main opportunity is not architecture but onboarding copy: clarify Corepack/Yarn setup, document a headless build check, and show one concrete first agent workflow. Those changes would make HarnessClaw easier for contributors and evaluators to trust before they run the desktop UI.
