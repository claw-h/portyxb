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
	EqualStencilFunc,
	KeepStencilOp,
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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { PanelManager } from '../ui/telemetry/PanelManager';
import { type PanelConfig } from '../ui/telemetry/types';
import { clamp, lerp, smoothstep } from '../utils/math';
import { createLoopController } from '../utils/canvas';
import type { LoopController } from '../utils/canvas';
import { markReady } from '../utils/loadState.ts';
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
	fireProgress: number;
	inkProgress: number;
	hudProgress: number;
	terminalProgress: number;
}

const SLICE_COUNT = 5;
const SLICE_GAP = 0.36;
const SCROLL_DAMPING = 0.08; 

// Reused every frame in the dissection reveal — never allocate Color objects inside the render loop.
const EMISSIVE_COOL = new Color(0x0a1f3d);
const EMISSIVE_HOT = new Color(0.1, 0.6, 1.0);
const EMISSIVE_PEAK_INTENSITY = 2.4; // ACES tonemapping starts eating the G/B channels well before 6.5 — tune from here

const TIMELINE = {
	heartFade: { start: 0.035, end: 0.11 },
	rotateH: { start: 0.1, end: 0.34 },
	rotateV: { start: 0.34, end: 0.58 },
	dissection: { start: 0.62, end: 0.80 },  
	fireIn: { start: 0.74, end: 0.84 },
	fireOut: { start: 0.86, end: 0.90 }, 
	ink: { start: 0.84, end: 0.90 },         
	hudIn: { start: 0.02, end: 0.15 },
	hudOut: { start: 0.50, end: 0.60 },
	terminal: { start: 0.85, end: 0.95 }
} as const;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function mergeModelGeometry(model: Object3D): BufferGeometry[] {
	const geometries: BufferGeometry[] = [];
	const modelBox = new Box3();
	model.updateWorldMatrix(true, true);

	model.traverse((child) => {
		if (!(child instanceof Mesh) || !child.geometry) return;
		const geometry = child.geometry.clone() as BufferGeometry;

		['position', 'normal'].forEach((key) => {
			const attr = geometry.attributes[key];
			if (attr && !(attr.array instanceof Float32Array)) {
				const floatArray = new Float32Array(attr.count * attr.itemSize);
				for (let i = 0; i < attr.count; i++) {
					if (attr.itemSize >= 1) floatArray[i * attr.itemSize] = attr.getX(i);
					if (attr.itemSize >= 2) floatArray[i * attr.itemSize + 1] = attr.getY(i);
					if (attr.itemSize >= 3) floatArray[i * attr.itemSize + 2] = attr.getZ(i);
				}
				geometry.setAttribute(key, new BufferAttribute(floatArray, attr.itemSize));
			}
		});

		geometry.applyMatrix4(child.matrixWorld);
		geometry.deleteAttribute('uv');
		const nonIndexed = geometry.toNonIndexed();
		nonIndexed.computeBoundingBox();
		modelBox.union(nonIndexed.boundingBox!);
		geometries.push(nonIndexed);
	});

	if (!geometries.length) return [];

	const center = new Vector3();
	const size = new Vector3();
	modelBox.getCenter(center);
	modelBox.getSize(size);
	const scale = 3.05 / Math.max(size.x, size.y, size.z);
	const normalize = new Matrix4()
		.makeTranslation(-center.x, -center.y, -center.z)
		.premultiply(new Matrix4().makeScale(scale, scale, scale));

	return geometries.map((geometry) => {
		geometry.applyMatrix4(normalize);
		geometry.computeVertexNormals();
		return geometry;
	});
}

function runWorkerSlicing(
	geometries: BufferGeometry[],
	group: Group,
	onDone: (result: { slices: SliceHolder[]; solids: Mesh[] }) => void
) {
	const box = new Box3();
	geometries.forEach((g) => {
		g.computeBoundingBox();
		box.union(g.boundingBox!);
	});
	
	const minY = box.min.y;
	const maxY = box.max.y;
	const vertexBuffers = geometries.map(g => g.attributes.position.array as Float32Array);

	const worker = new Worker(new URL('./heartWorker.ts', import.meta.url), { type: 'module' });
	
	worker.onmessage = async (e) => {
		const { slicedBuffers } = e.data;
		geometries.forEach(g => g.dispose()); 
		
		const result = await buildSlicesFromBuffers(slicedBuffers, group);
		onDone(result);
		worker.terminate();
	};

	worker.postMessage({
		vertexBuffers,
		minY,
		maxY,
		sliceCount: SLICE_COUNT
	}, vertexBuffers.map(b => b.buffer));
}

// =========================================================
// UNIFORM REVEAL & SPOTLIGHT CONFIGURATION
// =========================================================
const spotlightConfig = {
	pos: new Vector3(0, 0, 0),
	targetPos: new Vector3(0, 0, 0),
	intensity: 0,
	targetIntensity: 0,
	radius: 1.1, // Concentrated beam area
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
	slicedBuffers: Float32Array[],
	group: Group,
): Promise<{ slices: SliceHolder[]; solids: Mesh[] }> {
	const slices: SliceHolder[] = [];
	const solids: Mesh[] = [];

	// Optimized Hybrid Bio-Holographic Solid Material (Performance focused)
	const solidMaterial = new MeshPhysicalMaterial({
		color: 0x081c33,
		emissive: 0x0a1f3d,
		emissiveIntensity: 0.2,
		transparent: true,
		opacity: 0.75,         // Much higher opacity for solid physical presence
		roughness: 0.12,       // Very low roughness for a slick, wet specular highlight
		metalness: 0.65,       // High metalness fakes dense, glossy organic tissue
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

	for (let i = 0; i < slicedBuffers.length; i++) {
		const buffer = slicedBuffers[i];
		if (!buffer || buffer.length === 0) continue;

		const sliceGeometry = new BufferGeometry();
		sliceGeometry.setAttribute('position', new BufferAttribute(buffer, 3));
		sliceGeometry.computeVertexNormals();
		sliceGeometry.computeBoundingBox();

		const holder = new Group() as SliceHolder;
		holder.userData.baseY = 0;
		holder.userData.direction = i - (slicedBuffers.length - 1) / 2;
		holder.userData.phase = i * 0.34;
		holder.userData.index = i;

		const solid = new Mesh(sliceGeometry, solidMaterial);
		const wire = new Mesh(sliceGeometry.clone(), wireMaterial);
		const edges = new LineSegments(new EdgesGeometry(sliceGeometry, 22), edgeMaterial);

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
        fireProgress: smoothstep(TIMELINE.fireIn.start, TIMELINE.fireIn.end, p) * (1 - smoothstep(TIMELINE.fireOut.start, TIMELINE.fireOut.end, p)),
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

const FLAME_BASE_Y = -3.3;       
const FLAME_HALF_HEIGHT = 2.6;   
const FLAME_HALF_WIDTH = 1.3;    

function flameScaleY(intensity: number): number {
	return 0.55 + intensity * 0.55;
}

function flameScaleX(intensity: number): number {
	return 0.75 + intensity * 0.35;
}

function createEmberSystem(emberCount = 140, spotlight: typeof spotlightUniforms) {
	const geometry = new BufferGeometry();
	const positions = new Float32Array(emberCount * 3);
	const velocities = new Float32Array(emberCount * 3);
	const lifetimes = new Float32Array(emberCount);
	const sizes = new Float32Array(emberCount);

	const LIFE_DECAY = 0.055;
	const lifeDecayJitter = new Float32Array(emberCount); 
	const GRAVITY = 0.00022;      
	const DRAG = 0.94;            
	const TURBULENCE_STRENGTH = 0.003;

	function resetParticle(i: number, baseY: number, topY: number, spreadX: number) {
		const heightT = Math.pow(Math.random(), 1.5); 
		const widthHere = spreadX * (1.0 - heightT * 0.5);
		positions[i * 3] = (Math.random() - 0.5) * widthHere;
		positions[i * 3 + 1] = baseY + (heightT * (topY - baseY) * 0.8);
		positions[i * 3 + 2] = 1 + (Math.random() - 0.5) * 0.5;

		velocities[i * 3] = (Math.random() - 0.5) * 0.015;
		velocities[i * 3 + 1] = 0.03 + (Math.random() * 0.04);
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;

		sizes[i] = Math.random() * 0.15 + 0.05; 
		lifeDecayJitter[i] = 0.8 + Math.random() * 0.4;
		lifetimes[i] = 1.0;
	}

	for (let i = 0; i < emberCount; i++) {
		resetParticle(i, FLAME_BASE_Y, FLAME_BASE_Y + FLAME_HALF_HEIGHT * 2, FLAME_HALF_WIDTH);
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
				vSpotMask = (1.0 - smoothstep(uScannerRadius * 0.1, uScannerRadius, d)) * uScannerIntensity;

				vec4 mvPosition = viewMatrix * worldPos;
				float pointSize = aSize * 45.0 * (vLife + 0.2) * uIntensity * vSpotMask * (10.0 / -mvPosition.z);
				gl_PointSize = min(pointSize, 60.0);
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

				vec3 colorHot = vec3(2.2, 1.1, 0.4);
				vec3 colorCool = vec3(0.9, 0.15, 0.0);
				vec3 finalColor = mix(colorCool, colorHot, smoothstep(0.0, 1.0, vLife)) * (1.0 + vSpotMask * 2.5);

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

	const update = (time: number, intensity: number) => {
		material.uniforms.uIntensity.value = intensity;
		if (intensity <= 0.001 || spotlight.uScannerIntensity.value <= 0.001) return; 

		const tSec = time * 0.001;
		material.uniforms.uTime.value = tSec;

		const dt = lastTime === null ? 1 : Math.min(Math.max((time - lastTime) / 16.6667, 0), 3);
		lastTime = time;

		const posAttr = geometry.attributes.position;
		const lifeAttr = geometry.attributes.aLife;
		const velAttr = geometry.attributes.aVelocity;

		const windX = Math.sin(tSec * 0.15) * 0.006; 

		const baseY = FLAME_BASE_Y;
		const topY = FLAME_BASE_Y + 2 * FLAME_HALF_HEIGHT * flameScaleY(intensity);
		const spreadX = 2 * FLAME_HALF_WIDTH * flameScaleX(intensity) * 0.7;

		for (let i = 0; i < emberCount; i++) {
			let life = lifeAttr.getX(i);
			life -= LIFE_DECAY * lifeDecayJitter[i] * dt;

			if (life <= 0) {
				resetParticle(i, baseY, topY, spreadX);
				continue;
			}

			lifeAttr.setX(i, life);

			let vx = velAttr.getX(i);
			let vy = velAttr.getY(i);

			vy -= GRAVITY * dt;

			const n = turbulence(i, posAttr.getY(i), tSec);
			vx = vx * Math.pow(DRAG, dt) + n * TURBULENCE_STRENGTH * dt + windX * dt;

			velAttr.setX(i, vx);
			velAttr.setY(i, vy);

			posAttr.setX(i, posAttr.getX(i) + vx * dt);
			posAttr.setY(i, posAttr.getY(i) + vy * dt);
		}

		posAttr.needsUpdate = true;
		lifeAttr.needsUpdate = true;
	};

	return { mesh: points, update };
}

function createFlamePlane(spotlight: typeof spotlightUniforms) {
    const uniforms = {
        uTime: { value: 0 },
        uIntensity: { value: 0.0 },
        uUseCurl: { value: 1.0 },
        uScannerPos: spotlight.uScannerPos,
        uScannerRadius: spotlight.uScannerRadius,
        uScannerIntensity: spotlight.uScannerIntensity
    };

	const material = new ShaderMaterial({
		uniforms: uniforms,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
		stencilWrite: true,
		stencilRef: 1,
		stencilFunc: EqualStencilFunc,
		stencilFail: KeepStencilOp,
		stencilZFail: KeepStencilOp,
		stencilZPass: KeepStencilOp,
		
		vertexShader: `
			varying vec2 vUv;
			varying vec3 vWorldPos;
			
			void main() {
				vUv = uv;
				vec3 pos = position;
				
				float angle = (uv.x - 0.5) * 3.14159265; 
				float radius = 1.8; 
				
				pos.x = sin(angle) * radius;
				pos.z = (cos(angle) - 1.0) * radius; 
				
				vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
				
				gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
			}
		`,

		fragmentShader: `
			varying vec2 vUv;
			varying vec3 vWorldPos;
			uniform float uTime;
			uniform float uIntensity;
			uniform float uUseCurl;
			uniform vec3 uScannerPos;
			uniform float uScannerRadius;
			uniform float uScannerIntensity;

			float hash21(vec2 p) {
				p = fract(p * vec2(123.34, 456.21));
				p += dot(p, p + 45.32);
				return fract(p.x * p.y);
			}

			float noise(vec2 p) {
				vec2 i = floor(p);
				vec2 f = fract(p);
				float a = hash21(i);
				float b = hash21(i + vec2(1.0, 0.0));
				float c = hash21(i + vec2(0.0, 1.0));
				float d = hash21(i + vec2(1.0, 1.0));
				vec2 u = f * f * (3.0 - 2.0 * f);
				return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
			}

			float fbm(vec2 p) {
				float sum = 0.0;
				float amp = 0.5;
				for (int i = 0; i < 4; i++) {
					sum += amp * noise(p);
					p *= 2.02; 
					amp *= 0.5;
				}
				return sum;
			}

			vec2 domainWarp(vec2 p) {
				return vec2(fbm(p + vec2(0.0, 0.0)), fbm(p + vec2(5.2, 1.3)));
			}

			vec2 curlNoise(vec2 p) {
				float e = 0.06;
				float dPsiDy = (fbm(p + vec2(0.0, e)) - fbm(p - vec2(0.0, e))) / (2.0 * e);
				float dPsiDx = (fbm(p + vec2(e, 0.0)) - fbm(p - vec2(e, 0.0))) / (2.0 * e);
				return vec2(dPsiDy, -dPsiDx);
			}

			void main() {
				if (uIntensity < 0.01) discard;

				float spotDist = distance(vWorldPos, uScannerPos);
				float spotMask = (1.0 - smoothstep(uScannerRadius * 0.15, uScannerRadius, spotDist)) * uScannerIntensity;

				if (spotMask < 0.001) discard;

				float energy = mix(0.55, 1.35, uIntensity);

				vec2 p = vUv * vec2(2.2, 4.2);
				vec2 rise = vec2(0.0, uTime * 1.1 * energy); 
				vec2 base = p - rise;

				float warped;
				if (uUseCurl > 0.5) {
					vec2 flow = curlNoise(base) * 0.9 * energy;
					warped = fbm(base + flow - rise * 0.4);
				} else {
					vec2 offset = domainWarp(base) * 0.9 * energy;
					warped = fbm(base + offset - rise * 0.4);
				}
				
				warped = smoothstep(0.15, 0.85, warped);

				float wander = fbm(vec2(vUv.y * 1.3, uTime * 0.22 + 4.0)) - 0.5;
				float centerX = 0.5 + wander * 0.3 * vUv.y; 

				float widthNoise = fbm(vec2(vUv.y * 2.1 + 9.0, uTime * 0.2));
				float widthJitter = 0.65 + 0.6 * widthNoise;

				float heightNoise = fbm(vec2(vUv.x * 2.6 + 1.0, uTime * 0.3));
				
				float heightReach = mix(0.42, 1.05, heightNoise) * mix(0.7, 1.15, uIntensity);

				float heightEnvelope = 1.0 - smoothstep(0.08, heightReach, vUv.y);
				
				float halfWidthAtHeight = mix(0.6, 0.25, pow(vUv.y, 1.2)) * widthJitter;

				float edgeErosion = fbm(vec2(vUv.y * 6.0, uTime * 1.5)) * 0.15;
				float xOffset = abs(vUv.x - centerX) + edgeErosion;

				float widthEnvelope = 1.0 - smoothstep(halfWidthAtHeight * 0.2, halfWidthAtHeight * 1.3, xOffset);
				float envelope = heightEnvelope * widthEnvelope;

				float lateralMask = smoothstep(0.02, 0.15, vUv.x) * smoothstep(0.98, 0.85, vUv.x);
				float depthFade = lateralMask; 

				float edgeBias = pow(1.0 - envelope, 1.4) * 1.15; 
				float field = warped - edgeBias;

				float alpha = smoothstep(0.01, 0.25, field) * uIntensity * 0.8 * depthFade * spotMask;

				float flicker = 0.85 + 0.15 * fbm(vec2(uTime * 0.7, 3.1));
				float glow = clamp(warped * envelope * flicker, 0.0, 1.0);

				vec3 col = mix(vec3(0.15, 0.01, 0.0), vec3(0.85, 0.2, 0.0), smoothstep(0.05, 0.35, glow));
				col = mix(col, vec3(1.0, 0.5, 0.05), smoothstep(0.35, 0.65, glow));
				col = mix(col, vec3(1.2, 0.9, 0.5), smoothstep(0.65, 0.95, glow));

				col *= (1.0 + spotMask * 0.8);

				gl_FragColor = vec4(col, alpha);
			}
		`
	});

	const mesh = new Mesh(new PlaneGeometry(2.5, 4.5, 32, 1), material);
	mesh.position.set(0, FLAME_BASE_Y + FLAME_HALF_HEIGHT, 1);
	mesh.renderOrder = 1;

	const update = (time: number, scrollIntensity: number) => {
		material.uniforms.uIntensity.value = scrollIntensity;
		if (scrollIntensity <= 0.001 || spotlight.uScannerIntensity.value <= 0.001) return;

		const tSec = time * 0.001;
		material.uniforms.uTime.value = tSec;

		const scaleY = flameScaleY(scrollIntensity);
		const scaleX = flameScaleX(scrollIntensity);
		mesh.scale.set(scaleX, scaleY, 1);
		mesh.position.y = FLAME_BASE_Y + FLAME_HALF_HEIGHT * scaleY;
		mesh.position.x = Math.sin(tSec * 0.35) * 0.12 * scrollIntensity;
	};

	return { mesh, update };
}

function createWebGLFireSystem(emberCount = 140, spotlight: typeof spotlightUniforms) {
	const flame = createFlamePlane(spotlight);
	const embers = createEmberSystem(emberCount, spotlight);

	const group = new Group();
	group.add(flame.mesh);
	group.add(embers.mesh);

	let smoothedIntensity = 0;
	let lastTime: number | null = null;
	const SMOOTH_RATE = 4.5; 

	const update = (time: number, intensity: number) => {
		const dtSeconds = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000);
		lastTime = time;

		const alpha = 1 - Math.exp(-SMOOTH_RATE * dtSeconds);
		smoothedIntensity += (intensity - smoothedIntensity) * alpha;

		flame.update(time, smoothedIntensity);
		embers.update(time, smoothedIntensity);
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
	const labels = document.querySelectorAll<HTMLElement>('[data-dimension-label]');
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
        }
    ];
    panelConfigs.forEach(c => panelManager.registerPanel(c));

	let pathLength = 0;
	let pTop = 0;
	let pBot = 0;
	let cachedH = 0;

	let audioCtx: AudioContext | null = null;
    let fireOsc: OscillatorNode | null = null;
    let fireGain: GainNode | null = null;
    let inkOsc: OscillatorNode | null = null;
    let inkGain: GainNode | null = null;

    let maxProgress = 0;
    let decoupledFireIntensity = 0;
    let fireActive = false;
    let isHoveringPrevState = false;

	function initSynthEngine() {
        if (audioCtx) return;
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioContextClass();

        fireOsc = audioCtx.createOscillator();
        fireGain = audioCtx.createGain();
        const fireFilter = audioCtx.createBiquadFilter();
        
        fireOsc.type = 'sawtooth';
        fireOsc.frequency.setValueAtTime(45, audioCtx.currentTime); 
        fireFilter.type = 'lowpass';
        fireFilter.frequency.setValueAtTime(90, audioCtx.currentTime); 

        fireOsc.connect(fireFilter);
        fireFilter.connect(fireGain);
        fireGain.connect(audioCtx.destination);
        fireGain.gain.setValueAtTime(0, audioCtx.currentTime); 
        fireOsc.start();

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
    
    let isIntersecting = false;
    let isVisible = false;

    const handleMouseMove = (e: MouseEvent) => {
        mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    const heartRaycaster = new Raycaster();
    const heartPointerNdc = new Vector2();
    const scratchLabelPos = new Vector3(); // reused every frame in the labels loop below

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
            
            vec2 rOffset = vec2(0.015, 0.0) * distortion * fluid;
            vec2 bOffset = vec2(-0.015, 0.0) * distortion * fluid;
            
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

	const fireSystem = createWebGLFireSystem(140, spotlightUniforms); 
	scene.add(fireSystem.mesh);

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

	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);

	loader.load(
		'/heart-meshopt.glb',
		(gltf) => {
			runWorkerSlicing(mergeModelGeometry(gltf.scene), heartGroup, (result) => {
				slices = result.slices;
				solidMeshes = result.solids;
				renderer.compile(scene, camera);
				markReady('heart');
			});
		},
		undefined,
		() => {
			const fallback = new SphereGeometry(1.2, 64, 32).toNonIndexed();
			fallback.scale(0.82, 1.16, 0.72);
			runWorkerSlicing([fallback], heartGroup, (result) => {
				slices = result.slices;
				solidMeshes = result.solids;
				renderer.compile(scene, camera);
				markReady('heart');
			});
		},
	);
	
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

		if (dissectionProgress >= 0.999 && currentProgress <= TIMELINE.fireOut.start) {
            fireActive = true;
        } else {
            fireActive = false;
        }

        if (scrollVelocity > 0.02) {
            decoupledFireIntensity = fireActive ? 1.0 : 0.0;
        } else {
            decoupledFireIntensity = lerp(decoupledFireIntensity, fireActive ? 1.0 : 0.0, 0.08);
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

        // Was smoothstep(0.40, 0.72, progress) — an independent window that finished ramping
        // before the slices (TIMELINE.dissection: 0.62–0.80) had visibly separated. Keying off
        // dissectionProgress locks the color change to the same clock as the mechanical reveal.
        const lightPhase = dissectionProgress * (1 - smoothstep(0.92, 0.98, progress));
        
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

            // Continuous cool -> hot emissive transition (was a hard if/else that snapped the
            // color instantly at sliceLight > 0.05, and pushed intensity to 6.5 which blew the
            // G/B channels past the ACES tonemap ceiling before R caught up — read as a flat
            // clipped blue instead of a graded hot glow).
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
            }
            
            if (isHoveringPrevState !== isIntersecting) {
                document.documentElement.style.setProperty('--light-active', isIntersecting ? '1' : '0');
                isHoveringPrevState = isIntersecting;
            }
            
            setHoverTarget('heart', isIntersecting && isVisible);

            spotlightConfig.targetIntensity = (isIntersecting && isVisible) ? 1.0 : 0.0;
        } else {
            setHoverTarget('heart', false);
        }

        const panelVisibility = (currentProgress >= 0.02 && currentProgress <= 0.60) ? 1.0 : 0.0;

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

		// Snappier, high-precision spotlight tracking
		spotlightConfig.intensity = lerp(spotlightConfig.intensity, spotlightConfig.targetIntensity, 0.35);
		if (spotlightConfig.intensity > 0.001) {
			spotlightConfig.pos.lerp(spotlightConfig.targetPos, 0.45); // Very fast follow
		}
		
		spotlightUniforms.uScannerPos.value.copy(spotlightConfig.pos);
		spotlightUniforms.uScannerIntensity.value = spotlightConfig.intensity;
		spotlightPointLight.position.copy(spotlightConfig.pos);
		spotlightPointLight.intensity = spotlightConfig.intensity * 25.0; // Lowered from 52 so it doesn't clip
		
        labels.forEach((label, i) => {
            const targetSlice = slices[(SLICE_COUNT - 1) - i];
            if (!targetSlice) return;

            const isRightSide = i % 2 === 0;
            const staggerStart = i * 0.08;
            const fadeIn = smoothstep(staggerStart, staggerStart + 0.15, dissectionProgress);
            const fadeOut = smoothstep(0.85, 0.75, progress); 
            const visibility = fadeIn * fadeOut;

            if (visibility < 0.001) {
                label.style.opacity = '0';
                label.style.pointerEvents = 'none';
                return;
            }

            const slicePos = scratchLabelPos;
            targetSlice.getWorldPosition(slicePos);
            slicePos.x += isRightSide ? 1.8 : -1.8; 
            slicePos.y += 0.2;  

            slicePos.project(camera);
            const x = (slicePos.x * 0.5 + 0.5) * window.innerWidth;
            const y = -(slicePos.y * 0.5 - 0.5) * window.innerHeight;

            const slideX = lerp(isRightSide ? -40 : 40, 0, visibility); 
            const blur = lerp(8, 0, visibility);     

            label.style.opacity = String(visibility);
            label.style.filter = `blur(${blur}px)`;
            label.style.pointerEvents = visibility > 0.5 ? 'auto' : 'none';
            label.style.textAlign = isRightSide ? 'left' : 'right';
            
            const alignOffset = isRightSide ? '0%' : '-100%';
            label.style.transform = `translate3d(calc(${x + slideX}px + ${alignOffset}), calc(${y}px - 50%), 0)`;
        });

		fireSystem.update(time, decoupledFireIntensity);

        inkPass.uniforms.uTime.value = time * 0.001;
        inkPass.uniforms.uProgress.value = smoothstep(0.0, 1.0, inkProgress);
        inkPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
		gridMaterial.uniforms.uTime.value = time * 0.001;

        composer.render();
    };

	const controller = createLoopController(section, render);

	window.addEventListener('scroll', calculateTargetProgress, { passive: true });
	window.addEventListener('resize', handleResize);
	
	handleResize();

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

			fireOsc?.stop();
			inkOsc?.stop();
			fireOsc?.disconnect();
			fireGain?.disconnect();
			inkOsc?.disconnect();
			inkGain?.disconnect();
			audioCtx?.close();

			renderer.dispose();
		},
	};
}