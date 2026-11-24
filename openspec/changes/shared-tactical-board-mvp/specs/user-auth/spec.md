# user-auth Spec Delta

## ADDED Requirements

### Requirement: 邮箱注册

系统 SHALL 支持用户使用邮箱和密码注册账号，密码 MUST 以 bcrypt 哈希存储，邮箱 MUST 全局唯一。

#### Scenario: 注册成功
- **WHEN** 用户提交合法的邮箱、密码（≥8 位）和昵称
- **THEN** 系统创建账号并返回 JWT 会话凭证

#### Scenario: 邮箱已存在
- **WHEN** 用户使用已被注册的邮箱提交注册
- **THEN** 系统返回 409 冲突错误，且不创建新账号

### Requirement: 登录与会话

系统 SHALL 支持邮箱+密码登录，签发短期 JWT access token（2h）与 refresh token（7d，可吊销）。所有 API 与 Socket 连接 MUST 凭有效 JWT 访问。

#### Scenario: 登录成功
- **WHEN** 用户提交正确的邮箱和密码
- **THEN** 系统返回 access token 与 refresh token

#### Scenario: 会话刷新
- **WHEN** access token 过期且用户持有有效 refresh token
- **THEN** 系统签发新的 access token，无需重新登录

#### Scenario: 无凭证访问被拒
- **WHEN** 客户端不带或带无效 JWT 调用受保护接口
- **THEN** 系统返回 401，拒绝访问

### Requirement: 用户资料

系统 SHALL 允许用户查看和修改昵称与头像；昵称 MUST 非空且 ≤16 字符，头像 MUST 为预置头像列表之一（MVP 不支持自定义上传）。

#### Scenario: 修改昵称
- **WHEN** 用户提交合法新昵称
- **THEN** 系统保存并在后续房间展示中生效

#### Scenario: 昵称非法
- **WHEN** 用户提交空昵称或超过 16 字符的昵称
- **THEN** 系统返回校验错误，资料不变
