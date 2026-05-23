# HarnessClaw onboarding/build review — jspector-fr

Context: I tested HarnessClaw from a clean Linux checkout as a developer/operator evaluating whether it can fit into an agent workflow. I focused on the first-run repository path: install dependencies, build the Electron/Vite app, and inspect the surfaces that matter for agent operations (projects, sessions, skills, settings, and runtime wiring). I did not run a full desktop GUI session in this headless environment, so the notes below are intentionally scoped to installation/build and code-level UX review.

## What I tried

- Cloned the repository from `main`.
- Checked the README onboarding path and `package.json` scripts.
- Ran `yarn install --frozen-lockfile --ignore-scripts` with Yarn 1.22.22 and Node 22.22.2.
- Ran `yarn build`, which executes `electron-vite build` for main, preload, and renderer bundles.
- Reviewed the renderer page/component structure for the main user flows: Launcher, Projects, Chat, Agents, Sessions, Skills, Team, XLab, and Settings.

## Results

The install and production build path worked on the first attempt. The full build completed in under five seconds after dependencies were installed. Main and preload bundles compiled cleanly, and the renderer generated the expected static assets. The only notable build-time warning was Tailwind reporting an ambiguous `delay-[100ms]` class; it did not block the build, but it is worth cleaning up because warnings in first-run setup make users wonder whether they did something wrong.

From the repository structure, HarnessClaw looks organized around real operator workflows rather than a single chat window. The separation between Projects, Sessions, Agents, Skills, and Settings is a good mental model for someone running multiple agent tasks. I especially like that runtime concerns have dedicated hooks and main-process modules instead of being hidden inside UI components; that should make debugging easier when an agent connection fails.

## Friction points

1. The README is clear for developers, but it does not set expectations for headless/server environments. A short note saying that `yarn build` is the right smoke test when the desktop GUI cannot be launched would help CI users and remote contributors.
2. `yarn install --ignore-scripts` worked for build validation, but normal users will run postinstall scripts for Electron native dependencies. The README could mention what to do if native dependency rebuilds fail.
3. The Tailwind `delay-[100ms]` warning should either be fixed or documented. It is harmless, but it appears during the most important trust-building moment: the first build.
4. The README feature list is concise, but screenshots or a short “first useful workflow” example would make the product easier to evaluate quickly. For example: create project → configure provider/runtime → start chat/session → inspect session history.

## Suggested quick improvements

- Add a “Headless/CI smoke test” subsection: `yarn install --frozen-lockfile` then `yarn build`.
- Add a troubleshooting bullet for Electron native dependency rebuilds.
- Silence or fix the Tailwind `delay-[100ms]` warning.
- Add one minimal end-to-end walkthrough in the README with the names of the screens the user should click.

## Overall impression

HarnessClaw’s repository gives a serious, practical impression. The first build path is fast and reproducible, and the app structure maps well to agent operations. The main thing missing for a new evaluator is not functionality but guidance: a clearer first workflow and a small troubleshooting section would reduce uncertainty and help users reach the “my agent is ready” moment faster.
