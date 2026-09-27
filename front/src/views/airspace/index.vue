<template>
  <div class="airspace-app" :class="{ 'sidebar-collapsed': !sidebarOpen, 'has-detail': selectedAircraft }">
    <header class="topbar">
      <a class="brand" href="#/" aria-label="无线电监控台首页" @click="selectDomain('adsb'); activeMenu = 'overview'">
        <span class="brand-mark">
          <airspace-icon name="radar" :size="27" />
        </span>
        <span>
          <strong>无线电监控台</strong>
        </span>
      </a>
      <nav class="top-navigation" aria-label="主导航">
        <button :class="{ active: activeMenu !== 'source' }" @click="activeMenu = 'overview'; sidebarOpen = true">
          <airspace-icon name="globe" :size="17" />监视工作区</button>
        <button :class="{ active: activeMenu === 'source' }" @click="activeMenu = 'source'; sidebarOpen = true">
          <airspace-icon name="station" :size="17" />数据接入</button>
      </nav>
      <div class="topbar-right">
        <span v-if="activeDomain === 'adsb'" class="mode-badge live-mode">
          <span class="state-dot" />实时数据</span>
        <span class="header-clock mono">{{ clockText }}<small>UTC+8</small>
        </span>
        <button class="icon-button help-button" title="使用说明" aria-label="使用说明" @click="helpOpen = true">
          <airspace-icon name="info" :size="20" />
        </button>
        <span class="workspace-label">{{ activeModule.label }}</span>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar" aria-label="业务域与监视菜单">
        <div class="workspace-heading">
          <span class="workspace-title">业务域</span>
          <button class="icon-button" aria-label="收起侧栏" @click="sidebarOpen = false">
            <airspace-icon name="menu" :size="17" />
          </button>
        </div>
        <nav class="domain-navigation" aria-label="无线电业务域">
          <button v-for="module in signalModules" :key="module.id" :class="{ active: activeDomain === module.id }" :aria-pressed="activeDomain === module.id" @click="selectDomain(module.id)">
            <airspace-icon :name="module.icon" :size="17" />
            <span>{{ module.label }}</span>
            <span class="domain-state">{{ moduleState(module.id) }}</span>
          </button>
        </nav>
        <nav class="side-navigation" aria-label="监视菜单">
          <button v-for="item in availableMenus" :key="item.id" :class="{ active: activeMenu === item.id }" @click="activeMenu = item.id">
            <airspace-icon :name="item.icon" :size="16" />
            <span>{{ item.label }}</span>
            <span v-if="item.id === 'aircraft'" class="menu-count mono">{{ aircraft.length }}</span>
            <airspace-icon v-else-if="activeMenu === item.id" name="chevron" :size="14" />
          </button>
        </nav>

        <section v-if="activeDomain !== 'adsb' && activeMenu !== 'layers'" class="sidebar-content module-sidebar">
          <div class="section-title">
            <h2>{{ activeMenu === 'source' ? '数据接入' : activeModule.label }}</h2>
            <span class="subtle-tag">未接入</span>
          </div>
          <p class="panel-description">{{ activeModule.description }}</p>
          <dl class="module-facts">
            <div><dt>数据类型</dt><dd>{{ activeModule.kind }}</dd></div>
            <div><dt>接入位置</dt><dd>服务端 {{ activeModule.label }} 数据源配置</dd></div>
          </dl>
          <p class="field-hint">接收与解码进程在后端接入。配置完成后，工作台才能展示该业务的数据。</p>
          <button class="secondary-button full-button" @click="selectDomain('adsb')">返回 ADS-B 监视</button>
        </section>

        <template v-else-if="activeMenu === 'overview' || activeMenu === 'aircraft'">
          <section v-if="activeMenu === 'overview'" class="overview-section">
            <div class="section-title">
              <h2>当前空域</h2>
              <span class="small-status">
                <span class="state-dot" :class="{ muted: dataState !== 'live' }" />{{ receptionText }}</span>
            </div>
            <div class="overview-numbers">
              <div>
                <strong class="mono">{{ aircraft.length }}</strong>
                <span>接收目标</span>
              </div>
              <div>
                <strong class="mono">{{ mappedCount }}</strong>
                <span>有效位置</span>
              </div>
            </div>
            <div class="overview-breakdown">
              <span>
                <i class="legend-dot blue" />空中 {{ airborneCount }}</span>
              <span>
                <i class="legend-dot gray" />地面 {{ groundCount }}</span>
              <span>无位置 {{ aircraft.length - mappedCount }}</span>
            </div>
          </section>
          <section class="aircraft-list-section">
            <div class="section-title">
              <h2>{{ activeMenu === 'overview' ? '航空器' : '航空器列表' }}</h2>
              <span class="list-total">{{ filteredAircraft.length }} 个目标</span>
            </div>
            <label class="search-field">
              <airspace-icon name="search" :size="17" />
              <input v-model="query" placeholder="搜索呼号 / ICAO" aria-label="搜索呼号或 ICAO">
              <button v-if="query" class="icon-button" aria-label="清除搜索" @click="query = ''">
                <airspace-icon name="close" :size="14" />
              </button>
              <span v-else class="search-shortcut">⌕</span>
            </label>
            <div class="filter-tabs" aria-label="目标状态筛选">
              <button v-for="filter in filters" :key="filter.id" :class="{ active: statusFilter === filter.id }" @click="statusFilter = filter.id">{{ filter.label }}</button>
            </div>
            <div class="list-column-heading">
              <span>呼号 / ICAO</span>
              <span>高度 · ft</span>
            </div>
            <div class="aircraft-list">
              <button v-for="target in listedAircraft" :key="target.icao" class="aircraft-row" :class="{ selected: selectedId === target.icao }" @click="selectAircraft(target.icao)">
                <span class="row-plane" :class="{ ground: target.onGround, unavailable: !target.hasPosition }">
                  <airspace-icon name="plane" :size="19" />
                </span>
                <span class="row-identity">
                  <strong class="mono">{{ target.callsign }}</strong>
                  <small class="mono">{{ target.icao }}<span v-if="!target.hasPosition"> · 无位置</span>
                  </small>
                </span>
                <span class="row-altitude mono">{{ target.onGround ? '地面' : number(target.altitude) }}<small>{{ target.speed == null ? '—' : number(target.speed) + ' kt' }}</small>
                </span>
              </button>
              <div v-if="!listedAircraft.length" class="empty-list">
                <airspace-icon name="search" :size="25" />
                <p>{{ dataState === 'error' ? '等待数据连接' : query ? '没有匹配的航空器' : '暂无接收目标' }}</p>
                <small>{{ query ? '尝试其他呼号或 ICAO 地址' : '可在数据接入中配置接收源' }}</small>
              </div>
            </div>
            <button v-if="activeMenu === 'overview' && filteredAircraft.length > 6" class="view-all-button" @click="activeMenu = 'aircraft'">查看全部 {{ filteredAircraft.length }} 架航空器<airspace-icon name="arrow" :size="15" />
            </button>
          </section>
        </template>

        <section v-else-if="activeMenu === 'layers'" class="sidebar-content">
          <div class="section-title">
            <h2>地图图层</h2>
            <airspace-icon name="layers" :size="17" />
          </div>
          <p class="panel-description">按监视需要调整地图显示。</p>
          <label v-if="activeDomain === 'adsb'" class="layer-option">
            <span>
              <strong>航空器标签</strong>
              <small>显示呼号与选中目标参数</small>
            </span>
            <input v-model="layers.labels" type="checkbox" class="toggle">
          </label>
          <label v-if="activeDomain === 'adsb'" class="layer-option">
            <span>
              <strong>飞行航迹</strong>
              <small>本次会话内的历史位置</small>
            </span>
            <input v-model="layers.tracks" type="checkbox" class="toggle">
          </label>
          <label v-if="activeDomain === 'adsb'" class="layer-option">
            <span>
              <strong>参考距离圈</strong>
              <small>50 / 100 / 150 km</small>
            </span>
            <input v-model="layers.coverage" type="checkbox" class="toggle">
          </label>
          <div v-if="activeDomain === 'adsb'" class="sidebar-note">
            <airspace-icon name="info" :size="16" />
            <span>距离圈仅供参考，不代表接收站的实际覆盖范围。</span>
          </div>
          <h3 class="subsection-heading">底图与坐标</h3>
          <label class="form-field basemap-field">
            <span>地图底图</span>
            <select v-model="basemap" aria-label="选择地图底图">
              <option v-for="option in basemapOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <p class="basemap-status">当前：{{ basemapStatus.label }}<span v-if="basemapStatus.fallback">（已回退）</span></p>
          <p v-if="basemap === 'google-satellite'" class="field-hint">Google 底图需要后端配置 GOOGLE_MAPS_API_KEY，未配置或不可用时自动回退。</p>
          <dl class="station-facts">
            <div>
              <dt>地图引擎</dt>
              <dd>Cesium</dd>
            </div>
            <div>
              <dt>底图</dt>
              <dd>{{ basemapStatus.label }}</dd>
            </div>
            <div>
              <dt>坐标系</dt>
              <dd class="mono">WGS 84</dd>
            </div>
          </dl>
          <div class="map-mode-choice">
            <button :class="{ active: mapMode === '2D' }" @click="setMapMode('2D')">二维地图</button>
            <button :class="{ active: mapMode === '3D' }" @click="setMapMode('3D')">三维地球</button>
          </div>
        </section>

        <section v-else-if="activeMenu === 'station'" class="sidebar-content">
          <div class="section-title">
            <h2>接收站</h2>
            <span class="subtle-tag">{{ referencePositionAvailable ? '参考位置' : '未设置参考位置' }}</span>
          </div>
          <div class="station-summary">
            <strong>{{ receiver.name }}</strong>
            <span>1090 MHz · ADS-B</span>
          </div>
          <dl class="station-facts">
            <div>
              <dt>纬度</dt>
              <dd class="mono">{{ referencePositionAvailable ? number(receiver.lat, 4) + '°' : '—' }}</dd>
            </div>
            <div>
              <dt>经度</dt>
              <dd class="mono">{{ referencePositionAvailable ? number(receiver.lon, 4) + '°' : '—' }}</dd>
            </div>
            <div>
              <dt>数据源</dt>
              <dd>TCP · {{ activeSource ? activeSource.port : '—' }}</dd>
            </div>
            <div>
              <dt>累计消息</dt>
              <dd class="mono">{{ number(totalMessages) }}</dd>
            </div>
            <div>
              <dt>更新间隔</dt>
              <dd class="mono">1 s</dd>
            </div>
          </dl>
          <p class="panel-description">原始 Mode-S 数据由后端接收和解码，当前显示后端的接收链路状态。</p>
          <button class="secondary-button full-button" @click="activeMenu = 'source'">配置接收数据<airspace-icon name="arrow" :size="15" />
          </button>
        </section>

        <section v-else class="sidebar-content source-content">
          <div class="section-title">
            <h2>数据接入</h2>
            <airspace-icon name="settings" :size="17" />
          </div>
          <p class="panel-description">接入 ADS-B 接收机的 TCP 数据流。</p>
          <p class="source-config-status" :class="{ unread: sourceLoadState === 'unread' }">{{ sourceConfigText }}</p>
          <p v-if="sourceConfigChanged" class="source-config-change">其他页面已更新接收源；地图使用最新配置，当前表单草稿未改变，请核对后保存。</p>
          <p v-if="sourceLoadError" class="connection-error" role="alert">{{ sourceLoadError }}</p>
          <template>
            <label class="form-field">
              <span>数据源名称</span>
              <input v-model.trim="sourceName" maxlength="100" aria-label="数据源名称">
            </label>
            <label class="form-field">
              <span>IP 地址 / 主机名</span>
              <input v-model.trim="sourceHost" placeholder="192.168.1.10 或 receiver.local" spellcheck="false" aria-label="TCP 接收源 IP 地址或主机名">
            </label>
            <label class="form-field">
              <span>TCP 端口</span>
              <input v-model="sourcePort" type="number" min="1" max="65535" step="1" aria-label="TCP 接收源端口">
            </label>
            <label class="layer-option source-enabled">
              <span><strong>启用接收源</strong><small>保存后由后端连接接收机</small></span>
              <input v-model="sourceEnabled" type="checkbox" class="toggle" aria-label="启用 TCP 接收源">
            </label>
            <p class="field-hint">配置保存到后端数据库。后端通过 TCP 30002 接收原始 Mode-S 数据并解码，每秒经 WebSocket 推送目标。</p>
            <dl class="station-facts connection-states">
              <div><dt>已激活来源</dt><dd>{{ activeSourceText }}</dd></div>
              <div><dt>推送通道</dt><dd>{{ socketText }}</dd></div>
              <div><dt>TCP 接收链路</dt><dd>{{ receptionText }}</dd></div>
              <div><dt>最近有效消息</dt><dd class="mono">{{ lastMessageText }}</dd></div>
            </dl>
            <p v-if="receptionError" class="connection-error" role="alert">{{ receptionError }}</p>
          </template>
          <h3 class="subsection-heading">接收站参考位置</h3>
          <p class="field-hint">可留空；未设置站址时不显示接收站与参考距离圈。</p>
          <label class="form-field">
            <span>站点名称</span>
            <input v-model.trim="receiverDraft.name" maxlength="24">
          </label>
          <div class="coordinate-fields">
            <label class="form-field">
              <span>纬度</span>
              <input v-model="receiverDraft.lat" type="number" min="-90" max="90" step="0.0001">
            </label>
            <label class="form-field">
              <span>经度</span>
              <input v-model="receiverDraft.lon" type="number" min="-180" max="180" step="0.0001">
            </label>
          </div>
          <button class="primary-button full-button" :disabled="sourceSaving" @click="applySource">
            <airspace-icon name="refresh" :size="16" />{{ sourceSaving ? '正在保存…' : sourceEnabled ? '保存并连接' : '保存并停用' }}</button>
          <p v-if="sourceError" class="connection-error" role="alert">{{ sourceError }}</p>
          <h3 class="subsection-heading">平台服务</h3>
          <dl class="station-facts">
            <div><dt>后端</dt><dd>{{ backendText }}</dd></div>
            <div><dt>MariaDB</dt><dd>{{ databaseText }}</dd></div>
            <div><dt>航空器资料</dt><dd>{{ catalogText }}</dd></div>
          </dl>
          <div class="sidebar-note">
            <airspace-icon name="info" :size="16" />
            <span>原始 ADS-B 通常不含航线和机型信息，可在后续接入飞机资料库。</span>
          </div>
        </section>

        <div class="sidebar-bottom">
          <span class="receiver-dot" />
          <span>{{ activeDomain === 'adsb' ? receptionText : '等待后端接入' }}</span>
          <span v-if="activeDomain === 'adsb'" class="mono">1090 MHz</span>
        </div>
      </aside>

      <main class="map-workspace" :aria-label="activeModule.label + '工作区'">
        <cesium-map
          ref="map"
          :aircraft="activeDomain === 'adsb' ? filteredAircraft : []"
          :trails="activeDomain === 'adsb' ? trails : {}"
          :selected-id="selectedId"
          :labels="layers.labels"
          :tracks="layers.tracks"
          :coverage="activeDomain === 'adsb' && layers.coverage && referencePositionAvailable"
          :receiver-visible="activeDomain === 'adsb' && referencePositionAvailable"
          :basemap="basemap"
          :receiver="receiver"
          @select="selectAircraft"
          @coordinate="coordinate = $event"
          @unfollow="stopFollowing"
          @ready="onMapReady"
          @basemap-change="basemapStatus = $event"
        />
        <div class="map-topline">
          <div class="map-heading">
            <button v-if="!sidebarOpen" class="map-icon-button" aria-label="展开侧栏" @click="sidebarOpen = true">
              <airspace-icon name="menu" :size="19" />
            </button>
            <div>
              <h1>{{ activeDomain === 'adsb' ? 'ADS-B 空域监视' : activeModule.label }}<span v-if="activeDomain === 'adsb'">接收空域 · 位置 {{ mappedCount }}</span>
              </h1>
            </div>
          </div>
          <div class="map-top-actions">
            <span v-if="activeDomain === 'adsb'" class="map-data-badge">
              <span class="state-dot" :class="{ muted: dataState !== 'live' }" />{{ receptionText }}</span>
            <button class="map-icon-button" title="地图图层" aria-label="地图图层" :class="{ active: activeMenu === 'layers' }" @click="activeMenu = 'layers'; sidebarOpen = true">
              <airspace-icon name="layers" :size="19" />
            </button>
            <button class="map-icon-button fullscreen-button" title="全屏显示" aria-label="全屏显示" @click="toggleFullscreen">
              <airspace-icon name="expand" :size="19" />
            </button>
          </div>
        </div>
        <section v-if="activeDomain !== 'adsb'" class="module-panel" aria-label="模块接入状态">
          <div class="module-panel-heading"><h2>{{ activeModule.label }}</h2><span class="subtle-tag">未接入</span></div>
          <p>{{ activeModule.description }}</p>
          <dl class="module-facts">
            <div><dt>数据类型</dt><dd>{{ activeModule.kind }}</dd></div>
            <div><dt>接入位置</dt><dd>服务端 {{ activeModule.label }} 数据源配置</dd></div>
            <div><dt>地图内容</dt><dd>{{ activeModule.mapLayer }}</dd></div>
          </dl>
          <p class="module-empty-note">此模块尚未接入数据源，当前没有可显示的{{ activeModule.kind }}。接收、解码及存储由后端提供。</p>
          <button class="secondary-button" @click="activeMenu = 'source'; sidebarOpen = true">查看接入说明</button>
        </section>
        <div class="map-controls">
          <div class="dimension-controls">
            <button :class="{ active: mapMode === '2D' }" @click="setMapMode('2D')">2D</button>
            <button :class="{ active: mapMode === '3D' }" @click="setMapMode('3D')">3D</button>
          </div>
          <div class="zoom-controls">
            <button aria-label="放大地图" title="放大" @click="zoomMap(1)">
              <airspace-icon name="plus" :size="19" />
            </button>
            <button aria-label="缩小地图" title="缩小" @click="zoomMap(-1)">
              <airspace-icon name="minus" :size="19" />
            </button>
          </div>
          <button class="map-icon-button" title="返回接收站视野" aria-label="返回接收站视野" @click="resetMap">
            <airspace-icon name="locate" :size="19" />
          </button>
          <div class="north-indicator">
            <airspace-icon name="compass" :size="25" />
            <span>N</span>
          </div>
        </div>
        <div v-if="activeDomain === 'adsb'" class="map-bottomline">
          <div class="map-legend">
            <span>
              <i class="legend-dot blue" />空中目标</span>
            <span>
              <i class="legend-dot selected" />选中目标</span>
            <span>
              <i class="legend-dot gray" />地面目标</span>
          </div>
          <span class="map-instruction">拖动平移 · 滚轮缩放 · 点击目标查看详情</span>
        </div>
        <transition name="detail-slide">
          <aircraft-detail v-if="activeDomain === 'adsb' && selectedAircraft" :aircraft="selectedAircraft" :following="following" @close="closeDetail" @follow="toggleFollow" @locate="$refs.map.focus(selectedId)" />
        </transition>
      </main>
    </div>

    <footer class="statusbar">
      <div class="status-left">
        <span class="status-indicator" :class="{ error: activeDomain === 'adsb' && dataState === 'error', muted: activeDomain !== 'adsb' }" />
        <span>{{ activeDomain === 'adsb' ? statusText : activeModule.label + ' · 未接入' }}</span>
        <template v-if="activeDomain === 'adsb'">
          <span class="status-divider" />
          <span>目标 {{ aircraft.length }}</span>
          <span>位置 {{ mappedCount }}</span>
          <span class="status-divider" />
          <span class="update-status">更新 {{ lastUpdateText }}</span>
        </template>
      </div>
      <div class="status-right">
        <span>服务 {{ backendText }} · 数据库 {{ databaseText }}</span>
        <span class="status-divider" />
        <span class="mono">{{ number(coordinate.lon, 4) }}° E&nbsp; {{ number(coordinate.lat, 4) }}° N</span>
        <span class="status-divider" />
        <span>WGS 84</span>
      </div>
    </footer>
    <transition name="toast">
      <div v-if="toastMessage" class="app-toast" role="status">{{ toastMessage }}</div>
    </transition>
    <div v-if="helpOpen" class="dialog-backdrop" @click.self="helpOpen = false">
      <section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div class="detail-heading">
          <h2 id="help-title">工作台使用说明</h2>
          <button class="icon-button" aria-label="关闭使用说明" @click="helpOpen = false">
            <airspace-icon name="close" :size="19" />
          </button>
        </div>
        <p>点击地图上的飞机，或左侧航空器列表，可打开目标详情。详情中的“跟随目标”让地图保持在目标位置。</p>
        <p>使用左侧图层管理切换航迹、标签和参考距离圈。右侧地图工具支持缩放、复位及二维 / 三维切换。</p>
        <p>ADS-B 的“数据接入”可保存接收机 IP 或主机名与 TCP 端口，默认端口为 30002。配置存储在后端数据库，后端解码后通过 WebSocket 推送航空器。</p>
        <p>业务域入口可切换 AIS、SSTV、气象卫星与卫星轨道。未接入的业务显示数据类型与接入说明，接入后才能查看目标或产品。</p>
        <p class="help-footnote">已保存并启用的接收源会自动连接。推送通道连接成功后，仍需等待 TCP 接收链路收到有效消息。可在图层管理中选择底图。</p>
        <button class="primary-button" @click="helpOpen = false">知道了</button>
      </section>
    </div>
  </div>
</template>

<script>
import AirspaceIcon from '@/components/Airspace/Icon'
import CesiumMap from '@/components/Airspace/CesiumMap'
import AircraftDetail from '@/components/Airspace/AircraftDetail'
import { normalizeFeed, updateTrails, formatNumber } from '@/utils/aircraft'
import { signalModules } from '@/modules/registry'
import { platformApi } from '@/services/http/api-client'
import { createPoller } from '@/services/polling/poller'
import { createRealtimeClient } from '@/services/realtime/client'
import { readPlatformState } from '@/services/platform'
import { getMapConfig } from '@/services/map/map-config'
import './airspace.scss'

const defaultReceiver = { name: '', lat: null, lon: null }
const sourceStates = ['unconfigured', 'disabled', 'connecting', 'waiting', 'connected', 'reconnecting', 'error']
function sourceSignature(source, persisted) {
  if (!source) return ''
  const station = source.station || {}
  return JSON.stringify([persisted, source.name, source.host, source.port, source.enabled, station.name, station.latitude, station.longitude])
}

export default {
  name: 'AirspaceWorkspace',
  components: { AirspaceIcon, CesiumMap, AircraftDetail },
  data() {
    const receiver = defaultReceiver
    const basemap = getMapConfig().defaultLayer
    const basemapOptions = [{ id: 'esri-satellite', label: 'Esri 卫星影像' }, { id: 'google-satellite', label: 'Google 卫星影像' }, { id: 'dark', label: 'CARTO 深色地图' }, { id: 'offline', label: '离线底图' }]
    return {
      activeMenu: 'overview', activeDomain: 'adsb', signalModules, sidebarOpen: true,
      menus: [{ id: 'overview', icon: 'overview', label: '态势总览' }, { id: 'aircraft', icon: 'plane', label: '航空器列表' }, { id: 'layers', icon: 'layers', label: '图层管理' }, { id: 'station', icon: 'station', label: '接收站' }],
      filters: [{ id: 'all', label: '全部' }, { id: 'airborne', label: '空中' }, { id: 'ground', label: '地面' }],
      aircraft: [], totalMessages: null, trails: {},
      selectedId: '', following: false, query: '', statusFilter: 'all',
      layers: { labels: true, tracks: true, coverage: true }, mapMode: '2D', mapReady: false,
      basemap, basemapOptions,
      basemapStatus: { ...basemapOptions.find(option => option.id === basemap), fallback: false },
      dataState: 'unconfigured',
      platformState: { backend: 'checking', modules: [], database: { status: 'checking' }, catalog: { status: 'checking' }, maps: null },
      sourceName: 'ADS-B TCP', sourceHost: '', sourcePort: 30002, sourceEnabled: true,
      sourceError: '', sourceLoadError: '', sourceLoadState: 'loading', sourcePersisted: false, sourceSaving: false,
      activeSource: null, sourceRevision: null, sourceConfigChanged: false,
      socketState: { state: 'stopped', connected: false, message: '推送通道未订阅' },
      sourceStatus: { state: 'unconfigured', connected: false, message: '', lastMessageAt: null }, receptionError: '',
      receiver: { ...receiver }, receiverDraft: { name: '', lat: '', lon: '' }, referencePositionAvailable: false,
      coordinate: { lat: receiver.lat, lon: receiver.lon },
      now: new Date(), lastUpdate: null, toastMessage: '', helpOpen: false
    }
  },
  computed: {
    backendText() { return ({ checking: '检查中', available: '在线', unavailable: '不可用' })[this.platformState.backend] || '未知' },
    databaseText() { return ({ checking: '检查中', available: '已连接', unavailable: '不可用', unconfigured: '未配置' })[this.platformState.database.status] || '未知' },
    catalogText() { return ({ checking: '检查中', ready: '已就绪', table_unconfigured: '待导入并配置', table_missing: '表不存在', column_mismatch: '字段待匹配', database_unconfigured: '数据库未配置', database_unavailable: '数据库不可用', unavailable: '未读取' })[this.platformState.catalog.status] || '未读取' },
    activeModule() { return this.signalModules.find(module => module.id === this.activeDomain) || this.signalModules[0] },
    availableMenus() { return this.activeDomain === 'adsb' ? this.menus : [{ id: 'overview', icon: 'overview', label: '模块状态' }, { id: 'layers', icon: 'layers', label: '图层管理' }] },
    selectedAircraft() { return this.aircraft.find(target => target.icao === this.selectedId) || null },
    mappedCount() { return this.aircraft.filter(target => target.hasPosition).length },
    airborneCount() { return this.aircraft.filter(target => !target.onGround).length },
    groundCount() { return this.aircraft.filter(target => target.onGround).length },
    filteredAircraft() {
      const query = this.query.trim().toUpperCase()
      return this.aircraft.filter(target => (!query || target.callsign.toUpperCase().includes(query) || target.icao.includes(query)) && (this.statusFilter === 'all' || (this.statusFilter === 'ground' ? target.onGround : !target.onGround)))
    },
    listedAircraft() { return this.activeMenu === 'overview' ? this.filteredAircraft.slice(0, 6) : this.filteredAircraft },
    clockText() { return this.now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) },
    lastUpdateText() { return this.lastUpdate ? this.lastUpdate.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) : '—' },
    sourceConfigText() { return this.sourceLoadState === 'loading' ? '正在读取数据库配置' : this.sourceLoadState === 'unread' ? '数据库配置未读取' : this.sourcePersisted ? '配置已保存到数据库' : '数据库尚无保存配置' },
    activeSourceText() { return this.activeSource ? `${this.activeSource.name || 'ADS-B TCP'} · ${this.activeSource.host}:${this.activeSource.port}` : '—' },
    socketText() { return ({ stopped: '未订阅', connecting: '连接中', connected: '已连接', reconnecting: '重连中', error: '连接异常' })[this.socketState.state] || '未连接' },
    receptionText() { return ({ live: '接收中', waiting: 'TCP 已连接，等待有效消息', connecting: 'TCP 连接中', reconnecting: 'TCP 重连中', disabled: '接收源已停用', unconfigured: '接收源未配置', error: '接收链路异常', disconnected: '等待推送恢复' })[this.dataState] || '等待接收源状态' },
    lastMessageText() {
      if (!this.sourceStatus.lastMessageAt) return '—'
      const date = new Date(this.sourceStatus.lastMessageAt)
      return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false })
    },
    statusText() { return `${this.receptionText} · 推送${this.socketText}` }
  },
  mounted() {
    this._sourceActive = true
    this._sourceGeneration = 0
    this._sourceReadAttempts = 0
    this._streamRevision = null
    this._realtime = createRealtimeClient({
      onMessage: payload => this.receiveLiveFeed(payload),
      onStatus: status => this.receiveSocketStatus(status)
    })
    this._platformPoller = createPoller({
      load: ({ signal }) => readPlatformState(signal),
      onData: state => { this.platformState = state },
      intervalMs: 15000
    })
    this.loadSource()
    this._platformPoller.start()
    this._clockTimer = setInterval(() => { this.now = new Date() }, 1000)
    window.addEventListener('keydown', this.onKeydown)
  },
  beforeDestroy() {
    this._sourceActive = false
    this._sourceGeneration++
    this.cancelSourceRetry()
    if (this._sourceReadController) this._sourceReadController.abort()
    if (this._sourceSaveController) this._sourceSaveController.abort()
    this.stopFeed()
    this._platformPoller.stop()
    clearInterval(this._clockTimer)
    clearTimeout(this._toastTimer)
    window.removeEventListener('keydown', this.onKeydown)
  },
  methods: {
    number: formatNumber,
    moduleState(id) {
      if (id === 'adsb') return ({ live: '接收', waiting: '等待', connecting: '连接中', reconnecting: '重连', disabled: '停用', unconfigured: '未配置', disconnected: '重连', error: '异常' })[this.dataState] || '等待'
      const module = this.platformState.modules.find(item => item.id === id)
      return module && module.status === 'unavailable' ? '异常' : module && module.status === 'configured' ? '已配置' : '未接入'
    },
    selectDomain(id) {
      if (!this.signalModules.some(module => module.id === id)) return
      this.closeDetail()
      this.activeDomain = id
      this.activeMenu = 'overview'
      this.sidebarOpen = true
    },
    onKeydown(event) { if (event.key === 'Escape') { this.helpOpen = false; this.closeDetail() } },
    selectAircraft(id) {
      if (this.activeDomain !== 'adsb') return
      if (this.selectedId !== id) { this.following = false; this.$refs.map.follow(false) }
      this.selectedId = id
    },
    closeDetail() { this.following = false; this.selectedId = ''; if (this.$refs.map) this.$refs.map.follow(false) },
    toggleFollow() { this.following = !this.following; this.$refs.map.follow(this.following) },
    stopFollowing() { this.following = false; this.$refs.map.follow(false) },
    zoomMap(direction) { this.stopFollowing(); this.$refs.map.zoom(direction) },
    resetMap() { this.stopFollowing(); this.$refs.map.reset() },
    onMapReady() { this.mapReady = true; if (this.mapMode === '3D') this.$refs.map.setMode(this.mapMode) },
    setMapMode(mode) { this.mapMode = mode; this.$refs.map.setMode(mode) },
    showToast(message) { this.toastMessage = message; clearTimeout(this._toastTimer); this._toastTimer = setTimeout(() => { this.toastMessage = '' }, 3200) },
    async toggleFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else if (this.$el.requestFullscreen) await this.$el.requestFullscreen()
        else this.showToast('当前浏览器不支持全屏显示')
      } catch (error) { this.showToast('无法进入全屏，请检查浏览器设置') }
    },
    acceptFeed(feed) {
      this.trails = updateTrails(this.trails, feed.aircraft)
      this.aircraft = feed.aircraft
      this.totalMessages = feed.messages
      this.lastUpdate = feed.timestamp == null ? new Date() : new Date(feed.timestamp * 1000)
      if (this.selectedId && !this.selectedAircraft) this.closeDetail()
      if (this.following && this.selectedAircraft && !this.selectedAircraft.hasPosition) this.stopFollowing()
    },
    stopFeed() {
      if (this._realtime) this._realtime.stop()
    },
    readSourcePackage(payload) {
      if (!payload || !payload.source || typeof payload.persisted !== 'boolean') throw new Error('后端返回的接收源配置无效')
      const { source, status } = payload
      const station = source.station
      if (typeof source.host !== 'string' || !Number.isInteger(source.port) || source.port < 1 || source.port > 65535 || typeof source.enabled !== 'boolean' || !station || typeof station !== 'object') throw new Error('后端返回的接收源配置无效')
      if (!status || !sourceStates.includes(status.state) || typeof status.connected !== 'boolean') throw new Error('后端返回的接收链路状态无效')
      if ((station.latitude != null && (!Number.isFinite(station.latitude) || Math.abs(station.latitude) > 90)) || (station.longitude != null && (!Number.isFinite(station.longitude) || Math.abs(station.longitude) > 180))) throw new Error('后端返回的站点坐标无效')
      if (payload.revision != null && (!Number.isSafeInteger(payload.revision) || payload.revision < 0)) throw new Error('后端返回的接收源版本无效')
      return payload
    },
    installSource(payload) {
      const source = payload.source
      this.sourceName = source.name || 'ADS-B TCP'
      this.sourceHost = source.host || ''
      this.sourcePort = source.port || 30002
      this.sourceEnabled = payload.persisted ? source.enabled === true : true
      this.sourcePersisted = payload.persisted
      this.sourceLoadState = 'loaded'
      this.sourceLoadError = ''
      this.sourceConfigChanged = false
      this.cancelSourceRetry()
      const station = payload.persisted && source.station || {}
      this.receiverDraft = { name: station.name || '', lat: station.latitude == null ? '' : station.latitude, lon: station.longitude == null ? '' : station.longitude }
    },
    async loadSource() {
      const generation = this._sourceGeneration
      this._sourceReadController = typeof AbortController === 'undefined' ? null : new AbortController()
      try {
        const payload = this.readSourcePackage(await platformApi.get('adsb/source', { signal: this._sourceReadController && this._sourceReadController.signal }))
        if (!this._sourceActive || generation !== this._sourceGeneration) return
        this.installSource(payload)
        this.startLive(payload)
      } catch (error) {
        if (!this._sourceActive || generation !== this._sourceGeneration) return
        this.sourceLoadState = 'unread'
        this.sourcePersisted = false
        this.sourceLoadError = `未读取数据库配置：${error.message || '请求失败'}`
        this.scheduleSourceRetry(generation)
      }
    },
    cancelSourceRetry() {
      clearTimeout(this._sourceRetryTimer)
      this._sourceRetryTimer = null
      this._sourceReadAttempts = 0
    },
    scheduleSourceRetry(generation) {
      if (!this._sourceActive || generation !== this._sourceGeneration || this._sourceRetryTimer) return
      const retryInMs = Math.min(1000 * Math.pow(2, Math.min(this._sourceReadAttempts++, 5)), 30000)
      this._sourceRetryTimer = setTimeout(() => {
        this._sourceRetryTimer = null
        if (this._sourceActive && generation === this._sourceGeneration) this.loadSource()
      }, retryInMs)
    },
    supersedeSourceRead() {
      this._sourceGeneration++
      this.cancelSourceRetry()
      if (this.sourceLoadState === 'loading') {
        this.sourceLoadState = 'unread'
        if (this._sourceReadController) this._sourceReadController.abort()
      }
      return this._sourceGeneration
    },
    async applySource() {
      const empty = value => value === '' || value == null
      const optionalPosition = empty(this.receiverDraft.lat) && empty(this.receiverDraft.lon)
      const lat = empty(this.receiverDraft.lat) ? NaN : Number(this.receiverDraft.lat)
      const lon = empty(this.receiverDraft.lon) ? NaN : Number(this.receiverDraft.lon)
      if (!optionalPosition && (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) { this.sourceError = '请输入有效的经纬度，或同时留空'; return }
      const host = String(this.sourceHost).trim()
      const port = Number(this.sourcePort)
      if (!host || !/^[a-z\d.:[\]_-]+$/i.test(host)) { this.sourceError = '请输入有效的 IP 地址或主机名'; return }
      if (!Number.isInteger(port) || port < 1 || port > 65535) { this.sourceError = 'TCP 端口必须为 1 到 65535 的整数'; return }
      if (this.sourceSaving) return
      const generation = this.supersedeSourceRead()
      const source = { name: this.sourceName || 'ADS-B TCP', host, port, enabled: this.sourceEnabled, station: { name: this.receiverDraft.name || '接收站', latitude: optionalPosition ? null : lat, longitude: optionalPosition ? null : lon }}
      this.sourceSaving = true
      this.sourceError = ''
      this.toastMessage = ''
      this._sourceSaveController = typeof AbortController === 'undefined' ? null : new AbortController()
      try {
        const payload = this.readSourcePackage(await platformApi.put('adsb/source', source, { signal: this._sourceSaveController && this._sourceSaveController.signal }))
        if (!payload.persisted) throw new Error('接收源配置未保存到数据库')
        if (!this._sourceActive || generation !== this._sourceGeneration) return
        this.installSource(payload)
        this.startLive(payload)
        this.showToast(source.enabled ? '配置已保存，正在连接接收源' : '配置已保存，接收源已停用')
      } catch (error) {
        if (this._sourceActive && generation === this._sourceGeneration) {
          this.sourceError = `保存失败：${error.message || '请求失败'}`
          if (this.sourceLoadState === 'unread' && !this.activeSource) this.scheduleSourceRetry(generation)
        }
      } finally { if (this._sourceActive) this.sourceSaving = false }
    },
    clearLiveTargets() {
      this.aircraft = []
      this.trails = {}
      this.totalMessages = null
      this.lastUpdate = null
      this.closeDetail()
    },
    startLive(payload) {
      this.sourceError = ''
      this.receptionError = ''
      const changed = this.activateSource(payload)
      if (changed) this.clearLiveTargets()
      if (payload.revision != null && this.socketState.connected) this._streamRevision = payload.revision
      this._realtime.start()
      this.receiveSourceStatus(payload.status)
      if (!['live', 'waiting'].includes(this.dataState)) this.clearLiveTargets()
    },
    activateSource(payload) {
      const changed = sourceSignature(this.activeSource, this.sourcePersisted) !== sourceSignature(payload.source, payload.persisted)
      this.activeSource = { ...payload.source, station: { ...payload.source.station }}
      this.sourcePersisted = payload.persisted
      if (payload.revision != null) this.sourceRevision = payload.revision
      const station = payload.source.station || {}
      this.referencePositionAvailable = payload.persisted && Number.isFinite(station.latitude) && Number.isFinite(station.longitude) && Math.abs(station.latitude) <= 90 && Math.abs(station.longitude) <= 180
      this.receiver = this.referencePositionAvailable ? { name: station.name || '参考接收站', lat: station.latitude, lon: station.longitude } : { ...defaultReceiver, name: '未设置参考位置' }
      return changed
    },
    receiveSocketStatus(status) {
      this.socketState = status
      if (status.connected) this._streamRevision = null
      if (!this._sourceActive) return
      if (!status.connected && status.state !== 'stopped') {
        if (!['disabled', 'unconfigured'].includes(this.dataState)) this.dataState = status.state === 'connecting' ? 'connecting' : 'disconnected'
        this.receptionError = ['reconnecting', 'error'].includes(status.state) ? status.message || '' : ''
        this.clearLiveTargets()
      }
    },
    receiveSourceStatus(status) {
      if (!status || !sourceStates.includes(status.state) || typeof status.connected !== 'boolean') throw new Error('后端接收链路状态无效')
      this.sourceStatus = status
      this.dataState = status.state === 'connected' && status.connected ? 'live' : status.state === 'connected' ? 'error' : status.state
      this.receptionError = ['error', 'reconnecting'].includes(status.state) ? status.message || this.receptionText : ''
    },
    receiveLiveFeed(payload) {
      if (!this._sourceActive || !payload || payload.type !== 'adsb.snapshot') return
      try {
        const data = payload.data
        if (data && data.source) {
          const sourcePayload = this.readSourcePackage(data)
          if (sourcePayload.revision != null && this._streamRevision != null && sourcePayload.revision < this._streamRevision) return
          if (sourcePayload.revision !== this._streamRevision || sourceSignature(this.activeSource, this.sourcePersisted) !== sourceSignature(sourcePayload.source, sourcePayload.persisted)) {
            const changed = this.activateSource(sourcePayload)
            if (changed) { this.clearLiveTargets(); this.sourceConfigChanged = true }
          }
          if (sourcePayload.revision != null) this._streamRevision = sourcePayload.revision
        }
        this.receiveSourceStatus(payload.data && payload.data.status)
        if (!['live', 'waiting'].includes(this.dataState)) { this.clearLiveTargets(); return }
        this.acceptFeed(normalizeFeed(payload.data.snapshot))
      } catch (error) {
        this.dataState = 'error'
        this.receptionError = error.message || '推送数据无效'
        this.clearLiveTargets()
      }
    }
  }
}
</script>
