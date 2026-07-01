import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createLoopController } from '../utils/canvas';
import { clamp, lerp, smoothstep } from '../utils/math';
import type { LoopController } from '../utils/canvas';
 
// ---------------------------------------------------------------------------
// Design System & Structural Interfaces
// ---------------------------------------------------------------------------
 
interface Glyph {
	char: string; restX: number; restY: number; x: number; y: number;
	vy: number; vx: number; phase: number; revealT: number; index: number;
}
 
interface GridInstanceState {
	ix: number; iy: number; baseX: number; baseY: number; mirrorX: number;
	solidZ: number; baseScale: number; wireScale: number; wireTiltX: number; wireTiltY: number;
	mesh: THREE.Mesh;
}
 
interface MouseState {
	nx: number; ny: number; cx: number; cy: number; speed: number;
	prevCx: number; prevCy: number; vx: number; vy: number;
}
 
let _lenisVelocity = 0;
let _scrollProgress = 0;
 
export function setDreamScrollVelocity(v: number): void { _lenisVelocity = v; }
export function setDreamScrollProgress(p: number): void { _scrollProgress = clamp(p, 0, 1); }
 
const DECLARATION = 'Retrieving things from dreams on a long night.';
const GLYPH_FONT = '500 56px "Unbounded", sans-serif';
const GLYPH_LINE_HEIGHT = 76;
 
// Target world-space size the loaded staircase model is normalized to.
// Was 5.0 — scaled up so the hero piece reads as a real object, not a prop.
const STAIR_TARGET_SIZE = 12;
 
// Single source of truth for the staircase's base orientation. Previously
// this was two magic numbers (0.4, -0.4) duplicated in both the instance
// builder and the render loop — now it's one named value used everywhere.
const STAIR_ROTATION = new THREE.Euler(0, 1.57, 0);
 
// ---------------------------------------------------------------------------
// Viewport Scroll Math
// ---------------------------------------------------------------------------
function calcScrollProgress(sectionTop: number, sectionHeight: number): number {
	const vh = window.innerHeight;
	const bottom = sectionTop + sectionHeight - window.scrollY;
	return clamp(1 - bottom / (vh + sectionHeight), 0, 1);
}
 
// ---------------------------------------------------------------------------
// Custom Lens Fisheye Shader
// ---------------------------------------------------------------------------
const CustomLensShader = {
	uniforms: {
		tDiffuse: { value: null },
		uLensRadius: { value: 0.0 },
		uLensStrength: { value: 0.48 },
		uVelocity: { value: 0.0 },
		uMouseSpeed: { value: 0.0 },
		uTime: { value: 0.0 },
		uResolution: { value: new THREE.Vector2(1, 1) }
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
		uniform float uLensRadius;
		uniform float uLensStrength;
		uniform float uVelocity;
		uniform float uMouseSpeed;
		uniform float uTime;
		uniform vec2 uResolution;
		varying vec2 vUv;
 
		void main() {
			vec2 uv = vUv;
			vec2 center = vec2(0.5, 0.5);
			float aspect = uResolution.x / uResolution.y;
			
			vec2 uvAspect = vec2((uv.x - 0.5) * aspect + 0.5, uv.y);
			float dist = distance(uvAspect, center);
 
			// Soft falloff instead of a hard binary cutoff — avoids a visible
			// seam where the lens circle meets the black surround.
			float edgeFade = 1.0 - smoothstep(uLensRadius * 0.92, uLensRadius, dist);
			if (dist > uLensRadius * 1.15) {
				gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
				return;
			}
 
			float normDist = clamp(dist / uLensRadius, 0.0, 1.0);
			float distortionFactor = 1.0 + uLensStrength * pow(normDist, 2.5);
			vec2 distortedAspect = center + (uvAspect - center) * distortionFactor;
			
			vec2 finalUv = vec2((distortedAspect.x - 0.5) / aspect + 0.5, distortedAspect.y);
 
			float caBase = 0.005 * pow(normDist, 2.0);
			float caDynamic = (abs(uVelocity) * 0.0025) + (uMouseSpeed * 0.0012);
			float caAmount = caBase + caDynamic;
 
			float r = texture2D(tDiffuse, center + (finalUv - center) * (1.0 - caAmount)).r;
			float g = texture2D(tDiffuse, finalUv).g;
			float b = texture2D(tDiffuse, center + (finalUv - center) * (1.0 + caAmount)).b;
			vec3 finalColor = vec3(r, g, b);
 
			float vignette = smoothstep(1.0, 0.75, normDist);
			finalColor *= vignette * edgeFade;
 
			gl_FragColor = vec4(finalColor, edgeFade);
		}
	`
};
 
// ---------------------------------------------------------------------------
// Glyph Builder & Geometry Loaders
// ---------------------------------------------------------------------------
 
function buildGlyphs(width: number, height: number, previousGlyphs?: Glyph[]): Glyph[] {
	const offscreen = new OffscreenCanvas(width, 200);
	const octx = offscreen.getContext('2d')!;
	octx.font = GLYPH_FONT;
	
	const words = DECLARATION.split(' ');
	const maxLineWidth = Math.min(width * 0.80, 860);
	
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const test = current ? `${current} ${word}` : word;
		if (octx.measureText(test).width > maxLineWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = test;
		}
	}
	if (current) lines.push(current);
	
	const totalH = lines.length * GLYPH_LINE_HEIGHT;
	const startY = height * 0.52 - totalH / 2;
	
	const glyphs: Glyph[] = [];
	let globalIndex = 0;
	
	lines.forEach((line, li) => {
		const lineW = octx.measureText(line).width;
		const startX = (width - lineW) / 2;
		let cx = startX;
		
		for (const char of line) {
			const charW = octx.measureText(char).width;
			if (char !== ' ') {
				const prev = previousGlyphs?.[globalIndex];
				glyphs.push({
					char, restX: cx + charW / 2, restY: startY + li * GLYPH_LINE_HEIGHT,
					x: prev ? prev.x : Math.random() * width,
					y: prev ? prev.y : Math.random() * height,
					vx: prev ? prev.vx : 0, vy: prev ? prev.vy : 0,
					phase: prev ? prev.phase : Math.random() * Math.PI * 2,
					revealT: prev ? prev.revealT : 0, index: globalIndex++,
				});
			}
			cx += charW;
		}
	});
	return glyphs;
}
 
async function loadDreamGeometry(): Promise<THREE.BufferGeometry> {
	return new Promise((resolve) => {
		const loader = new GLTFLoader();
		loader.load(
			'/staircase.glb', 
			(gltf) => {
				let extractedGeo: THREE.BufferGeometry | null = null;
				const box = new THREE.Box3().setFromObject(gltf.scene);
				const center = box.getCenter(new THREE.Vector3());
				const size = box.getSize(new THREE.Vector3());
				const maxDim = Math.max(size.x, size.y, size.z);
				
				const scale = STAIR_TARGET_SIZE / maxDim; 
 
				gltf.scene.traverse((child) => {
					if (child instanceof THREE.Mesh && child.geometry && !extractedGeo) {
						extractedGeo = child.geometry.clone() as THREE.BufferGeometry;
						extractedGeo.translate(-center.x, -center.y, -center.z);
						extractedGeo.scale(scale, scale, scale);
						extractedGeo.computeVertexNormals();
					}
				});
				resolve(extractedGeo || new THREE.BoxGeometry(2.5, 2.5, 2.5));
			},
			undefined,
			() => resolve(new THREE.BoxGeometry(2.5, 2.5, 2.5))
		);
	});
}
 
// ---------------------------------------------------------------------------
// 3D Premium CRT Background Plane
// ---------------------------------------------------------------------------
function buildCRTBackground(scene: THREE.Scene) {
	const geo = new THREE.PlaneGeometry(150, 150);
	const mat = new THREE.ShaderMaterial({
		uniforms: { uTime: { value: 0 } },
		depthWrite: false,
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float uTime;
			varying vec2 vUv;
			void main() {
				float scanline = smoothstep(0.7, 1.0, sin(vUv.y * 800.0 - uTime * 1.5));
				float phosphorX = smoothstep(0.8, 1.0, sin(vUv.x * 1200.0));
				
				float grid = clamp(scanline + (phosphorX * 0.4), 0.0, 1.0);
				
				vec3 bgColor = vec3(0.004, 0.008, 0.016);
				vec3 lineColor = vec3(0.02, 0.045, 0.07); 
				
				gl_FragColor = vec4(mix(bgColor, lineColor, grid), 1.0);
			}
		`
	});
	
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.z = -40;
	scene.add(mesh);
	
	return { mat, geo };
}
 
// ---------------------------------------------------------------------------
// Staircase Triptych — Center Hero + Puddle Reflections
// ---------------------------------------------------------------------------
// Replaces the old 5x7 repeated-grid look with a single composition: one
// hero staircase in the center, and two mirrored "puddle" reflections
// flanking it. Still exactly one InstancedMesh pair (solid + wire) — the
// grid is generated once, in one place, with an instance count of 3 instead
// of 35.
//
// Positioning: the reflections are anchored to two "edge null" Object3Ds
// (After-Effects-style — empty transforms, no geometry) whose X position is
// derived from the camera's actual frustum width at the triptych's depth,
// recomputed on resize. Static offsets don't scale with viewport/aspect, so
// at some widths they landed inside the hero's own bounding width — hence
// the overlap. The nulls guarantee the reflections always sit near the true
// screen edges regardless of viewport size.
//
// Refraction: true screen-space refraction needs its own render-target pass
// (what MeshPhysicalMaterial's `transmission` does internally, uniformly,
// for the whole material). Rather than fake that on the solid mesh (which
// read as a flat color wash across the whole object, not a localized
// effect), the distortion now lives entirely in the WIREFRAME layer: it
// physically stretches outward and ripples, increasing toward each
// instance's own outer edge, with a warm/cool color split standing in for
// chromatic dispersion. The solid mesh stays geometrically clean and only
// gets a subtle fresnel rim so its silhouette reads, not its faces.
 
function buildStaircaseTriptych(scene: THREE.Scene, baseGeo: THREE.BufferGeometry, camera: THREE.PerspectiveCamera) {
	const masterGroup = new THREE.Group();
 
	baseGeo.computeBoundingBox();
	const rawHalfWidth = baseGeo.boundingBox ? (baseGeo.boundingBox.max.x - baseGeo.boundingBox.min.x) / 2 : 0;
	const rotatedBoundingBox = new THREE.Box3();
	if (baseGeo.boundingBox) {
		const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(STAIR_ROTATION);
		const corners = [
			new THREE.Vector3(baseGeo.boundingBox.min.x, baseGeo.boundingBox.min.y, baseGeo.boundingBox.min.z),
			new THREE.Vector3(baseGeo.boundingBox.min.x, baseGeo.boundingBox.min.y, baseGeo.boundingBox.max.z),
			new THREE.Vector3(baseGeo.boundingBox.min.x, baseGeo.boundingBox.max.y, baseGeo.boundingBox.min.z),
			new THREE.Vector3(baseGeo.boundingBox.min.x, baseGeo.boundingBox.max.y, baseGeo.boundingBox.max.z),
			new THREE.Vector3(baseGeo.boundingBox.max.x, baseGeo.boundingBox.min.y, baseGeo.boundingBox.min.z),
			new THREE.Vector3(baseGeo.boundingBox.max.x, baseGeo.boundingBox.min.y, baseGeo.boundingBox.max.z),
			new THREE.Vector3(baseGeo.boundingBox.max.x, baseGeo.boundingBox.max.y, baseGeo.boundingBox.min.z),
			new THREE.Vector3(baseGeo.boundingBox.max.x, baseGeo.boundingBox.max.y, baseGeo.boundingBox.max.z)
		];
		corners.forEach((corner) => corner.applyMatrix4(rotMatrix));
		rotatedBoundingBox.setFromPoints(corners);
	}
	const rotatedGeoHalfWidth = rotatedBoundingBox.isEmpty() ? rawHalfWidth : (rotatedBoundingBox.max.x - rotatedBoundingBox.min.x) / 2;
 
	const wireUniforms = {
		uTime: { value: 0 },
		uScroll: { value: 0 },
		uMouseSpeed: { value: 0 }
	};
 
	function makeWireMaterial(side: number) {
		return new THREE.ShaderMaterial({
			uniforms: {
				...wireUniforms,
				uSide: { value: side },
				uReflection: { value: side === 0 ? 0.0 : 1.0 },
				uFlare: { value: 0.0 } // ── NEW: Flare uniform
			},
			wireframe: true,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			vertexShader: `
				uniform float uSide;
				uniform float uTime;
				uniform float uReflection;
				varying vec3 vPosition;
				varying float vEdgeMask;
				varying float vSide;
				varying float vReflection;
				void main() {
					vPosition = position;
					vSide = uSide;
					vReflection = uReflection;
					vEdgeMask = clamp(abs(position.x) / 2.6, 0.0, 1.0) * abs(uSide);
					vec3 pos = position;
					float stretch = 1.0 + abs(uSide) * vEdgeMask * 0.9;
					pos.x *= stretch;
					pos.y += uSide * vEdgeMask * sin(position.x * 3.0 + uTime * 0.5) * 0.3;
					pos.x += abs(uSide) * vEdgeMask * sin(position.y * 2.2 + uTime * 0.6) * 0.25;
					pos.y += uReflection * sin(position.x * 4.8 + uTime * 2.0) * 0.14;
					pos.x += uReflection * cos(position.y * 5.6 + uTime * 2.4) * 0.065;
					pos.z += uReflection * sin(position.x * 1.8 + uTime * 1.5) * 0.05;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
				}
			`,
			fragmentShader: `
				uniform float uTime;
				uniform float uScroll;
				uniform float uMouseSpeed;
				uniform float uReflection;
				varying vec3 vPosition;
				varying float vEdgeMask;
				varying float vSide;
				varying float vReflection;
 
				void main() {
					vec3 colorBase = vec3(0.05, 0.2, 0.4);
					vec3 colorActive = vec3(0.4, 0.8, 0.9);
					float pulse = sin(vPosition.x * 1.0 + vPosition.y * 1.0 - uTime * 1.2) * 0.5 + 0.5;
					float activity = clamp(0.15 + (uScroll * 0.8) + (uMouseSpeed * 0.005) + (pulse * 0.3) + (vEdgeMask * 0.5), 0.0, 1.0);
					vec3 finalColor = mix(colorBase, colorActive, activity);
					finalColor += vec3(max(vSide, 0.0), 0.0, max(-vSide, 0.0)) * vEdgeMask * 0.22;
					float centerMask = 1.0 - clamp(abs(vSide), 0.0, 1.0);
					float waterTint = uReflection * 0.65;
					finalColor = mix(finalColor, vec3(0.035, 0.085, 0.14), waterTint);
					finalColor = mix(finalColor, vec3(0.17, 0.32, 0.42), centerMask * 0.22);
					float ripple = sin(vPosition.x * 4.3 + uTime * 1.9) * cos(vPosition.y * 3.7 + uTime * 2.3) * 0.08;
					finalColor += ripple * uReflection * 0.12;
					float alpha = mix(0.14, 0.65, activity);
					alpha *= mix(1.0, 0.7, vReflection);
					alpha *= 1.0 - (vReflection * 0.30);
					alpha *= 0.95 + (0.05 * (1.0 - vReflection));
					alpha *= mix(1.0, 0.86, centerMask);
					gl_FragColor = vec4(finalColor, alpha);
				}
			`
		});
	}
 
	const mirror = [1, -1, -1];
	const side = [0, -1, 1];
 	const instances: GridInstanceState[] = side.map((sideValue, i) => {
		const mesh = new THREE.Mesh(baseGeo, makeWireMaterial(sideValue));
		mesh.frustumCulled = false;
		mesh.matrixAutoUpdate = true;
		mesh.position.set(0, 0, 0);
		masterGroup.add(mesh);
		const baseScale = sideValue === 0 ? 1.5 : 1.0;
		return {
			ix: sideValue,
			iy: 0,
			mirrorX: mirror[i],
			baseX: 0,
			baseY: 0,
			solidZ: 0,
			baseScale,
			wireScale: baseScale,
			wireTiltX: 0,
			wireTiltY: 0,
			mesh
		};
	});
 
	masterGroup.position.set(0, 0, -28);
	masterGroup.rotation.y = Math.PI;
	scene.add(masterGroup);
 
	const EDGE_MARGIN = 1;
 
	function updateEdgeNulls(): void {
		const distanceFromCamera = camera.position.z - masterGroup.position.z;
		const vFov = (camera.fov * Math.PI) / 180;
		const visibleHeight = 2 * Math.tan(vFov / 2) * distanceFromCamera;
		const halfWidth = (visibleHeight * camera.aspect) / 2;
		const X_EDGE = halfWidth * EDGE_MARGIN * 1.25;
		const offset = Math.max(0, X_EDGE - rotatedGeoHalfWidth - 1.0);
		instances[0].baseX = 0;
		instances[1].baseX = -offset;
		instances[2].baseX = offset;
	}

	updateEdgeNulls();
 
	return { masterGroup, instances, wireUniforms, updateEdgeNulls };
}
 
// ---------------------------------------------------------------------------
// Render Pipelines
// ---------------------------------------------------------------------------
 
function drawOffscreenGlyphs(
	ctx: CanvasRenderingContext2D, glyphs: Glyph[], mouse: MouseState,
	scrollProgress: number, scrollVelocity: number, time: number, reducedMotion: boolean
): number {
	ctx.textBaseline = 'alphabetic';
	ctx.font = GLYPH_FONT;
	const absVel = Math.abs(scrollVelocity);
 
	const REVEAL_END = 0.75;
	const STAGGER_SPAN = 0.28;
	let maxGlyphSpeed = 0;
 
	glyphs.forEach((glyph) => {
		const staggerOffset = (glyph.index / glyphs.length) * STAGGER_SPAN;
		const localT = clamp((scrollProgress - staggerOffset) / (REVEAL_END - staggerOffset), 0, 1);
		glyph.revealT = smoothstep(0, 1, localT);
 
		let waveJitterX = 0; let waveJitterY = 0;
		if (!reducedMotion && absVel > 3.8) {
			const force = (absVel - 3.8) * 4.2;
			waveJitterX = Math.sin(time * 0.007 + glyph.index * 0.35) * force;
			waveJitterY = Math.cos(time * 0.005 + glyph.index * 0.25) * (force * 0.5);
		}
 
		const driftX = Math.sin(time * 0.00035 + glyph.phase) * 1.2;
		const driftY = Math.cos(time * 0.0003 + glyph.phase * 1.1) * 0.8;
 
		const gdx = glyph.restX - mouse.cx;
		const gdy = glyph.restY - mouse.cy;
		const gdist = Math.hypot(gdx, gdy);
		let repX = 0, repY = 0, proximityAlphaBoost = 0;
 
		if (gdist < 150 && gdist > 0) {
			const proximityFactor = Math.pow((150 - gdist) / 150, 2);
			const force = proximityFactor * 30;
			repX = (gdx / gdist) * force;
			repY = (gdy / gdist) * force;
			proximityAlphaBoost = proximityFactor * 0.35;
		}
 
		const lagY = scrollVelocity * 0.24 * (1 - glyph.revealT * 0.5);
		const lagX = scrollVelocity * 0.05 * Math.sin(glyph.phase);
 
		const targetX = glyph.restX * glyph.revealT + glyph.x * (1 - glyph.revealT) + driftX + repX + lagX + waveJitterX;
		const targetY = glyph.restY * glyph.revealT + glyph.y * (1 - glyph.revealT) + driftY + repY + lagY + waveJitterY;
 
		const springK = 0.08 + glyph.revealT * 0.06; 
		const damping = 0.82; 
		glyph.vx = (glyph.vx + (targetX - glyph.x) * springK) * damping;
		glyph.vy = (glyph.vy + (targetY - glyph.y) * springK) * damping;
		glyph.x += glyph.vx;
		glyph.y += glyph.vy;
 
		if (glyph.revealT < 0.01) return;
 
		maxGlyphSpeed = Math.max(maxGlyphSpeed, Math.abs(glyph.vx), Math.abs(glyph.vy));
 
		const velDim = clamp(absVel * 0.022, 0, 0.30);
		const finalAlpha = clamp((1.0 + proximityAlphaBoost - velDim) * glyph.revealT, 0, 1);
 
		ctx.shadowBlur = 6;
		ctx.shadowColor = 'rgba(140, 170, 220, 0.6)';
		ctx.fillStyle = `rgba(240, 250, 255, ${finalAlpha})`;
		ctx.fillText(glyph.char, glyph.x, glyph.y);
 
	});
 
	return maxGlyphSpeed;
}
 
// ---------------------------------------------------------------------------
// Main Pipeline Initiation & Lazy Loading
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Main Pipeline Initiation & Background Pre-Compilation
// ---------------------------------------------------------------------------
export async function setupDreamCanvas(): Promise<LoopController | null> {
	const section = document.querySelector<HTMLElement>('[data-canvas-zone="dream"]');
	const outputCanvas = document.querySelector<HTMLCanvasElement>('[data-dream-canvas]');
	if (!section || !outputCanvas) return null;
	const sectionEl = section;
	const outputCanvasEl = outputCanvas;
 
	let innerController: LoopController | null = null;
	let isDestroyed = false;
	let isVisible = false;
	// initHeavyLifting's listeners/GPU resources live in its own closure;
	// this is how the outer destroy() reaches in to release them.
	let releaseResources: (() => void) | null = null;
 
	// 1. Build the scene instantly, but keep it dormant
const initHeavyLifting = async () => {
	if (isDestroyed) return;

	await document.fonts.ready;
	
	const bufferCanvas = document.createElement('canvas');
	const bctx = bufferCanvas.getContext('2d');
	if (!bctx) return;

const renderer = new THREE.WebGLRenderer({ canvas: outputCanvas, alpha: false, antialias: false, powerPreference: 'high-performance' });	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);

	const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
	camera.position.z = 2;

	const { mat: crtMaterial, geo: crtGeometry } = buildCRTBackground(scene);

	const baseGeometry = await loadDreamGeometry();
	const { masterGroup, instances, wireUniforms, updateEdgeNulls } = buildStaircaseTriptych(scene, baseGeometry, camera);

	const initialWidth = Math.floor(outputCanvas.clientWidth);
	const initialHeight = Math.floor(outputCanvas.clientHeight);
	const dpr = Math.min(window.devicePixelRatio, 2);

	bufferCanvas.width = initialWidth * dpr;
	bufferCanvas.height = initialHeight * dpr;
	
	renderer.setSize(initialWidth, initialHeight, false);

	let activeTexture = new THREE.CanvasTexture(bufferCanvas);
	activeTexture.minFilter = THREE.LinearFilter;
	activeTexture.magFilter = THREE.LinearFilter;

	const textMaterial = new THREE.MeshBasicMaterial({ map: activeTexture, transparent: true, depthWrite: false });
	const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), textMaterial);

	const dist = 2.5;
	const vFov = (camera.fov * Math.PI) / 180;
	const planeHeight = 2 * Math.tan(vFov / 2) * dist;
	textPlane.scale.set((planeHeight * camera.aspect) / 10, planeHeight / 10, 1);
	textPlane.position.z = -dist;
	camera.add(textPlane);
	scene.add(camera);

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));

	const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.23, 0.7, 0.3);
	composer.addPass(bloomPass);

	const lensPass = new ShaderPass(CustomLensShader);
	composer.addPass(lensPass);

	composer.setSize(initialWidth, initialHeight);
	lensPass.uniforms.uResolution.value.set(initialWidth * dpr, initialHeight * dpr);

	let glyphs = buildGlyphs(initialWidth, initialHeight);
	let lastWidth = initialWidth;
	let lastHeight = initialHeight;
	let frameNeedsGlyphRedraw = true;

	function applyResize(width: number, height: number): void {
		const rdpr = Math.min(window.devicePixelRatio, 2);

		bufferCanvas.width = width * rdpr;
		bufferCanvas.height = height * rdpr;

		renderer.setSize(width, height, false);
		composer.setSize(width, height);
		lensPass.uniforms.uResolution.value.set(width * rdpr, height * rdpr);

		camera.aspect = width / height;
		camera.updateProjectionMatrix();

		const resizedVFov = (camera.fov * Math.PI) / 180;
		const resizedPlaneHeight = 2 * Math.tan(resizedVFov / 2) * dist;
		textPlane.scale.set((resizedPlaneHeight * camera.aspect) / 10, resizedPlaneHeight / 10, 1);

		activeTexture.dispose();
		activeTexture = new THREE.CanvasTexture(bufferCanvas);
		activeTexture.minFilter = THREE.LinearFilter;
		activeTexture.magFilter = THREE.LinearFilter;

		textMaterial.map = activeTexture;
		textMaterial.needsUpdate = true;

		glyphs = buildGlyphs(width, height, glyphs);

		lastWidth = width;
		lastHeight = height;
		frameNeedsGlyphRedraw = true;
	}

	const resizeObserver = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (!entry) return;
		const w = Math.floor(entry.contentRect.width);
		const h = Math.floor(entry.contentRect.height);
		if (w !== lastWidth || h !== lastHeight) applyResize(w, h);
	});
	resizeObserver.observe(outputCanvas);

	renderer.compile(scene, camera);
	composer.render();

	const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const mouse: MouseState = { nx: 0.5, ny: 0.5, cx: 0, cy: 0, speed: 0, prevCx: 0, prevCy: 0, vx: 0, vy: 0 };

let sectionRect = sectionEl.getBoundingClientRect();
	const sectionMetrics = { top: sectionEl.offsetTop, height: sectionEl.offsetHeight };

	function onMouseMove(e: MouseEvent): void {
		// clientX/Y and bounding client rect are both viewport-relative, 
		// so this math is perfectly self-contained. No scroll offsets needed!
		mouse.nx = (e.clientX - sectionRect.left) / Math.max(sectionRect.width, 1);
		mouse.ny = (e.clientY - sectionRect.top) / Math.max(sectionRect.height, 1);
	}

	function onResize(): void {
		sectionRect = sectionEl.getBoundingClientRect();
		sectionMetrics.top = sectionEl.offsetTop;
		sectionMetrics.height = sectionEl.offsetHeight;
	}

	if (hasFinePointer) sectionEl.addEventListener('mousemove', onMouseMove);
	window.addEventListener('resize', onResize);

const render = (time: number): void => {
		if (!isVisible) return;

		const width = lastWidth;
		const height = lastHeight;
		const dpr = Math.min(window.devicePixelRatio, 2);

		const scrollProgress = calcScrollProgress(sectionMetrics.top, sectionMetrics.height);		const scrollVelocity = _lenisVelocity;
		const absVel = Math.abs(scrollVelocity);

		mouse.cx = mouse.nx * width;
		mouse.cy = mouse.ny * height;
		const mdx = mouse.cx - mouse.prevCx;
		const mdy = mouse.cy - mouse.prevCy;
		const rawSpeed = Math.sqrt(mdx * mdx + mdy * mdy);
		mouse.speed += (rawSpeed - mouse.speed) * 0.12;

		mouse.prevCx = mouse.cx;
		mouse.prevCy = mouse.cy;

		const isRevealing = scrollProgress > 0 && scrollProgress < 0.42;
		const pointerActive = mouse.speed > 0.05;

		if (isRevealing || pointerActive || absVel > 0.5 || frameNeedsGlyphRedraw) {
			bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			bctx.clearRect(0, 0, width, height);

			const maxGlyphSpeed = drawOffscreenGlyphs(bctx, glyphs, mouse, scrollProgress, scrollVelocity, time, prefersReducedMotion);
			activeTexture.needsUpdate = true;

			frameNeedsGlyphRedraw = maxGlyphSpeed > 0.02;
		}

		const mouseTiltX = (mouse.nx - 0.5) * 2.0;
		const mouseTiltY = (mouse.ny - 0.5) * 2.0;

		instances.forEach((inst) => {
			const distToCenter = Math.abs(inst.ix);
			const scrollWave = Math.sin(distToCenter * 0.8 - scrollProgress * 15.0) * (absVel * 0.05);
			inst.solidZ = lerp(inst.solidZ, scrollWave, 0.1);

			const targetScale = inst.baseScale + (mouse.speed * 0.002);
			inst.wireScale = lerp(inst.wireScale, targetScale, 0.05);
			inst.wireTiltX = lerp(inst.wireTiltX, mouseTiltY * 0.08, 0.05);
			inst.wireTiltY = lerp(inst.wireTiltY, mouseTiltX * 0.08 * inst.ix, 0.05);

			let currentZ = inst.solidZ;
			let stretchX = 1.0;

			if (inst.ix === 0) {
				// Easing curve: Starts at 5% scroll, ends at 35%
				const beamProgress = smoothstep(0.15, 0.5, scrollProgress);
				
				// Pull it from the deep horizon
				currentZ += lerp(-150, 0, beamProgress);
				
				// Stretch it into a continuous light-trail
				stretchX = lerp(60, 1, beamProgress);

				// Feed HDR flare values into the shader
				const mat = inst.mesh.material as THREE.ShaderMaterial;
				mat.uniforms.uFlare.value = lerp(10.0, 0.0, beamProgress); 
			}

			inst.mesh.position.set(inst.baseX, inst.baseY, currentZ);

			const rotX = STAIR_ROTATION.x + inst.wireTiltX + (inst.ix === 0 ? Math.PI : 0);
			const rotY = (STAIR_ROTATION.y * inst.mirrorX) + inst.wireTiltY;
			const rotZ = STAIR_ROTATION.z * inst.mirrorX + (inst.ix === 0 ? Math.PI / 4 : 0);
			inst.mesh.rotation.set(rotX, rotY, rotZ);
			// Force the center instance to be flipped on X explicitly
			const xScale = inst.ix === 0 
				? -Math.abs(inst.wireScale) * stretchX 
				: inst.mirrorX * Math.abs(inst.wireScale);
			const yScale = Math.abs(inst.wireScale);
			const zScale = Math.abs(inst.wireScale); 
			
			inst.mesh.scale.set(xScale, yScale, zScale);
			
			inst.mesh.updateMatrix();
		});

		let lensScaleEnvelope = 0.0;
		if (scrollProgress < 0.25) {
			lensScaleEnvelope = smoothstep(0, 1, scrollProgress / 0.25);
		} else if (scrollProgress > 0.75) {
			lensScaleEnvelope = smoothstep(0, 1, (1.0 - scrollProgress) / 0.25);
		} else {
			lensScaleEnvelope = 1.0;
		}

		lensPass.uniforms.uLensRadius.value = lensScaleEnvelope * 2.0;
		lensPass.uniforms.uVelocity.value = prefersReducedMotion ? 0 : scrollVelocity;
		lensPass.uniforms.uMouseSpeed.value = prefersReducedMotion ? 0 : mouse.speed;
		lensPass.uniforms.uTime.value = time * 0.001;

		updateEdgeNulls();
		wireUniforms.uTime.value = time * 0.001;
		wireUniforms.uScroll.value = scrollProgress;
		wireUniforms.uMouseSpeed.value = mouse.speed;

		crtMaterial.uniforms.uTime.value = time * 0.001;

		composer.render();
	};

	innerController = createLoopController(section, render);

	releaseResources = () => {
		if (hasFinePointer) section.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('resize', onResize);
		resizeObserver.disconnect();

		textPlane.geometry.dispose();
		textMaterial.dispose();
		baseGeometry.dispose();
		activeTexture.dispose();
		crtGeometry.dispose();
		crtMaterial.dispose();
		composer.dispose();
		renderer.dispose();
	};

	if (isDestroyed) {
		innerController?.destroy?.();
		releaseResources?.();
	}
};

if ('requestIdleCallback' in window) {
	window.requestIdleCallback(() => initHeavyLifting());
} else {
	setTimeout(() => initHeavyLifting(), 1000);
}

const observer = new IntersectionObserver((entries) => {
	isVisible = entries[0].isIntersecting;
}, {
	rootMargin: '1000px 0px',
	threshold: 0
});

observer.observe(sectionEl);

return {
	start: () => {
		innerController?.start?.();
	},
	stop: () => {
		innerController?.stop?.();
	},
	destroy: () => {
		isDestroyed = true;
		observer.disconnect();
		innerController?.destroy?.();
		releaseResources?.();
	}
}}
