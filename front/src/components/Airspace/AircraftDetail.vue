<template>
  <aside class="aircraft-detail" aria-label="航空器详情">
    <div class="detail-heading">
      <span>航空器详情</span>
      <button class="icon-button" aria-label="关闭详情" @click="$emit('close')">
        <airspace-icon name="close" :size="18" />
      </button>
    </div>
    <div class="detail-identity">
      <div class="aircraft-symbol">
        <airspace-icon name="plane" :size="34" />
      </div>
      <div>
        <div class="detail-source">{{ aircraft.source }} · 接收目标</div>
        <h2>{{ aircraft.callsign }}</h2>
        <span class="mono detail-icao">ICAO {{ aircraft.icao }}</span>
      </div>
    </div>
    <div v-if="aircraft.emergency" class="detail-warning">应急状态：{{ aircraft.emergency }}</div>
    <div class="flight-state">
      <span class="state-dot" :class="{ muted: aircraft.stale }" />{{ aircraft.stale ? '信号过期' : aircraft.onGround ? '地面滑行' : '空中飞行' }}<span class="flight-state-right">{{ aircraft.hasPosition ? '位置有效' : '无有效位置' }}</span>
    </div>
    <div class="telemetry-grid">
      <div>
        <label>气压高度</label>
        <strong>{{ number(aircraft.altitude) }}<small>ft</small>
        </strong>
        <span>{{ aircraft.altitude == null ? '—' : number(aircraft.altitude * 0.3048) + ' m' }}</span>
      </div>
      <div>
        <label>地速</label>
        <strong>{{ number(aircraft.speed) }}<small>kt</small>
        </strong>
        <span>{{ aircraft.speed == null ? '—' : number(aircraft.speed * 1.852) + ' km/h' }}</span>
      </div>
      <div>
        <label>航向</label>
        <strong>{{ number(aircraft.heading) }}<small>°</small>
        </strong>
        <span>地面航迹方向</span>
      </div>
      <div>
        <label>垂直速率</label>
        <strong>{{ number(aircraft.verticalRate) }}<small>ft/min</small>
        </strong>
        <span>{{ verticalState }}</span>
      </div>
    </div>
    <section class="detail-section">
      <h3>位置与识别 <airspace-icon name="locate" :size="15" />
      </h3>
      <dl>
        <div>
          <dt>纬度</dt>
          <dd>{{ number(aircraft.latitude, 5) }}<small v-if="aircraft.latitude != null">°</small>
          </dd>
        </div>
        <div>
          <dt>经度</dt>
          <dd>{{ number(aircraft.longitude, 5) }}<small v-if="aircraft.longitude != null">°</small>
          </dd>
        </div>
        <div>
          <dt>应答机代码</dt>
          <dd>{{ aircraft.squawk || '—' }}</dd>
        </div>
        <div>
          <dt>目标类别</dt>
          <dd>{{ aircraft.category || '—' }}</dd>
        </div>
      </dl>
    </section>
    <section class="detail-section">
      <h3>接收信息 <airspace-icon name="signal" :size="15" />
      </h3>
      <dl>
        <div>
          <dt>信号强度</dt>
          <dd>{{ number(aircraft.rssi, 1) }} <small>dBFS</small>
          </dd>
        </div>
        <div>
          <dt>累计消息</dt>
          <dd>{{ number(aircraft.messages) }}</dd>
        </div>
        <div>
          <dt>消息更新于</dt>
          <dd>{{ number(aircraft.seen, 1) }} <small>秒前</small>
          </dd>
        </div>
        <div>
          <dt>位置更新于</dt>
          <dd>{{ number(aircraft.positionAge, 1) }} <small>秒前</small>
          </dd>
        </div>
      </dl>
    </section>
    <div class="detail-actions">
      <button class="primary-button" :disabled="!aircraft.hasPosition" :class="{ 'is-following': following }" @click="$emit('follow')">
        <airspace-icon name="locate" :size="16" />{{ following ? '停止跟随' : '跟随目标' }}</button>
      <button class="secondary-button" :disabled="!aircraft.hasPosition" @click="$emit('locate')">地图定位</button>
    </div>
    <p class="detail-note">数据来自接收站，未知字段保留为空。</p>
  </aside>
</template>

<script>
import AirspaceIcon from './Icon'
import { formatNumber } from '@/utils/aircraft'
export default {
  name: 'AircraftDetail',
  components: { AirspaceIcon },
  props: { aircraft: { type: Object, required: true }, following: Boolean },
  computed: {
    verticalState() {
      const rate = this.aircraft.verticalRate
      return rate == null ? '—' : rate > 0 ? '爬升' : rate < 0 ? '下降' : '平飞'
    }
  },
  methods: { number: formatNumber }
}
</script>
