# HarnessClaw Windows setup and agent-workflow review

This review is based on a fresh Windows checkout of `harnessclaw/harnessclaw` on May 22, 2026. I focused on the contributor/onboarding path and the shape of the app for an agent-heavy coding workflow, because that is the path I would use before trusting a local desktop agent console for real work.

## Test Context

- OS: Windows, PowerShell
- Node: modern Corepack-enabled Node environment
- Repository state: fresh clone of the public `main` branch
- Commands run:
  - `corepack yarn install --frozen-lockfile`
  - `corepack yarn build`

The install completed successfully. Native dependency setup rebuilt `better-sqlite3` for Windows through `electron-builder install-app-deps` and used the prebuilt binary path, so there was no manual Visual Studio toolchain work in this environment. The full install took about 148 seconds.

The production build also completed successfully. `electron-vite build` produced main, preload, and renderer bundles. The renderer build transformed 1866 modules and completed in about 39 seconds. The only notable build-time warning was Tailwind reporting that `delay-[100ms]` is ambiguous and suggesting `delay-&lsqb;100ms&rsqb;` if that token is content rather than a utility class.

## What Felt Strong

The project structure is easy to understand for a desktop agent console. The split between `main`, `preload`, and `renderer` is clear, and the exposed preload APIs make the boundary between UI and local engine operations explicit. That is important for an app that needs to manage sessions, local files, permissions, model/provider configuration, and agent events without turning the renderer into an unbounded privileged surface.

The app also appears to be treating agent execution as a first-class workflow rather than only a chat box. The code and docs show dedicated surfaces for sessions, projects, skills, teams, agent settings, permission responses, usage metrics, and local database state. For my use case, the most compelling design direction is this combination:

- a persistent session list,
- a local SQLite-backed history model,
- explicit permission handling,
- skill discovery and installation,
- team/sub-agent configuration,
- and engine communication isolated behind the Electron main process.

That makes HarnessClaw feel closer to an operator console for agent work than a wrapper around a single prompt input.

## Onboarding Notes

The README is short and works for someone already comfortable with Node/Electron projects, but the Windows path could be more explicit. On a clean Windows shell, `yarn` was not available directly, while `corepack yarn install --frozen-lockfile` worked. I would suggest changing the setup section to mention Corepack:

```bash
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn dev
```

That small change would reduce friction for new Windows users who have Node installed but do not have a global Yarn binary.

It would also help to document expected install/build times and native dependency behavior. Seeing `better-sqlite3` rebuild during install is normal for this app, but a first-time contributor may misread that as a problem. A short note like "Windows install may spend a minute rebuilding Electron native dependencies" would make the process feel more predictable.

## Product Feedback

The architecture document `docs/architecture/user-question-sequence.md` is valuable because it explains the path from renderer input through preload, IPC, the main process, the WebSocket client, and the local `harnessclaw-engine` process. That is exactly the kind of document I want when deciding whether I can debug agent execution failures. I would make it easier to find from the README, especially for contributors who are evaluating the project before running the full desktop app.

The local database documentation is also useful. The session, message, usage, project, and installed-skill tables make the persistence model concrete. For a long-running agent console, this matters because users need to know whether state is ephemeral, file-backed, or portable. A future improvement could be a "data location and backup" section in the user-facing docs that points to `~/.harnessclaw/db/harnessclaw.db` and the engine config file.

The skill market and skill composer direction looks especially useful. For agent workflows, the difference between "tell the agent what to do" and "attach a known capability with repeatable behavior" is significant. The current shape of `SkillsPage` and `SkillComposerInput` suggests the app is moving toward composable, visible capabilities rather than hidden prompt tricks. That is a strong product bet.

## Improvement Suggestions

1. Add a Windows/Corepack setup path to the README.
2. Link the architecture and database docs from the README.
3. Add a short troubleshooting section for native dependency rebuilds, missing Yarn, and the local engine binary.
4. Consider documenting the permission model from the user's perspective: what kinds of actions trigger confirmation, where the response flows, and how a denied permission is represented in the session.
5. Consider adding a contributor smoke-test command that verifies the minimum expected local state after install/build without requiring a full desktop manual test.

## Overall Impression

HarnessClaw already has the bones of a practical local agent control surface: persistent sessions, explicit IPC boundaries, a local engine bridge, skill management, and team/sub-agent concepts. The main thing I would improve is first-run confidence. The app is technically buildable on Windows, but the README currently hides a few pieces of knowledge that contributors will need: Corepack/Yarn, native dependency rebuild expectations, and where to look when the local engine or database layer is involved.

For agent operators, the strongest part of the project is that it does not look like a toy chat UI. It is organizing the operational surfaces that matter once an agent is doing real work over time.
