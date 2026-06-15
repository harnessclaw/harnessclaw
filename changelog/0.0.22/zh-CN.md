### 新增

- Models 设置页拆分为「对话 / 图片 / 视频」三个分段，默认内置 OpenAI、火山引擎 两个图片提供方与火山引擎 视频提供方，并预填 Ark 默认参数。
- Agent 现在支持独立的 `image_generation` / `video_generation` 端点绑定，下拉列表会列出 ImageGen / VideoGen 配置中的可选端点。
- 首页案例数据抽离到 `data/homeCases`，秘书插画改用 SVG，并新增会话侧边面板与配套侧边栏图标（more / recent-arrow / settings / sidebar-collapse / sidebar-open / secretary-corner）。
- 新增 `imagegen`、`videogen` IPC 桥，向渲染进程暴露 `listImageProviders` / `patchImageConfig`（以及视频侧的等价接口）。

### 变更

- 图片提供方配置将 API 地址与路径合并为单一完整 URL 字段，品牌图标统一为 28px 无背景容器样式（新增火山引擎 SVG，DeepSeek 由 PNG 切换为 SVG）。
- 流式呼吸闪烁小点现在与「鎏金」shimmer 状态文案同行渲染，替代原先停留在助手消息右下角的位置。
- 侧边栏：收起态的收起/展开按钮移至「设置」正上方（6px 间距）且图标颜色与其对齐；最近会话的"更多"按钮默认隐藏，仅在 hover、键盘聚焦或其菜单展开时出现；macOS 红绿灯按钮在 78px 收起边栏内居中对齐。
- 首页细节：「24h Online」徽标改用成功色 `#02B578`，输入框占位符由 22px 放大至 26px，textarea 高度随内容自适应，案例分类标签样式同步调整。
- 移除发送前的图片视觉门控，图片现在直接传递给引擎，配合升级后的多模态链路。

### 修复

- 未完成的导航项（Scheduler / Projects / Team / x-Lab）从侧边栏暂时隐藏，避免误入尚未接通的页面。
