# Commit 与 Changelog 规则

本文件用于固定仓库内的提交、版本、更新日志与发布规则。后续默认按本规则执行。

## 1. Commit 规范

提交信息使用 Conventional Commits 风格：

- `feat(scope): ...` 用于新增用户可见能力
- `fix(scope): ...` 用于缺陷修复
- `refactor(scope): ...` 用于重构但不改变外部行为
- `docs(scope): ...` 用于文档变更
- `chore(scope): ...` 用于杂项维护
- `build(scope): ...` 用于构建、打包、依赖、脚本链路
- `ci(scope): ...` 用于 CI / workflow 变更
- `test(scope): ...` 用于测试相关

约束：

- 标题使用祈使句，简短明确，不加句号
- 一个 commit 只做一类主变更，不混杂多类无关修改
- 用户可见功能变更优先使用 `feat` / `fix`
- 发版准备 commit 统一使用 `chore(release): prepare x.y.z`
- - **禁止在 commit message 中添加 `Co-Authored-By` 字段（包括但不限于 AI 生成的署名）**
- 遇到密钥等安全泄露及时终止提醒用户

示例：

- `feat(skills): add repository proxy settings`
- `fix(updater): handle missing release notes`
- `docs(changelog): add 0.0.4 entries`
- `chore(release): prepare 0.0.4`

## 2. Changelog 结构

更新日志的唯一内容源为：

```text
changelog/
  releases.json
  <version>/
    en.md
    zh-CN.md
```

说明：

- `changelog/releases.json` 维护版本顺序与发布日期
- `changelog/<version>/en.md` 维护英文更新内容
- `changelog/<version>/zh-CN.md` 维护中文更新内容

以下文件为生成产物，不手工编辑：

- `CHANGELOG.md`
- `CHANGELOG_zh.md`

更新方式：

1. 在 `changelog/releases.json` 中加入新版本和日期
2. 新建 `changelog/<version>/en.md`
3. 新建 `changelog/<version>/zh-CN.md`
4. 执行 `yarn changelog:build`

## 3. 何时必须更新 Changelog

以下情况必须更新 changelog：

- 新增用户可见功能
- 修复用户可感知问题
- 改变已有交互、配置或发布行为
- 影响安装、更新、打包、升级体验

以下情况通常可以不更新 changelog：

- 纯重构且无用户行为变化
- 纯测试调整
- 纯内部脚本重排且不影响发布结果

如果不确定，默认更新。

## 4. 发布规则

发布版本时必须满足以下条件：

1. 目标版本已在 `changelog/releases.json` 中登记
2. 英文与中文版本内容都已补齐
3. 已执行 `yarn changelog:build`
4. `CHANGELOG.md` 与 `CHANGELOG_zh.md` 已同步更新
5. 发版 tag 使用 `vX.Y.Z` 格式

GitHub Release 正文来源：

- 发布 workflow 会从 changelog 内容源中提取指定版本内容
- Release body 默认使用双语内容
- `electron-updater` 读取的 `releaseNotes` 来自该 GitHub Release 正文

## 5. 推荐发布流程

1. 完成功能开发与验证
2. 更新 `changelog/releases.json`
3. 补充 `changelog/<version>/en.md`
4. 补充 `changelog/<version>/zh-CN.md`
5. 执行 `yarn changelog:build`
6. 提交：
   `git commit -m "chore(release): prepare x.y.z"`
7. 打 tag：
   `git tag vx.y.z`
8. 推送 commit 与 tag

## 6. 维护约束

- 不直接手改 `CHANGELOG.md` 或 `CHANGELOG_zh.md`
- 不发布没有 changelog 条目的版本
- 中英文内容允许措辞自然差异，但语义必须一致
- 如某语言暂未准备好，不发版；不要只更新单语内容
