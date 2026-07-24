# Asset Pipeline & Deployment Strategy

This document outlines the asset creation workflow, audio engine roadmap, platform constraints, and recommended server architecture for the deployment of this hardware-accelerated portfolio application.

---

## 1. 3D Asset Pipeline

Given the heavy reliance on WebGL and volumetric scenes, managing the 3D asset pipeline is critical for maintaining high frame rates and fast load times.

- **Generation & Topology:** 
  - Base models are generated using AI 3D generator tools to quickly concept shapes.
  - The generated meshes are then imported into **Blender** and manually retopologized to ensure clean edge flow, optimized triangle counts, and proper UV mapping for shaders.
- **Optimization (Meshopt):** 
  - Retopologized models are heavily optimized using `meshoptimizer`.
  - Most assets are compressed via Meshopt to drastically reduce network payload sizes.
  - *Exception:* There is currently one unoptimized asset in the pipeline, but its raw size is intentionally kept under 1MB to avoid bottlenecking the initial network fetch.

## 2. Platform Constraints: Desktop-Only

The application is engineered exclusively for desktop-class hardware to leverage powerful GPUs for the `heartWorker` slicing, intensive post-processing, and multi-canvas rendering.

- **Mobile Strategy:** There is **no mobile version** of this site.
- **Redirection:** Any request originating from a mobile user-agent or a screen width below a certain threshold will bypass the heavy WebGL initialization and immediately redirect to a static `[Open on Desktop]` fallback page. 

## 3. Interactive Audio Engine (Roadmap)

The audio component will be the final system integrated into the application, designed as a full-scope, interactive-reactive synthesizer.

- **Architecture:** It will function as a standalone API-based component that hooks into the existing event buses (e.g., scroll velocity, raycaster hover states).
- **Functionality:** Rather than playing static audio files, the engine will synthesize sound dynamically (oscillators, biquad filters, gain nodes) to react in real-time to user interactions, scroll speed, and visual transitions, matching the biomechanical and void-like aesthetics of the site.

## 4. Server Architecture Post-Deployment

Because the site uses `@astrojs/node` for SSR but relies completely on client-side WebGL for the core experience, the server's primary responsibilities are fast initial HTML delivery and robust static asset serving (fonts, `.glb` files). 

Since the exact post-deployment architecture is currently undecided, here are the two recommended pathways:

### Option A: Containerized Cloud Deployment (Recommended)
This approach provides maximum control over the Node.js environment and handles heavy concurrent asset fetching well.
- **Dockerization:** Wrap the Astro Node build (`npm run build`) in a lightweight Node.js Docker container (e.g., `node:20-alpine`).
- **Hosting:** Deploy the container to a service like **Google Cloud Run**, **AWS App Runner**, or **Railway**. 
- **Delivery:** Place a CDN (like Cloudflare) in front of the container. The CDN will cache the heavy `.glb` assets and fonts, meaning the Node server only spends CPU cycles serving the initial HTML request.

### Option B: Managed Edge / Serverless (e.g., Vercel, Netlify)
If you prefer a zero-config setup, Astro supports deploying Node SSR apps to managed platforms.
- **Adapter Change:** You would swap `@astrojs/node` for `@astrojs/vercel` or `@astrojs/netlify`.
- **Pros:** Push-to-deploy, automatic CDN distribution for your `.glb` assets, and edge caching out of the box.
- **Cons:** You are subject to the strict execution time limits of serverless functions, though this rarely affects Astro SSR unless doing heavy server-side API calls.

*Recommendation:* Start with **Option B (Vercel/Netlify)** for frictionless deployment. If you find you need more control over how the static assets are cached or served, transition to **Option A**.
