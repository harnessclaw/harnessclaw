![Logo](./logo.png)

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

提交、版本与更新日志规则请见 [docs/release-rules.md](./docs/release-rules.md)。

## Reward 流程

- 新建 issue 时可直接使用 `Reward Task` 模板，填写奖励金额与币种。
- 当关联 PR 合并并关闭该 issue 后，GitHub Actions 会创建 `reward-<issue-number>` 标签，并把奖励拆分结果评论回 issue。
- 每个月第一天，GitHub Actions 会汇总上个月的 reward 标签，并发布一条 `statistic-YYYY-MM` 的统计 release。
- 当前这两条 workflow 直接使用仓库默认的 `GITHUB_TOKEN`，不需要额外配置个人 access token。

## 📞 Support

- 💬 Community Discussion: [GitHub Discussions](https://github.com/harnessclaw/harnessclaw/discussions)
- 🐛 Bug Reports: [Issues](https://github.com/harnessclaw/harnessclaw/issues)
- 👥 WeChat Work Group: ![WeCom Group](https://raw.githubusercontent.com/iflytek/astron-agent/main/docs/imgs/WeCom_Group.png)

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 许可证开源。
