# PORTYXB 

An interactive, high-performance web experience built with **Astro** and **WebGL (Three.js)**. This project prioritizes deep cinematic visuals, smooth procedural animations, and rigorous memory and performance management.

---

## 🛠 Tech Stack
- **Framework:** Astro (Server-Side Rendering via `@astrojs/node`)
- **Graphics/WebGL:** Three.js
- **Scrolling:** Lenis (Smooth Scroll)
- **Audio:** Web Audio API (Procedural synthesis)
- **Concurrency:** Web Workers (Off-screen mesh slicing and computation)

---

## 🏗 Architecture Overview

The system architecture is strictly designed to isolate heavy WebGL operations from the DOM to maintain a locked 60FPS. 

### The 5-Stage Boot Protocol
1. **Server Side Render:** `Layout.astro` and `index.astro` generate the HTML shell.
2. **DOM Mount & Script Init:** `Lenis` smooth scroll engine and the custom reticle/cursor initialize.
3. **Asset Fetch & Readiness Gate (`loadState.ts`):** 4 asynchronous slots must resolve independently (fonts, minimum splash duration, heart mesh slicing via worker, and staircase mesh loading).
4. **Preloader Power-Down:** A CRT collapse animation triggers, fading out the loading overlay.
5. **Unlock & Active Render Loops:** Reticle smooth tracking begins. `IntersectionObserver`s spin up WebGL render cycles only when their respective `.canvas-zone`s enter the viewport.

### Decoupled Communication Buses
Scenes and DOM UI elements are fundamentally decoupled to avoid layout thrashing and VRAM leaks:
- **Readiness State Gate:** Controls system initialization via independent system slots, firing callbacks only when fully resolved.
- **Hover Target Bus:** 3D WebGL raycasters decouple hover detection from UI cursor styles, broadcasting events that the Cursor controller subscribes to.
- **Scroll Broadcast Bridge:** Lenis scroll progress is broadcast globally. Each 3D scene calculates its own cinematic timeline (e.g., model dissection, focal distortions) purely from this centralized scroll feed.

---

## ⚙️ Core Subsystems

### Scene 1: Heart Scene
*A volumetric, highly interactive medical cross-section.*
- **Off-screen Slicing:** Offloads GLTF mesh processing to a Web Worker (`heartWorker.ts`), extracting raw buffers to generate 3D cross-sections.
- **Volumetric Shading & Audio:** Injects custom shader logic for rim illumination and utilizes Web Audio nodes (Sawtooth/Sine) modulated by scroll progress to simulate an audible, dynamic heartbeat.
- **Telemetry UI:** A `PanelManager` maps screen-space positions of 3D meshes to absolutely-positioned HTML overlays for context-aware "Tissue Analysis".

### Scene 2: Dream Canvas
*A surreal, typography-driven physics environment.*
- **Offscreen Glyph Engine:** Uses an `OffscreenCanvas` to read alpha pixels from rendered typography, spawning particle physics that react to mouse repulsion (incorporating momentum and spring return mechanics).
- **Custom Lens Shader:** Employs an `EffectComposer` with a custom fisheye distortion pass, applying offset sampling for chromatic aberration and vertical UV shifting.

### Scene 3: Case Dossier
*An interactive 3D portfolio archive.*
- **Procedural Geometry:** Mathematically generates an animated 3D book with distinct spine offsets and edge-highlighting meshes.
- **Dynamic Texturing:** Creates high-resolution offscreen HTML5 canvases mapped onto the pages via `CanvasTexture` (with anisotropic filtering).

---

## 🛡 Strict WebGL Performance Constraints

To prevent memory leaks and GC stutter, this codebase enforces strict WebGL rules:

1. **Memory & Garbage Collection:** Every dynamically allocated WebGL resource (`WebGLRenderer`, `BufferGeometry`, `ShaderMaterial`, `CanvasTexture`) MUST be explicitly `.dispose()`d during the subsystem's teardown lifecycle.
2. **The `rAF` Rule:** Render loops must be wrapped in `LoopController` instances backed by `IntersectionObserver`, suspending `requestAnimationFrame` when out of the viewport.
3. **Zero-Allocation Loops:** Absolutely no object instantiation occurs inside render loops. Temporary vectors and matrices are hoisted and updated via `.copy()` or `.lerp()`.
4. **Thread Offloading:** Heavy geometric computations are offloaded to Web Workers using `Transferable Objects`.

---

## 🚀 Development & Deployment

### Platform Constraints
- **Desktop-Only:** There is no mobile version of this site. Mobile user-agents or small screen widths are redirected to a static fallback page.
- **Asset Optimization:** `.glb` models are heavily compressed using `meshoptimizer` to drastically reduce network payloads.

### Running Locally
To start the Astro development server in background mode:
```bash
astro dev --background
```
You can manage the background task using standard commands:
- `astro dev stop`
- `astro dev status`
- `astro dev logs`

*For more granular architectural constraints, API methods, and subsystem behaviors, please reference `context.md`.*
