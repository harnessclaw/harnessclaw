# HarnessClaw Experience Review — Initial Setup & Architecture Exploration

**Author:** aglichandrap  
**Date:** 2026-05-24  
**Version reviewed:** 0.0.16  
**Platform:** macOS (primary), code inspection on Linux  

## Context

I discovered HarnessClaw while evaluating desktop AI agent tools for a personal workflow
automation project. My use case involves managing multiple LLM-backed agents that can
interact with local files, run shell commands, and coordinate across tasks. I was
comparing HarnessClaw against Claude Code (CLI), Cursor, and VS Code Copilot.

## First Impressions & Installation

The installation process is straightforward for anyone familiar with Electron-based apps.
`yarn install` followed by `yarn dev` gets you a working development build. The project
targets Node.js v18+ with Yarn as the package manager. The `electron-builder`
configuration supports macOS, Windows, and Linux distribution, though I primarily tested
the dev build.

One friction point: the `postinstall` script runs `electron-builder install-app-deps`,
which can be slow on first install and occasionally fails if native dependencies (like
`better-sqlite3`) don't match the Electron version. This is a known Electron ecosystem
issue, not specific to HarnessClaw, but it's worth documenting for new contributors.

## Architecture Deep-Dive

The codebase follows a clean Electron three-process architecture:

**Main Process (`src/main/`):** Handles IPC, SQLite persistence via `better-sqlite3`,
and WebSocket communication with the `harnessclaw-engine` subprocess. The engine is
spawned as a local child process and communicates via WebSocket, which is a solid
design choice — it keeps the agent runtime isolated from the Electron shell.

**Renderer Process (`src/renderer/`):** A React + TypeScript SPA using Vite, Tailwind
CSS, and Radix UI components. State management via Zustand stores (`agentStore`,
`sessionStore`, `uiStore`, `connectionStore`) is clean and follows a unidirectional
data flow pattern. The store separation is logical — sessions, agents, UI state, and
connection status each have their own store.

**Preload (`src/preload/`):** Uses `contextBridge` to expose a safe API surface to the
renderer. The IPC boundary is well-defined with specific channel names like
`harnessclaw:send`, `harnessclaw:respondPermission`, etc.

The message flow architecture is well-documented in `docs/architecture/`. When a user
sends a message, it flows through: ChatPage → sessionStore → PreloadBridge → IPC Main →
SQLite (persistence) → HarnessclawClient (WebSocket) → harnessclaw-engine → upstream
Claude/tools. Events stream back through the same chain in reverse. This is a textbook
implementation of the Electron IPC pattern with proper streaming support.

## Strengths

1. **Skill Integration via ClawHub:** The skill discovery and management system is
   well-designed. The `SkillComposerInput` component and the skills page suggest a
   marketplace-like experience for extending agent capabilities.

2. **Session Management:** The SQLite-backed session tracking with message persistence
   is robust. The `sessionStore` handles complex state like streaming segments, tool
   activity logs, and permission requests.

3. **Permission System:** The tool permission dialog flow is properly implemented — when
   the engine requests permission for a tool call, the UI presents a confirmation dialog,
   and the response flows back through IPC. This is critical for security in an agent
   tool that can execute shell commands.

4. **Internationalization:** The `locales/` directory and i18n setup show consideration
   for a global user base. Both English and Chinese documentation are provided.

5. **Component Architecture:** The component tree is well-organized with clear separation
   between layout components (`Sidebar`, `TopBar`, `AppLayout`), page components
   (`ChatPage`, `SettingsPage`, etc.), and common components. The `ChatPage` is
   substantial (~3400+ lines based on the architecture doc references), which is both a
   strength (feature-rich) and a concern (could benefit from further decomposition).

## Areas for Improvement

1. **ChatPage Complexity:** The ChatPage component appears to handle a lot — message
   rendering, input handling, streaming, tool activity display, permission dialogs, and
   more. Breaking it into smaller sub-components with focused responsibilities would
   improve maintainability.

2. **Error Handling:** While the architecture is solid, I'd like to see more explicit
   error boundaries and retry logic, especially for the WebSocket connection to the
   engine subprocess. Connection drops during long-running agent tasks could be
   frustrating.

3. **Documentation for Contributors:** The architecture docs are excellent for
   understanding the system, but there's limited guidance for new contributors on how
   to add features, run tests, or debug common issues.

4. **Testing:** I didn't find a test suite in the repository. For a tool that manages
   AI agent interactions and has permission to execute local commands, comprehensive
   testing is essential.

## Comparison with Alternatives

| Aspect | HarnessClaw | Claude Code | Cursor |
|--------|------------|-------------|--------|
| Interface | Desktop GUI (Electron) | CLI | Desktop GUI (VS Code fork) |
| Agent management | Multi-agent | Single session | Single agent |
| Skill system | ClawHub marketplace | Built-in tools | Extensions |
| Session persistence | SQLite | File-based | Built-in |
| Customization | High (settings page) | Limited | Moderate |

HarnessClaw's multi-agent management and skill marketplace differentiate it from
single-agent tools like Claude Code. The desktop GUI provides a more accessible
experience than CLI tools, while the Electron architecture enables cross-platform
support.

## Summary

HarnessClaw is a well-architected desktop AI agent management tool with a clean codebase
and thoughtful design decisions. The Electron + React + Zustand stack is modern and
maintainable. The WebSocket-based engine communication provides good isolation between
the UI and the agent runtime. The main areas for improvement are component decomposition
(especially ChatPage), test coverage, and contributor documentation. For anyone looking
for a desktop GUI to manage multiple AI agents with skill extensibility, HarnessClaw is
worth serious consideration.
