<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="(path, index) in paths" :key="index" :d="path" />
  </svg>
</template>

<script>
const icons = {
  radar: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 12l7-7', 'M12 12h.01'],
  overview: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  plane: ['M12 2l2 7 7 5v2l-7-2-1 5 3 2v1l-4-1-4 1v-1l3-2-1-5-7 2v-2l7-5z'],
  ship: ['M5 14l7-3 7 3-3 5H8z', 'M8 13V7h8v6M12 7V3M3 21l3-1 3 1 3-1 3 1 3-1 3 1'],
  image: ['M3 4h18v16H3z', 'M3 16l5-5 4 4 3-3 6 5M16 8h.01'],
  weather: ['M6 16a4 4 0 1 1 2-7 5 5 0 0 1 9 3 3 3 0 1 1 0 6H6', 'M10 2v2M3 6l2 1M16 4l-1 2M8 20v2M14 20v2'],
  satellite: ['M10 8l6 6-3 3-6-6z', 'M13 5l4-4 6 6-4 4M5 13l-4 4 6 6 4-4M16 15l4 4M15 20a5 5 0 0 0 5-5'],
  layers: ['M12 3l10 5-10 5L2 8z', 'M2 12l10 5 10-5M2 16l10 5 10-5'],
  station: ['M12 12v10M7 22h10M9 9a4 4 0 0 1 6 0M5 5a10 10 0 0 1 14 0', 'M12 12h.01'],
  search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'M16 16l5 5'],
  chevron: ['M9 5l7 7-7 7'],
  close: ['M6 6l12 12M18 6L6 18'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  locate: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v3M12 19v3M2 12h3M19 12h3', 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14'],
  globe: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M2 12h20M12 2a20 20 0 0 1 0 20 20 20 0 0 1 0-20'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
  arrow: ['M5 12h14M14 7l5 5-5 5'],
  expand: ['M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6M12 7h.01'],
  check: ['M5 12l4 4L19 6'],
  refresh: ['M20 7v5h-5M4 17v-5h5', 'M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1'],
  signal: ['M4 19v-3M9 19v-7M14 19V8M19 19V4'],
  settings: ['M4 7h16M4 17h16M8 4v6M16 14v6'],
  compass: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M16 8l-2 6-6 2 2-6z'],
  menu: ['M4 6h16M4 12h16M4 18h16']
}
export default {
  name: 'AirspaceIcon',
  props: { name: { type: String, required: true }, size: { type: [Number, String], default: 20 }},
  computed: { paths() { return icons[this.name] || icons.info } }
}
</script>
