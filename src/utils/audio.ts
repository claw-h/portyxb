// Web Audio API Synthesizer for Diegetic Sound Design

let audioCtx: AudioContext | null = null;

function getContext() {
    if (typeof window === 'undefined') return null;
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// Chunky mechanical synth button clack
export function playClack() {
    const ctx = getContext();
    if (!ctx) return;
    
    const bufferSize = ctx.sampleRate * 0.06; // 60ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1; // white noise
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.06);
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start();
}

// Massive cinematic sub-bass rumble for the blast doors
export function playRumble(duration = 2.5) {
    const ctx = getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    // Deep sub-bass frequency
    osc.type = 'sine';
    osc.frequency.setValueAtTime(35, ctx.currentTime);
    // Add a slight pitch drop for weight
    osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + duration);
    
    // Envelope: slow rumble in, fade out
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.3); // Attack
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration); // Release
    
    // Optional distortion for extra "machinery" texture
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
    filter.frequency.value = 150; // Keep it deep

    osc.connect(waveShaper);
    waveShaper.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
}

// Digital UI blip for accordion toggles
export function playBlip() {
    const ctx = getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.08);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
}
