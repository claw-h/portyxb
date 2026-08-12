# Architectural Master Reference & Strict Knowledge Base (portyxb)

This document is the Single Source of Truth (SSOT) for the `portyxb` project. It absorbs and replaces all previous context dumps (`CALLS_AND_FLOWS.md`, `PIPELINE_AND_DEPLOYMENT.md`), correcting outdated information and establishing strict performance paradigms.

## The Scrutiny Rubric
All subsystems and methods in this codebase are evaluated against the following strict WebGL & SSR performance rules:

1. **Memory & Garbage Collection Resilience:**
   - **Rule:** All dynamically allocated WebGL resources (`WebGLRenderer`, `EffectComposer`, `BufferGeometry`, `ShaderMaterial`, `CanvasTexture`) MUST be explicitly `.dispose()`d within a subsystem's `destroy()` lifecycle method.
   - **Rule:** Initialization routines MUST be guarded via asynchronous boolean locks (e.g., `isInitializing`, `dossierInit`) to prevent race conditions from `IntersectionObserver` triggers resulting in massive VRAM accumulation.
2. **Render Loop Efficiency (The `rAF` Rule):**
   - **Rule:** `requestAnimationFrame` loops MUST be wrapped in `LoopController` instances that automatically suspend execution when the canvas leaves the viewport.
   - **Rule:** ZERO object allocation inside render loops. Temporary vectors and matrices must be hoisted and updated via `.copy()` or `.lerp()`.
3. **Thread Offloading & Concurrency:**
   - **Rule:** Intensive geometric computations (e.g., mesh slicing) MUST be offloaded to Web Workers using `Transferable Objects` (`Float32Array` buffers) to prevent main-thread blocking during boot.
4. **Decoupled Inter-System Communication:**
   - **Rule:** Scenes and DOM UI elements MUST NOT be tightly coupled. Communication must flow exclusively through decoupled event buses (e.g., `hoverTargets.ts`, `loadState.ts`) or centralized scroll broadcasts.

---

## 1. Executive Architectural Summary & Deployment Pipeline

The application is built on **Astro** configured for Server-Side Rendering (SSR) using the `@astrojs/node` standalone adapter. The client runtime combines hardware-accelerated **Three.js (WebGL)** 3D scenes, 2D HTML5 canvas particle engines, Web Audio API synthesis, offscreen Web Worker geometry slicing, and a custom telemetry UI engine.

### Platform Constraints
- **Desktop-Only:** There is NO mobile version of this site. Requests originating from mobile user-agents or small screen widths are redirected to a static `[Open on Desktop]` fallback page.

### Asset Pipeline & Optimization
- **Meshopt Compression:** Retopologized `.glb` models MUST be heavily compressed using `meshoptimizer` to drastically reduce network payload sizes.
- **Server Architecture:** 
  - *Option A (Recommended):* Containerized Cloud Deployment (Dockerized `node:20-alpine` on Google Cloud Run/Railway) behind a CDN (Cloudflare) to cache heavy `.glb` assets and fonts.
  - *Option B:* Managed Edge / Serverless (Vercel/Netlify). Swap `@astrojs/node` for `@astrojs/vercel`. Note: Execution time limits apply.

---

## 2. Macro Topology & System Boot Sequence

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              SERVER RUNTIME (Node.js / Cloud Run)                      │
│  • Entrypoint: Astro SSR Adapter (@astrojs/node)                                       │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT RUNTIME (Browser / WebGL)                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│ │                                  READINESS GATE                                    │ │
│ │ • src/utils/loadState.ts                                                           │ │
│ │ • Slots: 'fonts' | 'heart' | 'dream' | 'minSplash'                                 │ │
│ └─────────────────────────┬──────────────────────────────────┬───────────────────────┘ │
│                           │                                  │                         │
│                           ▼                                  ▼                         │
│ ┌───────────────────────────────────┐              ┌─────────────────────────────────┐ │
│ │       SMOOTH SCROLL ENGINE        │              │     CURSOR & RETICLE SYSTEM     │ │
│ │ • Lenis Smooth Scroll             │              │ • CursorController.ts           │ │
│ │ • Broadcasts Velocity & Progress  │              │ • Focal text & hover states     │ │
│ └─────────────────┬─────────────────┘              └────────────────┬────────────────┘ │
│                   │                                                 │                  │
│                   ├─────────────────────────┬───────────────────────┤                  │
│                   ▼                         ▼                       ▼                  │
│ ┌───────────────────────────┐ ┌───────────────────────────┐ ┌────────────────────────┐ │
│ │        SCENE 1            │ │        SCENE 2            │ │        SCENE 3         │ │
│ │      HeartScene           │ │      DreamCanvas          │ │      DossierScene      │ │
│ │ • WebGL Volumetric Slice  │ │ • Staircase Triptych      │ │ • Dynamic 3D Book      │ │
│ │ • heartWorker.ts Thread   │ │ • Offscreen Glyph Engine  │ │ • Offscreen CanvasTex  │ │
│ │ • Web Audio Synth Engine  │ │ • Custom Lens Shader      │ │ • Procedural Materials │ │
│ └───────────────────────────┘ └───────────────────────────┘ └────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### The 5-Stage Boot Protocol
1. **Server Side Render:** `Layout.astro` and `index.astro` generate the HTML shell.
2. **DOM Mount & Script Init:** `Lenis` smooth scroll engine and `setupCursor()` initialized.
3. **Asset Fetch & Readiness Gate (`loadState.ts`):** 4 slots must resolve independently.
   - `document.fonts.ready` -> `markReady('fonts')`
   - `setTimeout(500)` -> `markReady('minSplash')`
   - `heartWorker` slicing done -> `markReady('heart')`
   - `staircase` mesh loaded -> `markReady('dream')`
4. **Preloader Power-Down:** CRT collapse animation triggers, overlay fades.
5. **Unlock & Active Render Loops:** Reticle smooth tracking begins. `IntersectionObservers` observe `.canvas-zone`s and spin up WebGL render cycles.

---

## 3. Decoupled Communication Buses

### Readiness State Gate (`src/utils/loadState.ts`)
Controls system initialization via exactly 4 independent asynchronous system slots (`ReadyKey = 'fonts' | 'heart' | 'dream' | 'minSplash'`). `markReady()` increments the count; `onReady()` executes callbacks when fully resolved.

### Hover Target Bus (`src/utils/hoverTargets.ts`)
Decouples 3D WebGL raycasters from UI cursor styles (`HoverTargetId = 'heart' | 'staircase'`). Raycasting logic in scenes calls `setHoverTarget()`, which `CursorController` subscribes to for dynamic reticle updating.

### Scroll Broadcast Bridge
`index.astro` hooks into `Lenis` scroll updates and distributes parameters to specific scenes:
- `setDreamScrollVelocity` / `setDreamScrollProgress`
- `setDossierScrollProgress` (Replaced the deprecated `BiomeSphere` updates).

---

## 4. Micro-Architectures & Shader Mechanics

### 4.1 Heart Scene (`src/scenes/HeartScene.ts`)
- **Offscreen Geometry Slicer:** Fetches GLTF geometry, extracts raw `Float32Array` buffers (positions/normals), and offloads them to `heartWorker.ts`. The worker divides the geometry into 5 parallel slices and builds edge segments, passing buffers back.
- **Volumetric Spot Shader:** Injects custom shader logic into `MeshPhysicalMaterial` via `onBeforeCompile`, utilizing `uScannerPos` and `uScannerRadius` to illuminate rims dynamically based on mouse intersection.
- **Web Audio Synth:** Dynamically modulates `OscillatorNode` (45Hz Sawtooth, 70Hz Sine) gain and `BiquadFilter` frequency based on scroll interpolation (`evaluateScrollState`).
- **Telemetry Engine:** `PanelManager` maps screen-space positions of 3D meshes to absolutely positioned `.panel` DOM elements for floating diagnostics.

### 4.2 Dream Canvas (`src/scenes/DreamCanvas.ts`)
- **Staircase Triptych:** Instantiates three meshes (Hero, Left Puddle, Right Puddle). The puddles are inverted `(-1)` on axes to create physically mirrored geometries.
- **Offscreen Glyph Engine:** Uses `OffscreenCanvas` and `getImageData` to read alpha pixels from rendered typography. Spawns `GlyphParticle` physics instances simulating spring return ($F = kx$), momentum ($V_{new} = (V + F) \times \text{friction}$), and radial mouse repulsion.
- **Custom Lens Composer:** Utilizes `EffectComposer` with a bespoke fisheye distortion pass. Evaluates $r' = r + r^3 \times \text{uFisheye}$, applying offset sampling for chromatic aberration and vertical UV shifting for motion blur (`uMotionBlur`).

### 4.3 Dossier Scene (`src/controllers/DossierScene.ts`) (Replaces BiomeSphere/VoidCanvas)
- **Procedural 3D Book Generation:** `DossierGeometry.ts` mathematically generates 19 animated pages with distinct bounding geometry, spine offsets, and edge highlighting meshes.
- **Dynamic Project Texturing:** `DossierPageContent.ts` creates high-resolution offscreen HTML5 canvases for `textTex` and `geomTex`, mapped onto the pages via `CanvasTexture` (with anisotropic filtering). 
- **Strict Memory Disposal:** Because `CanvasTexture` creates raw VRAM blobs mapped to JS references, the `dossierScene.destroy()` method strictly iterates over `allPages` and `hitboxes`, calling `.dispose()` on all internal `THREE.MeshPhysicalMaterial`s, `geometry` instances, and `texture.map` resources to prevent VRAM memory leaks during Astro View Transitions.

---

## 5. Comprehensive API & Function Call Matrix

*(Note: Archived systems like `BiomeSphere` and `VoidCanvas` have been stripped from this registry.)*

| Function / Method | Source Module | Caller Location | Parameters | Return Type | Architectural Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `markReady(key)` | `loadState.ts` | `HeartScene.ts`, `DreamCanvas.ts`, `index.astro` | `key`: `ReadyKey` | `void` | Increments readiness gate. |
| `onReady(fn)` | `loadState.ts` | `Preloader.astro` | `fn`: `() => void` | `Unsubscribe` | Triggers power-down animation. |
| `setHoverTarget(id, isOver)` | `hoverTargets.ts` | `HeartScene`, `DreamCanvas` | `id`, `boolean` | `void` | Updates central hover state. |
| `setupCursor()` | `CursorController.ts` | `index.astro` | None | `{ destroy: () => void }` | Binds pointer HUD, locks reticle. |
| `setupHeartScene()` | `HeartScene.ts` | `index.astro` | None | `{ render, destroy }` | Mounts 3D Heart, worker slicing, synth. |
| `setupDreamCanvas()` | `DreamCanvas.ts` | `index.astro` | None | `{ render, destroy }` | Mounts Staircase, offscreen typography. |
| `setupDossierScene()` | `DossierScene.ts` | `index.astro` | None | `{ destroy }` | Mounts 3D Book Portfolio. Creates VRAM resources requiring precise disposal. |
| `createProjectTexture()`| `DossierPageContent.ts`| `DossierScene.ts` | `Project`, `Category`, `w`, `h` | `{ textTex, geomTex }` | Draws text to canvas -> returns `THREE.CanvasTexture`. |
| `createLoopController()` | `canvas.ts` | `DreamCanvas.ts` | `Element`, `render` | `LoopController` | Wraps rendering loop in `IntersectionObserver` pause guard. |
| `PanelManager.update()` | `PanelManager.ts` | `HeartScene.ts` | `id`, `payload` | `void` | Syncs DOM panel opacity/rotation. |
