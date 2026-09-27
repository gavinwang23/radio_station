# 无线电监控台前端

Vue 2 / Element UI / Cesium。提供 ADS-B 实时态势、航空器详情、航迹和接收源配置，预留 AIS、SSTV、气象卫星及卫星轨道入口。仅展示后端推送的真实数据。

```powershell
npm.cmd install
npm.cmd run dev
```

默认打开 `http://localhost:9528/#/`，同时在 `../back` 启动 Express。

```powershell
npm.cmd run lint
npm.cmd run test:unit -- --runInBand
npm.cmd run build:prod
```

使用 Node.js 22。操作与扩展见 [工作台说明](README-airspace.md)，连接及地图配置见 [环境配置](../docs/environment.md)，后端接入见 [后端说明](../back/README.md)。

初始模板来自 [vue-admin-template](https://github.com/PanJiaChen/vue-admin-template)，保留其 MIT 许可，见 [LICENSE](LICENSE)。
