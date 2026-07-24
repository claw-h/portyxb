// ---------------------------------------------------------------------------
// Site readiness gate
// ---------------------------------------------------------------------------
// Single source of truth for "is the site actually done rendering yet".
//
// This replaces the old `window.__NEURAL_STATE` pattern, which had two real
// bugs: (1) nothing in the codebase ever *created* that object, so every
// read of it was silently a no-op and the preloader could never legitimately
// complete; and (2) it leaned on `DefaultLoadingManager`'s onLoad,
// which fires whenever its internal queue drains to zero — if one scene's
// loader finishes before another scene's loader has even started (e.g. the
// dream canvas used to defer its GLTF fetch behind requestIdleCallback), the
// manager considers "everything" loaded prematurely.
//
// Here, every heavy system claims a named slot up front and marks it ready
// exactly once, when its own real work is done. The site is only "ready"
// when every claimed slot has resolved — no shared mutable global, no
// implicit queue, no race.
//
// Preloader.astro, index.astro, HeartScene.ts and DreamCanvas.ts all import
// this file. Because it's a plain ES module, Vite/Astro gives every
// importer the same singleton instance for free — no window global needed.
// ---------------------------------------------------------------------------

export type ReadyKey = 'fonts' | 'heart' | 'minSplash';

const ALL_KEYS: ReadyKey[] = ['fonts', 'heart', 'minSplash'];
const pending = new Set<ReadyKey>(ALL_KEYS);

type ProgressListener = (percent: number) => void;
type ReadyListener = () => void;

const progressListeners: ProgressListener[] = [];
const readyListeners: ReadyListener[] = [];
let released = false;

function currentPercent(): number {
	return ((ALL_KEYS.length - pending.size) / ALL_KEYS.length) * 100;
}

/** Called by a scene/system exactly once, when its own real work is done. */
export function markReady(key: ReadyKey): void {
	if (!pending.has(key)) return; // already marked — ignore duplicates
	pending.delete(key);

	const percent = currentPercent();
	progressListeners.forEach((fn) => fn(percent));

	if (pending.size === 0 && !released) {
		released = true;
		readyListeners.forEach((fn) => fn());
	}
}

/**
 * Subscribes to real progress (0–100). Replays the current value immediately
 * on subscribe, so a listener that attaches late (e.g. after some slots have
 * already resolved) never misses progress that already happened.
 */
export function onProgress(fn: ProgressListener): () => void {
	progressListeners.push(fn);
	fn(currentPercent());
	return () => {
		const i = progressListeners.indexOf(fn);
		if (i !== -1) progressListeners.splice(i, 1);
	};
}

/**
 * Subscribes to the single "everything is ready" event. Fires immediately
 * if the site was already ready by the time something subscribes — guards
 * against a subscribe-after-resolve race.
 */
export function onReady(fn: ReadyListener): void {
	if (released) {
		fn();
		return;
	}
	readyListeners.push(fn);
}

export function isReady(): boolean {
	return released;
}

// ── Self-registering signals ──────────────────────────────────────────────
// These two aren't owned by any single scene module, so they live here.

if (typeof document !== 'undefined') {
	document.fonts.ready.then(() => markReady('fonts'));
}

// A modest floor under the preload duration. The CRT boot-up animation in
// Preloader.astro (`crt-turn-on`) runs for 2.5s — without this, a fully
// cached repeat visit could call `completeLoading()` mid-boot, cutting the
// power-on animation off and immediately reversing into power-down, which
// reads as broken rather than intentional. Tune or delete freely.
const MIN_SPLASH_MS = 500;
if (typeof window !== 'undefined') {
	window.setTimeout(() => markReady('minSplash'), MIN_SPLASH_MS);
}