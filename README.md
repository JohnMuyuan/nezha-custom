# Nezha Custom (哪吒探针 V2 魔改整合版)

基于 **哪吒监控 V2** 全家桶整合的单仓库（Monorepo）魔改版本，将面板后端、官方前台、管理后台与 Agent 被控端整合在同一个仓库中，采用**纯本地编译 + 自主上传部署**（无 GitHub Actions）。

## 目录结构

```text
nezha-custom/
├── dashboard/              # 面板后端 (基于 nezhahq/nezha v2.7.0)
├── frontend-user/          # 官方用户前台 (基于 hamster1963/nezha-dash-v2 v2.7.0)
├── frontend-admin/         # 管理后台 (基于 nezhahq/admin-frontend v2.6.1)
├── agent/                  # 被控端 Agent (基于 nezhahq/agent v2.4.0)
├── Dockerfile              # 一键多阶段本地构建（自动编译前后台并嵌入面板镜像）
├── docker-compose.yml      # 服务器部署示例
├── scripts/
│   ├── build-docker.ps1    # 本地构建并推送 Docker 镜像（或导出 tar 包）
│   ├── build-agent.ps1     # 本地交叉编译多平台 Agent 并可选发布到 GitHub Release
│   └── prepare-frontends.sh # 同步前后台静态文件到 dashboard 嵌入目录
└── UPSTREAM.md             # 上游仓库版本与基线记录
```

## 1. 本地构建面板 Docker 镜像（需 Docker Desktop 或 WSL）

根目录的 `Dockerfile` 会自动依次编译本地的 `frontend-user`、`frontend-admin` 和 `dashboard`，打包成一个最小体积的 Linux 镜像（`busybox:stable-musl`）。

### 方式 A：构建并推送到 GHCR（推荐）

首次推送到 `ghcr.io` 前先登录一次：

```powershell
# 申请 write:packages 权限（首次执行一次即可）
gh auth refresh -h github.com -s write:packages

# 登录 GHCR
gh auth token | docker login ghcr.io -u JohnMuyuan --password-stdin
```

一键构建并推送（默认 `linux/amd64`，如需同时打 ARM64 可改 `-Platforms "linux/amd64,linux/arm64"`）：

```powershell
# 仅嵌入本地魔改前后台（最快）
.\scripts\build-docker.ps1 -Push

# 如需同时内置额外第三方主题 + IPInfo GeoIP 国家旗帜数据库：
.\scripts\build-docker.ps1 -Push -WithCommunityThemes -IpInfoToken "你的IPINFO_TOKEN"
```

服务器上使用 `docker-compose.yml` 拉取重启即可：

```bash
docker compose pull
docker compose up -d
```

### 方式 B：不推镜像仓库，直接导出 `.tar` 传到服务器

```powershell
.\scripts\build-docker.ps1 -ExportTar .\dist\nezha-custom.tar
```

上传到 Linux 服务器后执行：

```bash
docker load -i nezha-custom.tar
docker compose up -d
```

## 2. 本地交叉编译 Agent（Windows 直接可用，无需 Docker）

Agent 为纯 Go（`CGO_ENABLED=0`），在 Windows 上即可直接编译 Linux / Windows / macOS 多平台压缩包：

```powershell
# 编译到 dist/agent/
.\scripts\build-agent.ps1 -Version "v2.4.0-custom.1"

# 编译并直接上传发布到 GitHub Release
.\scripts\build-agent.ps1 -Version "v2.4.0-custom.1" -Publish -ReleaseTag "agent-v2.4.0-custom.1"
```

> 提示：如果你魔改了 `agent/`，记得修改 `agent/cmd/agent/main.go` 中的自更新仓库地址或在客户端禁用自动更新，避免被官方版本覆盖。

## 3. 本地开发调试

```powershell
# 前台开发（内置 Mock 数据，无需后端即可实时预览 UI）
cd frontend-user
pnpm install
pnpm run dev:mock

# 后台开发
cd frontend-admin
npm ci
npm run dev
```

## 开源协议与致谢

本项目基于 [Nezha Monitoring](https://github.com/nezhahq/nezha) 及其生态项目构建，各子目录均完整保留了上游项目的原始许可证，详见 [UPSTREAM.md](./UPSTREAM.md)。
