# overlay-mode Spec Delta

## ADDED Requirements

### Requirement: 透明置顶窗口

客户端 SHALL 提供 Overlay 模式：半透明的战术板窗口置顶显示，MUST NOT 注入任何游戏进程或读取游戏内存，MUST NOT 与游戏产生任何进程级交互。

#### Scenario: Overlay 置顶显示
- **WHEN** 用户在游戏运行时呼出 Overlay
- **THEN** 战术板以半透明形式悬浮于游戏画面之上且始终置顶

### Requirement: 全局热键呼出与隐藏

客户端 SHALL 支持全局热键（默认 Alt+Q，可配置）在游戏中呼出/隐藏 Overlay，无需切出游戏窗口。

#### Scenario: 热键切换
- **WHEN** 用户在游戏内按下 Alt+Q
- **THEN** Overlay 显示；再次按下则隐藏

### Requirement: 点击穿透切换

Overlay SHALL 支持鼠标点击穿透模式切换：穿透开启时鼠标事件透传到游戏，Overlay 仅作展示；穿透关闭时可对 Overlay 内标注执行删除操作。

#### Scenario: 穿透查看
- **WHEN** 用户开启点击穿透并将鼠标移入 Overlay
- **THEN** 鼠标点击作用于下层游戏窗口，Overlay 不响应点击

### Requirement: Overlay 为查看模式

Overlay 窗口 SHALL 复用战术板画布并锁定为查看模式：实时显示队友的标注更新与时效淡出，不提供完整编辑工具栏；删除单个标注除外。

#### Scenario: 实时查看队友标注
- **WHEN** Overlay 显示期间队友新增标注
- **THEN** 该标注在 Overlay 中实时出现并同步淡出

### Requirement: 无边框窗口模式引导

客户端 MUST 在首次使用 Overlay 前提示：游戏需设置为"无边框窗口"显示模式，否则 Overlay 在全屏独占模式下不可见。

#### Scenario: 首次引导
- **WHEN** 用户首次开启 Overlay 功能
- **THEN** 客户端展示一次性引导，说明无边框窗口模式要求
