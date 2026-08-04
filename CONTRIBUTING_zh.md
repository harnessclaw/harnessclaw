# 为 Harnessclaw 贡献

[English](./CONTRIBUTING.md) | [简体中文](./CONTRIBUTING_zh.md)

感谢你抽出时间参与贡献！无论你是通过文档、YouTube 视频还是社区群了解到我们，这份指南都会帮你用最快的速度，从「刚 clone 下来」走到「PR 被合并」。

如果 Harnessclaw 对你有帮助，最能支持我们的一件小事就是 **⭐ 给仓库点个 Star** —— 这是新用户发现这个项目的主要途径。

## 贡献方式

不写代码也能帮上忙：

- 🐛 **报告 Bug** —— 提一个 [Issue](https://github.com/harnessclaw/harnessclaw/issues)，附上复现步骤、操作系统和应用版本。
- 💡 **提出想法** —— 在 [Discussions](https://github.com/harnessclaw/harnessclaw/discussions) 里发起讨论，我们一起把它打磨清楚。
- 📖 **完善文档** —— 修一个错别字、讲清一个步骤、翻译一个页面。纯文档 PR 非常受欢迎，也是最容易上手的第一次贡献。
- 🛠️ **修复 Issue** —— 认领带有 [`good first issue`](https://github.com/harnessclaw/harnessclaw/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 或 [`help wanted`](https://github.com/harnessclaw/harnessclaw/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) 标签的任务。
- 💰 **领取赏金** —— 部分 Issue 带有赏金（见下方 [Reward 流程](#reward-流程)）。

## 你的第一个 Pull Request

### 1. 准备项目

```bash
# 先在 GitHub 上 Fork 本仓库，再 clone 你的 Fork
git clone https://github.com/<你的用户名>/harnessclaw.git
cd harnessclaw
yarn install
yarn dev          # 以开发模式启动应用
```

环境要求：Node.js v18+ 和 Yarn。只要 `yarn dev` 能启动并弹出窗口，你就准备好了。

### 2. 新建分支

```bash
git checkout -b fix/short-description
```

### 3. 修改代码

- 保持改动聚焦 —— 一个 PR 只做一件事。
- 与周围代码风格保持一致，提交前先跑 `yarn lint`。
- 如果改动对用户可见，记得更新 changelog（见 [docs/release-rules.md](./docs/release-rules.md)）。

### 4. 提交

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范，并要求每个 commit 都带 **DCO 签名**：

```bash
git commit -s -m "fix(chat): keep scroll position when a new message arrives"
```

`-s` 会加上 CI 检查所要求的 `Signed-off-by` 行。提交类型与 scope 详见 [docs/release-rules.md](./docs/release-rules.md)。

### 5. 推送并发起 PR

```bash
git push origin fix/short-description
```

向 `main` 分支发起 PR，按模板填写（改动摘要、检查项、关联 Issue），维护者会进行 Review。如果想尽早获得反馈，也可以先发 Draft PR。

## 提交与 Changelog 规则

完整的提交规范、changelog 结构和发布流程都在 **[docs/release-rules.md](./docs/release-rules.md)**。核心要点：

- 提交信息遵循 `type(scope): summary`（`feat`、`fix`、`docs`、`refactor`、`chore`、`build`、`ci`、`test`）。
- 每个 commit 都用 `git commit -s` 签名。
- **不要**手改 `CHANGELOG.md` / `CHANGELOG_zh.md`；请编辑 `changelog/` 下的源文件再执行 `yarn changelog:build`。

## Reward 流程

部分 Issue 带有赏金，让贡献者的付出得到回报：

- 维护者用 `Reward Task` 模板新建 Issue，并填写金额与币种。
- 当你的 PR 合并并关闭该 Issue 后，GitHub Action 会创建 `reward-<issue-number>` 标签，并把奖励拆分结果评论回 Issue。
- 每个月第一天，上个月的 reward 标签会被汇总为一条 `statistic-YYYY-MM` 的统计 release。

想找付费任务，可以关注带 `reward` 标签的开放 Issue。

## 行为准则

请保持尊重与建设性。我们希望 Harnessclaw 对新手和资深贡献者都是一个友好的地方，不容忍任何骚扰或轻视他人的行为。

## 有问题？

- 💬 [GitHub Discussions](https://github.com/harnessclaw/harnessclaw/discussions)：想法与提问
- 🐛 [Issues](https://github.com/harnessclaw/harnessclaw/issues)：Bug 与任务

欢迎加入 —— 很高兴有你在。🎉
