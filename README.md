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

## 已内置的魔改增强功能（可视化配置）

管理后台新增 **「设置 → 主题增强」**（`/dashboard/settings/theme-custom`），所有功能均由 Go 后端持久化至 `config.yaml` 并下发给前台，支持逐项开关、调参、一键全开/全关与恢复默认：

- **外观、字体与全局布局**：副标题、Logo、桌面/移动端背景图与磨砂模糊、隐藏页脚、显示总流量、禁用小人动画、置顶卡片固定、字体预设（MiSans / 霞鹜文楷 / 自定义字体 URL）、导航栏自定义链接。
- **周期流量进度条**：动态色阶渐变进度条、流量明细/占比/重置日轮播、隐藏旧周期框。
- **VPS 剩余价值徽章**：自动解析 `public_note` 计费信息与实时汇率、分档高亮标签与悬浮明细。
- **实时三网延迟面板**：控制栏独立开关、IPv4/IPv6 电信/联通/移动卡片延迟实时轮询（视口懒加载）。
- **智能问候语与建站运行时间**：按中国法定节假日/工作日/周末/时段展示问候语与实时建站计时器。
- **右下/左侧 Mac 悬浮胶囊 Dock**（移动端自动切为底部居中）：一键呼出资产统计、交易助手、3D 地球、流量透视、续费日历五大工具。
- **多币种资产统计 & 现金流分析**：支持 CNY/USD/HKD/EUR/GBP 实时汇率汇总，内置**总览 / 未来 12 个月续费现金流柱状图（含月度明细） / 按商家与地区消费排行**三个视图。
- **出/收机交易计算与发帖助手**：三步滑动工作台、探针机器一键导入（自动带入已检测的流媒体解锁与三网回程路由）、明盘/溢价切换、剩价出、同号伴生机独立核算、暂存结算车、Markdown 帖子自由编辑与复制。
- **3D 互动地球**：基于 Globe.GL 的 3D 节点分布、昼夜纹理随明暗主题自动切换、访客连线与可点击节点清单。
- **全局 & 单机流量透视**：限定/无限流量池汇总、双环形图、7 种排序、日均消耗与月底预估告警，进入单机详情页自动切换为单机透视模式。
- **续费日历 & 紧急到期提醒**：年度热力图/月历/周历续费预测，以及右下角错峰弹出的临期提醒卡片。
- **左下角访客欢迎气泡**：多源 GeoIP 归属地、OS 图标、浏览器识别、IP/ISP 防窥点击马赛克与自动收起。
- **流媒体 & AI 解锁、三网回程路由与 IP 质量体检（详情页独立分区）**：通过哪吒原生 gRPC 命令通道零侵入检测（无需重装 Agent），支持 Netflix / Disney+ / YouTube Premium（含送中检测）/ TikTok / Spotify / Prime Video / Max / Bilibili / ChatGPT / Claude / Gemini 双栈（IPv4/IPv6）解锁、电信/联通/移动回程路由识别（CN2 GIA/GT/9929/4837/CMIN2/CMI 及逐跳路径）、以及 IP 类型/ASN/Google 送中/SMTP 25 端口/DNSBL 黑名单体检；支持后台定时轮询与单机/全量手动触发，结果持久化到 SQLite。
- **机器到期自动通知推送**：后端按 `public_note` 账单日期自动扫描即将到期节点，通过哪吒原生通知组（Telegram / 邮件 / Webhook）推送汇总提醒，支持自定义提前天数（如 `7,3,1` 天）、每日触发时间、当日防重发及后台一键测试。
- **一键生成节点测评 / 分享卡片**：节点详情页内置「测评卡片」工作台，自动汇总硬件配置、残值、三网延迟、回程路由、流媒体解锁与 IP 体检，支持导出可编辑 Markdown 评测帖与 2× 高清 PNG 海报图。
- **前台多维筛选 & 快捷搜索**：首页控制栏集成关键词搜索（名称/商家/地区/线路）、流媒体/AI 解锁快捷筛选（Netflix / Disney+ / ChatGPT / Claude / Gemini）、30 天内到期筛选，以及按到期日、剩余价值、月均价格排序。

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
