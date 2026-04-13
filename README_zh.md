# Harnessclaw

[English](./README.md) | [简体中文](./README_zh.md)

**Harnessclaw, your agent is ready. (你的专属智能体已就绪)**

Harnessclaw 是一款基于 Electron 构建的强大桌面应用程序，旨在帮助用户无缝地管理、对话以及操作 AI 智能体（Agents）和技能（Skills）。

## 主要功能

- 🤖 **智能体管理**：轻松管理和配置你的 AI 智能体。
- 💬 **交互式对话**：提供丰富的聊天界面，与你的智能体进行深度交互。
- 🛠️ **技能集成**：通过 ClawHub 发现和管理各种实用技能。
- 📊 **会话追踪**：记录并管理你的智能体会话及历史记录。
- ⚙️ **高度可定制**：全面的设置页面，打造属于你的个性化体验。

## 技术栈

- **框架**: [Electron](https://electronjs.org/) + [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- **UI 与样式**: [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)
- **状态管理**: [Zustand](https://github.com/pmndrs/zustand)
- **数据库**: [Better SQLite3](https://github.com/JoshuaWise/better-sqlite3)

## 快速开始

### 环境要求

- Node.js (推荐 v18 或更高版本)
- Yarn 包管理器

### 安装

克隆仓库并安装依赖：

```bash
git clone https://github.com/harnessclaw/harnessclaw.git
cd harnessclaw
yarn install
```

### 开发

在开发模式下启动应用程序：

```bash
yarn dev
```

### 构建与发布

构建适用于本地平台的应用程序：

```bash
yarn build
yarn dist
```

构建特定平台的应用程序：
- Mac: `yarn dist:mac`
- Windows: `yarn dist:win`

## 📞 Support

- 💬 Community Discussion: [GitHub Discussions](https://github.com/harnessclaw/harnessclaw/discussions)
- 🐛 Bug Reports: [Issues](https://github.com/harnessclaw/harnessclaw/issues)
- 👥 WeChat Work Group: [WeCom Group](https://github.com/iflytek/astron-agent/blob/main/docs/imgs/WeCom_Group.png)

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 许可证开源。
