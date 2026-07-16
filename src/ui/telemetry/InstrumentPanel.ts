// ui/telemetry/InstrumentPanel.ts
import './InstrumentPanel.css';
import { type ChannelConfig, type PanelConfig, type TelemetryData, type ChannelType } from './types';

// =====================================================================
// Internal Utility Functions
// =====================================================================
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function polar(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

const ARC_MIN = -52;
const ARC_MAX = 52;
let svgIdCounter = 0;

// Reusable inline SVG definition for physical telemetry gears
const GEAR_SVG_PATH = `
  <svg class="telemetry-gear gear--alpha" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="20" fill="none" stroke="#1f2836" stroke-width="3"/>
    <path d="M50 10 L50 20 M50 80 L50 90 M10 50 L20 50 M80 50 L90 50 M22 22 L29 29 M71 71 L78 78 M22 78 L29 71 M71 22 L78 29" stroke="#1f2836" stroke-width="6" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="8" fill="#05070a"/>
  </svg>
  <svg class="telemetry-gear gear--beta" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="25" fill="none" stroke="#17202b" stroke-width="2"/>
    <path d="M50 5 L50 18 M50 82 L50 95 M5 50 L18 50 M82 50 L95 50" stroke="#17202b" stroke-width="8"/>
    <circle cx="50" cy="50" r="12" fill="#05070a"/>
  </svg>
`;

function buildMeterSVG(channel: Extract<ChannelConfig, { type: 'meter' }>) {
    const { min, max, majorStep, redlineFrom } = channel;
    const cx = 100, cy = 118, rOuter = 88, rTickOuter = 88, rTickInner = 74, rLabel = 60, rNeedle = 78;
    const gradId = `meterGrad${svgIdCounter++}`;

    const pMin = polar(cx, cy, rOuter, ARC_MIN);
    const pMax = polar(cx, cy, rOuter, ARC_MAX);

    let defs = `<defs><radialGradient id="${gradId}" cx="50%" cy="20%" r="90%">
    <stop offset="0%" stop-color="#fbf3d9"/>
    <stop offset="60%" stop-color="#e9dfc2"/>
    <stop offset="100%" stop-color="#c4b587"/>
  </radialGradient></defs>`;

    let face = `<path fill="url(#${gradId})" d="M ${pMin.x} ${pMin.y} A ${rOuter} ${rOuter} 0 0 1 ${pMax.x} ${pMax.y} L ${cx} ${cy} Z"/>`;

    let redline = '';
    if (redlineFrom != null) {
        const t0 = (redlineFrom - min) / (max - min);
        const a0 = lerp(ARC_MIN, ARC_MAX, t0);
        const p0 = polar(cx, cy, rTickOuter, a0);
        const p1 = polar(cx, cy, rTickOuter, ARC_MAX);
        redline = `<path class="meter__redline" d="M ${p0.x} ${p0.y} A ${rTickOuter} ${rTickOuter} 0 0 1 ${p1.x} ${p1.y}"/>`;
    }

    let ticks = '';
    const majorCount = Math.round((max - min) / majorStep);
    for (let i = 0; i <= majorCount * 2; i++) {
        const t = i / (majorCount * 2);
        const a = lerp(ARC_MIN, ARC_MAX, t);
        const isMajor = i % 2 === 0;
        const p0 = polar(cx, cy, rTickOuter, a);
        const p1 = polar(cx, cy, isMajor ? rTickInner : rTickInner + 5, a);
        ticks += `<line class="meter__tick${isMajor ? '' : ' meter__tick--minor'}" x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}"/>`;
        if (isMajor) {
            const v = Math.round(min + t * (max - min));
            const lp = polar(cx, cy, rLabel, a);
            ticks += `<text class="meter__ticklabel" x="${lp.x}" y="${lp.y + 3}">${v}</text>`;
        }
    }

    const needleTip = polar(cx, cy, rNeedle, 0);

    // Replace the old return statement with this one
    return `<svg class="meter__face" viewBox="0 0 200 130">
    ${defs}
    ${face}
    ${redline}
    ${ticks}
    <polygon class="meter__needle" data-needle points="${cx - 4},${cy + 6} ${cx + 4},${cy + 6} ${cx + 1},${cy - rNeedle} ${cx - 1},${cy - rNeedle}" fill="#171109" stroke="#171109" stroke-linejoin="round" stroke-width="1"/>
    <circle class="meter__pivot" cx="${cx}" cy="${cy}" r="5.5"/>
  </svg>`;
}

// =====================================================================
// Class Definition
// =====================================================================

interface InternalRef {
    channel: ChannelConfig;
    type: ChannelType;
    needle?: SVGPolygonElement;
    pointer?: HTMLElement;
    valueEl?: HTMLElement;
    toggleEl?: HTMLElement;
    ledEl?: HTMLElement;
    cx?: number;
    cy?: number;
}

export class InstrumentPanel {
    public readonly id: string;
    private config: PanelConfig;
    private current: Map<number, number | boolean> = new Map();
    private refs: InternalRef[] = [];
    public root: HTMLElement;

    constructor(config: PanelConfig) {
        this.id = config.id;
        this.config = config;
        this.root = this._build(config);
    }

    // Cached reference to the '.panel' element, set once in _build() instead of
    // re-querying the DOM on every mousemove event.
    private panelEl!: HTMLElement;

    // Driven by PanelManager's single centralized, rAF-throttled listener —
    // this panel no longer owns a window listener itself.
    public updateLightPosition(clientX: number, clientY: number) {
        if (!this.panelEl) return;

        const rect = this.panelEl.getBoundingClientRect();

        // Skip the write entirely if the cursor is nowhere near this panel
        // (cheap early-out before touching style so far-off panels do no work).
        const margin = 200;
        if (
            clientX < rect.left - margin ||
            clientX > rect.right + margin ||
            clientY < rect.top - margin ||
            clientY > rect.bottom + margin
        ) {
            return;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        this.panelEl.style.setProperty('--light-x', `${x}px`);
        this.panelEl.style.setProperty('--light-y', `${y}px`);
    }

    public mount(parent: HTMLElement) {
        parent.appendChild(this.root);
    }

    private _build(config: PanelConfig): HTMLElement {
        const assembly = document.createElement('div');
        assembly.className = 'panel-assembly';
        assembly.innerHTML = GEAR_SVG_PATH;

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
      <div class="panel__light-spill"></div><div class="panel__bolt panel__bolt--tl"></div>
      <div class="panel__bolt panel__bolt--tr"></div>
      <div class="panel__bolt panel__bolt--bl"></div>
      <div class="panel__bolt panel__bolt--br"></div>
      <div class="panel__lens-housing">
        <div class="panel__lens-overlay"></div>
        <div class="panel__faceplate">
          <div class="panel__header">
            <span class="panel__eyebrow">${config.eyebrow}</span>
            <span class="panel__title">${config.title}</span>
          </div>
        </div>
      </div>
    `;

        const faceplate = panel.querySelector('.panel__faceplate') as HTMLElement;
        const meters = config.channels.filter(c => c.type === 'meter');
        const mids = config.channels.filter(c => c.type === 'knob' || c.type === 'digital');
        const switches = config.channels.filter(c => c.type === 'toggle' || c.type === 'led');

        if (meters.length) faceplate.appendChild(this._row(meters));
        if (mids.length) faceplate.appendChild(this._row(mids));
        if (switches.length) faceplate.appendChild(this._row(switches));

        const footer = document.createElement('div');
        footer.className = 'panel__footer';
        footer.innerHTML = `
      <span class="panel__brand">${config.brand}</span>
      <span class="panel__model">${config.model}</span>
    `;
        faceplate.appendChild(footer);

        this.panelEl = panel;
        assembly.appendChild(panel);
        return assembly;
    }

    private _row(channels: ChannelConfig[]): HTMLElement {
        const row = document.createElement('div');
        row.className = 'panel__row';
        channels.forEach((channel) => row.appendChild(this._channel(channel)));
        return row;
    }

    private _channel(channel: ChannelConfig): HTMLElement {
        switch (channel.type) {
            case 'meter': return this._meter(channel);
            case 'knob': return this._knob(channel);
            case 'digital': return this._digital(channel);
            case 'toggle': return this._toggle(channel);
            case 'led': return this._led(channel);
            default:
                // Fallback for exhaustive checking
                const el = document.createElement('div');
                return el;
        }
    }

    private _meter(channel: Extract<ChannelConfig, { type: 'meter' }>): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'channel channel--meter';
        wrap.innerHTML = `
      <div class="meter__housing">${buildMeterSVG(channel)}</div>
      <div class="meter__label">${channel.label}</div>
    `;
        const needle = wrap.querySelector('[data-needle]') as SVGPolygonElement;
        this.refs.push({ channel, type: 'meter', needle, cx: 100, cy: 118 });
        return wrap;
    }

    private _knob(channel: Extract<ChannelConfig, { type: 'knob' }>): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'channel channel--knob';
        let ticks = '';
        const tickCount = 11;
        for (let i = 0; i < tickCount; i++) {
            const a = lerp(-135, 135, i / (tickCount - 1));
            ticks += `<div class="knob__tick" style="transform: rotate(${a}deg)"></div>`;
        }
        wrap.innerHTML = `
      <div class="knob__stage">
        <div class="knob__ticks">${ticks}</div>
        <div class="knob__outer-bezel">
          <div class="knob__body">
            <div class="knob__pointer" data-pointer></div>
          </div>
        </div>
      </div>
      <div class="knob__value" data-value>--</div>
      <div class="knob__label">${channel.label}</div>
    `;
        const pointer = wrap.querySelector('[data-pointer]') as HTMLElement;
        const valueEl = wrap.querySelector('[data-value]') as HTMLElement;
        this.refs.push({ channel, type: 'knob', pointer, valueEl });
        return wrap;
    }

    private _digital(channel: Extract<ChannelConfig, { type: 'digital' }>): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'channel channel--digital';
        wrap.innerHTML = `
      <div class="digital__screen"><span class="digital__value" data-value>--</span></div>
      <div class="digital__label">${channel.label}</div>
    `;
        const valueEl = wrap.querySelector('[data-value]') as HTMLElement;
        this.refs.push({ channel, type: 'digital', valueEl });
        return wrap;
    }

    private _toggle(channel: Extract<ChannelConfig, { type: 'toggle' }>): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'channel channel--toggle';
        wrap.innerHTML = `
      <div class="toggle__housing">
        <div class="toggle" data-toggle>
          <div class="toggle__track"><div class="toggle__thumb"></div></div>
          <div class="toggle__labels"><span>${channel.offLabel}</span><span>${channel.onLabel}</span></div>
        </div>
      </div>
      <div class="channel__label">${channel.label}</div>
    `;
        const toggleEl = wrap.querySelector('[data-toggle]') as HTMLElement;
        this.refs.push({ channel, type: 'toggle', toggleEl });
        return wrap;
    }

    private _led(channel: Extract<ChannelConfig, { type: 'led' }>): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'channel channel--led';
        wrap.innerHTML = `
      <div class="led__socket" data-led>
        <div class="led"><div class="led__body"></div></div>
      </div>
      <div class="channel__label">${channel.label}</div>
    `;
        const ledEl = wrap.querySelector('[data-led]') as HTMLElement;
        this.refs.push({ channel, type: 'led', ledEl });
        return wrap;
    }

    // =====================================================================
    // Public API Methods
    // =====================================================================

// Inside InstrumentPanel.ts
    public setPosition(x: number, y: number, z: number, rotationY: number) {
        // Assuming your root element is this.el
this.root.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotationY}deg) scale(var(--panel-scale, 0.80))`;    }

    public setOpacity(opacity: number) {
        this.root.style.opacity = String(opacity);
        this.root.style.pointerEvents = opacity > 0.1 ? 'auto' : 'none';
    }

    public show() {
        this.setOpacity(1);
    }

    public hide() {
        this.setOpacity(0);
    }

    public update(values: TelemetryData) {
        this.refs.forEach((ref, i) => {
            const raw = values[ref.channel.id];
            if (raw === undefined) return;

            if (ref.type === 'meter') {
                const config = ref.channel as Extract<ChannelConfig, { type: 'meter' }>;
                const { min, max } = config;
                const prev = this.current.has(i) ? (this.current.get(i) as number) : (raw as number);
                const next = lerp(prev, raw as number, 0.14);
                this.current.set(i, next);
                const t = clamp01((next - min) / (max - min));
                const angle = lerp(ARC_MIN, ARC_MAX, t);
                if (ref.needle && ref.cx && ref.cy) {
                    ref.needle.setAttribute('transform', `rotate(${angle} ${ref.cx} ${ref.cy})`);
                }
            } else if (ref.type === 'knob') {
                const config = ref.channel as Extract<ChannelConfig, { type: 'knob' }>;
                const { min, max, format } = config;
                const prev = this.current.has(i) ? (this.current.get(i) as number) : (raw as number);
                const next = lerp(prev, raw as number, 0.2);
                this.current.set(i, next);
                const t = clamp01((next - min) / (max - min));
                const angle = lerp(-135, 135, t);
                if (ref.pointer) ref.pointer.style.transform = `translate(-50%,0) rotate(${angle}deg)`;
                if (ref.valueEl) ref.valueEl.textContent = format ? format(next) : String(Math.round(next));
            } else if (ref.type === 'digital') {
                const config = ref.channel as Extract<ChannelConfig, { type: 'digital' }>;
                if (ref.valueEl) ref.valueEl.textContent = config.format ? config.format(raw as number) : String(raw);
            } else if (ref.type === 'toggle') {
                if (ref.toggleEl) ref.toggleEl.classList.toggle('is-on', !!raw);
            } else if (ref.type === 'led') {
                if (ref.ledEl) ref.ledEl.classList.toggle('is-on', !!raw);
            }
        });
    }

    public destroy() {
        this.root.remove();
        this.refs = [];
        this.current.clear();
    }
}