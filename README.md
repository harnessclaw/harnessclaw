# Harnessclaw

[English](./README.md) | [简体中文](./README_zh.md)

**Harnessclaw, your agent is ready.**

Harnessclaw is a powerful, Electron-based desktop application designed to manage, chat with, and operate AI agents and skills seamlessly.

## Features

- 🤖 **Agent Management**: Easily manage and configure your AI agents.
- 💬 **Interactive Chat**: A rich chat interface for interacting with your agents.
- 🛠️ **Skill Integration**: Discover and manage skills via ClawHub.
- 📊 **Session Tracking**: Keep track of your agent sessions and history.
- ⚙️ **Highly Customizable**: Comprehensive settings page to tweak your experience.

## Tech Stack

- **Framework**: [Electron](https://electronjs.org/) + [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- **UI & Styling**: [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Database**: [Better SQLite3](https://github.com/JoshuaWise/better-sqlite3)

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- Yarn package manager

### Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/harnessclaw/harnessclaw.git
cd harnessclaw
yarn install
```

### Development

Start the application in development mode:

```bash
yarn dev
```

### Build & Release

To build the application for your local platform:

```bash
yarn build
yarn dist
```

To build for specific platforms:
- Mac: `yarn dist:mac`
- Windows: `yarn dist:win`

Commit, release, and changelog rules are documented in [docs/release-rules.md](./docs/release-rules.md).

## 📞 Support

- 💬 Community Discussion: [GitHub Discussions](https://github.com/harnessclaw/harnessclaw/discussions)
- 🐛 Bug Reports: [Issues](https://github.com/harnessclaw/harnessclaw/issues)
- 👥 WeChat Work Group: ![WeCom Group](https://github.com/iflytek/astron-agent/raw/main/docs/imgs/WeCom_Group.png)

## License

This project is licensed under the [Apache License 2.0](LICENSE).
