import { 
    Vector3, WebGLRenderer, ACESFilmicToneMapping, FogExp2, Scene, 
    PerspectiveCamera, AmbientLight, DirectionalLight, Mesh, PlaneGeometry, 
    Group, MathUtils, Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending,
    WebGLRenderTarget, HalfFloatType, MeshBasicMaterial, Color, Float32BufferAttribute, Box3,
    Points, PointsMaterial, BufferGeometry, RepeatWrapping, MeshStandardMaterial,
    PointLight, Vector2, Raycaster, Plane, TextureLoader, SRGBColorSpace // <--- Add TextureLoader & SRGBColorSpace
} from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'; // <--- Add EXRLoader
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { createNonEuclideanMaterial, applyNonEuclideanCurve } from '../materials/NonEuclideanMaterial';
import type { LoopController } from '../utils/canvas';

const _cameraTarget = new Vector3(0, 0, -10);

const mouseNDC = new Vector2(0, 0);       
const targetMouseNDC = new Vector2(0, 0); 

// --- DUAL-AXIS SCROLL TRACKING ---
let targetProgressZ = 0;
let renderedProgressZ = 0;

let targetProgressX = 0; // Horizontal offset (-1.0 to 1.0 or unbounded)
let renderedProgressX = 0;

const MAX_X_TRAVEL_RANGE = 70; // Maximum lateral movement distance in world units

let isFlashSequenceActive = false;
let isFlashSequenceComplete = false;
let flashStartTime = 0;
const FLASH_DURATION_MS = 600; 

export function setBiomeScrollProgress(progress: number): void {
    if (isFlashSequenceActive && !isFlashSequenceComplete) {
        targetProgressZ = MathUtils.clamp(progress, 0, 0.999);
        return;
    }
    targetProgressZ = MathUtils.clamp(progress, 0, 1);
}

export function setBiomeHorizontalProgress(progress: number): void {
    targetProgressX = MathUtils.clamp(progress, -1, 1);
}

function createProceduralBarkTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#1e120b';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 1800; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const h = 12 + Math.random() * 45;
        const alpha = 0.04 + Math.random() * 0.12;
        ctx.fillStyle = Math.random() > 0.5 ? `rgba(180, 120, 70, ${alpha})` : `rgba(10, 5, 2, ${alpha})`;
        ctx.fillRect(x, y, 1.5, h);
    }
    
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    return texture;
}

function createProceduralFoliageTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#0a1d12';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 3500; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const r = 1 + Math.random() * 3.5;
        const alpha = 0.06 + Math.random() * 0.22;
        ctx.fillStyle = Math.random() > 0.35 ? `rgba(34, 197, 94, ${alpha})` : `rgba(16, 85, 48, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    return texture;
}

function createParticleTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new CanvasTexture(canvas);
}

function createApparitionSprite(): Sprite {
    const size = 256; 
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;

    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)'); 
    glow.addColorStop(0.04, 'rgba(200, 230, 255, 0.9)');  
    glow.addColorStop(0.12, 'rgba(70, 130, 255, 0.4)'); 
    glow.addColorStop(0.4, 'rgba(0, 50, 255, 0)'); 
    
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(c, c);
    
    ctx.shadowColor = 'rgba(200, 230, 255, 1)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    
    for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -c * 0.95);
        ctx.lineTo(1.5, 0); 
        ctx.lineTo(0, c * 0.95);
        ctx.lineTo(-1.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.rotate((Math.PI / 4) + (i * Math.PI / 2));
        ctx.beginPath();
        ctx.moveTo(0, -c * 0.35); 
        ctx.lineTo(1, 0);
        ctx.lineTo(0, c * 0.35);
        ctx.lineTo(-1, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
    
    ctx.restore();

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false
    });

    const sprite = new Sprite(material);
    sprite.position.copy(_cameraTarget);
    sprite.scale.setScalar(0.001);
    
    return sprite;
}

const ENTRY_PHASE_END = 0.15;
const TRAVEL_PHASE_END = 0.85;

export function setupBiomeSphere(): LoopController | null {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-biome-canvas]');
    if (!canvas) return null;

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    const scene = new Scene();

    const envColor = new Color(0x04060f); 
    scene.background = envColor;
    scene.fog = new FogExp2(0x04060f, 0.012);

    const particleCount = 500;
    const particleGeo = new BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
        particlePositions[i]     = (Math.random() - 0.5) * 200;
        particlePositions[i + 1] = Math.random() * 40;
        particlePositions[i + 2] = -Math.random() * 240;
    }
    particleGeo.setAttribute('position', new Float32BufferAttribute(particlePositions, 3));
    
    const particleTexture = createParticleTexture();
    const particleMat = new PointsMaterial({
        color: 0x94a3b8,
        size: 0.25,
        map: particleTexture,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });
    const dustParticles = new Points(particleGeo, particleMat);
    scene.add(dustParticles);
    
    const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

    const cursorUniforms = {
        uCursorPos: { value: new Vector3(0, 0, 0) },
        uTime: { value: 0 },
        uSnapPulse: { value: 0 }
    };
    let isSnapActive = false;
    let snapStartTime = 0;
    const SNAP_DURATION_MS = 700;

    const cursorLight = new PointLight(0x38bdf8, 90, 150); 
    scene.add(cursorLight);

    // --- GPU VERTEX WIND SWAY FUNCTION ---
    function applyWindSway(mat: any) {
        const originalCompile = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader: any, renderer: any) => {
            if (originalCompile) originalCompile(shader, renderer);

            shader.uniforms.uTime = cursorUniforms.uTime;

            shader.vertexShader = `
                uniform float uTime;
                ${shader.vertexShader}
            `.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                
                vec4 windWorldPos = modelMatrix * vec4(position, 1.0);
                
                // Quadratic height bend: Roots/ground stay anchored at 0, branches flex
                float treeHeight = max(0.0, position.y);
                float bend = treeHeight * treeHeight * 0.012; 
                
                // Multi-frequency wind noise offset by world coordinates
                float spatialOffset = windWorldPos.x * 0.18 + windWorldPos.z * 0.12;
                float primaryWave = sin(uTime * 1.8 + spatialOffset);
                float secondaryWave = cos(uTime * 2.7 + spatialOffset * 1.5) * 0.5;
                float gust = sin(uTime * 0.7 + spatialOffset * 0.5) * 0.3 + 0.7;
                
                transformed.x += (primaryWave + secondaryWave) * bend * gust;
                transformed.z += (cos(uTime * 1.5 + spatialOffset) + sin(uTime * 2.2 + spatialOffset)) * bend * gust;
                `
            );
        };
    }

    function applyShaderScanEffect(mat: any) {
        const originalCompile = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader: any, renderer: any) => {
            if (originalCompile) originalCompile(shader, renderer);

            shader.uniforms.uCursorPos = cursorUniforms.uCursorPos;
            shader.uniforms.uTime = cursorUniforms.uTime;
            shader.uniforms.uSnapPulse = cursorUniforms.uSnapPulse;

            shader.vertexShader = `
                varying vec3 vWorldPos;
                ${shader.vertexShader}
            `.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                 vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
            );

            shader.fragmentShader = `
                uniform vec3 uCursorPos;
                uniform float uTime;
                uniform float uSnapPulse;
                varying vec3 vWorldPos;
                ${shader.fragmentShader}
            `.replace(
                '#include <output_fragment>',
                `#include <output_fragment>
                 
                 float dist = distance(vWorldPos, uCursorPos);
                 float scanRadius = 7.5;
                 
                 float intensity = 1.0 - smoothstep(0.0, scanRadius, dist);
                 
                 float pulse = fract(uTime * 1.2);
                 float ringRadius = scanRadius * pulse;
                 float ring = smoothstep(ringRadius - 0.3, ringRadius, dist) * (1.0 - smoothstep(ringRadius, ringRadius + 0.3, dist));
                 
                 vec3 scanColor = vec3(0.22, 0.74, 0.97); 
                 
                 float gridWave = abs(sin(vWorldPos.x * 0.8 - uTime * 20.0));
                 float snapEnergy = smoothstep(0.3, 0.7, gridWave) * uSnapPulse;
                 vec3 hyperCyan = vec3(0.1, 0.95, 1.0);
                 
                 gl_FragColor.rgb += scanColor * (intensity * 1.2 + ring * 3.5) + (hyperCyan * snapEnergy * 3.0);
                 
                 float scanAlpha = intensity * 0.85 + ring * 1.0 + snapEnergy * 0.8;
                 gl_FragColor.a = max(gl_FragColor.a, scanAlpha);
                `
            );
        };
    }

    const raycaster = new Raycaster();
    const cursorPlane = new Plane(new Vector3(0, 0, 1), 10); 
    const cursorIntersection = new Vector3();
    const targetLightPos = new Vector3(); 

    const onPointerMove = (e: MouseEvent) => {
        targetMouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
        targetMouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    const onWheel = (e: WheelEvent) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
            e.preventDefault(); 
            const delta = e.shiftKey ? e.deltaY : e.deltaX;
            targetProgressX = MathUtils.clamp(targetProgressX + delta * 0.0015, -1, 1);
        }
    };

    let touchStartX = 0;
    const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
    };

    const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 1) {
            const touchX = e.touches[0].clientX;
            const diffX = touchStartX - touchX;
            touchStartX = touchX;
            targetProgressX = MathUtils.clamp(targetProgressX + diffX * 0.003, -1, 1);
        }
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'z' || e.key === 'Z') {
            targetProgressX = 0;
            isSnapActive = true;
            snapStartTime = performance.now();
            return;
        }

        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            targetProgressX = MathUtils.clamp(targetProgressX - 0.08, -1, 1);
        } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            targetProgressX = MathUtils.clamp(targetProgressX + 0.08, -1, 1);
        }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('wheel', onWheel, { passive: false }); 
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    const renderTarget = new WebGLRenderTarget(
        window.innerWidth * Math.min(window.devicePixelRatio, 1.5),
        window.innerHeight * Math.min(window.devicePixelRatio, 1.5),
        {
            type: HalfFloatType,
            alpha: true,
            samples: 8
        }
    );

    const composer = new EffectComposer(renderer, renderTarget);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const FisheyeShader = {
        uniforms: {
            "tDiffuse": { value: null },
            "strength": { value: 0.25 },
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
            uniform float strength;
            varying vec2 vUv;

            void main() {
                vec2 coord = vUv - 0.5;
                float distance = length(coord);
                
                float bind = 1.0 + strength * distance * distance;
                coord *= bind;
                coord += 0.5;

                if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) {
                    gl_FragColor = vec4(0.0);
                } else {
                    gl_FragColor = texture2D(tDiffuse, coord);
                }
            }
        `
    };

    const fisheyePass = new ShaderPass(FisheyeShader);
    composer.addPass(fisheyePass);

    const trackGroup = new Group();
    scene.add(trackGroup);

    const gltfLoader = new GLTFLoader();

    const barkTexture = createProceduralBarkTexture();
    const foliageTexture = createProceduralFoliageTexture();

    const BIOME_SPACING = 60; 
    const biomes = [
        { name: 'New York',    color: 0x222222, texture: '/textures/ground/new-york'},
        { name: 'Forest',      color: 0x1B3320, texture: '/textures/ground/forest'},
        { name: 'Western',     color: 0x5C4033, texture: '/textures/ground/western'},
        { name: 'Night Canyon',color: 0x111116, texture: '/textures/ground/night-canyon'},
    ];

    const trackMaterials: Array<{ transparent: boolean; opacity: number; userData?: any }> = [];

    biomes.forEach((biome, index) => {
        const geo = new PlaneGeometry(120, 60, 128, 64);
        geo.rotateX(-Math.PI / 2);
        
        const mat = createNonEuclideanMaterial({ 
            color: biome.color, roughness: 0.8, metalness: 0.2, wireframe: true 
        });
        mat.transparent = true;
        trackMaterials.push(mat);
        
        const mesh = new Mesh(geo, mat);
        mesh.position.z = -(index * BIOME_SPACING);
        trackGroup.add(mesh);

        if (biome.name === 'Forest') {
            gltfLoader.load('/forest-low-poly.glb', (gltf) => {
                const baseModel = gltf.scene;

                const modelBBox = new Box3().setFromObject(baseModel);
                const localYMin = modelBBox.min.y;
                const localYMax = modelBBox.max.y;
                const localHeight = Math.max(localYMax - localYMin, 0.001);

                baseModel.traverse((child) => {
                    if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                        const childMesh = child as Mesh;
                        
                        if (childMesh.material) {
                            const rawMaterials = Array.isArray(childMesh.material) 
                                ? childMesh.material 
                                : [childMesh.material];
                            
                            const coreMaterials: any[] = [];
                            const wireframeMaterials: any[] = [];

                            rawMaterials.forEach((mat) => {
                                const coreMat = new MeshStandardMaterial({
                                    map: foliageTexture,
                                    roughness: 0.8,
                                    metalness: 0.1,
                                    transparent: true,
                                    opacity: 0,
                                    depthWrite: true
                                });
                                coreMat.userData = { baseOpacity: 0.55 };
                                
                                applyNonEuclideanCurve(coreMat);
                                applyWindSway(coreMat); // Attached GPU wind sway
                                trackMaterials.push(coreMat);
                                coreMaterials.push(coreMat);

                                const wireMat = new MeshBasicMaterial({
                                    wireframe: true,
                                    transparent: true,
                                    depthWrite: true,
                                    opacity: 0.25,
                                    vertexColors: true
                                });
                                wireMat.userData = { baseOpacity: 0.25 };

                                applyNonEuclideanCurve(wireMat);
                                applyWindSway(wireMat); // Attached GPU wind sway
                                applyShaderScanEffect(wireMat);
                                
                                trackMaterials.push(wireMat);
                                wireframeMaterials.push(wireMat);
                            });

                            childMesh.material = coreMaterials.length === 1 ? coreMaterials[0] : coreMaterials;

                            const wireframeMesh = new Mesh(
                                childMesh.geometry,
                                wireframeMaterials.length === 1 ? wireframeMaterials[0] : wireframeMaterials
                            );
                            
                            wireframeMesh.userData.isTronWireframe = true;
                            childMesh.add(wireframeMesh);
                        }
                    }
                });

                const TILE_SPACING = 8; 
                const tempColor = new Color();

                for (let x = -55; x <= 55; x += TILE_SPACING) {
                    for (let z = -25; z <= 25; z += TILE_SPACING) {
                        const tile = baseModel.clone(true); 

                        const trunkHue  = 0.06 + (Math.random() - 0.5) * 0.05;  
                        const canopyHue = 0.44 + (Math.random() - 0.5) * 0.12;  
                        
                        const instanceTrunk  = new Color().setHSL(trunkHue, 0.75, 0.42);
                        const instanceCanopy = new Color().setHSL(canopyHue, 0.70, 0.40);

                        tile.traverse((child) => {
                            if ((child as Mesh).isMesh) {
                                const childMesh = child as Mesh;
                                childMesh.geometry = childMesh.geometry.clone();

                                if (childMesh.geometry.attributes.position) {
                                    const posAttr = childMesh.geometry.attributes.position;
                                    const colors = new Float32Array(posAttr.count * 3);

                                    for (let i = 0; i < posAttr.count; i++) {
                                        const y = posAttr.getY(i);
                                        const relativeY = MathUtils.clamp((y - localYMin) / localHeight, 0, 1);
                                        
                                        const mixFactor = MathUtils.smoothstep(relativeY, 0.15, 0.55);
                                        tempColor.copy(instanceTrunk).lerp(instanceCanopy, mixFactor);

                                        colors[i * 3]     = tempColor.r;
                                        colors[i * 3 + 1] = tempColor.g;
                                        colors[i * 3 + 2] = tempColor.b;
                                    }

                                    childMesh.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
                                }
                            }
                        });

                        tile.position.set(x, 0, -(index * BIOME_SPACING) + z);
                        tile.rotation.y = Math.random() * Math.PI * 2; 
                        
                        const randScale = 5.2 + Math.random() * 2.0; 
                        tile.scale.set(randScale, randScale, randScale);

                        trackGroup.add(tile);
                    }
                }
            });
        }
    });

    const TRACK_TRAVEL_DISTANCE = BIOME_SPACING * (biomes.length - 1);

    scene.add(new AmbientLight(0xffffff, 0.5));
    
    const dirLight = new DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const apparitionSprite = createApparitionSprite();
    scene.add(apparitionSprite);

    const resize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    
    window.addEventListener('resize', resize);
    resize();

    let animationFrameId: number;
    let isDestroyed = false;
    let isRunning = false;

    const tick = () => {
        if (!isRunning || isDestroyed) return;
        animationFrameId = requestAnimationFrame(tick);

        const time = performance.now();
        cursorUniforms.uTime.value = time / 1000;

        let snapFactor = 0;
        if (isSnapActive) {
            const elapsed = time - snapStartTime;
            const snapProgress = MathUtils.clamp(elapsed / SNAP_DURATION_MS, 0, 1);
            
            snapFactor = Math.pow(1 - snapProgress, 3);
            cursorUniforms.uSnapPulse.value = snapFactor;

            fisheyePass.uniforms.strength.value = 0.25 + (snapFactor * 0.35);
            cursorLight.intensity = 90 + (snapFactor * 250);

            if (snapProgress >= 1) {
                isSnapActive = false;
                cursorUniforms.uSnapPulse.value = 0;
                fisheyePass.uniforms.strength.value = 0.25;
                cursorLight.intensity = 90;
            }
        }

        mouseNDC.x = MathUtils.lerp(mouseNDC.x, targetMouseNDC.x, 0.05);
        mouseNDC.y = MathUtils.lerp(mouseNDC.y, targetMouseNDC.y, 0.05);

        dustParticles.rotation.y += 0.00015;

        renderedProgressZ = MathUtils.lerp(renderedProgressZ, targetProgressZ, 0.035);
        
        const xLerpSpeed = isSnapActive ? 0.095 : 0.045;
        renderedProgressX = MathUtils.lerp(renderedProgressX, targetProgressX, xLerpSpeed);

        const entryProgress = 1.0 - MathUtils.clamp(renderedProgressZ / ENTRY_PHASE_END, 0, 1);
        const travelProgress = MathUtils.clamp((renderedProgressZ - ENTRY_PHASE_END) / (TRAVEL_PHASE_END - ENTRY_PHASE_END), 0, 1);
        const exitProgress = MathUtils.clamp((renderedProgressZ - TRAVEL_PHASE_END) / (1 - TRAVEL_PHASE_END), 0, 1);
        
        const travelZ = travelProgress * TRACK_TRAVEL_DISTANCE;
        const travelX = renderedProgressX * MAX_X_TRAVEL_RANGE;

        const entryEase = Math.pow(entryProgress, 3);
        const exitEase = Math.pow(exitProgress, 4);

        let targetCamY = 5;
        let targetCamZ = 10;
        let targetFOV = 45;

        if (entryProgress > 0) {
            targetCamY = MathUtils.lerp(5, 2.0, entryEase);
            targetCamZ = MathUtils.lerp(10, 2.0, entryEase); 
            targetFOV = MathUtils.lerp(45, 65, entryEase); 
        } else if (exitProgress > 0) {
            targetCamY = MathUtils.lerp(5, 0, exitEase);
            targetCamZ = 10;
            targetFOV = MathUtils.lerp(45, 120, exitEase);
        }

        const parallaxX = mouseNDC.x * 2.0;
        const parallaxY = mouseNDC.y * 1.2;

        camera.position.set(travelX + parallaxX, targetCamY + parallaxY, targetCamZ);
        camera.fov = targetFOV;
        
        const dynamicTarget = _cameraTarget.clone().add(new Vector3(travelX + parallaxX * 0.5, parallaxY * 0.5, 0));
        camera.lookAt(dynamicTarget);
        camera.updateProjectionMatrix();

        raycaster.setFromCamera(mouseNDC, camera);
        const intersects = raycaster.intersectObject(trackGroup, true);
        
        if (intersects.length > 0) {
            targetLightPos.copy(intersects[0].point);
        } else {
            cursorPlane.constant = -travelX;
            if (raycaster.ray.intersectPlane(cursorPlane, cursorIntersection)) {
                targetLightPos.copy(cursorIntersection);
            }
        }

        cursorLight.position.lerp(targetLightPos, 0.2);
        cursorUniforms.uCursorPos.value.copy(cursorLight.position);

        trackGroup.position.z = MathUtils.lerp(travelZ, _cameraTarget.z, exitEase);
        trackGroup.scale.setScalar(MathUtils.lerp(1, 0.0001, exitEase));

        const dissolveOpacity = 1 - MathUtils.clamp((exitProgress - 0.7) / 0.3, 0, 1);
        for (const mat of trackMaterials) {
            const baseCap = mat.userData?.baseOpacity ?? 1.0;
            mat.opacity = dissolveOpacity * (1 - entryEase) * baseCap;
        }

        const apparitionMaterial = apparitionSprite.material as SpriteMaterial;

        if (exitProgress < 0.95 && (isFlashSequenceComplete || isFlashSequenceActive)) {
            isFlashSequenceActive = false;
            isFlashSequenceComplete = false;
            apparitionMaterial.opacity = 0;
            apparitionSprite.scale.setScalar(0.001);
        }

        if (exitProgress > 0.99 && !isFlashSequenceActive && !isFlashSequenceComplete) {
            isFlashSequenceActive = true;
            flashStartTime = performance.now();
            window.dispatchEvent(new CustomEvent('biome-flash-start'));
        }

        if (isFlashSequenceActive) {
            const elapsed = time - flashStartTime;
            let animProgress = MathUtils.clamp(elapsed / FLASH_DURATION_MS, 0, 1);

            if (animProgress < 1) {
                const pingCurve = Math.sin(animProgress * Math.PI);
                
                apparitionMaterial.opacity = pingCurve * 4.0; 
                apparitionSprite.scale.setScalar(MathUtils.lerp(0.001, 3.5, pingCurve));
                apparitionMaterial.rotation = animProgress * (Math.PI / 2);
            } else {
                isFlashSequenceActive = false;
                isFlashSequenceComplete = true;
                apparitionMaterial.opacity = 0;
                apparitionSprite.scale.setScalar(0.001);
                
                window.dispatchEvent(new CustomEvent('biome-flash-complete'));
                targetProgressZ = 1; 
            }
        } else if (!isFlashSequenceComplete) {
            apparitionMaterial.opacity = 0;
        }
        
        composer.render();
    };

    const start = () => {
        if (isRunning) return;
        isRunning = true;
        tick();
    };

    const stop = () => {
        isRunning = false;
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };

    const destroy = () => {
        isDestroyed = true;
        stop(); 

        targetProgressZ = 0;
        renderedProgressZ = 0;
        targetProgressX = 0;
        renderedProgressX = 0;
        isFlashSequenceActive = false;
        isFlashSequenceComplete = false;
        flashStartTime = 0;

        window.removeEventListener('resize', resize);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('keydown', onKeyDown);

        const apparitionMaterial = apparitionSprite.material as SpriteMaterial;
        apparitionMaterial.map?.dispose();
        apparitionMaterial.dispose();

        barkTexture.dispose();
        foliageTexture.dispose();
        particleTexture.dispose();
        particleGeo.dispose();
        particleMat.dispose();

        trackGroup.traverse((child) => {
            if ((child as Mesh).isMesh) {
                const mesh = child as Mesh;
                mesh.geometry.dispose();
                Array.isArray(mesh.material) ? mesh.material.forEach(m => m.dispose()) : mesh.material.dispose();
            }
        });
        
        composer.dispose();
        renderer.dispose();
    };

    start();
    return { start, stop, destroy, resize };
}