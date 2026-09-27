# Map services

`loadCesium()` loads the configured runtime once, with a ten second timeout.
Failed loads remove their script element and can be retried. `createCesiumLoader`
accepts browser, document, baseUrl and timeoutMs for other hosts and tests.

`getMapConfig()` reads the Vue CLI environment variables for the default layer,
Cesium directory, offline imagery, Esri/CARTO tile templates and Google proxy
paths. Blank values retain the existing defaults. `VUE_APP_CESIUM_BASE_URL`
defaults to `BASE_URL + cesium/`; `VUE_APP_MAP_OFFLINE_URL` defaults to the
Natural Earth texture directory under that Cesium directory. Injected `baseUrl`
options retain the deployment-base behavior used by hosts and tests. An unknown
`VUE_APP_MAP_DEFAULT_LAYER` falls back to `esri-satellite`.

`createImageryRegistry()` provides `offline`, `esri-satellite`, `google-satellite`
and `dark`. Use `register({ id, label, create })` to add a provider. `create(context)`
may be asynchronous and returns `{ provider, attach?, dispose? }`. The context
includes Cesium (`C`), viewer, AbortSignal and `onFatalError(error)` for failures
that need a fallback. `attach` runs only after a visible tile has been verified;
`dispose` cleans subscriptions and auxiliary resources, including stale providers.
Registration returns an unregister callback.

`createImageryLayerManager({ C, viewer, registry, onChange, onError })` owns
imagery layers and removable event listeners. Call `initialize()` for the local
Natural Earth underlay, then `setBasemap(id)`. Online providers must produce a
tile for the current camera viewport before they are displayed. A failed provider
falls back to Esri and then the local underlay; Esri failure goes directly local.
Three consecutive tile errors trigger one fallback, and a successful tile resets
the error count. Selecting a new map removes the previous online layer and
invalidates pending work. Call `destroy()` before destroying the viewer.

`onChange` receives `{ id, label, fallback }` for the map actually displayed.
`onError` receives one readable message per failed attempt. Local maps shown
temporarily while an online map loads are reported as `fallback: false`.

Google tiles use `VUE_APP_MAP_GOOGLE_TILES_PATH` (default
`maps/google/tiles/{z}/{x}/{y}`). Google's viewport metadata uses
`VUE_APP_MAP_GOOGLE_VIEWPORT_PATH` (default `maps/google/viewport`) with zoom, north,
south, east and west from `camera.computeViewRectangle()`. The response must be
`{ ok: true, data: { copyright, maxZoomRects? } }`. Copyright is escaped before
it is added as an on-screen Cesium credit. Camera movement refreshes it; failed
current requests trigger fallback. Keys and Google sessions stay on the server.
Google imagery currently caps requests at zoom 19. The official logo remains
separate from Cesium's logo and all data credits stay visible.
Both relative proxy paths use `VUE_APP_API_BASE_URL` (default `/api/v1`). Tile
template placeholders remain intact when the API base and path are joined.

These services only manage imagery. Application entities and future AIS or
satellite data layers can use Cesium data sources independently of basemap
selection. A future data-layer manager can follow the same async create/attach/
dispose lifecycle without coupling it to airspace state.
