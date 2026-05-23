# HarnessClaw review: first setup and developer build from a clean Linux workspace

I evaluated HarnessClaw from the perspective of someone who wants to quickly inspect the project, build it, and decide whether it is ready to use as an agent desktop/workbench. My test environment was a clean Linux workspace with Node.js `v22.22.2` and Yarn `1.22.22`. I focused on the repository onboarding path rather than a packaged desktop release: clone the repo, install dependencies, inspect the documented entry points, and run a production build.

## What worked well

The short README is enough to identify the stack and the intended workflow. The app structure is also easy to navigate: Electron main/preload code lives under `src/main` and `src/preload`, while the React UI is under `src/renderer/src`. The page/component split (`AgentsPage`, `SkillsPage`, `SessionsPage`, `ProjectsPage`, `ChatPage`, etc.) made it clear where the main product surfaces are implemented. For a developer or reviewer, this is useful because the product concepts in the README map directly to source files.

Dependency installation was uneventful in my environment using:

```bash
yarn install --frozen-lockfile --ignore-scripts
```

The production build also completed successfully:

```bash
yarn build
```

The build produced the Electron main bundle, preload bundle, and renderer assets in roughly five seconds in my container. The only visible warning was Tailwind's ambiguous `delay-[100ms]` class warning; it did not block the build. This is a good first impression: even before launching the desktop GUI, the project can be checked quickly by a contributor.

I also appreciated that the README documents the reward workflow and the release rules link. That makes contributor expectations more explicit than in many small Electron projects.

## Friction points

The main gap is onboarding depth. The README says to run `yarn dev`, but it does not explain what should appear on first launch, which local services/config files are expected, or what a healthy HarnessClaw runtime status looks like. Because the application manages agents, skills, sessions, projects, and gateway/runtime state, a first-time user would benefit from a short “first successful run” checklist.

A second small issue is that headless or CI-style validation is not documented. `yarn build` works well as a quick smoke test, so it would be useful to explicitly mention it as the fastest non-GUI verification step. The Tailwind warning about `delay-[100ms]` is harmless, but cleaning it up would make first-build output feel more polished.

## Suggestions

1. Add a short “First launch checklist” with expected screens and where runtime/config data is stored.
2. Document `yarn build` as a quick smoke test for contributors who cannot launch Electron immediately.
3. Consider adding screenshots or a very small walkthrough for creating or connecting the first agent.
4. Fix or silence the Tailwind ambiguous class warning to keep build output clean.

Overall, HarnessClaw feels buildable and approachable from the source tree. The strongest part of my first experience was that the project compiled cleanly and the feature areas were easy to discover in code. The next improvement should be reducing uncertainty after `yarn dev`: what a new user should configure first, what “ready” looks like, and how to verify that the runtime bridge is healthy.
