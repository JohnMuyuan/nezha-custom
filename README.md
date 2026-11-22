# Nezha Custom (哪吒探针 V2 魔改整合版)

基于 **哪吒监控 V2** 全家桶整合的单仓库（Monorepo）魔改版本，将面板后端、官方前台、管理后台与 Agent 被控端整合在同一个仓库中，并通过 GitHub Actions 自动编译并推送 Docker 镜像与二进制文件。

## 目录结构

```text
nezha-custom/
├── dashboard/              # 面板后端 (基于 nezhahq/nezha v2.7.0)
├── frontend-user/          # 官方用户前台 (基于 hamster1963/nezha-dash-v2 v2.7.0)
├── frontend-admin/         # 管理后台 (基于 nezhahq/admin-frontend v2.6.1)
├── agent/                  # 被控端 Agent (基于 nezhahq/agent v2.4.0)
├── scripts/
│   └── prepare-frontends.sh # 同步本地编译后的前后台静态文件到 dashboard 嵌入目录
├── docker-compose.yml      # Docker 一键部署示例
├── UPSTREAM.md             # 上游仓库版本与基线记录
└── .github/workflows/      # 自动构建与发布工作流
```

## 快速部署（Docker）

推送代码到 `main` 分支后，GitHub Actions 会自动编译魔改后的 `frontend-user` + `frontend-admin` + `dashboard`，并发布多架构镜像（`linux/amd64`、`linux/arm64`）到：

```text
ghcr.io/johnmuyuan/nezha-custom:latest
```

在服务器上使用仓库自带的 `docker-compose.yml` 即可启动：

```bash
docker compose pull
docker compose up -d
```

默认监听端口 `8008`，数据保存在当前目录 `./data`。首次初始化默认管理员账号密码为 `admin` / `admin`（登录后请第一时间修改）。

## 可选配置：开启 GeoIP 国家/地区旗帜

哪吒面板构建时会嵌入 IPInfo 的免费 `country.mmdb` 数据库用于自动识别服务器 IP 归属国旗：

1. 前往 [ipinfo.io](https://ipinfo.io/) 注册免费账号并获取 Access Token
2. 在本仓库的 **Settings → Secrets and variables → Actions → New repository secret** 中添加：
   - Name: `IPINFO_TOKEN`
   - Value: 你的 IPInfo Token
3. 重新触发一次 `Build & Release Dashboard` 工作流即可将真实 GeoIP 数据库打包进镜像。

（不配置也不影响构建和正常运行，只是自动 IP 归属国旗识别会回退为空。）

## 发布方式

* **日常更新面板**：直接推送代码到 `main` 分支（或手动触发 Actions），自动构建并更新 `ghcr.io/johnmuyuan/nezha-custom:latest`。
* **发布面板正式版**：推送 `v*` 标签（如 `git tag v2.7.0-custom.1 && git push --tags`），会同时推送 Docker 镜像和 GitHub Release 二进制压缩包。
* **发布魔改 Agent**：推送 `agent-v*` 标签（如 `git tag agent-v2.4.0-custom.1 && git push --tags`），自动编译多平台 Agent 并发布到 GitHub Release。
  > 注意：如果你魔改了 `agent/`，建议在魔改时顺便修改 `agent/cmd/agent/main.go` 中的自更新仓库地址，或在客户端配置中关闭自动更新，避免被官方版本覆盖。

## 本地开发说明

```bash
# 1. 前台开发 (支持 Mock 数据)
cd frontend-user
pnpm install
pnpm run dev:mock

# 2. 后台开发
cd frontend-admin
npm ci
npm run dev

# 3. 面板后端 (需先准备前端构建产物并生成 swagger 文档)
cd dashboard
go install github.com/swaggo/swag/cmd/swag@v1.16.6
swag init --pd -d cmd/dashboard -g main.go -o cmd/dashboard/docs
go run -tags go_json ./cmd/dashboard
```

## 开源协议与致谢

本项目基于 [Nezha Monitoring](https://github.com/nezhahq/nezha) 及其生态项目构建，各子目录均完整保留了上游项目的原始许可证，详见 [UPSTREAM.md](./UPSTREAM.md)。
