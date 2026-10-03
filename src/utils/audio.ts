// ---------------------------------------------------------------------------
// Animus Audio Engine — Procedural Web Audio Synthesis
// ---------------------------------------------------------------------------
// Single shared AudioContext, master gain bus, pre-generated noise buffer.
// Every sound is bass-heavy and smooth — no sharp treble spikes.
// Respects prefers-reduced-motion.
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function getContext() {
	if (typeof window === 'undefined') return null;
	if (!audioCtx) {
		audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

		masterGain = audioCtx.createGain();
		masterGain.gain.value = 0.4;
		masterGain.connect(audioCtx.destination);

		// Pre-generate a 100ms white noise buffer, reused by all noise-based sounds
		const bufferSize = audioCtx.sampleRate * 0.1;
		noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
		const data = noiseBuffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) {
			data[i] = Math.random() * 2 - 1;
		}
	}
	if (audioCtx.state === 'suspended') {
		audioCtx.resume();
	}
	return audioCtx;
}

export function setVolume(v: number) {
	if (masterGain) {
		masterGain.gain.value = Math.max(0, Math.min(1, v));
	}
}

function shouldPlay() {
	if (typeof window === 'undefined') return false;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
	return true;
}

// ---------------------------------------------------------------------------
// Scene 3 — Dossier: Archive Button Clack
// ---------------------------------------------------------------------------
// Deep mechanical thud — lowpass-filtered noise with sub-bass body
export function playClack() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain || !noiseBuffer) return;

	const noise = ctx.createBufferSource();
	noise.buffer = noiseBuffer;

	// Sub-bass body
	const sub = ctx.createOscillator();
	sub.type = 'sine';
	sub.frequency.setValueAtTime(60, ctx.currentTime);
	sub.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.12);

	const subGain = ctx.createGain();
	subGain.gain.setValueAtTime(0.4, ctx.currentTime);
	subGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

	// Noise layer — very low cutoff for muffled thud
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.setValueAtTime(400, ctx.currentTime);
	filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);

	const noiseGain = ctx.createGain();
	noiseGain.gain.setValueAtTime(0.3, ctx.currentTime);
	noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

	noise.connect(filter);
	filter.connect(noiseGain);
	noiseGain.connect(masterGain);

	sub.connect(subGain);
	subGain.connect(masterGain);

	noise.start();
	noise.stop(ctx.currentTime + 0.1);
	sub.start();
	sub.stop(ctx.currentTime + 0.12);
}

// ---------------------------------------------------------------------------
// Scene 3 — Dossier: Blast Door Rumble
// ---------------------------------------------------------------------------
// Deep cinematic sub-bass with waveshaper distortion
export function playRumble(duration = 2.5) {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const osc = ctx.createOscillator();
	const gain = ctx.createGain();

	osc.type = 'sine';
	osc.frequency.setValueAtTime(35, ctx.currentTime);
	osc.frequency.exponentialRampToValueAtTime(18, ctx.currentTime + duration);

	gain.gain.setValueAtTime(0, ctx.currentTime);
	gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.4);
	gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

	const waveShaper = ctx.createWaveShaper();
	const curve = new Float32Array(400);
	for (let i = 0; i < 400; ++i) {
		const x = i * 2 / 400 - 1;
		curve[i] = (3 + 20) * x * 20 * (Math.PI / 180) / (Math.PI + 20 * Math.abs(x));
	}
	waveShaper.curve = curve;
	waveShaper.oversample = '4x';

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 120;

	osc.connect(waveShaper);
	waveShaper.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	osc.start();
	osc.stop(ctx.currentTime + duration);
}

// ---------------------------------------------------------------------------
// Scene 3 — Dossier: Category Toggle Blip
// ---------------------------------------------------------------------------
// Smooth low-mid sine sweep — warm, not piercing
export function playBlip() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const osc = ctx.createOscillator();
	const gain = ctx.createGain();

	osc.type = 'sine';
	osc.frequency.setValueAtTime(180, ctx.currentTime);
	osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.12);

	gain.gain.setValueAtTime(0, ctx.currentTime);
	gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.02);
	gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 600;

	osc.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	osc.start();
	osc.stop(ctx.currentTime + 0.12);
}

// ---------------------------------------------------------------------------
// Snap Scroll — Forward
// ---------------------------------------------------------------------------
// Dual sub-bass sines sweeping down, with a muffled noise puff
export function playSnapForward() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain || !noiseBuffer) return;

	const osc1 = ctx.createOscillator();
	const osc2 = ctx.createOscillator();
	const gain = ctx.createGain();

	osc1.type = 'sine';
	osc1.frequency.setValueAtTime(200, ctx.currentTime);
	osc1.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.18);

	osc2.type = 'sine';
	osc2.frequency.setValueAtTime(300, ctx.currentTime);
	osc2.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.18);

	// Soft noise puff
	const noise = ctx.createBufferSource();
	noise.buffer = noiseBuffer;
	const nFilter = ctx.createBiquadFilter();
	nFilter.type = 'lowpass';
	nFilter.frequency.value = 300;
	const nGain = ctx.createGain();
	nGain.gain.setValueAtTime(0.06, ctx.currentTime);
	nGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
	noise.connect(nFilter);
	nFilter.connect(nGain);
	nGain.connect(masterGain);

	gain.gain.setValueAtTime(0, ctx.currentTime);
	gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 400;

	osc1.connect(filter);
	osc2.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	osc1.start();
	osc2.start();
	noise.start();
	osc1.stop(ctx.currentTime + 0.18);
	osc2.stop(ctx.currentTime + 0.18);
	noise.stop(ctx.currentTime + 0.04);
}

// ---------------------------------------------------------------------------
// Snap Scroll — Reverse
// ---------------------------------------------------------------------------
// Same but pitch rises — psychoacoustic cue for "going back"
export function playSnapReverse() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain || !noiseBuffer) return;

	const osc1 = ctx.createOscillator();
	const osc2 = ctx.createOscillator();
	const gain = ctx.createGain();

	osc1.type = 'sine';
	osc1.frequency.setValueAtTime(80, ctx.currentTime);
	osc1.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.18);

	osc2.type = 'sine';
	osc2.frequency.setValueAtTime(120, ctx.currentTime);
	osc2.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.18);

	const noise = ctx.createBufferSource();
	noise.buffer = noiseBuffer;
	const nFilter = ctx.createBiquadFilter();
	nFilter.type = 'lowpass';
	nFilter.frequency.value = 300;
	const nGain = ctx.createGain();
	nGain.gain.setValueAtTime(0.06, ctx.currentTime);
	nGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
	noise.connect(nFilter);
	nFilter.connect(nGain);
	nGain.connect(masterGain);

	gain.gain.setValueAtTime(0, ctx.currentTime);
	gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 400;

	osc1.connect(filter);
	osc2.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	osc1.start();
	osc2.start();
	noise.start();
	osc1.stop(ctx.currentTime + 0.18);
	osc2.stop(ctx.currentTime + 0.18);
	noise.stop(ctx.currentTime + 0.04);
}

// ---------------------------------------------------------------------------
// Snap Scroll — Zone Crossing (section boundaries)
// ---------------------------------------------------------------------------
// Heavy sub-bass hit with waveshaper warmth
export function playZoneCrossing() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const osc = ctx.createOscillator();
	const sub = ctx.createOscillator();
	const gain = ctx.createGain();

	osc.type = 'triangle';
	osc.frequency.setValueAtTime(120, ctx.currentTime);
	osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.35);

	sub.type = 'sine';
	sub.frequency.value = 30;

	const subGain = ctx.createGain();
	subGain.gain.setValueAtTime(0, ctx.currentTime);
	subGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.03);
	subGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

	gain.gain.setValueAtTime(0, ctx.currentTime);
	gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
	gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

	const waveShaper = ctx.createWaveShaper();
	const curve = new Float32Array(400);
	for (let i = 0; i < 400; ++i) {
		const x = i * 2 / 400 - 1;
		curve[i] = (3 + 10) * x * 10 * (Math.PI / 180) / (Math.PI + 10 * Math.abs(x));
	}
	waveShaper.curve = curve;

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 250;

	osc.connect(gain);
	sub.connect(subGain);
	gain.connect(waveShaper);
	subGain.connect(waveShaper);
	waveShaper.connect(filter);
	filter.connect(masterGain);

	osc.start();
	sub.start();
	osc.stop(ctx.currentTime + 0.35);
	sub.stop(ctx.currentTime + 0.35);
}

// ---------------------------------------------------------------------------
// Scene 2 — DreamCanvas: Staircase Materialization
// ---------------------------------------------------------------------------
// Warm sub-harmonic swell — stacked low sines with slow attack
export function playMaterialize() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const freqs = [60, 90, 135];
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0, ctx.currentTime);
	gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.25);
	gain.gain.setValueAtTime(0.1, ctx.currentTime + 0.5);
	gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.setValueAtTime(100, ctx.currentTime);
	filter.frequency.linearRampToValueAtTime(300, ctx.currentTime + 0.8);

	freqs.forEach(f => {
		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(f, ctx.currentTime);
		osc.frequency.exponentialRampToValueAtTime(f + 20, ctx.currentTime + 1.2);
		osc.connect(filter);
		osc.start();
		osc.stop(ctx.currentTime + 1.2);
	});

	filter.connect(gain);
	gain.connect(masterGain);
}

// ---------------------------------------------------------------------------
// Scene 2 — DreamCanvas: Glyph Reveal Tick
// ---------------------------------------------------------------------------
// Tiny muffled sub-thump — barely audible
export function playGlyphReveal() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const osc = ctx.createOscillator();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(80, ctx.currentTime);
	osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.03);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.025, ctx.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);

	osc.connect(gain);
	gain.connect(masterGain);

	osc.start();
	osc.stop(ctx.currentTime + 0.03);
}

// ---------------------------------------------------------------------------
// Scene 3 — Dossier: Data Scramble
// ---------------------------------------------------------------------------
// Low-frequency rumble scramble — bass-heavy with muffled randomization
export function playScramble() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const osc = ctx.createOscillator();
	osc.type = 'triangle';

	const now = ctx.currentTime;
	const duration = 0.35;
	const steps = duration / 0.02;

	osc.frequency.setValueAtTime(80 + Math.random() * 120, now);
	for (let i = 1; i < steps; i++) {
		osc.frequency.setValueAtTime(60 + Math.random() * 150, now + i * 0.02);
	}

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.setValueAtTime(200, now);
	filter.frequency.linearRampToValueAtTime(500, now + duration);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0, now);
	gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
	gain.gain.setValueAtTime(0.1, now + duration * 0.3);
	gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

	osc.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	osc.start(now);
	osc.stop(now + duration);
}

// ---------------------------------------------------------------------------
// Scene 3 — Dossier: Project Accordion Open
// ---------------------------------------------------------------------------
// Warm low ping with soft delayed echo
export function playDataPing() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const now = ctx.currentTime;

	const osc = ctx.createOscillator();
	osc.type = 'sine';
	osc.frequency.value = 220;

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0, now);
	gain.gain.linearRampToValueAtTime(0.07, now + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 400;

	// Soft delayed echo
	const delay = ctx.createDelay();
	delay.delayTime.value = 0.2;
	const delayGain = ctx.createGain();
	delayGain.gain.value = 0.15;

	osc.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	gain.connect(delay);
	delay.connect(delayGain);
	delayGain.connect(masterGain);

	osc.start(now);
	osc.stop(now + 0.15);
}

// ---------------------------------------------------------------------------
// Global UI — Hover Tick (80ms debounce built-in)
// ---------------------------------------------------------------------------
// Subliminal sub-bass nudge
let lastHoverTick = 0;
export function playHoverTick() {
	if (!shouldPlay()) return;
	const now = performance.now();
	if (now - lastHoverTick < 80) return;
	lastHoverTick = now;

	const ctx = getContext();
	if (!ctx || !masterGain) return;

	const osc = ctx.createOscillator();
	const gain = ctx.createGain();

	osc.type = 'sine';
	osc.frequency.value = 100;

	const audioNow = ctx.currentTime;
	gain.gain.setValueAtTime(0, audioNow);
	gain.gain.linearRampToValueAtTime(0.015, audioNow + 0.004);
	gain.gain.exponentialRampToValueAtTime(0.001, audioNow + 0.025);

	osc.connect(gain);
	gain.connect(masterGain);

	osc.start(audioNow);
	osc.stop(audioNow + 0.025);
}

// ---------------------------------------------------------------------------
// Global UI — Nav Click
// ---------------------------------------------------------------------------
// Muffled low-frequency tap
export function playNavClick() {
	if (!shouldPlay()) return;
	const ctx = getContext();
	if (!ctx || !masterGain || !noiseBuffer) return;

	const noise = ctx.createBufferSource();
	noise.buffer = noiseBuffer;

	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 350;

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.06, ctx.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

	noise.connect(filter);
	filter.connect(gain);
	gain.connect(masterGain);

	noise.start(ctx.currentTime);
	noise.stop(ctx.currentTime + 0.05);
}

// ---------------------------------------------------------------------------
// Scene 1 — Heart: Continuous Synth Oscillators + Heartbeat
// ---------------------------------------------------------------------------
// Arc buzz (square 220Hz bandpass) + ink sub (sine 70Hz) + procedural heartbeat.
// Heartbeat is a dual-thump (lub-dub) driven by beatPhase from the render loop.
// Stops when dissection begins (flatlineFactor → 0).
export function initHeartSynth() {
	if (!shouldPlay()) return {
		setArcGain: () => {},
		setInkGain: () => {},
		beat: (_phase: number, _flat: number) => {},
		destroy: () => {}
	};
	const ctx = getContext();
	if (!ctx || !masterGain) return {
		setArcGain: () => {},
		setInkGain: () => {},
		beat: (_phase: number, _flat: number) => {},
		destroy: () => {}
	};

	// --- Arc buzz (continuous, gain-modulated) ---
	const arcOsc = ctx.createOscillator();
	const arcGain = ctx.createGain();
	const arcFilter = ctx.createBiquadFilter();

	arcOsc.type = 'square';
	arcOsc.frequency.value = 220;
	arcFilter.type = 'bandpass';
	arcFilter.frequency.value = 1800;
	arcGain.gain.value = 0;

	arcOsc.connect(arcFilter);
	arcFilter.connect(arcGain);
	arcGain.connect(masterGain);

	// --- Ink sub (continuous, gain-modulated) ---
	const inkOsc = ctx.createOscillator();
	const inkGain = ctx.createGain();

	inkOsc.type = 'sine';
	inkOsc.frequency.value = 70;
	inkGain.gain.value = 0;

	inkOsc.connect(inkGain);
	inkGain.connect(masterGain);

	arcOsc.start();
	inkOsc.start();

	// --- Heartbeat (procedural lub-dub) ---
	// Two sine oscillators always running: a "lub" at 50Hz and a "dub" at 35Hz.
	// Their gains are driven per-frame from the render loop via beat().
	const lubOsc = ctx.createOscillator();
	const dubOsc = ctx.createOscillator();
	const lubGain = ctx.createGain();
	const dubGain = ctx.createGain();

	lubOsc.type = 'sine';
	lubOsc.frequency.value = 50;
	lubGain.gain.value = 0;

	dubOsc.type = 'sine';
	dubOsc.frequency.value = 35;
	dubGain.gain.value = 0;

	const beatFilter = ctx.createBiquadFilter();
	beatFilter.type = 'lowpass';
	beatFilter.frequency.value = 100;

	lubOsc.connect(lubGain);
	dubOsc.connect(dubGain);
	lubGain.connect(beatFilter);
	dubGain.connect(beatFilter);
	beatFilter.connect(masterGain);

	lubOsc.start();
	dubOsc.start();

	let smoothLub = 0;
	let smoothDub = 0;

	return {
		setArcGain: (v: number) => { arcGain.gain.value = v; },
		setInkGain: (v: number) => { inkGain.gain.value = v; },

		// Call every frame from HeartScene render loop.
		// beatPhase: 0–1 cycle at 65 BPM (already computed in HeartScene)
		// flatlineFactor: 1.0 = alive, 0.0 = dissected (already computed)
		beat: (beatPhase: number, flatlineFactor: number) => {
			// Lub: sharp attack at phase 0, decay by 0.15
			let lubTarget = 0;
			if (beatPhase < 0.12) {
				lubTarget = Math.sin(beatPhase / 0.12 * Math.PI) * 0.35;
			}

			// Dub: secondary thump at phase 0.18–0.30
			let dubTarget = 0;
			if (beatPhase > 0.18 && beatPhase < 0.30) {
				const t = (beatPhase - 0.18) / 0.12;
				dubTarget = Math.sin(t * Math.PI) * 0.2;
			}

			// Kill both on dissection
			lubTarget *= flatlineFactor;
			dubTarget *= flatlineFactor;

			// Smooth to avoid clicks
			smoothLub += (lubTarget - smoothLub) * 0.3;
			smoothDub += (dubTarget - smoothDub) * 0.3;

			lubGain.gain.value = smoothLub;
			dubGain.gain.value = smoothDub;
		},

		destroy: () => {
			try {
				arcOsc.stop(); inkOsc.stop();
				lubOsc.stop(); dubOsc.stop();
				arcOsc.disconnect(); inkOsc.disconnect();
				arcGain.disconnect(); inkGain.disconnect();
				arcFilter.disconnect();
				lubOsc.disconnect(); dubOsc.disconnect();
				lubGain.disconnect(); dubGain.disconnect();
				beatFilter.disconnect();
			} catch (e) {}
		}
	};
}

// Global interaction listener to unlock AudioContext early
if (typeof window !== 'undefined') {
	const unlockEvents = ['pointerdown', 'touchstart', 'keydown', 'wheel'];
	const unlockAudio = () => {
		const ctx = getContext();
		if (ctx && ctx.state === 'suspended') {
			ctx.resume().catch(() => {});
		}
		unlockEvents.forEach(e => window.removeEventListener(e, unlockAudio));
	};
	unlockEvents.forEach(e => window.addEventListener(e, unlockAudio, { once: true, passive: true }));
}
