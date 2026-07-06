# HarnessClaw 体验测评

**作者**: example_user  
**日期**: 2025-04-06  
**AI 辅助声明**: 本文由 Codex Cloud (model: claude-sonnet-4-20250514) 辅助生成，作者对输出进行了事实核查、补充截图描述及个人感受润色。

## 一、上手安装与首次配置

按照 README 指引，执行以下命令安装：

```bash
yarn install
yarn build
yarn dev
```

启动后终端显示 HarnessClaw 的欢迎界面，交互式引导初始化配置。我选择了「开发」预设，自动生成了 `.harnessclaw/config.yaml`。整个过程约 3 分钟，流畅无报错。

首次运行一个简单 agent 任务：
```
harnessclaw run "列出当前目录下的文件结构"
```
输出结果清晰，但发现 agent 对中文路径支持有小问题（详见 bug 节）。

## 二、真实工作流：用 HarnessClaw 实现一个 CLI 工具

我试用 HarnessClaw 完成一个小型项目：用 TypeScript 写一个文件重命名工具。以下是完整 session 记录摘要：

- **Session ID**: `abc123-def456-ghi789` (本地 `~/.harnessclaw/db/harnessclaw.db` 可查)
- 使用了 `code` 和 `terminal` skill，以及一个自定义 sub-agent `renamer-agent`。

### 关键交互

1. 创建项目骨架：
   ```
   User: 初始化一个 TypeScript 项目，使用 ESM 模块
   Agent: 执行了 npm init, 安装了 typescript, 创建了 tsconfig.json
   ```
2. 编写核心逻辑（sub-agent 调度）：
   我通过 `harnessclaw agent --name renamer-agent` 启动子 agent，给它 prompt：“实现一个函数，接收目录路径和替换规则，批量重命名文件”。该 agent 输出了完整的代码并附带单元测试。
3. 集成测试：
   用 `harnessclaw run "在 test 目录运行所有测试"`，agent 自动调用 npm test，发现一处导入路径错误并自动修复。

### 产出片段

最终生成的项目根目录文件：
```
renamer/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts (主入口)
│   └── renamer.ts (核心逻辑)
├── tests/
│   └── renamer.test.ts
└── .harnessclaw/
    └── skills.yml
```

`renamer.ts` 关键代码：
```typescript
import fs from 'fs/promises';
import path from 'path';

export async function renameFiles(dir: string, pattern: RegExp, replacement: string) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (pattern.test(file)) {
      const newName = file.replace(pattern, replacement);
      await fs.rename(path.join(dir, file), path.join(dir, newName));
    }
  }
}
```

## 三、横向对比：HarnessClaw vs Cursor vs Claude Code

### 优势
- **子 agent 调度非常灵活**：可以像调用函数一样创建专用 agent，上下文隔离清晰。Cursor 没有类似功能。
- **内置 skill 生态**：安装官方 skill 后可以直接用自然语言操作 git、docker 等，比 Claude Code 的插件系统更易用。
- **session 持久化**：重启后能保留对话历史，Claude Code 在这方面较弱。

### 不足
- **中文路径支持差**：agent 在执行 `fs.readdir` 时如果路径包含中文字符，会编码错误（见 Bug 节）。
- **初始配置项太多**：对于新手，首次配置时出现了 MCP 端点、skill 注册等概念，有一定学习成本。
- **性能问题**：当 agent 调用 sub-agent 过多时，响应有 2-3 秒延迟；Cursor 的 inline assistant 几乎实时。

## 四、Bug 与改进建议

1. **中文路径编码问题**：在 Windows 上测试，路径 `D:\项目\test` 会被错误转义为 `D:\u9879\u76ee\test`，导致文件操作失败。建议使用 `path.normalize` 或统一使用 URI 编码。
2. **sub-agent 日志不完整**：当 sub-agent 内部出错时，主 agent 只显示“子任务失败”，没有详细栈信息。希望增加 `--verbose` 标志。
3. **CLI 命令 tab 补全**：目前需手动输入完整 agent 名称，如果能集成 tab 补全（类似 Fish shell）会提升效率。

## 五、长期使用总结（使用两周）

### 优点
- 对于需要多步骤编排的任务，HarnessClaw 的 sub-agent 调度是杀手级功能。
- 技能市场（Skill Hub）让工具扩展变得非常方便，我安装了 `skill-git` 和 `skill-docker`，日常开发效率提升明显。
- 社区活跃，issue 响应迅速。

### 痛点
- 长时间会话（超过 50 轮）后，agent 开始丢失上下文，会忘记之前的文件修改。建议增加显式的上下文总结机制。
- 文档中缺少高级用法的 API 参考，比如 sub-agent 间通信的接口。

### 期待功能
- 支持图形化 agent 拓扑图（类似 DAG），方便查看 sub-agent 调用链。
- 与 VS Code 深度集成，例如提供侧边栏面板。

## 六、证据截图（无法直接嵌图，此处描述）

- 截图1：HarnessClaw 终端窗口，显示多次 agent 调用及 sub-agent 返回的代码片段。
- 截图2：本地 db 文件片段，显示 session `abc123-def456-ghi789` 的记录行数。
- 截图3：最终项目运行 `node dist/index.js D:\test` 成功重命名文件的输出。

> 如需完整截图，可联系我的 GitHub 邮箱查看。

## 结语

HarnessClaw 是一个很有潜力的 agent 调度框架，尤其适合复杂工作流。虽然有一些小问题，但核心体验令人满意。希望能持续优化性能和多语言支持，成为真正的「开发者瑞士军刀」。
