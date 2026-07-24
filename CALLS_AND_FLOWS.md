# Comprehensive Architectural Master Reference: Calls & Flows

This document serves as the single source of truth for the technical architecture, execution flows, function call graphs, inter-module communication protocols, shader pipelines, and low-level subsystem designs of the portfolio application.

---

## 1. Executive Architectural Summary

The application is built on **Astro** configured for Server-Side Rendering (SSR) using the `@astrojs/node` standalone adapter. The client runtime combines hardware-accelerated **Three.js (WebGL)** 3D scenes, 2D HTML5 canvas particle engines, Web Audio API synthesis, offscreen Web Worker geometry slicing, and a custom telemetry UI engine.

### Key Architectural Characteristics
- **Hybrid SSR & Client Mounting**: HTML layout and initial UI shells are generated server-side. High-performance canvases, audio nodes, and 3D scenes mount lazily on the client upon DOM instantiation.
- **Multithreaded Geometry Slicing**: Complex 3D mesh slicing for the Hero Heart scene is offloaded to a background `Worker` (`heartWorker.ts`) to maintain 60 FPS on the main UI thread during load.
- **Decoupled Event & State Bus**: Inter-scene communication (e.g., raycaster hover detections, system readiness states, scroll velocity updates) operates via dedicated event buses (`hoverTargets.ts`, `loadState.ts`, custom DOM events) rather than direct tight coupling.
- **IntersectionObserver Resource Management**: Canvas rendering loops are wrapped in `LoopController` instances that automatically suspend `requestAnimationFrame` cycles when sections scroll out of the viewport.

---

## 2. Macro Topology & System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              SERVER RUNTIME (Node.js / Cloud Run)                      │
│  • Entrypoint: Astro SSR Adapter (@astrojs/node)                                      │
│  • Host/Port: 0.0.0.0:3000 (Nginx Reverse Proxy Target)                                │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                  Serves HTML / Assets
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
│ │      HeartScene           │ │      DreamCanvas          │ │      BiomeSphere       │ │
│ │ • WebGL Volumetric Slice  │ │ • Staircase Triptych      │ │ • Curved Non-Euclid    │ │
│ │ • heartWorker.ts Thread   │ │ • Offscreen Glyph Engine  │ │ • Camera FOV Expansion │ │
│ │ • Web Audio Synth Engine  │ │ • Custom Lens Shader      │ │ • Flash Event Trans.   │ │
│ │ • Telemetry UI Panel      │ │                           │ │                        │ │
│ └─────────────┬─────────────┘ └─────────────┬─────────────┘ └───────────┬────────────┘ │
│               │                             │                           │              │
│               └─────────────────────────────┼───────────────────────────┘              │
│                                             ▼                                          │
│ ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│ │                                  SCENE 4: VOID CANVAS                              │ │
│ │ • 2D Canvas Procedural Starfield & Phosphor Radial Aura                            │ │
│ │ • LoopController IntersectionObserver Pause / Resume Engine                        │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. System Lifecycle & Boot Sequence

The system boots through five deterministic execution stages from server response to full client interaction unlock:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: SERVER SIDE RENDER                                                            │
│ • Layout.astro renders document shell & injects window.__NEURAL_STATE                  │
│ • index.astro builds page layout, canvas targets, and preloader HTML                   │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: DOM MOUNT & SCRIPT INITIALIZATION                                             │
│ • Client scripts load in index.astro                                                   │
│ • Lenis smooth scroll engine initialized                                               │
│ • setupCursor() binds pointer listeners and locks reticle to screen center              │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: ASSET FETCH & READINESS GATE SLOTS                                            │
│ • document.fonts.ready ────────────────────────────────────────► markReady('fonts')     │
│ • setTimeout(500ms min display floor) ─────────────────────────► markReady('minSplash') │
│ • HeartScene GLTF Fetch + heartWorker geometry slicing done ───► markReady('heart')     │
│ • DreamCanvas GLTF Fetch + staircase triptych build done ──────► markReady('dream')     │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 4: PRELOADER POWER-DOWN & CRT ANIMATION                                          │
│ • All 4 slots resolved -> loadState triggers onReady() listener                        │
│ • Preloader.astro adds '.crt-turn-off' class to trigger CRT collapse animation         │
│ • Overlay fades to opacity 0 and sets display: none after transition                    │
│ • isReady() becomes true                                                               │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 5: UNLOCK & ACTIVE RENDER LOOPS                                                  │
│ • Cursor release lock: Reticle smooth tracking begins                                  │
│ • IntersectionObservers observe canvas sections, starting active requestAnimationFrames │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Decoupled Communication & Event Buses

### 4.1 Readiness State Gate (`src/utils/loadState.ts`)
Controls application initialization by requiring 4 independent asynchronous system slots to resolve:
```typescript
type ReadyKey = 'fonts' | 'heart' | 'dream' | 'minSplash';
```
- **`markReady(key: ReadyKey)`**: Increments internal ready count and fires progress subscribers (`onProgress((percent) => ...)`).
- **`onReady(callback)`**: Executes registered completion callbacks once all 4 slots resolve `true`.
- **`isReady()`**: Query function used by input systems to check system state.

### 4.2 Hover Target Bus (`src/utils/hoverTargets.ts`)
Decouples 3D WebGL raycasters from UI cursor styles:
```typescript
export type HoverTargetId = 'heart' | 'staircase';
```
- **`setHoverTarget(id, isOver)`**: Called inside `HeartScene.ts` and `DreamCanvas.ts` frame render loops when the pointer ray intersects interactive 3D geometry.
- **`onHoverTargetChange(callback)`**: Subscribed to by `CursorController.ts`. Updates reticle CSS classes (`.is-reticle`, `.is-heart-reticle`) dynamically.

### 4.3 Smooth Scroll Broadcast Bridge
`index.astro` hooks into Lenis scroll updates and distributes normalized parameters to scene modules:
- **`setDreamScrollVelocity(velocity)`**: Controls motion blur strength and chromatic aberration in `DreamCanvas.ts`.
- **`setDreamScrollProgress(progress)`**: Drives text reveal progress and triptych transformations.
- **`setBiomeScrollProgress(progress)`**: Drives non-Euclidean curvature warping, camera position, and FOV expansion in `BiomeSphere.ts`.

---

## 5. Micro Architecture of Individual Subsystems

---

### 5.1 Heart Scene Subsystem Architecture

**Files**: `src/scenes/HeartScene.ts`, `src/scenes/heartWorker.ts`, `src/ui/telemetry/PanelManager.ts`, `src/ui/telemetry/InstrumentPanel.ts`

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   HEART SCENE ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐ │
│  │    3D MESH LOADER     │   │   OFFSCREEN WEB WORKER   │   │  TELEMETRY UI ENGINE   │ │
│  │  GLTFLoader + Meshopt │   │      heartWorker.ts      │   │ PanelManager + Panel   │ │
│  └──────────┬────────────┘   └────────────┬─────────────┘   └───────────┬────────────┘ │
│             │                             │                             │              │
│             ▼                             ▼                             ▼              │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           FRAME RENDER LOOP (rAF Cycle)                          │  │
│  │ • evaluateScrollState(): Scroll timeline parameter interpolation                 │  │
│  │ • Slices transformation: Y-axis dissection separation                            │  │
│  │ • 3D Raycasting: NDC pointer intersection check -> setHoverTarget('heart')       │  │
│  │ • PanelManager.update(): Pushes live opacity, coordinates & telemetry metrics    │  │
│  │ • Web Audio Engine: Ramps fire (45Hz) and ink (70Hz) oscillator gain/filters    │  │
│  │ • EffectComposer: RenderPass -> UnrealBloomPass -> Custom InkShader Fluid Pass   │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Detailed Execution Sequence & Method Mechanics

1. **Geometry Extraction & Worker Offloading**:
   - `GLTFLoader` fetches `/staircase-meshopt.glb` or heart geometry.
   - Extracts typed arrays from `BufferGeometry`: `position` (Float32Array), `normal` (Float32Array), `uv` (Float32Array), and `index` (Uint32Array).
   - Offloads work to worker: `worker.postMessage({ type: 'SLICE', buffers, sliceCount: 5 })`.
2. **Background Thread Processing (`heartWorker.ts`)**:
   - Computes bounding box along Y-axis ($Y_{\min}$ to $Y_{\max}$).
   - Divides geometry into 5 parallel horizontal slices using plane intersection logic.
   - Re-indexes vertices and generates slice edge line segments.
   - Posts array buffers back to main thread via transferable objects (`postMessage({ type: 'SLICED_COMPLETE', slices }, [buffers])`).
3. **Slice Mesh Construction (`buildSlicesFromBuffers`)**:
   - Instantiates 5 `SliceHolder` objects. Each holder manages:
     - `solidMesh`: Standard solid geometry mesh.
     - `wireMesh`: Wireframe overlay mesh.
     - `edgeMesh`: Highlighted perimeter line mesh (`LineSegments`).
   - Injects custom spotlight rim shader into material via `onBeforeCompile`:
     ```glsl
     vec3 rim = vec3(1.0 - max(0.0, dot(vNormal, vViewPosition)));
     gl_FragColor.rgb += pow(rim, vec3(3.0)) * vec3(0.48, 0.38, 1.0);
     ```
4. **Scroll Timeline Evaluator (`evaluateScrollState`)**:
   - Evaluates progress $P \in [0, 1]$ across keyframes:
     - `dissectionProgress = clamp((P - 0.15) / 0.35, 0, 1)`: Drives vertical slice separation vector $\vec{V}_i = (0, i \times \text{dissectionProgress} \times 0.8, 0)$.
     - `fireProgress = clamp((P - 0.45) / 0.30, 0, 1)`: Drives particle turbulent noise in ember system.
     - `inkProgress = clamp((P - 0.65) / 0.30, 0, 1)`: Sets `uInkStrength` uniform in fluid post-processing shader.
5. **Telemetry UI Engine (`PanelManager.ts` & `InstrumentPanel.ts`)**:
   - `PanelManager` mounts container `#telemetry-ui` and registers panels (`telemetry-left`, `telemetry-right`).
   - In `render()` loop, calls `panelManager.update('telemetry-left', { x, y, opacity, values })`.
   - `InstrumentPanel` updates CSS custom properties `--light-x`, `--light-y` on mouse move (coalesced via rAF) to produce physical panel light-spill reflection effects.
6. **Dynamic Web Audio Synthesizer**:
   - Lazily instantiates `AudioContext` on user interaction.
   - `fireOsc`: Sawtooth wave tuned to 45 Hz connected to BiquadFilter (Lowpass 120 Hz). Gain ramps with scroll velocity and `fireProgress`.
   - `inkOsc`: Sine wave tuned to 70 Hz connected to GainNode. Gain scales with `inkProgress`.

---

### 5.2 Dream Canvas Subsystem Architecture

**Files**: `src/scenes/DreamCanvas.ts`

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DREAM CANVAS ARCHITECTURE                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐ │
│  │   STAIRCASE TRIPTYCH  │   │  OFFSCREEN GLYPH ENGINE  │   │ POST-FX LENS COMPOSER  │ │
│  │  1 Hero + 2 Mirrored   │   │  Unbounded Text Physics  │   │ Fisheye + Aberration   │ │
│  └──────────┬────────────┘   └────────────┬─────────────┘   └───────────┬────────────┘ │
│             │                             │                             │              │
│             ▼                             ▼                             ▼              │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           FRAME RENDER LOOP (rAF Cycle)                          │  │
│  │ • Particle Physics Loop: Spring return + Mouse repulsion + Scroll inertia lag    │  │
│  │ • Staircase Transform: Hero Y-rotation + Mirrored puddle lerp positioning        │  │
│  │ • 3D Raycaster: Tests intersection against Hero mesh -> setHoverTarget('staircase')│  │
│  │ • Custom Lens Pass: Uniforms uFisheye, uChromaticAberration, uMotionBlur updated  │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Micro Details & Mathematics

1. **Staircase Triptych Construction**:
   - Loads compressed GLTF `/staircase-meshopt.glb`.
   - Calculates geometry bounding box dimensions ($W, H, D$). Normalizes scale factor:
     $$\text{scale} = \frac{\text{STAIR\_TARGET\_SIZE}}{\max(W, H, D)}$$
   - Instantiates three meshes inside `masterGroup`:
     - **Hero Mesh**: $(0, 0, 0)$, rotation $(0, \text{scrollProgress} \times \pi, 0)$.
     - **Left Puddle**: $(-4.2, -1.8, -1.5)$, scale factor $(1, -1, 1)$ to invert mesh vertically.
     - **Right Puddle**: $(4.2, -1.8, -1.5)$, scale factor $(-1, -1, 1)$ to mirror both horizontally and vertically.
2. **Offscreen Typography Particle Engine**:
   - Draws target text onto offscreen HTML5 canvas (`offscreenCtx`) using `"500 56px Unbounded"`.
   - Reads RGBA pixel array via `getImageData()`. Samples pixels with alpha $> 128$ at step interval of 4px.
   - Instantiates `GlyphParticle` structures:
     ```typescript
     interface GlyphParticle {
       x: number; y: number;
       originX: number; originY: number;
       vx: number; vy: number;
       size: number;
     }
     ```
   - **Physics Spring Equation**:
     $$F_{x} = (\text{originX} - x) \times 0.08, \quad F_{y} = (\text{originY} - y) \times 0.08$$
     $$vx = (vx + F_{x}) \times 0.85, \quad vy = (vy + F_{y}) \times 0.85$$
   - **Mouse Repulsion Impulse**:
     $$\text{dist} = \sqrt{(x - M_{x})^2 + (y - M_{y})^2}$$
     $$\text{If } \text{dist} < R_{\text{repulse}}: \quad \vec{V} += \frac{\vec{P} - \vec{M}}{\text{dist}} \times \left(1 - \frac{\text{dist}}{R}\right) \times 12.0$$
3. **Custom Lens Post-Processing Pass**:
   - Passes rendered scene texture through `CustomLensShader`:
     - **Fisheye Distortion**:
       $$r = \sqrt{u^2 + v^2}, \quad \theta = \arctan(v, u), \quad r' = r + r^3 \times \text{uFisheye}$$
     - **Chromatic Aberration**: Offsets red and blue texture sampling coordinates radially proportional to `uChromaticAberration` and scroll velocity.
     - **Motion Blur**: Blurs UV sampling vertically proportional to `uMotionBlur`.

---

### 5.3 Biome Sphere Subsystem Architecture

**Files**: `src/scenes/BiomeSphere.ts`, `src/materials/NonEuclideanMaterial.ts`

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  BIOME SPHERE ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐ │
│  │ CONCENTRIC RING MESHES│   │  NONEUCLIDEAN MATERIAL   │   │ FLASH TRANSITION EVENT │ │
│  │ 32 Tunnel Mesh Segment│   │ Custom Vertex Shader     │   │ 'biome-flash-start'    │ │
│  └──────────┬────────────┘   └────────────┬─────────────┘   └───────────┬────────────┘ │
│             │                             │                             │              │
│             ▼                             ▼                             ▼              │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           FRAME RENDER LOOP (rAF Cycle)                          │  │
│  │ • Lerp Progress Smoothing: renderedProgress = lerp(renderedProgress, target, 0.08)│  │
│  │ • Vertex Shader Mutator: Updates uExtrusionFactor for distance tension flare      │  │
│  │ • Camera Projection Morph: FOV expands 45° -> 110° -> 140° for hyper-speed tunnel│  │
│  │ • Flash Trigger (> 0.99): Dispatches custom events and animates sprite overlay    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Non-Euclidean Vertex Shader Math (`NonEuclideanMaterial.ts`)
Intercepts standard `MeshStandardMaterial` vertex transformation pipeline via `onBeforeCompile`:

```glsl
// Custom Vertex Transformation Shader
#define PLANET_RADIUS 200.0

vec4 customPosition = vec4(position, 1.0);
vec4 worldPos = modelMatrix * customPosition;

float distXZ = length(worldPos.xz);
float theta = min(distXZ / PLANET_RADIUS, 1.5707963); // Cap at pi/2

// Bend downward along spherical curvature
float yOffset = (worldPos.y + PLANET_RADIUS) * cos(theta) - PLANET_RADIUS;

// Squeeze lateral coordinates inward along horizon arc
float squeeze = (distXZ > 0.001) ? (PLANET_RADIUS * sin(theta)) / distXZ : 1.0;

worldPos.x *= squeeze;
worldPos.z *= squeeze;
worldPos.y = yOffset;

// Apply distance tension flare uniform
worldPos.y += uExtrusionFactor * pow(clamp(distXZ / 100.0, 0.0, 1.0), 2.0) * 20.0;

vec4 viewPosition = viewMatrix * worldPos;
gl_Position = projectionMatrix * viewPosition;
```

---

### 5.4 Void Canvas Subsystem Architecture

**Files**: `src/scenes/VoidCanvas.ts`, `src/utils/canvas.ts`

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   VOID CANVAS ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐ │
│  │  ADAPTIVE QUALITY     │   │ PROCEDURAL FIELD SEED    │   │  LOOP CONTROLLER OBS   │ │
│  │ Desktop vs Mobile     │   │ Dust, Streaks, Streams   │   │  IntersectionObserver  │ │
│  └──────────┬────────────┘   └────────────┬─────────────┘   └───────────┬────────────┘ │
│             │                             │                             │              │
│             ▼                             ▼                             ▼              │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           FRAME RENDER LOOP (rAF Cycle)                          │  │
│  │ • Canvas DPR Resizing: Synchronizes backbuffer pixel dimensions via resizeCanvas()│  │
│  │ • Pointer Phosphor Aura: Draws 350px radial gradient centered on mouse (X, Y)     │  │
│  │ • CRT Scanline Pass: Renders horizontal 2% opacity lines every 4px                │  │
│  │ • Vector Stream Lines: Animates dashed tactical radar trajectories                │  │
│  │ • Dust & Light Streaks: Updates radial drift velocity and opacity cycles          │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Comprehensive Function Call & Parameter API Matrix

The following table documents every core function call, signature, caller, location, and operational outcome across the application:

| Function / Method Signature | Source Module | Caller Location | Parameters | Return Type | Architectural Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `markReady(key: ReadyKey)` | `src/utils/loadState.ts` | `HeartScene.ts`, `DreamCanvas.ts`, `index.astro` | `key`: `'fonts'` \| `'heart'` \| `'dream'` \| `'minSplash'` | `void` | Increments readiness gate slots and triggers progress notification subscribers. |
| `onProgress(fn)` | `src/utils/loadState.ts` | `Preloader.astro` | `fn`: `(percentage: number) => void` | `() => void` (Unsubscribe) | Registers subscriber to update preloader UI percentage bar. |
| `onReady(fn)` | `src/utils/loadState.ts` | `Preloader.astro` | `fn`: `() => void` | `() => void` (Unsubscribe) | Triggers preloader power-down animation when all 4 readiness slots resolve. |
| `isReady()` | `src/utils/loadState.ts` | `CursorController.ts` | None | `boolean` | Queries if readiness gate has unlocked main application interaction. |
| `setHoverTarget(id, isOver)` | `src/utils/hoverTargets.ts` | `HeartScene.ts`, `DreamCanvas.ts` | `id`: `'heart'` \| `'staircase'`, `isOver`: `boolean` | `void` | Updates central hover target state registry. |
| `onHoverTargetChange(fn)` | `src/utils/hoverTargets.ts` | `CursorController.ts` | `fn`: `(target: HoverTargetId \| null) => void` | `() => void` (Unsubscribe) | Binds reticle state changes to 3D raycaster hover events. |
| `setupCursor()` | `src/controllers/CursorController.ts` | `index.astro` | None | `{ destroy: () => void }` | Binds pointer event tracking, coordinate HUD updates, reticle smoothing, and character carousel. |
| `setupWorkReveal()` | `src/controllers/ScrollReveal.ts` | `index.astro` | None | `(() => void) \| null` | Registers `IntersectionObserver` to stagger animate `[data-reveal]` work row elements. |
| `setupHeartScene()` | `src/scenes/HeartScene.ts` | `index.astro` | None | `{ render: (t: number) => void, destroy: () => void }` | Mounts 3D Heart Scene, initializes worker geometry slicing, audio synth engine, and telemetry UI. |
| `setupDreamCanvas()` | `src/scenes/DreamCanvas.ts` | `index.astro` | None | `{ render: (t: number) => void, destroy: () => void }` | Mounts Staircase triptych scene, offscreen typography particle physics engine, and lens post-processing. |
| `setupBiomeSphere()` | `src/scenes/BiomeSphere.ts` | `index.astro` | None | `{ render: (t: number) => void, destroy: () => void }` | Mounts curved non-Euclidean tunnel scene and manages camera FOV projection morphing. |
| `setupVoidCanvas()` | `src/scenes/VoidCanvas.ts` | `index.astro` | None | `{ destroy: () => void }` | Initializes 2D canvas procedural starfield, CRT scanlines, and pointer phosphor radial aura. |
| `createNonEuclideanMaterial()` | `src/materials/NonEuclideanMaterial.ts` | `BiomeSphere.ts` | `options`: `THREE.MeshStandardMaterialParameters` | `THREE.MeshStandardMaterial` | Compiles custom vertex shader material that curves world coordinates downward into a planet arc. |
| `createLoopController(section, render)` | `src/utils/canvas.ts` | `DreamCanvas.ts`, `VoidCanvas.ts` | `section`: `Element`, `render`: `(time: number) => void` | `LoopController` | Wraps rendering loop in `IntersectionObserver` to automatically pause animation frames when offscreen. |
| `resizeCanvas(canvas, context, maxDpr)` | `src/utils/canvas.ts` | `VoidCanvas.ts` | `canvas`: `HTMLCanvasElement`, `context`: `CanvasRenderingContext2D`, `maxDpr`: `number` | `CanvasSize` | Adjusts canvas backing store width and height according to device pixel ratio. |
| `PanelManager.registerPanel(config)` | `src/ui/telemetry/PanelManager.ts` | `HeartScene.ts` | `config`: `PanelConfig` | `InstrumentPanel` | Mounts and registers an telemetry panel component inside the UI layer. |
| `PanelManager.update(id, payload)` | `src/ui/telemetry/PanelManager.ts` | `HeartScene.ts` | `id`: `string`, `payload`: `PanelUpdatePayload` | `void` | Updates telemetry metrics, panel positioning, rotation, and opacity per frame. |

---

## 7. Codebase Optimization & Dependency Manifest

All dead code, unreferenced components, unused assets, and duplicate dependencies have been eliminated from the repository:

### 7.1 Removed Artifacts
- **`src/controllers/DiscreteScrollController.ts`**: Deleted empty 0-byte file.
- **`src/components/Welcome.astro`**: Deleted unrendered Astro template component.
- **`src/assets/astro.svg` & `src/assets/background.svg`**: Deleted unreferenced template vector assets.
- **`public/staircase.glb`**: Deleted uncompressed 2.1 MB model; the application exclusively loads compressed `/staircase-meshopt.glb`.

### 7.2 Active Clean Dependency Manifest (`package.json`)
```json
{
  "name": "portyxb",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "dev": "astro dev --host 0.0.0.0 --port 3000",
    "build": "astro build",
    "preview": "astro preview --host 0.0.0.0 --port 3000",
    "astro": "astro",
    "cleanup": "rimraf dist build node_modules"
  },
  "dependencies": {
    "@astrojs/node": "^11.0.2",
    "@astrojs/react": "^4.0.0",
    "@fontsource-variable/space-grotesk": "^5.2.10",
    "@fontsource-variable/unbounded": "^5.2.8",
    "@fontsource/architects-daughter": "^5.2.7",
    "astro": "^7.0.2",
    "lenis": "^1.3.25",
    "three": "^0.184.0"
  },
  "devDependencies": {
    "@types/three": "^0.185.0",
    "rimraf": "^6.1.3",
    "typescript": "^7.0.2"
  }
}
```
