# 无线电监控台

基于现有 Vue 2 模板，使用 Cesium 展示卫星底图、航空器、航迹与接收站参考距离圈。左侧业务域预留 AIS、SSTV、气象卫星和卫星轨道入口，未配置的模块明确显示未接入。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

默认地址：`http://localhost:9528/#/`。首页直接打开工作台。页面启动时读取数据库接收源配置并订阅 WebSocket，只显示后端解码得到的真实目标。尚未配置、停用或断线时保持空列表，未收到快照时更新时间显示“—”。演示目标、演示模式和模板 mock 服务已移除。

使用 Node 18 或更高版本；构建脚本已兼容旧版 Webpack 在新版 Node 下的 OpenSSL 要求。

## 连接 dump1090

1. 启动根目录 `back` 中的 Express 服务；数据库配置位于 `back/.env`。
2. 点击顶部“数据接入”，填写 dump1090 的 IP 或主机名，端口 `30002`，启用并保存。主机字段不填 `http://`，也不填 `aircraft.json`。
3. 名称与参考经纬度可选；经纬度同时留空时保存为 `null`，地图不显示假定的接收站位置或距离圈。
4. 保存成功表示配置已写入 MariaDB；后端负责 TCP 接收与协议解码，前端通过 `/api/v1/stream` WebSocket 获取每秒快照。服务重启和页面刷新会恢复数据库配置。

后端快照使用 `{ now, messages, aircraft: [...] }`，前端适配器保留 dump1090 常用字段兼容：`alt_baro/altitude`、`gs/speed`、`baro_rate/vert_rate`。原始 Mode-S 解译全部位于后端。

开发连接、HTTP/WebSocket 地址、Cesium 资源与各底图 URL 位于 `.env.development`；生产配置位于 `.env.production`。本机覆盖值可从 `.env.local.example` 复制到 `.env.development.local` 或 `.env.production.local`，这些覆盖文件被 Git 忽略。完整字段见 [环境配置](../docs/environment.md)。修改开发配置后重启前端；生产配置修改后重新构建。生产反向代理须转发 WebSocket Upgrade。不要把数据库凭据或 Google Key 放入 `VUE_APP_*`。

实时连接失败时清除旧目标并自动重试。消息年龄超过 15 秒或位置年龄超过 30 秒的目标不绘制。未知参数显示“—”。航空器资料和真实航线需另接数据库，不从 ADS-B 呼号推断。

推送连接与接收链路分别显示：WebSocket 连通不等于收到飞机报文；TCP `waiting` 表示等待有效报文，`connected` 表示已接收到有效 ADS-B。后端分别记录原始字节时间和有效报文时间，前端显示消息年龄。保存失败保留当前实时连接；读取数据库失败显示“未读取”，不会冒充“尚无配置”。

启动读取数据库失败会自动退避重试。多个页面共享后端保存的接收源：其他页面切换来源时，当前地图同步实际站点和目标，保留本页正在编辑的草稿并提示配置已变化。实时模式停用源时仍订阅，其他页面重新启用后自动恢复显示。

Cesium 脚本、样式、Workers 和低精度 Natural Earth 底图随构建产物发布，无需 Cesium ion token。默认 Esri 卫星影像；可切换 Google 卫星影像、CARTO 深色地图和离线底图。在线图层超时或连续加载失败时回退，并显示实际底图名称。距离圈不是实测接收覆盖范围。

Google 图层通过后端官方 Map Tiles API 接入，在 `back/.env` 配置 `GOOGLE_MAPS_API_KEY`，该 Key 需要启用 Map Tiles API。前端保留 Google Maps 标志与视口版权信息。未配置 Key 时自动使用备用底图，不使用未公开的 Google 瓦片地址。

## 核心文件

- `src/views/airspace/index.vue`：布局、筛选和业务域切换。
- `src/views/airspace/airspace.scss`：界面样式和窄屏适配。
- `src/components/Airspace/CesiumMap.vue`：地图、飞机点选、航迹及地图控制。
- `src/components/Airspace/AircraftDetail.vue`：目标详情。
- `src/utils/aircraft.js`：数据适配和有界航迹缓存。
- `src/config/endpoints.js`：统一 API/WebSocket 地址与超时配置。
- `src/services/http`、`src/services/polling`：统一响应解析、超时取消及不重叠轮询。
- `src/services/realtime`：WebSocket 推送、退避重连、消息超时及资源清理。
- `src/services/map`：底图注册、Cesium 加载和图层资源清理。
- `src/modules/registry.js`：业务域描述和视图入口。

后端运行、数据库字段映射见 `../back/README.md`，扩展边界与数据契约见 `../docs/architecture.md`。验证：`npm.cmd run lint`、`npm.cmd run test:unit -- --runInBand`、`npm.cmd run build:prod`。

参考：[Cesium 静态资源配置](https://cesium.com/blog/2024/02/13/configuring-vite-or-webpack-for-cesiumjs/)、[dump1090 JSON 字段](https://github.com/flightaware/dump1090/blob/master/README-json.md)。
