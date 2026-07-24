import { 
	MeshPhysicalMaterial,
	LineBasicMaterial,
	Object3D,
	Matrix4,
	EdgesGeometry,
	AdditiveBlending,
	ACESFilmicToneMapping,
	FogExp2,
	Points,
	AmbientLight,
	PointLight,
	SphereGeometry,
	Group,
	Float32BufferAttribute,
	LineSegments,
	BufferAttribute,
	DoubleSide,
	ShaderMaterial,
	Box3,
	AlwaysStencilFunc,
	ReplaceStencilOp,
	Scene, 
	PerspectiveCamera, 
	BufferGeometry,
	WebGLRenderer, 
	Color, 
	MeshBasicMaterial, 
	Mesh, 
	PlaneGeometry,
	Vector2,
	Vector3,
	Raycaster
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { PanelManager } from '../ui/telemetry/PanelManager';
import { type PanelConfig } from '../ui/telemetry/types';
import { clamp, lerp, smoothstep } from '../utils/math';
import { createLoopController } from '../utils/canvas';
import type { LoopController } from '../utils/canvas';
import { markReady } from '../utils/loadState';
import { setHoverTarget } from '../utils/hoverTargets';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

interface SliceMaterials {
	solid: MeshPhysicalMaterial;
	wire: MeshBasicMaterial;
	edges: LineBasicMaterial;
}

interface SliceHolder extends Group {
	userData: {
		baseY: number;
		direction: number;
		phase: number;
		index: number;
		materials: SliceMaterials;
	};
}

interface ScrollState {
	progress: number;
	heartFade: number;
	rotateHorizontal: number;
	rotateVertical: number;
	dissectionProgress: number;
	dischargeProgress: number;
	inkProgress: number;
	hudProgress: number;
	terminalProgress: number;
}

const SLICE_COUNT = 5;
const SLICE_GAP = 0.36;
const SCROLL_DAMPING = 0.08; 

const SLICE_NAMES: string[] = [
    'APEX',
    'INFERIOR VENTRICLE',
    'MID-VENTRICLE',
    'VALVE PLANE',
    'BASE',
];

const SLICE_DESCRIPTIONS: string[] = [
	'The heart\'s blunt lower point, formed mainly by the left ventricle\'s thick muscular wall. This is where the apical impulse can be felt against the chest.',
	'Thick left ventricular myocardium doing the heavy lifting of systemic circulation, alongside the thinner right ventricular free wall.',
	'Both ventricles in cross-section, separated by the interventricular septum. Papillary muscles and chordae tendineae anchor the valve leaflets here.',
	'The atrioventricular boundary: mitral and tricuspid valves control flow from atria into ventricles, preventing backflow during contraction.',
	'The heart\'s upper surface, where the great vessels take root: aorta, pulmonary artery, superior vena cava, and pulmonary veins.',
];

const EMISSIVE_COOL = new Color(0x0a1f3d);
const EMISSIVE_HOT = new Color(0.1, 0.6, 1.0);
const EMISSIVE_PEAK_INTENSITY = 2.4; 

const TIMELINE = {
	heartFade: { start: 0.035, end: 0.11 },
	rotateH: { start: 0.1, end: 0.34 },
	rotateV: { start: 0.34, end: 0.58 },
	dissection: { start: 0.62, end: 0.80 },  
	dischargeIn: { start: 0.74, end: 0.84 },
	dischargeOut: { start: 0.86, end: 0.90 }, 
	ink: { start: 0.80, end: 0.92 },         
	hudIn: { start: 0.02, end: 0.15 },
	hudOut: { start: 0.50, end: 0.60 },
	terminal: { start: 0.85, end: 0.95 }
} as const;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// Geometry helpers removed (moved to heartWorker.ts)

function loadHeartGeometry(
	url: string,
	sliceCount: number,
	group: Group,
	onDone: (result: { slices: SliceHolder[]; solids: Mesh[] }) => void
) {
	const worker = new Worker(new URL('./heartWorker.ts', import.meta.url), { type: 'module' });
	
	worker.onmessage = async (e) => {
		const { slicedPositions, slicedNormals, slicedEdges } = e.data;
		
		const result = await buildSlicesFromBuffers(slicedPositions, slicedNormals, slicedEdges, group);
		
		onDone(result);
		worker.terminate();
	};

	worker.postMessage({ url, sliceCount });
}

// =========================================================
// UNIFORM REVEAL & SPOTLIGHT CONFIGURATION
// =========================================================
const spotlightConfig = {
	pos: new Vector3(0, 0, 0),
	targetPos: new Vector3(0, 0, 0),
	intensity: 0,
	targetIntensity: 0,
	radius: 1.1,
};

const spotlightUniforms = {
	uScannerPos: { value: spotlightConfig.pos },
	uScannerRadius: { value: spotlightConfig.radius },
	uScannerIntensity: { value: spotlightConfig.intensity }
};

const injectSpotlightReveal = (shader: any) => {
	shader.uniforms.uScannerPos = spotlightUniforms.uScannerPos;
	shader.uniforms.uScannerRadius = spotlightUniforms.uScannerRadius;
	shader.uniforms.uScannerIntensity = spotlightUniforms.uScannerIntensity;

	shader.vertexShader = `
		varying vec3 vWorldPos;
		${shader.vertexShader}
	`.replace(
		`#include <project_vertex>`,
		`#include <project_vertex>\n			 vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
	);

	shader.fragmentShader = `
		uniform vec3 uScannerPos;
		uniform float uScannerRadius;
		uniform float uScannerIntensity;
		varying vec3 vWorldPos;
		${shader.fragmentShader}
	`.replace(
		`#include <dithering_fragment>`,
		`
		#include <dithering_fragment>
		float shaderDist = distance(vWorldPos, uScannerPos);
		float shaderReveal = 1.0 - smoothstep(uScannerRadius * 0.1, uScannerRadius, shaderDist);
		shaderReveal *= uScannerIntensity;

		float baseVisibility = 0.025;
		
		gl_FragColor.a = mix(gl_FragColor.a * baseVisibility, gl_FragColor.a * 1.0, shaderReveal);
		
		vec3 volumetricColor = vec3(0.48, 0.82, 1.0);
		float volumetricFalloff = pow(1.0 - clamp(shaderDist / uScannerRadius, 0.0, 1.0), 2.5);
		gl_FragColor.rgb += volumetricColor * volumetricFalloff * uScannerIntensity * 0.48;
		`
	);
};

async function buildSlicesFromBuffers(
	slicedPositions: Float32Array[],
	slicedNormals: Float32Array[],
	slicedEdges: Float32Array[],
	group: Group,
): Promise<{ slices: SliceHolder[]; solids: Mesh[] }> {
	const slices: SliceHolder[] = [];
	const solids: Mesh[] = [];

	const solidMaterial = new MeshPhysicalMaterial({
		color: 0x081c33,
		emissive: 0x0a1f3d,
		emissiveIntensity: 0.2,
		transparent: true,
		opacity: 0.75,
		roughness: 0.12, 
		metalness: 0.65, 
		side: DoubleSide,
		depthWrite: false,
		stencilWrite: true,
		stencilRef: 1,
		stencilFunc: AlwaysStencilFunc,
		stencilZPass: ReplaceStencilOp,
	});

	const wireMaterial = new MeshBasicMaterial({
		color: 0xd2edff,
		transparent: true,
		opacity: 0.22, 
		wireframe: true,
		depthWrite: false,
	});

	const edgeMaterial = new LineBasicMaterial({
		color: 0x82d6ff,
		transparent: true,
		opacity: 0.18, 
	});

	solidMaterial.onBeforeCompile = injectSpotlightReveal;
	wireMaterial.onBeforeCompile = injectSpotlightReveal;
	edgeMaterial.onBeforeCompile = injectSpotlightReveal;

	for (let i = 0; i < slicedPositions.length; i++) {
		const posBuffer = slicedPositions[i];
		const normBuffer = slicedNormals[i];
		const edgeBuffer = slicedEdges[i];
		
		if (!posBuffer || posBuffer.length === 0) continue;

		const sliceGeometry = new BufferGeometry();
		sliceGeometry.setAttribute('position', new BufferAttribute(posBuffer, 3));
		sliceGeometry.setAttribute('normal', new BufferAttribute(normBuffer, 3));
		sliceGeometry.computeBoundingBox();

		const edgesGeometry = new BufferGeometry();
		edgesGeometry.setAttribute('position', new BufferAttribute(edgeBuffer, 3));

		const holder = new Group() as SliceHolder;
		holder.userData.baseY = 0;
		holder.userData.direction = i - (slicedPositions.length - 1) / 2;
		holder.userData.phase = i * 0.34;
		holder.userData.index = i;

		const solid = new Mesh(sliceGeometry, solidMaterial);
		const wire = new Mesh(sliceGeometry.clone(), wireMaterial);
		const edges = new LineSegments(edgesGeometry, edgeMaterial);

		wire.scale.setScalar(1.006);
		edges.scale.setScalar(1.011);

		holder.add(solid, wire, edges);
		holder.userData.materials = { solid: solidMaterial, wire: wireMaterial, edges: edgeMaterial };
		group.add(holder);
		slices.push(holder);
		solids.push(solid);
	}

	return { slices, solids };
}

function evaluateScrollState(progress: number): ScrollState {
    const p = Math.min(progress, 1.0); 
    return {
        progress,                       
		heartFade: Math.max(0.001, smoothstep(TIMELINE.heartFade.start, TIMELINE.heartFade.end, p)),
        rotateHorizontal: smoothstep(TIMELINE.rotateH.start, TIMELINE.rotateH.end, p),
        rotateVertical: smoothstep(TIMELINE.rotateV.start, TIMELINE.rotateV.end, p),
        dissectionProgress: smoothstep(TIMELINE.dissection.start, TIMELINE.dissection.end, p),
        dischargeProgress: smoothstep(TIMELINE.dischargeIn.start, TIMELINE.dischargeIn.end, p) * (1 - smoothstep(TIMELINE.dischargeOut.start, TIMELINE.dischargeOut.end, p)),
        inkProgress: smoothstep(TIMELINE.ink.start, TIMELINE.ink.end, p),
        hudProgress: smoothstep(TIMELINE.hudIn.start, TIMELINE.hudIn.end, p) * (1 - smoothstep(TIMELINE.hudOut.start, TIMELINE.hudOut.end, p)),
        terminalProgress: smoothstep(TIMELINE.terminal.start, TIMELINE.terminal.end, p),
    };
}

function turbulence(i: number, y: number, t: number): number {
	return (
		Math.sin(y * 1.3 + t * 0.9 + i * 12.9898) * 0.5 +
		Math.sin(y * 3.7 - t * 1.7 + i * 78.233) * 0.25 +
		Math.sin(y * 7.1 + t * 2.3 + i * 37.719) * 0.125
	);
}

// ---------------------------------------------------------------------------
// Electrical discharge system
// ---------------------------------------------------------------------------

const DISCHARGE_ORIGIN_Y = 0;
const DISCHARGE_ANCHOR_JITTER = 0.85;

const ARC_POOL_SIZE = 12;
const ARC_SUBDIVISIONS = 5;
const ARC_SEGMENT_COUNT = 2 ** ARC_SUBDIVISIONS;
const ARC_JITTER = 0.34;
const ARC_MIN_LIFE = 0.06;
const ARC_MAX_LIFE = 0.14;
const ARC_HOT_COLOR = EMISSIVE_HOT.clone().multiplyScalar(5.5);
const ARC_COOL_COLOR = EMISSIVE_COOL.clone().multiplyScalar(2.4);

const scratchAnchorA = new Vector3();
const scratchAnchorB = new Vector3();
const scratchSparkSpawn = new Vector3();

function subdivideBolt(a: Vector3, b: Vector3, depth: number, jitter: number, out: number[]): void {
	if (depth <= 0) {
		out.push(b.x, b.y, b.z);
		return;
	}

	const dir = new Vector3().subVectors(b, a);
	const perp = new Vector3(-dir.y, dir.x, dir.z * 0.35);
	if (perp.lengthSq() < 0.0001) perp.set(1, 0, 0);
	perp.normalize();

	const kick = (Math.random() - 0.5) * 2 * jitter * dir.length();
	const mid = a.clone().lerp(b, 0.5).addScaledVector(perp, kick);

	subdivideBolt(a, mid, depth - 1, jitter * 0.6, out);
	subdivideBolt(mid, b, depth - 1, jitter * 0.6, out);
}

function buildBoltPositions(a: Vector3, b: Vector3, target: Float32Array): void {
	const points: number[] = [a.x, a.y, a.z];
	subdivideBolt(a, b, ARC_SUBDIVISIONS, ARC_JITTER, points);

	let w = 0;
	for (let i = 0; i < ARC_SEGMENT_COUNT; i++) {
		target[w++] = points[i * 3];
		target[w++] = points[i * 3 + 1];
		target[w++] = points[i * 3 + 2];
		target[w++] = points[(i + 1) * 3];
		target[w++] = points[(i + 1) * 3 + 1];
		target[w++] = points[(i + 1) * 3 + 2];
	}
}

function pickDischargeAnchors(slices: SliceHolder[], a: Vector3, b: Vector3): boolean {
	if (slices.length < 2) return false;

	const i = Math.floor(Math.random() * (slices.length - 1));
	slices[i].getWorldPosition(a);
	slices[i + 1].getWorldPosition(b);

	a.x += (Math.random() - 0.5) * DISCHARGE_ANCHOR_JITTER;
	a.z += (Math.random() - 0.5) * DISCHARGE_ANCHOR_JITTER * 0.6;
	b.x += (Math.random() - 0.5) * DISCHARGE_ANCHOR_JITTER;
	b.z += (Math.random() - 0.5) * DISCHARGE_ANCHOR_JITTER * 0.6;
	return true;
}

interface ArcBolt {
	mesh: LineSegments;
	material: LineBasicMaterial;
	nextStrikeAt: number;
}

function createArcBoltSystem(spotlight: typeof spotlightUniforms) {
	const group = new Group();
	const bolts: ArcBolt[] = [];

	for (let i = 0; i < ARC_POOL_SIZE; i++) {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(new Float32Array(ARC_SEGMENT_COUNT * 2 * 3), 3));

		const material = new LineBasicMaterial({
			color: ARC_HOT_COLOR,
			transparent: true,
			opacity: 0,
			blending: AdditiveBlending,
			depthWrite: false,
		});

		const mesh = new LineSegments(geometry, material);
		mesh.visible = false;
		group.add(mesh);
		bolts.push({ mesh, material, nextStrikeAt: Math.random() * ARC_MAX_LIFE });
	}

	const update = (time: number, intensity: number, slices: SliceHolder[]) => {
		const tSec = time * 0.001;
		const spotBoost = 0.55 + spotlight.uScannerIntensity.value * 0.45;
		const active = intensity > 0.02 && slices.length >= 2;

		for (const bolt of bolts) {
			if (!active) {
				bolt.mesh.visible = false;
				continue;
			}

			if (tSec >= bolt.nextStrikeAt) {
				if (pickDischargeAnchors(slices, scratchAnchorA, scratchAnchorB)) {
					const attr = bolt.mesh.geometry.attributes.position as BufferAttribute;
					buildBoltPositions(scratchAnchorA, scratchAnchorB, attr.array as Float32Array);
					attr.needsUpdate = true;
					bolt.mesh.geometry.computeBoundingSphere();
				}
				bolt.nextStrikeAt = tSec + ARC_MIN_LIFE + Math.random() * (ARC_MAX_LIFE - ARC_MIN_LIFE);
				bolt.material.color.copy(Math.random() > 0.35 ? ARC_HOT_COLOR : ARC_COOL_COLOR);
			}

			const lifeRemaining = clamp((bolt.nextStrikeAt - tSec) / ARC_MIN_LIFE);
			bolt.material.opacity = intensity * spotBoost * (0.6 + 0.4 * Math.random()) * lifeRemaining;
			bolt.mesh.visible = bolt.material.opacity > 0.02;
		}
	};

	return { mesh: group, update };
}

function createSparkSystem(sparkCount = 140, spotlight: typeof spotlightUniforms) {
	const geometry = new BufferGeometry();
	const positions = new Float32Array(sparkCount * 3);
	const velocities = new Float32Array(sparkCount * 3);
	const lifetimes = new Float32Array(sparkCount);
	const sizes = new Float32Array(sparkCount);

	const LIFE_DECAY = 0.11; 
	const lifeDecayJitter = new Float32Array(sparkCount);
	const GRAVITY = 0.00045; 
	const DRAG = 0.92;
	const TURBULENCE_STRENGTH = 0.0035;

	function resetParticle(i: number, slices: SliceHolder[]) {
		let originX = 0;
		let originY = DISCHARGE_ORIGIN_Y;
		let originZ = 1;

		if (pickDischargeAnchors(slices, scratchAnchorA, scratchAnchorB)) {
			scratchSparkSpawn.copy(scratchAnchorA).lerp(scratchAnchorB, Math.random());
			originX = scratchSparkSpawn.x;
			originY = scratchSparkSpawn.y;
			originZ = scratchSparkSpawn.z + 0.3;
		}

		positions[i * 3] = originX + (Math.random() - 0.5) * 0.3;
		positions[i * 3 + 1] = originY + (Math.random() - 0.5) * 0.15;
		positions[i * 3 + 2] = originZ + (Math.random() - 0.5) * 0.3;

		const angle = Math.random() * Math.PI * 2;
		const speed = 0.02 + Math.random() * 0.05;
		velocities[i * 3] = Math.cos(angle) * speed;
		velocities[i * 3 + 1] = (Math.random() - 0.3) * 0.05;
		velocities[i * 3 + 2] = Math.sin(angle) * speed * 0.6;

		sizes[i] = Math.random() * 0.16 + 0.06;
		lifeDecayJitter[i] = 0.8 + Math.random() * 0.4;
		lifetimes[i] = 1.0;
	}

	for (let i = 0; i < sparkCount; i++) {
		resetParticle(i, []);
		lifetimes[i] = Math.random();
	}

	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('aVelocity', new BufferAttribute(velocities, 3));
	geometry.setAttribute('aLife', new BufferAttribute(lifetimes, 1));
	geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));

	const material = new ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uIntensity: { value: 0.0 },
			uScannerPos: spotlight.uScannerPos,
			uScannerRadius: spotlight.uScannerRadius,
			uScannerIntensity: spotlight.uScannerIntensity
		},
		vertexShader: `
			attribute float aLife;
			attribute float aSize;
			varying float vLife;
			varying float vSpotMask;
			uniform float uIntensity;
			uniform vec3 uScannerPos;
			uniform float uScannerRadius;
			uniform float uScannerIntensity;

			void main() {
				vLife = aLife;
				vec4 worldPos = modelMatrix * vec4(position, 1.0);
				float d = distance(worldPos.xyz, uScannerPos);
				float distFalloff = 1.0 - smoothstep(uScannerRadius * 0.1, uScannerRadius, d);
				vSpotMask = mix(0.55, 1.0, uScannerIntensity) * mix(1.0, distFalloff, uScannerIntensity);

				vec4 mvPosition = viewMatrix * worldPos;
				float pointSize = aSize * 70.0 * (vLife + 0.2) * uIntensity * vSpotMask * (10.0 / -mvPosition.z);
				gl_PointSize = min(pointSize, 85.0);
				gl_Position = projectionMatrix * mvPosition;
			}
		`,
		fragmentShader: `
			varying float vLife;
			varying float vSpotMask;
			uniform float uIntensity;

			void main() {
				if (uIntensity < 0.01 || vSpotMask < 0.01) discard;

				vec2 xy = gl_PointCoord.xy - vec2(0.5);
				float dist = length(xy);
				if (dist > 0.5) discard;

				vec3 colorHot = vec3(1.0, 2.0, 3.4);
				vec3 colorCool = vec3(0.15, 0.4, 0.9);
				vec3 finalColor = mix(colorCool, colorHot, smoothstep(0.0, 1.0, vLife)) * (1.0 + vSpotMask * 3.5);

				float glow = smoothstep(0.5, 0.05, dist);
				float alpha = glow * vLife * uIntensity * vSpotMask;
				gl_FragColor = vec4(finalColor, alpha);
			}
		`,
		transparent: true,
		blending: AdditiveBlending,
		depthWrite: false,
	});

	const points = new Points(geometry, material);

	let lastTime: number | null = null;

	const update = (time: number, intensity: number, slices: SliceHolder[]) => {
		material.uniforms.uIntensity.value = intensity;
		if (intensity <= 0.001) return;

		const tSec = time * 0.001;
		material.uniforms.uTime.value = tSec;

		const dt = lastTime === null ? 1 : Math.min(Math.max((time - lastTime) / 16.6667, 0), 3);
		lastTime = time;

		const posAttr = geometry.attributes.position;
		const lifeAttr = geometry.attributes.aLife;
		const velAttr = geometry.attributes.aVelocity;

		for (let i = 0; i < sparkCount; i++) {
			let life = lifeAttr.getX(i);
			life -= LIFE_DECAY * lifeDecayJitter[i] * dt;

			if (life <= 0) {
				resetParticle(i, slices);
				continue;
			}

			lifeAttr.setX(i, life);

			let vx = velAttr.getX(i);
			let vy = velAttr.getY(i);
			let vz = velAttr.getZ(i);

			vy -= GRAVITY * dt;

			const n = turbulence(i, posAttr.getY(i), tSec);
			vx = vx * Math.pow(DRAG, dt) + n * TURBULENCE_STRENGTH * dt;
			vz = vz * Math.pow(DRAG, dt);

			velAttr.setX(i, vx);
			velAttr.setY(i, vy);
			velAttr.setZ(i, vz);

			posAttr.setX(i, posAttr.getX(i) + vx * dt);
			posAttr.setY(i, posAttr.getY(i) + vy * dt);
			posAttr.setZ(i, posAttr.getZ(i) + vz * dt);
		}

		posAttr.needsUpdate = true;
		lifeAttr.needsUpdate = true;
		velAttr.needsUpdate = true;
	};

	return { mesh: points, update };
}

function createDischargeSystem(sparkCount = 140, spotlight: typeof spotlightUniforms) {
	const arcs = createArcBoltSystem(spotlight);
	const sparks = createSparkSystem(sparkCount, spotlight);

	const group = new Group();
	group.add(arcs.mesh);
	group.add(sparks.mesh);

	let smoothedIntensity = 0;
	let lastTime: number | null = null;
	const SMOOTH_RATE = 4.5; 

	const update = (time: number, intensity: number, slices: SliceHolder[]) => {
		const dtSeconds = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000);
		lastTime = time;

		const alpha = 1 - Math.exp(-SMOOTH_RATE * dtSeconds);
		smoothedIntensity += (intensity - smoothedIntensity) * alpha;

		arcs.update(time, smoothedIntensity, slices);
		sparks.update(time, smoothedIntensity, slices);
	};

	return { mesh: group, update };
}

// ---------------------------------------------------------------------------
// Public setup function
// ---------------------------------------------------------------------------

export function setupHeartScene(): LoopController | null {
	const section = document.querySelector<HTMLElement>('[data-hero]') as HTMLElement;
	const canvas = document.querySelector<HTMLCanvasElement>('[data-heart-canvas]') as HTMLElement;
	const progressContainer = document.querySelector<HTMLElement>('.hero-progress');
	const progressFill = document.querySelector<HTMLElement>('[data-hero-progress]');
	const depthReadout = document.querySelector<HTMLElement>('[data-depth-readout]');
	// [data-dimension-label] elements removed — labels are now inside the slice-info panel
	const scrollPrompt = document.querySelector<HTMLElement>('[data-scroll-prompt]');
	const fillAortic = document.querySelector<HTMLElement>('.gel-fill--aortic');
	const fillVentricle = document.querySelector<HTMLElement>('.gel-fill--ventricle');
	const borderSvg = document.querySelector<SVGSVGElement>('.hero-border-svg');
	const borderPaths = document.querySelectorAll<SVGPathElement>('.hero-border-path');
	
	const heroCopyEl = document.querySelector<HTMLElement>('[data-hero-copy]');
	const lineOne = heroCopyEl?.querySelector<HTMLElement>('.hero-copy-line--one');
	const lineTwo = heroCopyEl?.querySelector<HTMLElement>('.hero-copy-line--two');

	const uiLayer = document.getElementById('heart-ui-layer');
    if (!uiLayer) {
        console.warn('Telemetry UI layer (#heart-ui-layer) not found in DOM.');
    }
    const panelManager = new PanelManager(uiLayer as HTMLElement);

    const panelConfigs: PanelConfig[] = [
        {
            id: 'telemetry-left',
            eyebrow: 'SYS-01',
            title: 'Cardiac Descent',
            brand: 'HEMODYNAMICS',
            model: 'MK-IV',
            channels: [
                { id: 'heartFade', type: 'meter', label: 'Heart Opacity', min: 0, max: 100, majorStep: 25 },
                { id: 'dissection', type: 'meter', label: 'Dissection Depth', min: 0, max: 100, majorStep: 25, redlineFrom: 80 },
                { id: 'progressKnob', type: 'knob', label: 'Scroll Depth', min: 0, max: 100 },
                { id: 'progressPct', type: 'digital', label: 'Progress Tracking', format: (v) => v.toFixed(1) + '%' }
            ]
        },
        {
            id: 'telemetry-right',
            eyebrow: 'SYS-02',
            title: 'Optical Tracking',
            brand: 'MYOCARDIUM',
            model: 'LV-X',
            channels: [
                { id: 'lat', type: 'meter', label: 'Cursor Lat', min: -100, max: 100, majorStep: 50 },
                { id: 'long', type: 'meter', label: 'Cursor Long', min: -100, max: 100, majorStep: 50 },
                { id: 'intersect', type: 'led', label: 'Target Intersection' }
            ]
        },
        {
            id: 'slice-info',
            eyebrow: 'SYS-03',
            title: 'Tissue Analysis',
            brand: 'HISTOLOGY',
            model: 'HX-1',
            labels: [
                'Aortic Arch & Pulmonary Artery',
                'Left & Right Atria',
                'Mitral & Tricuspid Valves',
                'Ventricular Chambers',
                'Myocardial Apex',
            ],
            channels: [
                { id: 'sliceName', type: 'text', label: 'Region', placeholder: 'Scanning...' },
                { id: 'sliceText', type: 'text', label: 'Function', placeholder: 'Hover a slice to inspect tissue function.' }
            ]
        }
    ];
    panelConfigs.forEach(c => panelManager.registerPanel(c));

	let pathLength = 0;
	let pTop = 0;
	let pBot = 0;
	let cachedH = 0;

	let audioCtx: AudioContext | null = null;
    let arcOsc: OscillatorNode | null = null;
    let arcGain: GainNode | null = null;
    let inkOsc: OscillatorNode | null = null;
    let inkGain: GainNode | null = null;

    let maxProgress = 0;
    let decoupledDischargeIntensity = 0;
    let dischargeActive = false;
    let isHoveringPrevState = false;

	function initSynthEngine() {
        if (audioCtx) return;
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioContextClass();

        arcOsc = audioCtx.createOscillator();
        arcGain = audioCtx.createGain();
        const arcFilter = audioCtx.createBiquadFilter();
        
        arcOsc.type = 'square';
        arcOsc.frequency.setValueAtTime(220, audioCtx.currentTime); 
        arcFilter.type = 'bandpass';
        arcFilter.frequency.setValueAtTime(1800, audioCtx.currentTime); 

        arcOsc.connect(arcFilter);
        arcFilter.connect(arcGain);
        arcGain.connect(audioCtx.destination);
        arcGain.gain.setValueAtTime(0, audioCtx.currentTime); 
        arcOsc.start();

        inkOsc = audioCtx.createOscillator();
        inkGain = audioCtx.createGain();
        
        inkOsc.type = 'sine';
        inkOsc.frequency.setValueAtTime(70, audioCtx.currentTime);

        inkOsc.connect(inkGain);
        inkGain.connect(audioCtx.destination);
        inkGain.gain.setValueAtTime(0, audioCtx.currentTime); 
        inkOsc.start();
    }

	function updateBorderLength() {
		if (borderPaths.length === 2 && borderSvg) {
			const rect = borderSvg.getBoundingClientRect();
			const w = rect.width;
			cachedH = rect.height;
			
			borderSvg.setAttribute('viewBox', `0 0 ${w} ${cachedH}`);
			
			pTop = (window.innerHeight * 0.18) - 24;
			pBot = (window.innerHeight * 0.82) - 24;
			
			borderPaths[0].setAttribute('d', `M ${w - 1} ${cachedH / 2} L ${w - 1} 1 L 1 1 L 1 ${cachedH / 2}`);
			borderPaths[1].setAttribute('d', `M ${w - 1} ${cachedH / 2} L ${w - 1} ${cachedH - 1} L 1 ${cachedH - 1} L 1 ${cachedH / 2}`);
			
			pathLength = w + cachedH - 4;
			
			borderPaths.forEach(path => {
				path.style.strokeDasharray = `${pathLength}`;
			});
		}
	}
	
	updateBorderLength();

	if (!section || !canvas) {
		markReady('heart');
		return null;
	}

	window.setTimeout(() => {
		if (window.scrollY < 8) section.classList.add('is-idle');
	}, 1400);

	let cachedSectionTop = 0;
	let cachedScrollableRange = 0;
	
	let targetProgress = 0;
	let currentProgress = 0;
	let prevProgress = 0;

    const mouse = {
        currentX: 0,
        currentY: 0,
        targetX: 0,
        targetY: 0
    };

    // Slice Modal State Tracker — shrink/expand with 1s dwell
    const modalState = {
        displayIndex: -1,       // confirmed slice (content currently shown)
        pendingIndex: -1,       // slice being hovered (before dwell confirms)
        dwellTimer: 0,          // seconds continuously hovering pendingIndex
        scaleY: 0,              // animated detail height fraction (0=collapsed, 1=expanded)
        targetScaleY: 0,        // lerp target for scaleY
        phase: 'collapsed' as 'collapsed' | 'collapsing' | 'expanding',
        panelOpacity: 0,        // overall panel fade (0 before dissection, 1 after)
        lastTime: 0,
    };
    
    let isIntersecting = false;
    let isVisible = false;
    let hoveredSliceIndex = -1;

    const handleMouseMove = (e: MouseEvent) => {
        mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    const heartRaycaster = new Raycaster();
    const heartPointerNdc = new Vector2();
    // scratchLabelPos removed — floating labels are now inside the panel
    const scratchHeartCenter = new Vector3(); // reused each frame for heart projection

	const scene = new Scene();
	scene.fog = new FogExp2(0x020308, 0.035);

	const camera = new PerspectiveCamera(38, 1, 0.1, 100);
	camera.position.set(0, 0.02, 6.9);

	const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance', stencil: true });
	renderer.localClippingEnabled = true;
	renderer.setClearColor(0x000000, 0); 
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;

	const renderPass = new RenderPass(scene, camera);
	renderPass.clearColor = new Color(0, 0, 0);
	renderPass.clearAlpha = 0;

	const bloomPass = new UnrealBloomPass(
		new Vector2(window.innerWidth/2, window.innerHeight/2),
		0.1, 
		0.1, 
		0.9  
	);

	const InkShader = {
		uniforms: {
			tDiffuse: { value: null }, 
			uProgress: { value: 0.0 }, 
			uTime: { value: 0.0 },
			uAspect: { value: 1.0 }    
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uProgress;
        uniform float uTime;
        uniform float uAspect;
        varying vec2 vUv;

        vec2 hash(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
        }

        float noise(vec2 p) {
            const float K1 = 0.366025404; 
            const float K2 = 0.211324865; 
            vec2 i = floor(p + (p.x + p.y) * K1);
            vec2 a = p - i + (i.x + i.y) * K2;
            vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec2 b = a - o + K2;
            vec2 c = a - 1.0 + 2.0 * K2;
            vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
            vec3 n = h * h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
            return dot(n, vec3(70.0));
        }

        float fbm(vec2 uv) {
            float f = 0.0;
            vec2 p = uv * 2.5; 
            f += 0.5000 * noise(p); p = p * 2.02;
            f += 0.2500 * noise(p); p = p * 2.03;
            f += 0.1250 * noise(p); p = p * 2.01;
            f += 0.0625 * noise(p);
            return f / 0.9375;
        }

        void main() {
            if (uProgress <= 0.001) {
                gl_FragColor = texture2D(tDiffuse, vUv);
                return;
            }

            vec2 aspectUv = vec2(vUv.x * uAspect, vUv.y);
            vec2 fluidUv = aspectUv + vec2(0.0, uTime * -0.1);
            float fluid = fbm(fluidUv);
            
            float threshold = 1.2 - (uProgress * 1.5);
            
            float edge = smoothstep(threshold - 0.2, threshold + 0.2, fluid);
            float distortion = (1.0 - edge) * edge * 4.0; 
            
            float aberrationAmount = clamp(fluid, 0.0, 1.0) * distortion;
            vec2 rOffset = vec2(0.015, 0.0) * aberrationAmount;
            vec2 bOffset = vec2(-0.015, 0.0) * aberrationAmount;
            
            float rCol = texture2D(tDiffuse, vUv + rOffset).r;
            float gCol = texture2D(tDiffuse, vUv).g;
            float bCol = texture2D(tDiffuse, vUv + bOffset).b;
            
            vec4 baseFrame = vec4(rCol, gCol, bCol, 1.0);
            
            float inkAlpha = smoothstep(threshold, threshold + 0.4, fluid);
            
            inkAlpha *= smoothstep(0.0, 0.05, uProgress);
            inkAlpha = mix(inkAlpha, 1.0, smoothstep(0.9, 1.0, uProgress));
            
            gl_FragColor = mix(baseFrame, vec4(0.0, 0.0, 0.0, 1.0), inkAlpha);
        }
    `
	};

	const inkPass = new ShaderPass(InkShader);
	const composer = new EffectComposer(renderer);
	composer.addPass(renderPass);
	composer.addPass(bloomPass);
	composer.addPass(inkPass);

	const dischargeSystem = createDischargeSystem(180, spotlightUniforms); 
	scene.add(dischargeSystem.mesh);

	const heartGroup = new Group();
	scene.add(heartGroup);

	const ambient = new AmbientLight(0x4da2ff, 1.8);
	const key = new PointLight(0xa6d8ff, 95, 14);
	key.position.set(3, 2.8, 4);
	const blue = new PointLight(0x00aaff, 45, 12);
	blue.position.set(-3, -1.8, 3);
	scene.add(ambient, key, blue);

	const spotlightPointLight = new PointLight(0x8fdcff, 0, 5);
	scene.add(spotlightPointLight);

	const gridMaterial = new ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uGlowColor: { value: new Color(0x6b8c96) } 
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float uTime;
			uniform vec3 uGlowColor;
			varying vec2 vUv;

			void main() {
				vec2 gridUv = vUv * 110.0;
				vec2 grid = fract(gridUv);
				
				float lineX = smoothstep(0.04, 0.0, grid.x) + smoothstep(0.96, 1.0, grid.x);
				float lineY = smoothstep(0.04, 0.0, grid.y) + smoothstep(0.96, 1.0, grid.y);
				
				float intersection = lineX * lineY;
				float baseAlpha = intersection; 
				
				float wave1 = sin(vUv.x * 12.0 + uTime * 0.8) * cos(vUv.y * 14.0 - uTime * 0.6);
				float wave2 = sin((vUv.x - vUv.y) * 20.0 + uTime * 1.2);
				float hotspot = wave1 * 0.5 + wave2 * 0.5;
				
				hotspot = smoothstep(0.1, 0.9, hotspot);
				float alpha = baseAlpha * (0.05 + hotspot * 0.95);

				float dist = distance(vUv, vec2(0.5, 0.5));
				float vignette = 1.0 - smoothstep(0.1, 0.40, dist);

				float finalAlpha = alpha * vignette * 0.8; 

				if (finalAlpha < 0.005) discard;

				vec3 finalColor = uGlowColor * (1.0 + (hotspot * 3.5));
				gl_FragColor = vec4(finalColor, finalAlpha);
			}
		`,
		transparent: true,
		blending: AdditiveBlending,
		depthWrite: false
	});
	
	const screenGrid = new Mesh(new PlaneGeometry(80, 80), gridMaterial);
	screenGrid.position.z = -15; 
	scene.add(screenGrid);

	let slices: SliceHolder[] = [];
	let solidMeshes: Mesh[] = []; 

	loadHeartGeometry('/heart-meshopt.glb', SLICE_COUNT, heartGroup, async (result) => {
		slices = result.slices;
		solidMeshes = result.solids;
		
		// Chunk 1: Grid
		heartGroup.visible = false;
		dischargeSystem.mesh.visible = false;
		renderer.compile(scene, camera);
		await new Promise(r => setTimeout(r, 20));
		
		// Chunk 2: Discharge
		dischargeSystem.mesh.visible = true;
		renderer.compile(scene, camera);
		await new Promise(r => setTimeout(r, 20));
		
		// Chunk 3: Heart Slices
		heartGroup.visible = true;
		renderer.compile(scene, camera);
		await new Promise(r => setTimeout(r, 20));

		markReady('heart');
	});
	
	function applyDOMScrollState(state: ScrollState): void {
        const { progress, heartFade, hudProgress, terminalProgress } = state;
    
        const BORDER_START = 0.88;
        const BORDER_END   = 0.91;
        const SNAP_OUT     = 0.92; 
        
        if (progressFill && progressContainer) {
            const fillPct = Math.min(progress / BORDER_START, 1.0) * 100;
            progressFill.style.height = `${fillPct}%`;
        }

		let rectOpacity = 1;
		let rectScale = 1;

		if (progress >= SNAP_OUT) {
			const snapProgress = clamp((progress - SNAP_OUT) / 0.02); 
			rectOpacity = 1 - snapProgress;
			rectScale = 1 + (snapProgress * 0.05); 
		}

		if (progressContainer) {
			if (progress < 0.02 || progress >= SNAP_OUT) {
				progressContainer.style.opacity = '0';
			} else {
				progressContainer.style.opacity = '1';
			}
			
			const pushOutwardX = (rectScale - 1) * 400; 
			progressContainer.style.transform = `translate3d(${pushOutwardX}px, 0, 0) scale(${rectScale})`;
		}

        if (borderPaths.length === 2 && borderSvg) {
			const topScrollbarLength = (cachedH / 2) - pTop;
			const botScrollbarLength = pBot - (cachedH / 2);

            if (progress < BORDER_START) {
                borderSvg.style.opacity = '0';
				borderPaths[0].style.strokeDashoffset = `${pathLength - topScrollbarLength}`;
				borderPaths[1].style.strokeDashoffset = `${pathLength - botScrollbarLength}`;
                borderSvg.style.transform = `scale(1)`;
                borderSvg.classList.remove('is-snapped');
            } else if (progress < BORDER_END) {
                borderSvg.style.opacity = '1';
                borderSvg.style.transform = `scale(1)`;
                const drawProgress = (progress - BORDER_START) / (BORDER_END - BORDER_START);
                
				borderPaths[0].style.strokeDashoffset = `${(pathLength - topScrollbarLength) * (1 - drawProgress)}`;
				borderPaths[1].style.strokeDashoffset = `${(pathLength - botScrollbarLength) * (1 - drawProgress)}`;
                borderSvg.classList.remove('is-snapped');
            } else {
                borderSvg.style.opacity = String(rectOpacity);
                borderSvg.style.transform = `scale(${rectScale})`;
                borderPaths[0].style.strokeDashoffset = '0';
                borderPaths[1].style.strokeDashoffset = '0';
                
                if (progress < SNAP_OUT) {
                    borderSvg.classList.add('is-snapped');
                } else {
                    borderSvg.classList.remove('is-snapped');
                }
            }
        }
    
        section.style.setProperty('--heart-opacity', String(heartFade));
        section.style.setProperty('--heart-darkness', String(state.inkProgress));
        section.style.setProperty('--hud-opacity', String(hudProgress));
    
        section.classList.toggle('is-idle', progress < 0.02 && section.classList.contains('is-idle'));
        if (scrollPrompt && progress > 0.02) scrollPrompt.style.opacity = '0';
        if (depthReadout) depthReadout.textContent = `${(progress * 100).toFixed(2)}%`;
    
        if (fillAortic)   fillAortic.style.width   = `${lerp(15, 92, progress)}%`;
        if (fillVentricle) fillVentricle.style.width = `${lerp(80, 25, progress)}%`;
    
        section.classList.toggle('is-terminal', terminalProgress > 0.35);
    
        if (heroCopyEl && lineOne && lineTwo) {
            heroCopyEl.style.opacity = progress >= SNAP_OUT ? '1' : '0';
            
            lineOne.style.opacity = String(
                smoothstep(0.92, 0.94, progress) *
                (1 - smoothstep(0.95, 0.97, progress))
            );
            
            lineTwo.style.opacity = String(
                smoothstep(0.975, 0.995, progress)
            );
        }
    }

	function handleResize(): void {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		camera.aspect = w / Math.max(h, 1);
		camera.updateProjectionMatrix();

		const rect = section.getBoundingClientRect();
		cachedSectionTop = rect.top + window.scrollY;
		cachedScrollableRange = section.offsetHeight - window.innerHeight;
		updateBorderLength();

		calculateTargetProgress();
    }

	function calculateTargetProgress(): void {
		targetProgress = Math.max(0, (window.scrollY - cachedSectionTop) / Math.max(cachedScrollableRange, 1));
	}

    const render = (time: number): void => {
        const scrollVelocity = Math.abs(currentProgress - prevProgress);
        prevProgress = currentProgress;
        
        currentProgress = lerp(currentProgress, targetProgress, SCROLL_DAMPING);

        if (Math.abs(currentProgress - targetProgress) < 0.0001) {
            currentProgress = targetProgress;
        }
        
        maxProgress = Math.max(maxProgress, currentProgress);

        const state = evaluateScrollState(currentProgress);
        applyDOMScrollState(state);

        const { rotateHorizontal, rotateVertical, dissectionProgress, heartFade, inkProgress, progress } = state;

		if (dissectionProgress >= 0.999 && currentProgress <= TIMELINE.dischargeOut.start) {
            dischargeActive = true;
        } else {
            dischargeActive = false;
        }

        if (scrollVelocity > 0.02) {
            decoupledDischargeIntensity = dischargeActive ? 1.0 : 0.0;
        } else {
            decoupledDischargeIntensity = lerp(decoupledDischargeIntensity, dischargeActive ? 1.0 : 0.0, 0.08);
        }

        const timeSec = time * 0.001;
        const bpm = (window as any).DEV_STOP_PULSE ? 0 : 65; 
        const beatPhase = (timeSec * (bpm / 60)) % 1.0;

        let radialPulse = 0;   
        let longPulse = 0;     
        let twistPulse = 0;    

        if (beatPhase < 0.12) {
            const t = beatPhase / 0.12;
            radialPulse = Math.sin(t * Math.PI) * 0.01;
            longPulse = Math.sin(t * Math.PI) * 0.005;
            twistPulse = Math.sin(t * Math.PI) * 0.01;
        } else if (beatPhase < 0.42) {
            const t = (beatPhase - 0.12) / 0.30;
            radialPulse = -Math.sin(t * Math.PI) * 0.05; 
            longPulse = -Math.sin(t * Math.PI) * 0.075;
            twistPulse = Math.sin(t * Math.PI) * 0.14; 
        } else if (beatPhase < 0.62) {
            const t = (beatPhase - 0.42) / 0.20;
            radialPulse = Math.sin(t * Math.PI) * 0.015; 
            longPulse = Math.sin(t * Math.PI) * 0.01;
            twistPulse = -Math.sin(t * Math.PI) * 0.03;
        }

        const flatlineFactor = 1.0 - smoothstep(0.0, 0.06, dissectionProgress);

        heartGroup.rotation.y = rotateHorizontal * Math.PI * 2 + Math.sin(time * 0.00022) * 0.035 * heartFade;
        heartGroup.rotation.x = -0.08 + rotateVertical * Math.PI * 2;
        heartGroup.rotation.z = lerp(0, -0.03, rotateVertical);	
        
        camera.position.z = lerp(6.9, 8.45, dissectionProgress);
        mouse.currentX = lerp(mouse.currentX, mouse.targetX, 0.05);
        mouse.currentY = lerp(mouse.currentY, mouse.targetY, 0.05);
        camera.position.x = mouse.currentX * 0.4;
        camera.position.y = lerp(0.02, -0.03, dissectionProgress) + mouse.currentY * 0.4;
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();

        const lightPhase = dissectionProgress;
        
        slices.forEach((slice, i) => {
            const direction = slice.userData.direction ?? i - 2;
            const eased = 1 - Math.pow(1 - dissectionProgress, 3);
            
            slice.position.y = slice.userData.baseY + direction * eased * SLICE_GAP;
            slice.position.z = Math.abs(direction) * eased * 0.04;

            const sliceIndex = typeof slice.userData.index === 'number' ? slice.userData.index : i;
            const apexIntensity = 1.0 - (sliceIndex / (SLICE_COUNT - 1));

            const sliceScaleX = 1.0 + (radialPulse * (0.4 + apexIntensity * 1.2)) * flatlineFactor;
            const sliceScaleZ = 1.0 + (radialPulse * (0.4 + apexIntensity * 1.2)) * flatlineFactor;
            const sliceScaleY = 1.0 + (longPulse * (0.2 + apexIntensity * 1.6)) * flatlineFactor;
            slice.scale.set(sliceScaleX, sliceScaleY, sliceScaleZ);

            if (flatlineFactor > 0.001) {
                const localLift = -longPulse * apexIntensity * 0.42 * flatlineFactor;
                slice.position.y += localLift;
            }

            slice.rotation.y = twistPulse * apexIntensity * flatlineFactor;

            const { materials } = slice.userData;
            const order = sliceIndex / Math.max(SLICE_COUNT - 1, 1);
            const delay = order * 0.16;
            const sliceLight = clamp((lightPhase - delay) / 0.32);

            materials.solid.emissive.lerpColors(EMISSIVE_COOL, EMISSIVE_HOT, sliceLight);
            materials.solid.emissiveIntensity = lerp(0.2, EMISSIVE_PEAK_INTENSITY, sliceLight);
            
            materials.wire.opacity = lerp(0.15, 0.85, sliceLight);
            materials.edges.opacity = lerp(0.10, 0.85, sliceLight);
        });

		heartGroup.updateMatrixWorld(true);

        if (hasFinePointer && solidMeshes.length > 0) {
            heartPointerNdc.set(mouse.targetX, mouse.targetY);
            heartRaycaster.setFromCamera(heartPointerNdc, camera);
            
            const intersects = heartRaycaster.intersectObjects(solidMeshes, false);
            isIntersecting = intersects.length > 0;
            isVisible = inkProgress < 0.5; 
            
            if (isIntersecting && isVisible) {
                spotlightConfig.targetPos.copy(intersects[0].point);
                hoveredSliceIndex = solidMeshes.indexOf(intersects[0].object as Mesh);
            } else {
                hoveredSliceIndex = -1;
            }
            
            if (isHoveringPrevState !== isIntersecting) {
                document.documentElement.style.setProperty('--light-active', isIntersecting ? '1' : '0');
                isHoveringPrevState = isIntersecting;
            }
            
            setHoverTarget('heart', isIntersecting && isVisible);

            spotlightConfig.targetIntensity = (isIntersecting && isVisible) ? 1.0 : 0.0;
        } else {
            setHoverTarget('heart', false);
            hoveredSliceIndex = -1;
        }

        // Smoothstep crossfade: pre-dissection panels fade out over 0.52–0.62
        const panelVisibility = smoothstep(0.62, 0.52, currentProgress) * smoothstep(0.01, 0.04, currentProgress);

        const SCALE = 0.40;
        const PANEL_BASE_WIDTH = 530; 
        const actualPanelWidth = PANEL_BASE_WIDTH * SCALE;

        const leftPanelX = window.innerWidth * (-0.1); 
        const rightPanelX = window.innerWidth - actualPanelWidth - (window.innerWidth * 0.02); 
        const panelY = window.innerHeight * 0.22;      

        const screenWidth = window.innerWidth;
        const screenCenter = screenWidth / 2;
        const maxRotationY = 5;  
        const maxDepthZ = -300;   

        const leftNormX = (leftPanelX - screenCenter) / screenCenter; 
        const leftRotationY = leftNormX * -maxRotationY; 
        const leftZ = Math.abs(leftNormX) * maxDepthZ;

        const rightNormX = (rightPanelX - screenCenter) / screenCenter;
        const rightRotationY = rightNormX * -maxRotationY;
        const rightZ = Math.abs(rightNormX) * maxDepthZ;

        panelManager.update('telemetry-left', {
            x: leftPanelX,
            y: panelY,
            z: leftZ,                 
            rotationY: leftRotationY, 
            opacity: panelVisibility,
            values: {
                heartFade: heartFade * 100,
                dissection: dissectionProgress * 100,
                progressKnob: currentProgress * 100,
                progressPct: currentProgress * 100
            }
        });

        panelManager.update('telemetry-right', {
            x: rightPanelX - 300,
            y: panelY,
            z: rightZ,                  
            rotationY: rightRotationY,  
            opacity: panelVisibility,
            values: {
                lat: mouse.targetY * 100,
                long: mouse.targetX * 100,
                intersect: isIntersecting 
            }
        });

        // -----------------------------------------------------------------------
        // Tissue Analysis Modal — Shrink/Expand with 1s Dwell
        // -----------------------------------------------------------------------
        const dtSeconds = modalState.lastTime === 0 ? 0 : (time - modalState.lastTime) / 1000;
        modalState.lastTime = time;

        // Panel fades in as pre-dissection panels fade out (crossfade over 0.55–0.65)
        const targetPanelOpacity = smoothstep(0.55, 0.65, currentProgress) * smoothstep(0.90, 0.82, currentProgress);
        modalState.panelOpacity = lerp(modalState.panelOpacity, targetPanelOpacity, 0.08);

        // --- Dwell tracking ---
        const isDissected = currentProgress > 0.58;
        if (isDissected && hoveredSliceIndex >= 0) {
            if (hoveredSliceIndex !== modalState.pendingIndex) {
                // New slice — reset dwell, start collapsing if detail is open
                modalState.pendingIndex = hoveredSliceIndex;
                modalState.dwellTimer = 0;
                if (modalState.displayIndex >= 0 && modalState.scaleY > 0.01) {
                    modalState.phase = 'collapsing';
                }
            } else {
                modalState.dwellTimer += dtSeconds;
            }
        } else {
            // Nothing hovered — collapse and clear
            modalState.pendingIndex = -1;
            modalState.dwellTimer = 0;
            if (modalState.displayIndex >= 0 && modalState.scaleY > 0.01) {
                modalState.phase = 'collapsing';
            }
        }

        // --- State machine for detail section scaleY ---
        if (modalState.phase === 'collapsing') {
            modalState.targetScaleY = 0;
            if (modalState.scaleY < 0.02) {
                modalState.scaleY = 0;
                if (modalState.pendingIndex >= 0 && modalState.dwellTimer >= 1.0) {
                    modalState.displayIndex = modalState.pendingIndex;
                    modalState.phase = 'expanding';
                } else if (modalState.pendingIndex < 0) {
                    modalState.displayIndex = -1;
                    modalState.phase = 'collapsed';
                }
                // else: stay collapsed, waiting for dwell to satisfy
            }
        }

        if (modalState.phase === 'expanding') {
            modalState.targetScaleY = 1.0;
            if (modalState.scaleY > 0.98) {
                modalState.scaleY = 1.0; // snap
            }
        }

        // From collapsed, if dwell is satisfied, begin expanding
        if (modalState.phase === 'collapsed' && modalState.pendingIndex >= 0 && modalState.dwellTimer >= 1.0) {
            modalState.displayIndex = modalState.pendingIndex;
            modalState.phase = 'expanding';
        }

        modalState.scaleY = lerp(modalState.scaleY, modalState.targetScaleY, 0.12);

        // --- Position to the left of the heart with viewport clamping ---
        // The panel renders at scale(var(--panel-scale, 0.80)), so use 0.80
        // for sizing calculations.
        const RENDER_SCALE = 0.80;
        const MODAL_EST_HEIGHT = 420;
        const MODAL_MARGIN = 24;
        const HEART_GAP = 400; // px gap between panel right edge and heart left edge
        const modalWidth = PANEL_BASE_WIDTH * RENDER_SCALE;
        const modalHeight = MODAL_EST_HEIGHT * RENDER_SCALE;

        // Project heart center to screen coordinates
        heartGroup.getWorldPosition(scratchHeartCenter);
        scratchHeartCenter.project(camera);
        const heartScreenX = (scratchHeartCenter.x * 0.5 + 0.5) * window.innerWidth;
        const heartScreenY = -(scratchHeartCenter.y * 0.5 - 0.5) * window.innerHeight;

        // Place panel to the left of the heart, vertically centered
        let fixedX = heartScreenX - modalWidth - HEART_GAP;
        let fixedY = heartScreenY - modalHeight * 0.4;

        // Clamp to viewport bounds
        fixedX = Math.max(MODAL_MARGIN, Math.min(fixedX, window.innerWidth - modalWidth - MODAL_MARGIN));
        fixedY = Math.max(MODAL_MARGIN, Math.min(fixedY, window.innerHeight - modalHeight - MODAL_MARGIN));

        panelManager.update('slice-info', {
            x: fixedX,
            y: fixedY,
            opacity: modalState.panelOpacity,
            scaleY: modalState.scaleY,
            activeLabel: modalState.pendingIndex >= 0 ? (SLICE_COUNT - 1) - modalState.pendingIndex : -1,
            values: {
                sliceName: modalState.displayIndex >= 0 ? SLICE_NAMES[modalState.displayIndex] : '',
                sliceText: modalState.displayIndex >= 0 ? SLICE_DESCRIPTIONS[modalState.displayIndex] : ''
            }
        });

		spotlightConfig.intensity = lerp(spotlightConfig.intensity, spotlightConfig.targetIntensity, 0.35);
		if (spotlightConfig.intensity > 0.001) {
			spotlightConfig.pos.lerp(spotlightConfig.targetPos, 0.45);
		}
		
		spotlightUniforms.uScannerPos.value.copy(spotlightConfig.pos);
		spotlightUniforms.uScannerIntensity.value = spotlightConfig.intensity;
		spotlightPointLight.position.copy(spotlightConfig.pos);
		spotlightPointLight.intensity = spotlightConfig.intensity * 25.0; 
		
        // Floating labels removed — they are now integrated into the slice-info panel

		dischargeSystem.update(time, decoupledDischargeIntensity, slices);

        inkPass.uniforms.uTime.value = time * 0.001;
        inkPass.uniforms.uProgress.value = smoothstep(0.0, 1.0, inkProgress);
        inkPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
		gridMaterial.uniforms.uTime.value = time * 0.001;

        composer.render();
    };

	const controller = createLoopController(section, render);

	window.addEventListener('scroll', calculateTargetProgress, { passive: true });
	window.addEventListener('resize', handleResize);
	
	// Defer the initial layout read so it doesn't block FCP
	requestAnimationFrame(() => {
		handleResize();
	});

	return {
		...controller,
		destroy: () => {
			controller.destroy();
			window.removeEventListener('scroll', calculateTargetProgress);
			window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove); 
			setHoverTarget('heart', false);

			panelManager.destroy();

			scene.traverse((obj) => {
				if (obj instanceof Mesh || obj instanceof LineSegments || obj instanceof Points) {
					obj.geometry.dispose();
					if (Array.isArray(obj.material)) {
						obj.material.forEach((m) => m.dispose());
					} else {
						obj.material.dispose();
					}
				}
			});

			bloomPass.dispose?.();
			inkPass.dispose?.();
			composer.dispose();

			arcOsc?.stop();
			inkOsc?.stop();
			arcOsc?.disconnect();
			arcGain?.disconnect();
			inkOsc?.disconnect();
			inkGain?.disconnect();
			audioCtx?.close();

			renderer.dispose();
		},
	};
}