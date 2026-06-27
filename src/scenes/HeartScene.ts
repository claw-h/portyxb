import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { clamp, lerp, smoothstep } from '../utils/math';
import { createLoopController } from '../utils/canvas';
import type { LoopController } from '../utils/canvas';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

interface SliceMaterials {
	solid: THREE.MeshPhysicalMaterial;
	wire: THREE.MeshBasicMaterial;
	edges: THREE.LineBasicMaterial;
}

interface SliceHolder extends THREE.Group {
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
const SCROLL_DAMPING = 0.08; // Control smooth kinetic scrolling inertia

const TIMELINE = {
	heartFade: { start: 0.035, end: 0.11 },
	rotateH: { start: 0.1, end: 0.34 },
	rotateV: { start: 0.34, end: 0.58 },
	dissection: { start: 0.62, end: 0.82 },
	fireIn: { start: 0.76, end: 0.88 },
	fireOut: { start: 0.92, end: 0.96 },
	ink: { start: 0.90, end: 0.98 },
	hudIn: { start: 0.02, end: 0.15 },
	hudOut: { start: 0.50, end: 0.60 },
	terminal: { start: 0.9, end: 1.0 }
} as const;


// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function mergeModelGeometry(model: THREE.Object3D): THREE.BufferGeometry[] {
	const geometries: THREE.BufferGeometry[] = [];
	const modelBox = new THREE.Box3();
	model.updateWorldMatrix(true, true);

	model.traverse((child) => {
		if (!(child instanceof THREE.Mesh) || !child.geometry) return;
		const geometry = child.geometry.clone() as THREE.BufferGeometry;
		geometry.applyMatrix4(child.matrixWorld);
		geometry.deleteAttribute('uv');
		const nonIndexed = geometry.toNonIndexed();
		nonIndexed.computeBoundingBox();
		modelBox.union(nonIndexed.boundingBox!);
		geometries.push(nonIndexed);
	});

	if (!geometries.length) return [];

	const center = new THREE.Vector3();
	const size = new THREE.Vector3();
	modelBox.getCenter(center);
	modelBox.getSize(size);
	const scale = 3.05 / Math.max(size.x, size.y, size.z);
	const normalize = new THREE.Matrix4()
		.makeTranslation(-center.x, -center.y, -center.z)
		.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));

	return geometries.map((geometry) => {
		geometry.applyMatrix4(normalize);
		geometry.computeVertexNormals();
		return geometry;
	});
}

function buildSliceGeometry(geometries: THREE.BufferGeometry[], sliceIndex: number): THREE.BufferGeometry {
	const box = new THREE.Box3();
	geometries.forEach((g) => {
		g.computeBoundingBox();
		box.union(g.boundingBox!);
	});

	const height = box.max.y - box.min.y;
	const overlap = height * 0.035;
	const low = box.min.y + (height / SLICE_COUNT) * sliceIndex - overlap;
	const high = box.min.y + (height / SLICE_COUNT) * (sliceIndex + 1) + overlap;
	const positions: number[] = [];

	geometries.forEach((geometry) => {
		const source = geometry.attributes.position.array as Float32Array;
		for (let i = 0; i < source.length; i += 9) {
			const y = (source[i + 1] + source[i + 4] + source[i + 7]) / 3;
			if (y < low || y > high) continue;
			for (let v = 0; v < 9; v++) positions.push(source[i + v]);
		}
	});

	const sliceGeometry = new THREE.BufferGeometry();
	sliceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	sliceGeometry.computeVertexNormals();
	sliceGeometry.computeBoundingBox();
	return sliceGeometry;
}

async function buildSlices(
	geometries: THREE.BufferGeometry[],
	group: THREE.Group,
): Promise<SliceHolder[]> {
	const slices: SliceHolder[] = [];

	for (let i = 0; i < SLICE_COUNT; i++) {
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		const sliceGeometry = buildSliceGeometry(geometries, i);
		if (!sliceGeometry.attributes.position?.count) continue;
		sliceGeometry.computeBoundingBox();

		const solidMaterial = new THREE.MeshPhysicalMaterial({
			color: 0x07162c,
			emissive: 0x1c2e4d,
			emissiveIntensity: 0.08,
			transparent: true,
			opacity: 0.42,
			roughness: 0.18,
			metalness: 0.06,
			transmission: 0.72,
			thickness: 1.8,
			clearcoat: 0.82,
			clearcoatRoughness: 0.12,
			reflectivity: 0.38,
			ior: 1.34,
			side: THREE.DoubleSide,
			depthWrite: false,
		});
		const wireMaterial = new THREE.MeshBasicMaterial({
			color: 0xc6e4ff,
			transparent: true,
			opacity: 0.35,
			wireframe: true,
			depthWrite: false,
		});
		const edgeMaterial = new THREE.LineBasicMaterial({
			color: 0x76cdff,
			transparent: true,
			opacity: 0.22,
		});

		const holder = new THREE.Group() as SliceHolder;
		holder.userData.baseY = 0;
		holder.userData.direction = i - (SLICE_COUNT - 1) / 2;
		holder.userData.phase = i * 0.34;
		holder.userData.index = i;

		const solid = new THREE.Mesh(sliceGeometry, solidMaterial);
		const wire = new THREE.Mesh(sliceGeometry.clone(), wireMaterial);
		const edges = new THREE.LineSegments(new THREE.EdgesGeometry(sliceGeometry, 22), edgeMaterial);
		wire.scale.setScalar(1.006);
		edges.scale.setScalar(1.011);
		holder.add(solid, wire, edges);
		holder.userData.materials = { solid: solidMaterial, wire: wireMaterial, edges: edgeMaterial };
		holder.position.y = 0;
		group.add(holder);
		slices.push(holder);
	}

	return slices;
}

// ---------------------------------------------------------------------------
// High Performance Scroll Evaluator
// ---------------------------------------------------------------------------

function evaluateScrollState(progress: number): ScrollState {
	return {
		progress,
		heartFade: smoothstep(TIMELINE.heartFade.start, TIMELINE.heartFade.end, progress),
		rotateHorizontal: smoothstep(TIMELINE.rotateH.start, TIMELINE.rotateH.end, progress),
		rotateVertical: smoothstep(TIMELINE.rotateV.start, TIMELINE.rotateV.end, progress),
		dissectionProgress: smoothstep(TIMELINE.dissection.start, TIMELINE.dissection.end, progress),
		fireProgress: smoothstep(TIMELINE.fireIn.start, TIMELINE.fireIn.end, progress) * (1 - smoothstep(TIMELINE.fireOut.start, TIMELINE.fireOut.end, progress)),
		inkProgress: smoothstep(TIMELINE.ink.start, TIMELINE.ink.end, progress),
		hudProgress: smoothstep(TIMELINE.hudIn.start, TIMELINE.hudIn.end, progress) * (1 - smoothstep(TIMELINE.hudOut.start, TIMELINE.hudOut.end, progress)),
		terminalProgress: smoothstep(TIMELINE.terminal.start, TIMELINE.terminal.end, progress),
	};
}

// ---------------------------------------------------------------------------
// WebGL fire class
// ---------------------------------------------------------------------------

function createWebGLFireSystem(fireCount = 200) {
	const geometry = new THREE.BufferGeometry();
	const positions = new Float32Array(fireCount * 3);
	const velocities = new Float32Array(fireCount * 3);
	const lifetimes = new Float32Array(fireCount); // 0.0 to 1.0
	const sizes = new Float32Array(fireCount);

	for (let i = 0; i < fireCount; i++) {
		resetParticle(i);
		lifetimes[i] = Math.random();
	}

	function resetParticle(i: number) {
		positions[i * 3] = (Math.random() - 0.5) * 4;       
		positions[i * 3 + 1] = -3 + Math.random() * 0.5;    
		positions[i * 3 + 2] = 1 + (Math.random() - 0.5);   
		
		velocities[i * 3] = (Math.random() - 0.5) * 0.02;   
		velocities[i * 3 + 1] = 0.04 + Math.random() * 0.04;
		velocities[i * 3 + 2] = 0;                          

		lifetimes[i] = 1.0;
		sizes[i] = Math.random() * 2.0 + 1.0;
	}

	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
	geometry.setAttribute('aLife', new THREE.BufferAttribute(lifetimes, 1));
	geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

	const material = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uIntensity: { value: 0.0 }
		},
		vertexShader: `
			attribute float aLife;
			attribute float aSize;
			varying float vLife;
			uniform float uTime;
			uniform float uIntensity;

			void main() {
				vLife = aLife;
				vec3 pos = position;
				
				pos.x += sin(uTime * 2.0 + pos.y * 2.0) * 0.2 * uIntensity;
				
				vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
				
				gl_PointSize = aSize * 40.0 * (vLife + 0.2) * uIntensity * (10.0 / -mvPosition.z);
				gl_Position = projectionMatrix * mvPosition;
			}
		`,
		fragmentShader: `
			varying float vLife;
			uniform float uIntensity;

			void main() {
				if (uIntensity < 0.01) discard;

				vec2 xy = gl_PointCoord.xy - vec2(0.5);
				float distance = length(xy);
				if (distance > 0.5) discard;

				float alpha = (0.5 - distance) * 2.0;
				alpha *= vLife * uIntensity;

				vec3 colorWhite = vec3(1.0, 0.9, 0.7);
				vec3 colorOrange = vec3(1.0, 0.4, 0.0);
				vec3 colorRed = vec3(0.5, 0.0, 0.0);

				vec3 finalColor = mix(colorRed, colorOrange, smoothstep(0.0, 0.5, vLife));
				finalColor = mix(finalColor, colorWhite, smoothstep(0.5, 1.0, vLife));

				gl_FragColor = vec4(finalColor, alpha);
			}
		`,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

	const points = new THREE.Points(geometry, material);

	const update = (time: number, intensity: number) => {
		material.uniforms.uTime.value = time * 0.001;
		material.uniforms.uIntensity.value = intensity;

		if (intensity <= 0.01) return;

		const posAttr = geometry.attributes.position;
		const lifeAttr = geometry.attributes.aLife;
		const velAttr = geometry.attributes.aVelocity;

		for (let i = 0; i < fireCount; i++) {
			let life = lifeAttr.getX(i);
			life -= 0.01;

			if (life <= 0) {
				resetParticle(i);
			} else {
				lifeAttr.setX(i, life);
				
				posAttr.setX(i, posAttr.getX(i) + velAttr.getX(i));
				posAttr.setY(i, posAttr.getY(i) + velAttr.getY(i) * (1.0 + intensity * 0.5));
			}
		}

		posAttr.needsUpdate = true;
		lifeAttr.needsUpdate = true;
	};

	return { mesh: points, update };
}

// ---------------------------------------------------------------------------
// Public setup function
// ---------------------------------------------------------------------------

export function setupHeartScene(): LoopController | null {
	const section = document.querySelector<HTMLElement>('[data-hero]');
	const canvas = document.querySelector<HTMLCanvasElement>('[data-heart-canvas]');
	const progressBar = document.querySelector<HTMLElement>('[data-hero-progress]');
	const depthReadout = document.querySelector<HTMLElement>('[data-depth-readout]');
	const labels = document.querySelectorAll<HTMLElement>('[data-dimension-label]');
	const scrollPrompt = document.querySelector<HTMLElement>('[data-scroll-prompt]');
	const fillAortic = document.querySelector<HTMLElement>('.gel-fill--aortic');
	const fillVentricle = document.querySelector<HTMLElement>('.gel-fill--ventricle');

	if (!section || !canvas) return null;

	window.setTimeout(() => {
		if (window.scrollY < 8) section.classList.add('is-idle');
	}, 1400);

	let cachedSectionTop = 0;
	let cachedScrollableRange = 0;
	
	let targetProgress = 0;
	let currentProgress = 0;

    // ─── MOUSE TRACKING STATE ────────────────────────────────────────────────
    const mouse = {
        currentX: 0,
        currentY: 0,
        targetX: 0,
        targetY: 0
    };

    const handleMouseMove = (e: MouseEvent) => {
        mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    // ─────────────────────────────────────────────────────────────────────────

	// ---------------------------------------------------------------------------
	// Three.js scene setup
	// ---------------------------------------------------------------------------

	const scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x020308, 0.035);

	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
	camera.position.set(0, 0.02, 6.9);

	const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
	renderer.localClippingEnabled = true;
	renderer.setClearColor(0x000000, 0); 
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;

	const renderPass = new RenderPass(scene, camera);
	renderPass.clearColor = new THREE.Color(0, 0, 0);
	renderPass.clearAlpha = 0;

	const bloomPass = new UnrealBloomPass(
		new THREE.Vector2(window.innerWidth, window.innerHeight),
		1.5, 
		0.4, 
		0.9  
	);

	// ─── WEBGL INK BLEED SHADER ──────────────────────────────────────────────
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

	const fireSystem = createWebGLFireSystem(250); 
	scene.add(fireSystem.mesh);

	const heartGroup = new THREE.Group();
	scene.add(heartGroup);

	const ambient = new THREE.AmbientLight(0x4da2ff, 1.8);
	const key = new THREE.PointLight(0xa6d8ff, 95, 14);
	key.position.set(3, 2.8, 4);
	const blue = new THREE.PointLight(0x00aaff, 45, 12);
	blue.position.set(-3, -1.8, 3);
	scene.add(ambient, key, blue);

	// ─── DARK ATMOSPHERIC BACKGROUND GRID ────────────────────────────────────
	const gridMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uGlowColor: { value: new THREE.Color(0x6b8c96) } 
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
		blending: THREE.AdditiveBlending,
		depthWrite: false
	});
	
	const screenGrid = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), gridMaterial);
	screenGrid.position.z = -15; 
	scene.add(screenGrid);

	// ---------------------------------------------------------------------------
	// Slice state
	// ---------------------------------------------------------------------------

	let slices: SliceHolder[] = [];

	const loader = new GLTFLoader();
	loader.load(
		'/heart.glb',
		async (gltf) => {
			slices = await buildSlices(mergeModelGeometry(gltf.scene), heartGroup);
			renderer.compile(scene, camera);
		},
		undefined,
		async () => {
			const fallback = new THREE.SphereGeometry(1.2, 64, 32).toNonIndexed();
			fallback.scale(0.82, 1.16, 0.72);
			slices = await buildSlices([fallback], heartGroup);
			fallback.dispose(); 
			renderer.compile(scene, camera);
		},
	);

	// ---------------------------------------------------------------------------
	// HUD update
	// ---------------------------------------------------------------------------

    function applyDOMScrollState(state: ScrollState): void {
		const { progress, heartFade, hudProgress, terminalProgress } = state;

		progressBar?.style.setProperty('height', `${progress * 100}%`);
		section.style.setProperty('--heart-opacity', String(heartFade));
		section.style.setProperty('--heart-darkness', String(state.inkProgress));
		section.style.setProperty('--hud-opacity', String(hudProgress));

		section.classList.toggle('is-idle', progress < 0.02 && section.classList.contains('is-idle'));
		if (scrollPrompt && progress > 0.02) scrollPrompt.style.opacity = '0';
		if (depthReadout) depthReadout.textContent = `${(progress * 100).toFixed(2)}%`;

		if (fillAortic) fillAortic.style.width = `${lerp(15, 92, progress)}%`;
		if (fillVentricle) fillVentricle.style.width = `${lerp(80, 25, progress)}%`;

		section.classList.toggle('is-terminal', terminalProgress > 0.35);
	}

	// ---------------------------------------------------------------------------
	// Layout Caching / Resize Handler
	// ---------------------------------------------------------------------------

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
		calculateTargetProgress();
    }

	function calculateTargetProgress(): void {
		targetProgress = clamp((window.scrollY - cachedSectionTop) / Math.max(cachedScrollableRange, 1));
	}

	// ---------------------------------------------------------------------------
	// Main render loop
	// ---------------------------------------------------------------------------

    const render = (time: number): void => {
        currentProgress = lerp(currentProgress, targetProgress, SCROLL_DAMPING);

        if (Math.abs(currentProgress - targetProgress) < 0.0001) {
            currentProgress = targetProgress;
        }

        const state = evaluateScrollState(currentProgress);
        applyDOMScrollState(state);

        const { rotateHorizontal, rotateVertical, dissectionProgress, heartFade, fireProgress, inkProgress, progress } = state;

        // 1. Heart Model Transformations
        heartGroup.rotation.y = rotateHorizontal * Math.PI * 2 + Math.sin(time * 0.00022) * 0.035 * heartFade;
        heartGroup.rotation.x = -0.08 + rotateVertical * Math.PI * 2;
        heartGroup.rotation.z = lerp(0, -0.03, rotateVertical);
        camera.position.z = lerp(6.9, 8.45, dissectionProgress);

        // ─── CINEMATIC MOUSE PARALLAX ──────────────────────────────────────
        mouse.currentX = lerp(mouse.currentX, mouse.targetX, 0.05);
        mouse.currentY = lerp(mouse.currentY, mouse.targetY, 0.05);

        camera.position.x = mouse.currentX * 0.4;
        // Combine the scroll-driven Y movement with the parallax Y movement
        camera.position.y = lerp(0.02, -0.03, dissectionProgress) + mouse.currentY * 0.4;
        
        // Force the camera lens to stay perfectly centered on the scene
        camera.lookAt(0, 0, 0);
        // ───────────────────────────────────────────────────────────────────

        // 2. Dissection Spacing
        slices.forEach((slice, i) => {
            const direction = slice.userData.direction ?? i - 2;
            const eased = 1 - Math.pow(1 - dissectionProgress, 3);
            slice.position.y = slice.userData.baseY + direction * eased * SLICE_GAP;
            slice.position.z = Math.abs(direction) * eased * 0.04;
        });

        // 3. Slice Illumination
        const lightPhase = smoothstep(0.40, 0.72, progress) * (1 - smoothstep(0.92, 0.98, progress));
        slices.forEach((slice, i) => {
            const { materials } = slice.userData;
            const idx = typeof slice.userData.index === 'number' ? slice.userData.index : i;
            const order = idx / Math.max(SLICE_COUNT - 1, 1);
            const delay = order * 0.16;
            const sliceLight = clamp((lightPhase - delay) / 0.32);

            materials.solid.emissive.setRGB(sliceLight, sliceLight * 0.58, sliceLight * 0.24 * 0.75);
            materials.solid.emissiveIntensity = lerp(0.04, 1.5, sliceLight);

            materials.wire.opacity = lerp(0.35, 0.95, sliceLight);
            materials.edges.opacity = lerp(0.22, 0.9, sliceLight);
        });

        // 4. Perfect 3D-to-2D Label Tracking (Alternating Sides)
        scene.updateMatrixWorld(true);

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

            const slicePos = new THREE.Vector3();
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

		// 5. Update WebGL Fire Particles
        fireSystem.update(time, fireProgress);

        // 6. Update Custom Post-Processing Shaders
        inkPass.uniforms.uTime.value = time * 0.001;
        inkPass.uniforms.uProgress.value = smoothstep(0.0, 1.0, inkProgress);
        inkPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
		gridMaterial.uniforms.uTime.value = time * 0.001;

        // 7. Render entire scene through the Composer
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
            window.removeEventListener('mousemove', handleMouseMove); // NEW: Prevent memory leaks
			renderer.dispose();
			scene.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.geometry.dispose();
					if (Array.isArray(obj.material)) {
						obj.material.forEach((m) => m.dispose());
					} else {
						obj.material.dispose();
					}
				}
			});
		},
	};
}