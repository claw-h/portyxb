import { 
	Scene, 
	PerspectiveCamera, 
	WebGLRenderer, 
	Vector2, 
	Group, 
	Box3, 
	Vector3, 
	Mesh, 
	AmbientLight, 
	DirectionalLight,
	Raycaster
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createLoopController } from '../utils/canvas';
import type { LoopController } from '../utils/canvas';
import { clamp, lerp, smoothstep } from '../utils/math';

let _tvScrollProgress = 0;
export function setTelevisionScrollProgress(p: number) {
	_tvScrollProgress = clamp(p, 0, 1);
}

// ---------------------------------------------------------------------------
// Custom Lens Fisheye Shader (Adapted from DreamCanvas)
// ---------------------------------------------------------------------------
const CustomLensShader = {
	uniforms: {
		tDiffuse: { value: null },
		uLensRadius: { value: 0.85 },
		uLensStrength: { value: 0.15 }, // Milder warp for OS readability
		uVelocity: { value: 0.0 },
		uTime: { value: 0.0 },
		uResolution: { value: new Vector2(1, 1) }
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
		uniform float uTime;
		uniform vec2 uResolution;
		varying vec2 vUv;
 
		void main() {
			vec2 uv = vUv;
			vec2 center = vec2(0.5, 0.5);
			float aspect = uResolution.x / uResolution.y;
			
			vec2 uvAspect = vec2((uv.x - 0.5) * aspect + 0.5, uv.y);
			float dist = distance(uvAspect, center);
 
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
			float caAmount = caBase + (abs(uVelocity) * 0.002);
 
			float r = texture2D(tDiffuse, center + (finalUv - center) * (1.0 - caAmount)).r;
			float g = texture2D(tDiffuse, finalUv).g;
			float b = texture2D(tDiffuse, center + (finalUv - center) * (1.0 + caAmount)).b;
			float a = texture2D(tDiffuse, finalUv).a;
			
			vec3 finalColor = vec3(r, g, b);
 
			// Scanline overlay (only apply where there is some opacity)
			float scanline = sin(uv.y * uResolution.y * 1.5) * 0.04;
			finalColor -= scanline * a;

			float vignette = smoothstep(1.0, 0.65, normDist);
			finalColor *= vignette * edgeFade;
 
			gl_FragColor = vec4(finalColor, a * edgeFade);
		}
	`
};

interface TVPart {
	mesh: Mesh;
	originalPos: Vector3;
	originalRot: Vector3; // Euler angles
	offsetPos: Vector3;  // Where it flies in from
	targetPos: Vector3;  // Where it assembles (inside the cabinet)
	animStart: number;
	animEnd: number;
}

export function setupTelevisionScene(): LoopController | null {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-tv-canvas]');
	if (!canvas) return null;

	const scene = new Scene();
	const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
	
	const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
	renderer.setClearColor(0x000000, 0); // ensure background is perfectly transparent
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

	const composer = new EffectComposer(renderer);
	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);

	const lensPass = new ShaderPass(CustomLensShader);
	lensPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
	composer.addPass(lensPass);

	// Warm, low-poly cinematic lighting for the TV reveal
	const ambient = new AmbientLight(0xffaa55, 1.2);
	scene.add(ambient);
	const dirLight = new DirectionalLight(0xffcc88, 2.5);
	dirLight.position.set(5, 10, 15);
	scene.add(dirLight);

	const tvGroup = new Group();
	scene.add(tvGroup);

	const tvParts: TVPart[] = [];
	let isBooted = false;

	// Load TV Model
	const loader = new GLTFLoader();
	loader.load('/TV.glb', (gltf) => {
		
		// Normalize size
		const box = new Box3().setFromObject(gltf.scene);
		const center = box.getCenter(new Vector3());
		const size = box.getSize(new Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		const scale = 15 / maxDim; // Scale up so it fills screen nicely
		
		gltf.scene.position.sub(center);
		gltf.scene.scale.set(scale, scale, scale);
		
		// Build a precise sequence mapping
		gltf.scene.traverse(child => {
			if (!(child instanceof Mesh)) return;
			
			// Aggregate names from all parents in case the mesh itself is just called 'Mesh_1'
			let name = child.name.toUpperCase();
			let parent = child.parent;
			while (parent && parent.type !== 'Scene') {
				name += ' ' + parent.name.toUpperCase();
				parent = parent.parent;
			}
			
			const originalPos = child.position.clone();
			const originalRot = new Vector3(child.rotation.x, child.rotation.y, child.rotation.z);
			
			// 1. Where does it fly in from? (Off-screen)
			let offsetPos = originalPos.clone();
			
			// 2. Where does it assemble? 
			// Because the GLB was exported in an "exploded" state, originalPos leaves them hovering outside.
			// We define targetPos to move them back INSIDE the cabinet.
			let targetPos = originalPos.clone();

			let animStart = 0;
			let animEnd = 1;

			// =========================================================================
			// 🛠️ ASSEMBLY TWEAKING ZONE
			// Adjust `targetPos` to shift where the part lands inside the cabinet.
			// Adjust `offsetPos` to change where it flies in from.
			// =========================================================================

			if (name.includes('MOTHERBOARD')) {
				offsetPos.x += 120; // far right off-screen
				targetPos.y -= 0.15; // Move down into cabinet
				
				animStart = 0.15;
				animEnd = 0.35;
			} else if (name.includes('SOUND BOARD') || name.includes('SOUNDBOARD')) {
				offsetPos.x += 120; // far right off-screen
				targetPos.x += 0.2; // Move right into cabinet
				targetPos.y -= 0.35; // Move down into cabinet
				
				animStart = 0.35;
				animEnd = 0.50;
			} else if (name.includes('SCREEN CASING')) {
				offsetPos.x += 120; // far right off-screen
				targetPos.y -= 0.4; // Move down into cabinet
				
				animStart = 0.50;
				animEnd = 0.70;
			} else if (name.includes('PSU')) {
				offsetPos.x -= 120; // far left off-screen
				targetPos.x -= 0.2; // Move left into cabinet
				targetPos.y -= 0.1; // Move down into cabinet
				
				animStart = 0.50;
				animEnd = 0.70;
			} else if (name.includes('CRT TUBE')) {
				offsetPos.z -= 120; // deep back off-screen
				targetPos.y -= 0.45; // Move down into cabinet
				
				animStart = 0.60;
				animEnd = 0.85;
			} else if (name.includes('SCREEN') && !name.includes('CASING')) {
				offsetPos.z += 120; // front off-screen
				targetPos.y -= 0.7; // Move way down into cabinet
				targetPos.z -= 0.05; // Push slightly into casing
				
				animStart = 0.65;
				animEnd = 0.85;
			} else if (name.includes('CABINET')) {
				const mats = Array.isArray(child.material) ? child.material as any[] : [child.material as any];
				mats.forEach(mat => {
					if (mat) {
						mat.transparent = true;
						mat.opacity = 0;
					}
				});
				animStart = 0.0;
				animEnd = 0.15;
			}

			// Hide parts initially so they don't hover awkwardly in view
			if (!name.includes('CABINET')) {
				child.visible = false;
			}

			tvParts.push({
				mesh: child as Mesh,
				originalPos,
				originalRot,
				offsetPos,
				targetPos,
				animStart,
				animEnd
			});
		});

		tvGroup.add(gltf.scene);
	});

	// Fix initial camera position (will be driven by scroll later)
	camera.position.set(0, 30, 25);
	camera.lookAt(0, 0, 0);

	let lastTime = performance.now();
	let prevProgress = 0;

	const section = document.querySelector('.tv-zone');
	if (!section) return null;

	const onResize = () => {
		const w = window.innerWidth;
		const h = window.innerHeight;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
		composer.setSize(w, h);
		lensPass.uniforms.uResolution.value.set(w, h);
	};
	window.addEventListener('resize', onResize);

	// Interaction logic for booting the OS
	const raycaster = new Raycaster();
	const mouse = new Vector2();
	const onClick = (event: MouseEvent) => {
		// Only allow interaction if TV is mostly assembled
		if (_tvScrollProgress < 0.90) return;

		mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
		mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);

		const intersects = raycaster.intersectObject(tvGroup, true);
		if (intersects.length > 0 && !isBooted) {
			isBooted = true;
			if ((window as any).bootGrafxOS) {
				(window as any).bootGrafxOS();
			}
		}
	};
	window.addEventListener('click', onClick);

	const loop = createLoopController(section, (time) => {
		const deltaTime = Math.max(16, time - lastTime);
		lastTime = time;
		// Update Lens Uniforms & Light Intensity (Fade from black)
		lensPass.uniforms.uTime.value = time * 0.001;
		const velocity = (_tvScrollProgress - prevProgress) / deltaTime;
		prevProgress = _tvScrollProgress;
		lensPass.uniforms.uVelocity.value = lerp(lensPass.uniforms.uVelocity.value, velocity * 100, 0.1);

		// Fade out the shader effect when scrolled away for pure black
		const effectIntensity = smoothstep(0.0, 0.15, _tvScrollProgress);
		lensPass.uniforms.uLensStrength.value = 0.15 * effectIntensity;

		// Drive Camera Descent
		const cameraProgress = smoothstep(0.0, 0.85, _tvScrollProgress);
		camera.position.y = lerp(30, 0, cameraProgress);
		camera.position.z = lerp(35, 20, cameraProgress);
		camera.lookAt(0, 0, 0);

		// Animate Assembly Sequence
		tvParts.forEach(part => {
			let localProgress = 0.0;
			const isCabinet = part.mesh.name.toUpperCase().includes('CABINET');

			if (_tvScrollProgress >= part.animEnd) {
				localProgress = 1.0;
			} else if (_tvScrollProgress > part.animStart) {
				localProgress = smoothstep(part.animStart, part.animEnd, _tvScrollProgress);
			}

			// Show parts only when their animation begins (or if they are already done)
			if (!isCabinet) {
				if (_tvScrollProgress > part.animStart) {
					part.mesh.visible = true;
				} else {
					part.mesh.visible = false;
				}
			}

			// Handle opacity fading for the cabinet
			if (isCabinet && part.mesh.material) {
				const mats = Array.isArray(part.mesh.material) ? part.mesh.material as any[] : [part.mesh.material as any];
				mats.forEach(mat => {
					if (mat) mat.opacity = localProgress;
				});
			}

			// Lerp position tightly to the sequence without random noise
			part.mesh.position.lerpVectors(part.offsetPos, part.targetPos, localProgress);
		});

		// Reset OS if scrolled away
		if (_tvScrollProgress < 0.9 && isBooted) {
			isBooted = false; // reset if user scrolls back up
			const shell = document.querySelector('[data-grafx-shell]');
			if (shell) shell.classList.remove('is-booting');
		}

		composer.render();
	});

	return {
		start: loop.start,
		stop: loop.stop,
		destroy: () => {
			loop.destroy();
			window.removeEventListener('resize', onResize);
			window.removeEventListener('click', onClick);
			composer.dispose();
			renderer.dispose();
		}
	};
}
