# Infinite Canvas v3.0.117

## v3.0.117 本次发布

- Agent 傻瓜模式的纯文本视频草稿请求改用有限 JSON 响应，避免线上 SSE 连接悬挂造成“生成模型适配提示词超时”。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.117`。
- 回滚目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.116`；上线前 Compose、容器和镜像状态按时间戳备份。

## v3.0.116 本次发布

- Agent 傻瓜模式默认使用 `deepseek-v4-pro-ga-260813`，并保留 `doubao-seed-2-1-pro-260628` 作为已登记备用通道。
- 旧版 Agent 文本模型配置自动迁移；工具调用遇到空结果或可重试上游错误时切换另一条 Agent 文本通道。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.116`。
- 回滚目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.115`；上线前 Compose、容器和镜像状态按时间戳备份。

## v3.0.115 本次发布

- 对已确认草稿做保留口播的确定性长度压缩，使最终视频提示词满足 90–170 英文词的供应商约束。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.115`。
- 回滚目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.114`；上线前 Compose 与运行状态备份：`/opt/infinite-canvas/backups/release-v3.0.115-20260820T044650Z`。

## v3.0.114 本次发布

- 在 v3.0.113 的确定性确认基础上，兼容生产模型实际返回的单引号口播和冗余 `Subtitle:` 段落。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.114`。
- 回滚目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.113`；上线前 Compose 与运行状态备份：`/opt/infinite-canvas/backups/release-v3.0.114-20260820T044055Z`。

## v3.0.113 本次发布

- 用户在审阅并确认视频提示词后，画布直接使用该草稿准备视频节点，不再发起第二次模型请求。
- 在线 Agent 与本地 Agent 都采用同一确定性确认逻辑；确认操作不额外扣 Agent 积分，也不会自动提交付费视频生成。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.113`。
- 回滚目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.112`；上线前 Compose 与运行状态备份：`/opt/infinite-canvas/backups/release-v3.0.113-20260820T043035Z`。

## 默认发布流程（长期规则）

本项目所有生产变更默认按以下顺序执行，不跳步、不省略：

1. **备份**：保存当前源码状态、Compose 配置、正在运行的镜像/容器与必要数据路径，生成带时间戳的可恢复备份。
2. **版本号**：同步 `VERSION`、`web/package.json`、`CHANGELOG.md`，为本次发布确定唯一版本号。
3. **提交**：提交代码、测试和变更记录，确保提交内容可审计。
4. **推送**：推送分支、提交和版本标签；生产镜像也使用同一版本号推送。
5. **构建**：用确定的提交构建带版本标签的生产镜像，不覆盖旧镜像。
6. **验证**：完成类型检查、回归测试、生产构建，并对线上健康接口和关键业务接口做冒烟验证。
7. **上线**：只切换本次目标服务；除非明确授权，不修改或重启中转站等无关服务。
8. **保留回滚**：保留上线前镜像、容器、Compose 配置和备份目录，记录可执行的回滚目标与方式。

这套流程是本项目的默认操作约定；若任一步无法完成，应先停在该步并说明原因，不得把未验证的状态当作已上线。

## v3.0.104 本次发布

- Root 设置分销管理员；分销管理员自定义售价方案并通过自己的邀请码归集客户。
- 平台成本保持不变，生成成功后差价以积分返入分销管理员账户；失败不返佣。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.104`。
- 回滚目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.103`；保留上线前 SQLite 在线备份、Compose、Nginx 和镜像快照。

## v3.0.102 本次发布

- 移除旧中转站账号登录迁移桥，画布不再接受中转站账号进入。
- 画布到模型服务的 `/api/gateway` 与 `/api/tokaxis` 生成链路保持不变。
- 账务边界独立：画布只结算自己的积分、订单和流水；中转站只提供模型上游，不向画布导入余额或消费流水。
- 生产镜像目标：`ghcr.io/tzx666888/infinite-canvas:v3.0.102`。

### v3.0.102 回滚目标

- 回滚至已验证的 `ghcr.io/tzx666888/infinite-canvas:v3.0.101`。
- 保留 v3.0.101 的 Compose 配置、容器和数据卷，不删除认证数据。

## v3.0.101 本次发布

- 恢复独立 TTS 配音入口，保持与中转站服务隔离。
- 为 root 用户管理增加详情面板，展示余额、充值订单、积分流水和消耗统计。
- 详情接口支持分页，并区分历史带入余额与可追溯流水。
- 生产镜像：`ghcr.io/tzx666888/infinite-canvas:v3.0.101`。

### v3.0.101 回滚记录（2026-08-17）

- 上线前镜像：`ghcr.io/tzx666888/infinite-canvas:v3.0.101-user-details-tts`。
- 上线前配置与容器备份：`/opt/infinite-canvas/backups/release-v3.0.101-pre-20260817T050256Z`。
- 保留的停止回滚容器：`infinite-canvas-rollback-v3.0.101-20260817`。
- 中转站 `newapi` 未重启，仍使用 `newapi:v3.0.102-customer-key`。

This release assigns each canvas customer a dedicated upstream New API Key so task and usage records are attributed to the customer instead of `root`.

- New canvas accounts receive their dedicated upstream Key immediately after registration.
- Existing canvas accounts keep their current `vc_live_` Key and receive a dedicated upstream Key on login or their first request.
- Dedicated upstream Keys are encrypted in the canvas auth database and are used for synchronous requests and asynchronous video polling.
- If the private provisioning bridge is temporarily unavailable, the previous upstream Key remains as a compatibility fallback so existing generation is not interrupted.
- The previous production image `ghcr.io/tzx666888/infinite-canvas:v3.0.98` and the pre-release image `infinite-canvas:v3.0.97` remain rollback targets.

Rollback: preserve the pre-release backup under `/opt/infinite-canvas/data/deploy-backups/infinite-canvas-v3.0.97-pre-customer-key-*`, set Compose image back to `infinite-canvas:v3.0.97`, and redeploy with Docker Compose. Do not use `git reset --hard`, `git clean`, or delete data volumes.

Production image: `ghcr.io/tzx666888/infinite-canvas:v3.0.101`.

Previous release details are retained in Git history and the `v3.0.98` and `v3.0.97` tags.
