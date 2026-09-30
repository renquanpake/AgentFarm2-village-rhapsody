# 需求文档：旗舰版视觉美化（flagship-visual-polish）

Updated: 2026-09-29
状态：需求已由用户拍板（像素风精修 / 音频进本期 / 无深色模式 / M4 实机验收待用户）

## Introduction

对 AgentFarm2 客户端做旗舰级视觉与体验升级，对标一线像素经营游戏（星露谷 UI 质感 + 一线主机厂交互反馈手感）。玩法旗舰升级已完成，本特性覆盖 UI、动效、场景氛围、音频四个维度。全部改动落地于 mod 注入层（`client/mod/agentfarm.js` 及新增模块），原版外壳 5128 文件哈希门保持零变更。

## Glossary

- **mod 注入层**：`client/mod/agentfarm.js` 及其加载的模块，运行时注入 DOM/CSS/反射调用，位于原版哈希基线之外。
- **哈希门**：`client/original-hash.json`（5128 文件基线），`tools/hash-manifest.mjs --check` 校验原版文件零修改。
- **Design Tokens**：集中定义的颜色/字体/间距/圆角/阴影/动效曲线变量集。
- **面板**：mod 层注入的全部 af-* DOM 界面（指挥台/村事面板/走马灯/聊天/登录/设置等）。
- **粒子层**：单 canvas 全屏特效层（天气/季节/点击反馈）。
- **氛围注入**：经 `window.__AF_MODS__` 反射对 Cocos 运行时节点改属性（tint/光晕/粒子挂载），零文件修改。
- **UI 音效线索（cue）**：命名的一类交互音（点击/成功/金币/失败等）。

## Requirements

### R1 视觉设计系统（M1）

**User Story:** AS 玩家，我希望全部界面呈现统一的像素精修视觉语言，以获得一线游戏的成品感。

#### Acceptance Criteria

1. THE mod 注入层 SHALL 提供唯一 Design Tokens 文件，定义 12 色板（含 4 季强调色）、像素圆体字体、间距/圆角/阴影层级与 6 条动效曲线。
2. WHILE 任意面板渲染，THE mod 注入层 SHALL 从 Design Tokens 取全部颜色、圆角、阴影与动效参数。
3. THE 全部 af-* 面板样式 SHALL 通过静态检查：tokens 文件之外的样式表中裸色值（hex/rgb）计数为 0。
4. THE mod 注入层 SHALL 在字体资源加载失败时回落到系统字体栈并保持版式完整。

### R2 HUD 与信息层级（M2）

**User Story:** AS 玩家，我希望核心状态一目了然且分区固定，以降低阅读负担。

#### Acceptance Criteria

1. THE HUD SHALL 按固定分区呈现：左上状态区（金币/体力）、右上时辰区（游戏时刻/天气/节日）、右下指挥台、底部聊天条。
2. WHEN 金币或体力数值变化，THE 状态区 SHALL 以数值滚动动画呈现过渡，时长 300-600ms。
3. WHEN 游戏时刻或天气变化（/af/calendar 数据更新），THE 时辰区 SHALL 同步更新文本与图标。
4. WHILE 天气为雨/雪，THE 时辰区天气图标 SHALL 播放对应微动画。

### R3 统一提示与对话框（M2）

**User Story:** AS 玩家，我希望所有提示与弹窗风格一致，以获得完整的产品感。

#### Acceptance Criteria

1. THE mod 注入层 SHALL 提供统一 toast 组件替代全部零散提示，存活时长默认 2.5s，最多同屏 3 条。
2. WHEN 对话框打开或关闭，THE 对话框 SHALL 以 scale 0.92→1 加淡入/淡出动画过渡，时长 180-260ms，缓动含轻微 overshoot。
3. THE 对话框 SHALL 呈现羊皮纸底 + 木框描边的像素精修样式（token 化）。

### R4 交互动效反馈（M3）

**User Story:** AS 玩家，我希望每次操作都有即时视效反馈，以获得主机级手感。

#### Acceptance Criteria

1. WHILE 指针悬停于可点元素，THE 元素 SHALL 呈现亮度提升反馈。
2. WHEN 可点元素被按下，THE 元素 SHALL 呈现下沉位移（2px）反馈。
3. WHEN 操作成功或失败，THE 系统 SHALL 呈现对应成功/失败反馈动效（含粒子点缀），时长 ≤400ms。
4. THE 全部 af-* 可点元素 SHALL 三态覆盖（hover/按下/结果反馈），静态检查计数覆盖率 100%。
5. WHEN 面板打开或关闭，THE 面板内元素 SHALL 按 30-60ms 间隔逐项入场（stagger）。

### R5 环境粒子层（M3）

**User Story:** AS 玩家，我希望画面有活的氛围粒子，以获得场景生命感。

#### Acceptance Criteria

1. THE 粒子层 SHALL 以单 canvas 全屏层实现，支持雨/雪/萤火/落叶/花瓣五种模式。
2. WHEN /af/calendar 返回季节或天气变化，THE 粒子层 SHALL 切换到对应模式（春花瓣/夏萤火/秋落叶/冬雪 + 天气雨雪优先）。
3. WHEN 玩家点击游戏画面，THE 粒子层 SHALL 播放点击涟漪。
4. WHILE 粒子层满屏运行，THE 渲染 SHALL 保持 60fps（performance 实测）。
5. THE 粒子层 SHALL 提供总开关（设置面板），默认开启。

### R6 昼夜与季节氛围（M4，实机验收待用户）

**User Story:** AS 玩家，我希望画面随时间与季节呈现色彩氛围变化，以获得沉浸感。

#### Acceptance Criteria

1. THE 氛围注入 SHALL 按游戏时刻对场景层施加 4 时段色调（晨金/昼白/暮橙/夜蓝）。
2. THE 氛围注入 SHALL 按 /af/calendar 季节施加 4 季色调映射（春嫩绿/夏浓绿/秋金/冬灰白）。
3. WHEN 天气为雨/雪/风暴，THE 氛围注入 SHALL 叠加对应滤镜（冷色/亮化/暗压）。
4. WHILE 游戏时刻为夜，THE 氛围注入 SHALL 为灯笼资产挂载光晕节点。
5. THE 色调叠加 SHALL 经 Cocos 运行时反射改节点属性实现，原版文件保持零修改。

### R7 角色与环境反馈强化（M4，实机验收待用户）

**User Story:** AS 玩家，我希望角色与环境互动有细腻反馈，以获得大厂级打磨感。

#### Acceptance Criteria

1. WHEN 主角移动，THE 系统 SHALL 在脚下按步频生成尘土粒子。
2. WHILE 主角待机，THE 主角节点 SHALL 以 1-2px 幅度呼吸浮动。
3. WHEN 主角进入水域相邻格，THE 系统 SHALL 播放水花粒子。
4. WHEN 玩家登录进入游戏，THE 系统 SHALL 播放开局运镜（相机从村口缓推至主角家 + 标题淡入），时长 2-4s 且可点击跳过。

### R8 音频系统（M5，进本期）

**User Story:** AS 玩家，我希望有随情境变化的背景音乐与操作音效，以获得完整的感官体验。

#### Acceptance Criteria

1. THE 音频系统 SHALL 按昼夜与季节呈现 BGM 氛围变化（季节可通过曲目切换或滤镜变调实现），切换时交叉淡入淡出 ≥2s。
2. THE 音频系统 SHALL 提供至少 8 个 UI 音效线索（点击/按下/成功/失败/金币/开关面板/粒子环境音/对话框）。
3. WHEN 用户首次与页面交互，THE 音频系统 SHALL 完成 AudioContext 解锁后才开始播放（浏览器自动播放策略合规）。
4. THE 设置面板 SHALL 提供 BGM 与音效独立开关及音量控制，偏好持久化到 localStorage。
5. IF 音频资源解码失败或加载超时（5s），THE 音频系统 SHALL 静默降级并保持界面功能正常。

### R9 原版外壳保护（全局约束）

**User Story:** AS 项目维护者，我要求原版外壳保持只读，以保证升级兼容与回滚安全。

#### Acceptance Criteria

1. THE 全部美化改动 SHALL 位于 mod 注入层，`tools/hash-manifest.mjs --check` 校验 5128 文件零变更。
2. THE 氛围注入 SHALL 仅通过运行时反射修改节点属性与挂载新节点。
3. WHEN 美化任一模块初始化失败，THE mod 注入层 SHALL 降级停用该模块并保持游戏功能正常（try/catch 隔离，单模块异常不阻断其他模块）。

### R10 性能与资源预算（全局约束）

**User Story:** AS 玩家，我希望美化后游戏流畅度与内存占用保持在预算内。

#### Acceptance Criteria

1. THE mod 注入层常驻 DOM 节点 SHALL ≤10 个（粒子 canvas 与瞬时 toast 除外）。
2. THE 美化模块 SHALL 控制内存增量 <30MB（资产加载后 DevTools 实测）。
3. THE 协议回归 SHALL 保持 11 项全过（美化纯客户端 mod 层，服务端零改动）。

## 排除项（用户拍板）

- 深色模式：本期不实现。
- 现代扁平 UI 大改：采用忠实像素风精修路线。
