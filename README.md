# 无线电监视平台

Vue 2 / Cesium 前端与 Express / MariaDB 后端。当前提供 ADS-B 工作台和可切换底图，预留 AIS、SSTV、气象卫星与轨道模块。详细设计见 [架构说明](docs/architecture.md)。

分别在两个终端启动：

```powershell
cd back
npm.cmd install
# 已配置本地 .env 时直接启动；新环境从 .env.example 复制并填写
npm.cmd run dev
```

```powershell
cd front
npm.cmd install
npm.cmd run dev
```

前端默认端口 9528，后端 3000。前后端连接和地图地址集中在 `.env` 配置，详见 [环境配置](docs/environment.md)。开发服务器代理 `/api/v1` 的 HTTP 和 WebSocket；生产部署也需同源反向代理并开启 WebSocket Upgrade。运行环境推荐 Node.js 22。

本地 MariaDB 配置指向 `radio_station`，凭据仅保存于被忽略的 `back/.env`。平台创建 `signal_sources`（接收源配置）和 `rs_schema_migrations`（迁移记录），不修改用户导入的 ADS-B 资料表。也可运行 `npm.cmd run migrate` 手动迁移；重复运行安全。

前端“数据接入”填写 dump1090 的 IP/主机名、端口 `30002`，启用并保存。配置写入 MariaDB，服务重启时自动恢复。后端通过 TCP 接收 AVR 原始报文、解码并维护实时目标，再通过 `/api/v1/stream` WebSocket 推送前端；不需要设置 `ADSB_SOURCE_URL`。站点经纬度可留空，未设置时不显示接收站点与距离圈。页面仅显示真实接收数据；尚未配置或断线时保持空列表并显示实际状态。

导入 ADS-B 资料表后填写实际 `ADSB_TABLE` 和 `ADSB_COLUMN_MAPPING`，用于补充登记号、机型等资料。实时目标暂存后端内存，尚不将每条报文写成历史轨迹。

Google 卫星影像使用官方 Map Tiles API，在后端配置 `GOOGLE_MAPS_API_KEY` 后启用。默认使用 Esri 卫星影像，网络失败时回退到随 Cesium 打包的低精度离线底图。

接口、字段映射与模块注册见 [后端说明](back/README.md)，界面操作见 [前端说明](front/README-airspace.md)。

根目录 `.gitignore` 排除数据库凭据、本地环境覆盖文件、依赖、构建产物、日志和数据库导出；保留不含凭据的前端环境默认值和后端配置示例。上传 GitHub 前可用 `git status --short` 查看待提交文件。

验证命令：

```powershell
cd back
npm.cmd test
```

```powershell
cd front
npm.cmd run lint
npm.cmd run test:unit -- --runInBand
npm.cmd run build:prod
```
