# HarnessClaw 首次上手实测：安装、模型配置与开源项目出海分析实践

> 近期参加某黑客松与 ChatGPT 碰撞出一个小的想法：面向开源项目、开发者工具和独立产品的 AI DevRel / 出海增长 Agent。初版实践见：[GlobalDev Agent](https://github.com/hu-qi/globaldev-agent),看到 HarnessClaw 这个产品，于是想试试看能不能用它实现类似的功能。

## 0. 测试环境

| 项目 | 内容 |
| --- | --- |
| 操作系统 |  macOS 26.5 (25F71) |
| HarnessClaw 版本 | 0.0.17 |
| 安装方式 | Release 安装包 |
| 模型服务商 | 华为云 MaaS  |
| 模型名称 | GLM-5.1 |
| 测试时间 | 2026-05-27 |

---

## 1. 安装和启动

我的安装方式：

```text
从 GitHub Release 下载 `HarnessClaw-0.0.17-mac-arm64.dmg` 安装包并安装。
```


首次启动结果：

```text
应用成功启动，进入欢迎页。
```

![首次启动](./imgs/hu-qi/01-starter.png)


接着配置模型，这里我配置的是华为云 MaaS 的 glm-5

![模型配置](./imgs/hu-qi/02-setModel.png)


不知为何要强制选择身份卡：
![选择身份](./imgs/hu-qi/03-selectProfile.png)


我的感受：

**比较难受！！！**

有几个槽点吧：
1. 引导页设置的自定义模型不见了[#53]
2. 引导页最后一步一定要选一个身份，但是选的这个信息后续也没看到在哪些修改。
3. 热键被占用[#54],好在还有关闭的地方，差点就卸载了😂 ，此外发现设置的语言为中文没有生效。


---

## 2. 模型配置

可能正儿八经还是需要重新配置一下模型，这回没得自定义了，那就用 OpenAI 了（实际上还是用的华为云 MaaS）

![模型配置](./imgs/hu-qi/04-setModelAgain.png)


配置过程中的卡点：
主要是我没主要点击 Models 下模型开启时需要先开启供应商，不然会报**莫名其妙的 API Key is Require**（我确定 Key 都已经 test 通过成可用状态了）。


所以我必须得再确认一下模型可用：
![验证模型](./imgs/hu-qi/05-confirmModel.png)


---

## 3. 搭建 GlobalDev Agent Team

这里我不 care 啥 X-Lab 、啥 Skill（后续可以补充方便 Agent 调用），咱直奔 Team tab，准备创建我们的出海增长 Agent 军团：用户输入一个 GitHub 仓库地址，GlobalDev Agent Team 自动读取 README、仓库元数据和近期 Issues，并生成一份完整的 Global Launch Kit 出海增长包，包括产品定位、海外开发者用户画像、Product Hunt / Hacker News / Reddit / X / LinkedIn 发布文案、Issue 反馈洞察和增长任务看板。

大概的工作流如图：

![核心工作流](./imgs/hu-qi/07-workflow.png)

覆盖的场景：

| 场景 | Agent 节点 | 输入 | 输出 |
|---|---|---|---|
| 产品分析 | Product Analyst Agent | GitHub README、repo metadata、topics、language、stars | 产品类型、核心价值、目标用户、差异化 |
| 海外定位 | Market Positioning Agent | 产品分析结果 | 英文 one-liner、定位叙事、海外用户画像 |
| 发布内容生成 | Content Agent | 产品定位和仓库上下文 | Product Hunt、Hacker News、Reddit、X、LinkedIn 文案 |
| 反馈洞察 | Feedback Agent | 近期 GitHub Issues | 反馈主题、用户顾虑、采用阻力 |
| 增长执行 | Growth PM Agent | 上述所有输出 | 优先级增长任务看板 |


要创建团队，先得有人，那要创建 Agent Team，那先得有 Agent。我们依次创建上述 Agent：


![准备创建 Agent](./imgs/hu-qi/09-newAgent.png)

### 定义 Agent

先来第一个 Agent，这是第一个真正干活的 Agent。它的职责是读取仓库基础信息，形成后续 Agent 都能复用的 repo_snapshot。
然后继续第二个、第三个……


![Agents](./imgs/hu-qi/15-agents.png)


### 定义 Agent Team

> 做到这才发现暂时还不支持

![新建 AgentTeam](./imgs/hu-qi/06-newAgentTeam.png)

```
Team Name: GlobalDev Agent Team
Team Goal: GlobalDev Agent is an AI DevRel and growth agent for open-source projects, developer tools, and indie products going global. Paste a GitHub repository URL, and it generates a complete Global Launch Kit: product positioning, overseas developer personas, Product Hunt/Hacker News/Reddit/X launch content, issue insights, and prioritized growth tasks.
Application Scenario: AI DevRel
```

![](./imgs/hu-qi/08-defineGoal.png)
![](./imgs/hu-qi/10-designWorkflow.png)
![](./imgs/hu-qi/11-selectMembers.png)
![](./imgs/hu-qi/12-configureCollaboration.png)
![](./imgs/hu-qi/13-publish.png)


当我哐哐哐一段操作猛如虎，结果发现大部分功能还在 commingsoon 。
Agent 添加完了也没法找到：
![](./imgs/hu-qi/14-agentNotfound.png)

怎么办？
那就继续尝试 SKill

### 回滚到 Skill 方案

我使用终端将 [globaldev-agent-skill](https://atomgit.com/huqi/globaldev-agent)克隆到了`~/.harnessclaw/workspace/skills`,
这样我就安装好了这个 skill：
![](./imgs/hu-qi/16-addSkill.png)


结果还是不行，那就只能等更新了

![](./imgs/hu-qi/17-skillFail.png)

![](./imgs/hu-qi/18-gameover.png)


## 总结

这是一次失败的体验，没能正常使用 Agent、Agent Team 以及 Skill ，暂时无法完成预期的任务。