import { ShaderMaterial, CylinderGeometry, SphereGeometry, ConeGeometry, DodecahedronGeometry, IcosahedronGeometry, InstancedMesh, Object3D, DoubleSide, TorusGeometry, 
    Vector3, WebGLRenderer, ACESFilmicToneMapping, FogExp2, Scene, 
    PerspectiveCamera, AmbientLight, DirectionalLight, Mesh, PlaneGeometry, 
    Group, MathUtils, Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending,
    WebGLRenderTarget, HalfFloatType, MeshBasicMaterial, Color, Float32BufferAttribute, Box3,
    Points, PointsMaterial, BufferGeometry, RepeatWrapping, MeshStandardMaterial,
    PointLight, Vector2, Raycaster, Plane, TextureLoader, SRGBColorSpace, BoxGeometry, Material, PCFSoftShadowMap,
    Matrix4, Quaternion, Euler, LoadingManager
} from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'; // <--- Add EXRLoader
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';

import { createNonEuclideanMaterial, applyNonEuclideanCurve } from '../materials/NonEuclideanMaterial';
import { createHorizonTextures, createHorizonMaterial } from '../materials/HorizonMorphMaterial';
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


// --- PROCEDURAL PBR GENERATOR ---
function generateMapsFromDiffuse(diffuseCanvas: HTMLCanvasElement): { normalMap: CanvasTexture, bumpMap: CanvasTexture } {
    const width = diffuseCanvas.width;
    const height = diffuseCanvas.height;
    
    // Bump Map Canvas
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = width;
    bumpCanvas.height = height;
    const bumpCtx = bumpCanvas.getContext('2d')!;
    
    // Normal Map Canvas
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = width;
    normalCanvas.height = height;
    const normalCtx = normalCanvas.getContext('2d')!;
    
    const dCtx = diffuseCanvas.getContext('2d')!;
    const imgData = dCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const bumpData = bumpCtx.createImageData(width, height);
    const bData = bumpData.data;
    
    const normalImgData = normalCtx.createImageData(width, height);
    const nData = normalImgData.data;
    
    // Convert to grayscale for bump map
    const heights = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
        // Luminance
        const lum = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
        bData[i] = lum;
        bData[i+1] = lum;
        bData[i+2] = lum;
        bData[i+3] = 255;
        heights[i/4] = lum / 255.0;
    }
    bumpCtx.putImageData(bumpData, 0, 0);
    
    // Compute Normal map using Sobel filter
    const strength = 4.0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const left = heights[y * width + Math.max(x - 1, 0)];
            const right = heights[y * width + Math.min(x + 1, width - 1)];
            const up = heights[Math.max(y - 1, 0) * width + x];
            const down = heights[Math.min(y + 1, height - 1) * width + x];
            
            let dx = (right - left) * strength;
            let dy = (down - up) * strength;
            let dz = 1.0;
            
            // Normalize
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            dx /= len;
            dy /= len;
            dz /= len;
            
            // Map to 0-255 RGB
            const i = (y * width + x) * 4;
            nData[i] = (dx * 0.5 + 0.5) * 255;
            nData[i+1] = (dy * 0.5 + 0.5) * 255;
            nData[i+2] = (dz * 0.5 + 0.5) * 255;
            nData[i+3] = 255;
        }
    }
    normalCtx.putImageData(normalImgData, 0, 0);
    
    const nTex = new CanvasTexture(normalCanvas);
    nTex.wrapS = RepeatWrapping; nTex.wrapT = RepeatWrapping;
    
    const bTex = new CanvasTexture(bumpCanvas);
    bTex.wrapS = RepeatWrapping; bTex.wrapT = RepeatWrapping;
    
    return { normalMap: nTex, bumpMap: bTex };
}



// --- PROCEDURAL GEOMETRY DISPLACEMENT ---
function displaceGeometry(geometry: BufferGeometry, intensity: number, scale: number = 1.0) {
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        
        // Simple 3D pseudo-noise
        const nx = Math.sin(x * scale) * Math.cos(z * scale) * Math.sin(y * scale);
        const ny = Math.cos(x * scale * 1.5) * Math.sin(z * scale * 1.5);
        const nz = Math.sin(x * scale * 2) * Math.sin(y * scale * 2);
        
        positions.setXYZ(i, x + nx * intensity, y + ny * intensity, z + nz * intensity);
    }
    geometry.computeVertexNormals();
}

// --- PROCEDURAL GROUND TEXTURES ---
function createForestGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#1a2916'; // Base dirt green
    ctx.fillRect(0, 0, 512, 512);
    
    for (let i = 0; i < 4000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = 1 + Math.random() * 5;
        const color = Math.random() > 0.5 ? '#243b22' : '#304a29'; // Lighter moss/leaves
        ctx.fillStyle = color;
        ctx.fillRect(x, y, s, s);
    }
    
    // Add dirt patches
    for (let i = 0; i < 1500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = 2 + Math.random() * 4;
        ctx.fillStyle = 'rgba(40, 25, 15, 0.6)'; 
        ctx.fillRect(x, y, s, s);
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

function createCanyonGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#6d4021'; // Terracotta
    ctx.fillRect(0, 0, 512, 512);
    
    // Cracked earth simulation
    ctx.strokeStyle = '#4a2812';
    ctx.lineWidth = 2;
    for (let i = 0; i < 300; i++) {
        ctx.beginPath();
        const startX = Math.random() * 512;
        const startY = Math.random() * 512;
        ctx.moveTo(startX, startY);
        let cx = startX;
        let cy = startY;
        for (let j = 0; j < 5; j++) {
            cx += (Math.random() - 0.5) * 40;
            cy += (Math.random() - 0.5) * 40;
            ctx.lineTo(cx, cy);
        }
        ctx.stroke();
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

function createCityGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#222222'; // Asphalt
    ctx.fillRect(0, 0, 512, 512);
    
    // Asphalt noise
    for (let i = 0; i < 15000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const l = Math.floor(20 + Math.random() * 40);
        ctx.fillStyle = `rgb(${l},${l},${l})`;
        ctx.fillRect(x, y, 1.5, 1.5);
    }
    
    // Add some road lines
    ctx.fillStyle = '#ccaa33';
    ctx.fillRect(246, 0, 20, 512);
    ctx.fillStyle = '#222222';
    for(let i=0; i<512; i+=40) {
        ctx.fillRect(246, i+20, 20, 20); // Dashed
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

function createSavannaGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#8f7a4e'; // Dusty yellow soil
    ctx.fillRect(0, 0, 512, 512);
    
    // Sand noise
    for (let i = 0; i < 10000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = Math.random() > 0.5 ? 2 : 1;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(200, 180, 100, 0.4)' : 'rgba(100, 80, 40, 0.4)';
        ctx.fillRect(x, y, s, s);
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
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

function createProceduralFacadeTexture(): { diffuseMap: CanvasTexture, emissiveMap: CanvasTexture } {
    const dCanvas = document.createElement('canvas');
    dCanvas.width = 512; dCanvas.height = 512;
    const dCtx = dCanvas.getContext('2d')!;
    
    const eCanvas = document.createElement('canvas');
    eCanvas.width = 512; eCanvas.height = 512;
    const eCtx = eCanvas.getContext('2d')!;
    
    // Base siding (wood/vinyl)
    dCtx.fillStyle = '#9e8b76';
    dCtx.fillRect(0, 0, 512, 512);
    dCtx.fillStyle = '#8a7966';
    for(let i=0; i<512; i+=16) {
        dCtx.fillRect(0, i, 512, 2);
    }
    
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, 512, 512);
    
    // Structured windows
    const drawWindow = (x: number, y: number, w: number, h: number) => {
        const isLit = Math.random() > 0.4;
        dCtx.fillStyle = isLit ? '#ffcca4' : '#222222';
        dCtx.fillRect(x, y, w, h);
        
        if (isLit) {
            eCtx.fillStyle = '#ffffff';
            eCtx.fillRect(x, y, w, h);
        }
        
        dCtx.fillStyle = '#ffffff';
        dCtx.fillRect(x + w/2 - 2, y, 4, h); // vertical mullion
        dCtx.fillRect(x, y + h/2 - 2, w, 4); // horizontal mullion
        
        if (isLit) {
            eCtx.fillStyle = '#000000'; // mullions don't glow
            eCtx.fillRect(x + w/2 - 2, y, 4, h); 
            eCtx.fillRect(x, y + h/2 - 2, w, 4); 
        }
        
        dCtx.strokeStyle = '#333333';
        dCtx.lineWidth = 4;
        dCtx.strokeRect(x, y, w, h); // window frame
    };

    drawWindow(64, 128, 128, 128); // left window
    drawWindow(320, 128, 128, 128); // right window
    
    // Door
    dCtx.fillStyle = '#553311';
    dCtx.fillRect(200, 320, 112, 192);
    
    const dTex = new CanvasTexture(dCanvas);
    dTex.wrapS = RepeatWrapping; dTex.wrapT = RepeatWrapping; dTex.repeat.set(1, 1);
    
    const eTex = new CanvasTexture(eCanvas);
    eTex.wrapS = RepeatWrapping; eTex.wrapT = RepeatWrapping; eTex.repeat.set(1, 1);
    
    return { diffuseMap: dTex, emissiveMap: eTex };
}


function createProceduralLeafTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    // Draw an organic leaf shape
    ctx.fillStyle = '#4da84a';
    ctx.beginPath();
    ctx.moveTo(32, 4);
    ctx.quadraticCurveTo(60, 20, 32, 60);
    ctx.quadraticCurveTo(4, 20, 32, 4);
    ctx.fill();
    
    // Veins
    ctx.strokeStyle = '#2d682a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(32, 60);
    ctx.lineTo(32, 10);
    ctx.moveTo(32, 40); ctx.lineTo(45, 25);
    ctx.moveTo(32, 40); ctx.lineTo(19, 25);
    ctx.moveTo(32, 50); ctx.lineTo(42, 40);
    ctx.moveTo(32, 50); ctx.lineTo(22, 40);
    ctx.stroke();
    
    const tex = new CanvasTexture(canvas);
    return tex;
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
    const textureLoader = new TextureLoader();
    const exrLoader = new EXRLoader();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    // We use PCFSoftShadowMap but it requires importing it. 
    // Let's just use the default (PCFShadowMap) to avoid import issues, or add the import.
    // Three exports PCFSoftShadowMap, I will add it to the import.

    
    const scene = new Scene();

    type WeatherState = 'CLEAR' | 'OVERCAST' | 'STORM';
    const weatherTints: Record<WeatherState, { color: Color, fogMult: number }> = {
        'CLEAR': { color: new Color(0xffffff), fogMult: 1.0 },
        'OVERCAST': { color: new Color(0x9ab8d4), fogMult: 1.5 },
        'STORM': { color: new Color(0x5a6b7c), fogMult: 2.0 }
    };
    let currentWeather: WeatherState = 'CLEAR';
    let targetWeather: WeatherState = 'CLEAR';
    let currentWeatherTint = new Color(0xffffff);
    let targetWeatherTint = new Color(0xffffff);
    let currentFogMult = 1.0;
    let targetFogMult = 1.0;
    let lightningFlash = 0.0;
    let targetWetness = 0.0;
    let currentWetness = 0.0;
    let lastWeatherChange = 0; // will be updated on first tick

    let lastTime = 0;


    const envColor = new Color(0x04060f); 
    scene.background = envColor;
    scene.fog = new FogExp2(0x04060f, 0.012);

    
    

    const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    scene.add(camera); // Required for camera children to render

    // --- HORIZON BACKDROP ---
    const horizonTextures = createHorizonTextures();
    const horizonMaterial = createHorizonMaterial();
    horizonMaterial.uniforms.tDiffuseCurrent.value = horizonTextures[0];
    horizonMaterial.uniforms.tDiffuseNext.value = horizonTextures[1];
    
    // A semi-sphere (dome) to act as the horizon backdrop
    const horizonGeo = new SphereGeometry(300, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const horizonMesh = new Mesh(horizonGeo, horizonMaterial);
    horizonMesh.position.set(0, -20, 0); // Sink it slightly so the equator blends into the ground fog
    horizonMesh.frustumCulled = false;
    camera.add(horizonMesh);

    // --- ZERO-PASS LENS DIRT ---
    const createLensDirt = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 512, 512);
        
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for(let i=0; i<300; i++) { // dust
            ctx.beginPath();
            ctx.arc(Math.random()*512, Math.random()*512, Math.random()*3, 0, Math.PI*2);
            ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        for(let i=0; i<50; i++) { // scratches
            ctx.beginPath();
            const sx = Math.random()*512; const sy = Math.random()*512;
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + (Math.random()-0.5)*40, sy + (Math.random()-0.5)*40);
            ctx.stroke();
        }
        const tex = new CanvasTexture(canvas);
        return tex;
    };

    const lensUniforms = {
        uDirtMap: { value: createLensDirt() },
        uSunDir: { value: new Vector3(0,1,0) },
        uCamFwd: { value: new Vector3(0,0,-1) }
    };

    const lensMat = new ShaderMaterial({
        uniforms: lensUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0); // Fixed to screen space
            }
        `,
        fragmentShader: `
            uniform sampler2D uDirtMap;
            uniform vec3 uSunDir;
            uniform vec3 uCamFwd;
            varying vec2 vUv;
            void main() {
                float alignment = max(0.0, dot(normalize(uSunDir), normalize(uCamFwd)));
                float flare = pow(alignment, 8.0); // Only visible when looking straight at sun
                vec4 dirt = texture2D(uDirtMap, vUv);
                gl_FragColor = vec4(dirt.rgb * flare * 2.5, dirt.a * flare);
            }
        `
    });

    const lensPlane = new Mesh(new PlaneGeometry(2, 2), lensMat);
    lensPlane.frustumCulled = false;
    lensPlane.renderOrder = 999;
    camera.add(lensPlane);


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
    
    const dirLight = new DirectionalLight(0xffffff, 0.0); // Intensity managed in tick
    dirLight.position.set(100, 200, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024; // Halved memory
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 200; // Drastically tightened
    dirLight.shadow.camera.left = -80;
    dirLight.shadow.camera.right = 80;
    dirLight.shadow.camera.top = 80;
    dirLight.shadow.camera.bottom = -80;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    const biomeEnvs = [
        { fog: 0x2f5035, density: 0.012, light: 0xaaddaa, intensity: 2.5 }, // Forest
        { fog: 0x6d4021, density: 0.015, light: 0xffcc44, intensity: 3.5 }, // Canyon
        { fog: 0x1f253a, density: 0.016, light: 0x88aacc, intensity: 3.5 }, // Suburb
        { fog: 0x7a6141, density: 0.012, light: 0xffeedd, intensity: 3.0 }  // Savanna
    ];

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
        } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
            window.scrollBy({ top: 75, behavior: 'smooth' });
        } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
            window.scrollBy({ top: -75, behavior: 'smooth' });
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
    
    // Depth of Field
    const bokehPass = new BokehPass(scene, camera, {
        focus: 50.0,
        aperture: 0.0005, // subtle aperture for wide depth of field
        maxblur: 0.008 // subtle blur amount
    });
    composer.addPass(bokehPass);

    // --- CRT TV Shutdown Effect (for final Savanna exit) ---
    const CRTShutdownShader = {
        uniforms: {
            tDiffuse: { value: null },
            uShutdown: { value: 0.0 } // 0 = normal, 1 = fully collapsed to singularity
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
            uniform float uShutdown;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                vec2 center = vec2(0.5, 0.5);

                if (uShutdown <= 0.0) {
                    gl_FragColor = texture2D(tDiffuse, uv);
                    return;
                }

                // Phase 1 (0.0 -> 0.6): Vertical squeeze into a horizontal line
                // Phase 2 (0.6 -> 0.9): Horizontal squeeze into a dot
                // Phase 3 (0.9 -> 1.0): Dot fades and shrinks to nothing

                float vSqueeze = smoothstep(0.0, 0.6, uShutdown); // 0->1 for vertical collapse
                float hSqueeze = smoothstep(0.6, 0.9, uShutdown); // 0->1 for horizontal collapse
                float dotFade  = smoothstep(0.9, 1.0, uShutdown); // 0->1 for final fade

                // Squeeze vertically: map UV.y from center outward
                float halfH = mix(0.5, 0.003, vSqueeze); // height shrinks to a thin line
                float halfW = mix(0.5, 0.006, hSqueeze); // width shrinks to a dot

                // Check if the pixel falls within the squeezed rectangle
                if (abs(uv.y - center.y) > halfH || abs(uv.x - center.x) > halfW) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }

                // Remap UVs to sample from the full image into the squeezed area
                vec2 remappedUv;
                remappedUv.x = (uv.x - center.x) / (halfW * 2.0) + 0.5;
                remappedUv.y = (uv.y - center.y) / (halfH * 2.0) + 0.5;

                vec4 col = texture2D(tDiffuse, remappedUv);

                // Add slight glow/bloom to the collapsed line
                float edgeDist = abs(uv.y - center.y) / max(halfH, 0.001);
                float lineGlow = (1.0 - edgeDist) * vSqueeze * (1.0 - hSqueeze) * 0.5;
                col.rgb += vec3(0.6, 0.8, 1.0) * lineGlow;

                // Add dot glow during final phase
                float dotDist = length(uv - center) / max(halfW, 0.001);
                float dotGlow = (1.0 - dotDist) * hSqueeze * (1.0 - dotFade) * 1.5;
                col.rgb += vec3(0.7, 0.9, 1.0) * dotGlow;

                // Final fade to black
                col.rgb *= (1.0 - dotFade);

                gl_FragColor = col;
            }
        `
    };
    const crtShutdownPass = new ShaderPass(CRTShutdownShader);
    composer.addPass(crtShutdownPass);

    // --- Fade-from-Black overlay (LAST pass — covers everything) ---
    const FadeBlackShader = {
        uniforms: {
            tDiffuse: { value: null },
            uBlackness: { value: 1.0 } // 1 = pure black, 0 = fully visible
        },
        vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uBlackness;
            varying vec2 vUv;
            void main() {
                vec4 col = texture2D(tDiffuse, vUv);
                gl_FragColor = vec4(col.rgb * (1.0 - uBlackness), 1.0);
            }
        `
    };
    const fadeBlackPass = new ShaderPass(FadeBlackShader);
    composer.addPass(fadeBlackPass);

    const trackGroup = new Group();
    scene.add(trackGroup);

    const gltfLoader = new GLTFLoader();

    const barkTexture = createProceduralBarkTexture();
    const facadeMaps = createProceduralFacadeTexture();
    const foliageTexture = createProceduralFoliageTexture();

    const BIOME_SPACING = 1500;
    const biomes = [
        { name: 'Forest',      color: 0x1B3320, texture: '/textures/forest'},
        { name: 'Canyon',      color: 0x5C4033, texture: '/textures/western'},
        { name: 'City',        color: 0x222222, texture: '/textures/new-york'},
        { name: 'Savanna',     color: 0x111116, texture: '/textures/night-canyon'},
    ];

    const trackMaterials: Material[] = [];

    
    // Helper to apply wireframe wrapper for City buildings
        const wrapWireframe = (childMesh: any, coreMat: any, wireProps: any) => {
        childMesh.material = coreMat;
        
        // Dynamic color matching if wireProps.color is not explicitly set or we want it to match
        let wireColor = new Color(wireProps.color);
        if (wireProps.matchColor && coreMat.color) {
            wireColor.copy(coreMat.color);
            // Boost brightness and saturation for the Tron glow
            const hsl = { h: 0, s: 0, l: 0 };
            wireColor.getHSL(hsl);
            wireColor.setHSL(hsl.h, Math.min(1.0, hsl.s * 1.5), Math.min(0.8, hsl.l * 2.0 + 0.2));
        }

        const wireMat = new MeshBasicMaterial({ wireframe: true, transparent: true, depthWrite: true, color: wireColor, opacity: wireProps.opacity || 0.15 });
        applyNonEuclideanCurve(wireMat);
        if (wireProps.sway) applyWindSway(wireMat);
        trackMaterials.push(wireMat);
        const wireMesh = new Mesh(childMesh.geometry, wireMat);
        wireMesh.userData.isTronWireframe = true;
        childMesh.add(wireMesh);
    };

    const particleTexture = createParticleTexture();
    // --- 3D INSTANCED DEBRIS SYSTEM ---
    const debrisAnimations: Array<() => void> = [];
    const buildDebris = (geo: any, count: number, matProps: any, zOffset: number, behavior: string) => {
        const mat = new MeshBasicMaterial({ ...matProps, transparent: true, depthWrite: false });
        mat.userData = { baseOpacity: matProps.opacity || 0.8 };
        trackMaterials.push(mat);
        applyNonEuclideanCurve(mat);
        const imesh = new InstancedMesh(geo, mat, count);
        
        const dummy = new Object3D();
        const positions = new Float32Array(count * 3);
        const rotations = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        
        for (let i = 0; i < count; i++) {
            positions[i*3] = (Math.random()-0.5)*150;
            positions[i*3+1] = Math.random()*40;
            positions[i*3+2] = (Math.random()-0.5)*200 + zOffset;
            
            rotations[i*3] = Math.random()*Math.PI*2;
            rotations[i*3+1] = Math.random()*Math.PI*2;
            rotations[i*3+2] = Math.random()*Math.PI*2;
            
            velocities[i*3] = (Math.random()-0.5)*0.2;
            velocities[i*3+1] = (Math.random()-0.5)*0.2;
            velocities[i*3+2] = (Math.random()-0.5)*0.2;
            
            dummy.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
            dummy.rotation.set(rotations[i*3], rotations[i*3+1], rotations[i*3+2]);
            dummy.updateMatrix();
            imesh.setMatrixAt(i, dummy.matrix);
        }
        
        trackGroup.add(imesh);
        
        debrisAnimations.push(() => {
            for (let i = 0; i < count; i++) {
                if (behavior === 'leaf') {
                    positions[i*3+1] -= 0.05 + Math.random()*0.05;
                    positions[i*3] += Math.sin(Date.now()*0.001 + i) * 0.1;
                    rotations[i*3] += 0.05;
                    rotations[i*3+1] += 0.02;
                    if (positions[i*3+1] < 0) positions[i*3+1] = 40;
                } else if (behavior === 'tumble') {
                    positions[i*3+2] -= 0.2;
                    positions[i*3+1] = Math.abs(Math.sin(positions[i*3+2]*0.2)) * 3;
                    rotations[i*3] -= 0.1;
                    if (positions[i*3+2] < zOffset - 100) positions[i*3+2] = zOffset + 100;
                } else if (behavior === 'paper') {
                    positions[i*3+1] += velocities[i*3+1];
                    positions[i*3] += velocities[i*3];
                    rotations[i*3] += velocities[i*3]*0.5;
                    if (positions[i*3+1] > 40) positions[i*3+1] = 0;
                    if (positions[i*3+1] < 0) positions[i*3+1] = 40;
                } else if (behavior === 'moth') {
                    const time = Date.now() * 0.002 + i;
                    // Erratic fluttering
                    positions[i*3] += Math.sin(time * 2.5) * 0.08 + (Math.random()-0.5)*0.05;
                    positions[i*3+1] += Math.cos(time * 3.1) * 0.08 + (Math.random()-0.5)*0.05;
                    positions[i*3+2] += Math.sin(time * 1.7) * 0.08;
                    
                    // Keep moths near ground
                    if (positions[i*3+1] > 8) positions[i*3+1] -= 0.2;
                    if (positions[i*3+1] < 1) positions[i*3+1] += 0.2;
                    
                    rotations[i*3] += (Math.random()-0.5)*0.8;
                    rotations[i*3+1] += (Math.random()-0.5)*0.8;
                }
                dummy.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
                dummy.rotation.set(rotations[i*3], rotations[i*3+1], rotations[i*3+2]);
                dummy.updateMatrix();
                imesh.setMatrixAt(i, dummy.matrix);
            }
            imesh.instanceMatrix.needsUpdate = true;
        });
    };

    // Spawn Debris for each biome
    const leafTex = createProceduralLeafTexture();
    buildDebris(new PlaneGeometry(0.8, 0.8), 200, { map: leafTex, color: 0xffffff, side: DoubleSide, transparent: true, alphaTest: 0.1 }, 0, 'leaf'); // Forest
    buildDebris(new IcosahedronGeometry(0.8, 0), 100, { color: 0xffaa44, wireframe: true }, -300, 'tumble'); // Canyon
    buildDebris(new PlaneGeometry(0.8, 1.2), 150, { color: 0xaaaabb, side: DoubleSide }, -600, 'paper'); // City
    buildDebris(new ConeGeometry(0.2, 0.4, 3), 300, { color: 0xffffaa }, -900, 'moth'); // Savanna


    
    
    function createProceduralDeciduousTree(): Group {
        const group = new Group();
        
        // Trunk
        const trunkGeo = new CylinderGeometry(0.5, 0.8, 3, 5);
        trunkGeo.translate(0, 1.5, 0);
        const trunkMesh = new Mesh(trunkGeo);
        trunkMesh.userData.isTrunk = true;
        group.add(trunkMesh);
        
        // Canopy
        const canopyGeo = new DodecahedronGeometry(3.5, 0);
        canopyGeo.translate(0, 4.5, 0);
        const canopyMesh = new Mesh(canopyGeo);
        canopyMesh.userData.isLeaf = true;
        group.add(canopyMesh);
        
        return group;
    }

    function createProceduralBush(): Group {
        const group = new Group();
        for (let i = 0; i < 3; i++) {
            const bushGeo = new IcosahedronGeometry(1.5 + Math.random(), 0);
            bushGeo.translate((Math.random()-0.5)*2, 0.5 + Math.random(), (Math.random()-0.5)*2);
            const bushMesh = new Mesh(bushGeo);
            bushMesh.userData.isLeaf = true;
            group.add(bushMesh);
        }
        return group;
    }

    function createProceduralRock(): Group {
        const group = new Group();
        const rockGeo = new IcosahedronGeometry(2, 0);
        // Random scale for jagged rocks
        rockGeo.scale(1 + Math.random(), 0.5 + Math.random()*0.8, 1 + Math.random());
        rockGeo.translate(0, 1, 0);
        const rockMesh = new Mesh(rockGeo);
        rockMesh.userData.isRock = true;
        group.add(rockMesh);
        return group;
    }

    function createProceduralLog(): Group {
        const group = new Group();
        const logGeo = new CylinderGeometry(0.6, 0.6, 4 + Math.random()*3, 5);
        logGeo.rotateZ(Math.PI / 2);
        logGeo.translate(0, 0.4, 0);
        const logMesh = new Mesh(logGeo);
        logMesh.userData.isTrunk = true;
        group.add(logMesh);
        return group;
    }

    function createProceduralMushroom(): Group {
        const group = new Group();
        // Stalk
        const stalkGeo = new CylinderGeometry(0.1, 0.15, 1, 4);
        stalkGeo.translate(0, 0.5, 0);
        const stalkMesh = new Mesh(stalkGeo);
        stalkMesh.userData.isMushroomStalk = true;
        group.add(stalkMesh);
        
        // Cap
        const capGeo = new ConeGeometry(0.6, 0.4, 6);
        capGeo.translate(0, 1.1, 0);
        const capMesh = new Mesh(capGeo);
        capMesh.userData.isMushroomCap = true;
        group.add(capMesh);
        
        return group;
    }

    function createProceduralPineTree(): Group {
        const group = new Group();
        
        // Trunk
        const trunkGeo = new CylinderGeometry(0.3, 0.6, 2, 5);
        trunkGeo.translate(0, 1, 0); // anchor at base
        const trunkMesh = new Mesh(trunkGeo);
        trunkMesh.userData.isTrunk = true;
        group.add(trunkMesh);
        
        // Leaves (3 stacked cones)
        const heights = [3, 2.5, 2];
        const radii = [2.2, 1.6, 1.0];
        const yOffsets = [2, 3.5, 4.8];
        
        for (let i = 0; i < 3; i++) {
            const coneGeo = new ConeGeometry(radii[i], heights[i], 5);
            coneGeo.translate(0, yOffsets[i] + heights[i]/2, 0);
            const coneMesh = new Mesh(coneGeo);
            coneMesh.userData.isLeaf = true;
            group.add(coneMesh);
        }
        
        return group;
    }


    function createProceduralMesa(): Group {
        const group = new Group();
        const heights = [4, 3, 2];
        const radii = [3, 2.2, 1.5];
        let y = 0;
        for (let i = 0; i < 3; i++) {
            const geo = new CylinderGeometry(radii[i], radii[i]*1.2, heights[i], 12, 4);
            displaceGeometry(geo, 0.4, 1.5);
            geo.translate(0, y + heights[i]/2, 0);
            const mesh = new Mesh(geo);
            mesh.userData.isRock = true;
            group.add(mesh);
            y += heights[i];
        }
        return group;
    }

    function createProceduralArch(): Group {
        const group = new Group();
        const geo = new TorusGeometry(5, 1.5, 12, 16, Math.PI);
        displaceGeometry(geo, 0.5, 1.2);
        geo.translate(0, 0, 0);
        const mesh = new Mesh(geo);
        mesh.userData.isRock = true;
        group.add(mesh);
        return group;
    }

    function createProceduralHouse(): Group {
        const group = new Group();
        // Base
        const w = 6 + Math.random()*2;
        const d = 5 + Math.random()*3;
        const h = 4 + Math.random()*2;
        const baseGeo = new BoxGeometry(w, h, d);
        baseGeo.translate(0, h/2, 0);
        const baseMesh = new Mesh(baseGeo);
        baseMesh.userData.isBuilding = true;
        group.add(baseMesh);
        
        // Roof
        const roofGeo = new ConeGeometry(Math.max(w,d)*0.7, 3, 4);
        roofGeo.translate(0, h + 1.5, 0);
        roofGeo.rotateY(Math.PI/4);
        const roofMesh = new Mesh(roofGeo);
        roofMesh.userData.isRoof = true;
        group.add(roofMesh);
        
        return group;
    }

    function createProceduralMansion(): Group {
        const group = new Group();
        // Base
        const w = 10 + Math.random()*4;
        const d = 8 + Math.random()*3;
        const h = 6 + Math.random()*2;
        const baseGeo = new BoxGeometry(w, h, d);
        baseGeo.translate(0, h/2, 0);
        const baseMesh = new Mesh(baseGeo);
        baseMesh.userData.isBuilding = true;
        group.add(baseMesh);
        
        // Roof
        const roofGeo = new ConeGeometry(Math.max(w,d)*0.7, 4, 4);
        roofGeo.translate(0, h + 2, 0);
        roofGeo.rotateY(Math.PI/4);
        const roofMesh = new Mesh(roofGeo);
        roofMesh.userData.isRoof = true;
        group.add(roofMesh);
        
        return group;
    }

    function createProceduralFence(): Group {
        const group = new Group();
        const geo = new BoxGeometry(4, 1.5, 0.2);
        geo.translate(0, 0.75, 0);
        const mesh = new Mesh(geo);
        mesh.userData.isBuilding = true;
        group.add(mesh);
        return group;
    }

    function createProceduralAcacia(): Group {
        const group = new Group();
        // Branching L-system style
        const buildBranch = (parent: Group, len: number, rad: number, yOffset: number, rotZ: number, rotY: number, depth: number) => {
            const geo = new CylinderGeometry(rad*0.6, rad, len, 5);
            geo.translate(0, len/2, 0);
            const mesh = new Mesh(geo);
            mesh.userData.isTrunk = true;
            mesh.rotation.z = rotZ;
            mesh.rotation.y = rotY;
            mesh.position.y = yOffset;
            parent.add(mesh);
            
            if (depth > 0) {
                buildBranch(mesh, len*0.8, rad*0.6, len*0.9, rotZ + 0.4, rotY + 1.2, depth - 1);
                buildBranch(mesh, len*0.8, rad*0.6, len*0.9, rotZ - 0.4, rotY - 1.2, depth - 1);
            } else {
                // Canopy at branch end
                const canopyGeo = new DodecahedronGeometry(len*1.5, 0);
                canopyGeo.scale(1, 0.3, 1);
                canopyGeo.translate(0, len, 0);
                const canopyMesh = new Mesh(canopyGeo);
                canopyMesh.userData.isLeaf = true;
                mesh.add(canopyMesh);
            }
        };
        buildBranch(group, 5, 0.6, 0, 0, 0, 2);
        return group;
    }

    function createProceduralBaobab(): Group {
        const group = new Group();
        
        // Bloated trunk using multiple segments (faux vertex deformation via stacking)
        let y = 0;
        let rad = 3.5;
        for (let i = 0; i < 5; i++) {
            const h = 2;
            const geo = new CylinderGeometry(rad*0.8, rad, h, 8);
            geo.translate((Math.random()-0.5)*0.2, y + h/2, (Math.random()-0.5)*0.2);
            const mesh = new Mesh(geo);
            mesh.userData.isTrunk = true;
            group.add(mesh);
            y += h;
            rad *= 0.8;
        }
        
        // Sparse chaotic canopy
        for (let i = 0; i < 4; i++) {
            const canopyGeo = new DodecahedronGeometry(2, 0);
            canopyGeo.translate((Math.random()-0.5)*4, y + Math.random()*2, (Math.random()-0.5)*4);
            const canopyMesh = new Mesh(canopyGeo);
            canopyMesh.userData.isLeaf = true;
            group.add(canopyMesh);
        }
        
        return group;
    }

    biomes.forEach((biome, index) => {
        const startMatIndex = trackMaterials.length;
        const startMeshIndex = trackGroup.children.length;

        // PROCEDURAL GROUND GRID (Physical Textures)
        // Endless grid to prevent seeing the edge of the world
        const geo = new PlaneGeometry(800, 4500, 64, 128); 
        geo.rotateX(-Math.PI / 2);
        
        let diffuseCanvas: HTMLCanvasElement | null = null;
        let diffuseTex: CanvasTexture | null = null;
        
        if (biome.name === 'Forest') {
            diffuseTex = createForestGround();
        } else if (biome.name === 'Canyon') {
            diffuseTex = createCanyonGround();
        } else if (biome.name === 'City') {
            diffuseTex = createCityGround();
        } else if (biome.name === 'Savanna') {
            diffuseTex = createSavannaGround();
        }
        
        let matProps: any = { 
            color: 0xffffff, roughness: 1.0, metalness: 0.1, wireframe: false 
        };
        
        if (diffuseTex) {
            diffuseCanvas = diffuseTex.image;
            const maps = generateMapsFromDiffuse(diffuseCanvas);
            
            diffuseTex.repeat.set(8, 8);
            maps.normalMap.repeat.set(8, 8);
            maps.bumpMap.repeat.set(8, 8);
            
            matProps.map = diffuseTex;
            matProps.normalMap = maps.normalMap;
            matProps.roughnessMap = maps.bumpMap;
            matProps.bumpMap = maps.bumpMap;
            matProps.bumpScale = 0.5;
        }
        
        const mat = createNonEuclideanMaterial(matProps);
        mat.transparent = true;
        
        trackMaterials.push(mat);
        
        const mesh = new Mesh(geo, mat);
        mesh.position.z = -(index * BIOME_SPACING);
        mesh.receiveShadow = true;
        mesh.userData.isGround = true; // Exempt from Z-culling (this mesh spans 4500 units)
        trackGroup.add(mesh);


        
        if (biome.name === 'Forest') {
            const basePine = createProceduralPineTree();
            const baseDeciduous = createProceduralDeciduousTree();
            const baseBush = createProceduralBush();
            // Dense Golden Grass Instancing
            const grassCount = 20000;
            const grassGeo = new ConeGeometry(0.15, 2, 3);
            grassGeo.translate(0, 1, 0);
            const grassMat = new MeshStandardMaterial({ color: 0xcca844, roughness: 1.0, transparent: true, opacity: 0 });
            grassMat.userData = { baseOpacity: 0.9 };
            applyNonEuclideanCurve(grassMat);
            applyWindSway(grassMat);
            trackMaterials.push(grassMat);
            const grassInst = new InstancedMesh(grassGeo, grassMat, grassCount);
            grassInst.castShadow = true; grassInst.receiveShadow = true;
            const grassDummy = new Object3D();
            for (let i=0; i<grassCount; i++) {
                const gx = (Math.random()-0.5)*500;
                const gz = (Math.random()-0.5)*1400;
                grassDummy.position.set(gx, 0, gz);
                grassDummy.rotation.y = Math.random() * Math.PI;
                grassDummy.rotation.x = (Math.random()-0.5)*0.2;
                grassDummy.scale.setScalar(0.5 + Math.random()*1.0);
                grassDummy.updateMatrix();
                grassInst.setMatrixAt(i, grassDummy.matrix);
            }
            grassInst.position.set(0, 0, -(index * BIOME_SPACING));
            trackGroup.add(grassInst);

            const baseRock = createProceduralRock();
            const baseLog = createProceduralLog();
            const baseMushroom = createProceduralMushroom();
            
            // Dense forest with a small central winding path
            for (let x = -200; x <= 200; x += 20) {
                for (let z = -600; z <= 600; z += 20) {
                    const pathCurve = Math.sin(z * 0.02) * 30;
                    const distToPath = Math.abs(x - pathCurve);
                    
                    if (distToPath < 10) continue; 
                    if (Math.random() > 0.5) continue; // Adjust density

                    const r = Math.random();
                    let tile: Group;
                    let defaultScale = 1.0;
                    
                    if (r < 0.4) {
                        tile = basePine.clone();
                        defaultScale = 4.0 + Math.random() * 4.0;
                    } else if (r < 0.6) {
                        tile = baseDeciduous.clone();
                        defaultScale = 3.5 + Math.random() * 4.0;
                    } else if (r < 0.75) {
                        tile = baseBush.clone();
                        defaultScale = 1.5 + Math.random() * 2.5;
                    } else if (r < 0.9) {
                        tile = baseRock.clone();
                        defaultScale = 1.5 + Math.random() * 4.5;
                    } else if (r < 0.95) {
                        tile = baseLog.clone();
                        defaultScale = 2.0 + Math.random() * 2.0;
                    } else {
                        tile = baseMushroom.clone();
                        defaultScale = 2.0 + Math.random() * 2.0;
                    }
                    
                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            
                            // Determine Base Color based on metadata
                            let baseColor = new Color();
                            if (childMesh.userData.isTrunk) {
                                baseColor.setHSL(0.06 + (Math.random() - 0.5) * 0.05, 0.7, 0.2 + Math.random() * 0.1);
                            } else if (childMesh.userData.isLeaf) {
                                baseColor.setHSL(0.35 + (Math.random() - 0.5) * 0.1, 0.8, 0.2 + Math.random() * 0.1);
                            } else if (childMesh.userData.isRock) {
                                baseColor.setHSL(0.0, 0.0, 0.3 + Math.random() * 0.2); // Greys
                            } else if (childMesh.userData.isMushroomStalk) {
                                baseColor.setHSL(0.1, 0.3, 0.8); // Pale stalk
                            } else if (childMesh.userData.isMushroomCap) {
                                // Glowing bright mushroom caps (Cyan/Purple/Pink)
                                baseColor.setHSL(0.5 + Math.random()*0.4, 0.9, 0.5 + Math.random()*0.2); 
                            } else {
                                baseColor.setHSL(0.3, 0.8, 0.2);
                            }

                            const emissiveColor = (childMesh.userData.isMushroomCap) ? baseColor.clone() : new Color(0x000000);
                            const emissiveIntensity = (childMesh.userData.isMushroomCap) ? 1.5 : 0;

                            const coreMat = new MeshStandardMaterial({
                                color: baseColor, emissive: emissiveColor, emissiveIntensity: emissiveIntensity,
                                roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0, depthWrite: true
                            });
                            coreMat.userData = { baseOpacity: 1.0 };
                            
                            applyNonEuclideanCurve(coreMat);
                            if (childMesh.userData.isLeaf || childMesh.userData.isTrunk) applyWindSway(coreMat);
                            trackMaterials.push(coreMat);
                            
                            wrapWireframe(childMesh, coreMat, { matchColor: true, sway: childMesh.userData.isLeaf || childMesh.userData.isTrunk });
                        }
                    });

                    tile.position.set(x + (Math.random()-0.5)*8, 0, -(index * BIOME_SPACING) + z + (Math.random()-0.5)*8);
                    tile.rotation.y = Math.random() * Math.PI * 2; 
                    
                    tile.scale.set(defaultScale, defaultScale, defaultScale);
                    trackGroup.add(tile);
                }
            }
        } else if (biome.name === 'Canyon') {
            const baseMesa = createProceduralMesa();
            const baseArch = createProceduralArch();
            const baseRock = createProceduralRock();
            
            for (let x = -200; x <= 200; x += 25) {
                for (let z = -600; z <= 600; z += 25) {
                    const pathCurve = Math.sin(z * 0.02) * 20;
                    const distToPath = Math.abs(x - pathCurve);
                    
                    if (distToPath < 12) continue; 
                    if (Math.random() > 0.45) continue;

                    const r = Math.random();
                    let tile: Group;
                    let defaultScale = 1.0;
                    
                    if (r < 0.3) { tile = baseMesa.clone(); defaultScale = 3.0 + Math.random() * 2.0; }
                    else if (r < 0.5 && distToPath > 20) { tile = baseArch.clone(); defaultScale = 4.0 + Math.random() * 3.0; }
                    else { tile = baseRock.clone(); defaultScale = 2.0 + Math.random() * 3.0; }
                    
                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            const rockColor = new Color().setHSL(0.05 + (Math.random()-0.5)*0.08, 0.6 + Math.random()*0.3, 0.4 + Math.random()*0.2);
                            const coreMat = new MeshStandardMaterial({ color: rockColor, roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0, depthWrite: true });
                            coreMat.userData = { baseOpacity: 1.0 };
                            applyNonEuclideanCurve(coreMat);
                            trackMaterials.push(coreMat);
                            wrapWireframe(childMesh, coreMat, { matchColor: true, opacity: 0.25 });
                        }
                    });

                    tile.position.set(x + (Math.random()-0.5)*5, 0, -(index * BIOME_SPACING) + z + (Math.random()-0.5)*5);
                    tile.rotation.y = Math.random() * Math.PI * 2; 
                    tile.scale.set(defaultScale, defaultScale, defaultScale);
                    trackGroup.add(tile);
                }
            }
        } else if (biome.name === 'City') {
            const baseHouse = createProceduralHouse();
            const baseMansion = createProceduralMansion();
            const baseFence = createProceduralFence();

            for (let row = -40; row <= 40; row++) {
                for (let colOffset of [-180, -120, -70, -35, 35, 70, 120, 180]) {
                    if (row === 0 && Math.abs(colOffset) < 100) continue; // Leave central clearing near origin
                    
                    const x = colOffset + (Math.random()-0.5)*10;
                    const z = row * 20 + (Math.random()-0.5)*4; // strict row spacing
                    
                    const rand = Math.random();
                    let tile: Group;
                    
                    if (rand < 0.15) tile = baseMansion.clone();
                    else if (rand < 0.85) tile = baseHouse.clone();
                    else tile = baseFence.clone();
                    
                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            const isBuilding = child.userData.isBuilding;
                            const isRoof = child.userData.isRoof;
                            
                            let matColor = new Color();
                            if (isBuilding) matColor.setHSL(0.1 + Math.random()*0.1, 0.4, 0.3 + Math.random()*0.3); // Siding
                            else if (isRoof) matColor.setHSL(0.0, 0.0, 0.15 + Math.random()*0.1); // Asphalt shingle
                            
                            const coreMat = new MeshStandardMaterial({ 
                                color: matColor, 
                                roughness: 0.8, 
                                metalness: 0.1, 
                                transparent: true, 
                                opacity: 0, 
                                depthWrite: true,
                                map: isBuilding ? facadeMaps.diffuseMap : null, emissiveMap: isBuilding ? facadeMaps.emissiveMap : null, emissive: isBuilding ? new Color(0xffaa55) : new Color(0x000000), emissiveIntensity: isBuilding ? 0.8 : 0
                            });
                            coreMat.userData = { baseOpacity: 1.0 };
                            applyNonEuclideanCurve(coreMat);
                            trackMaterials.push(coreMat);
                            childMesh.material = coreMat;
                            wrapWireframe(childMesh, coreMat, { matchColor: true, opacity: 0.45 });
                        }
                    });

                    tile.position.set(x, 0, -(index * BIOME_SPACING) + z);
                    // Point houses toward the street roughly
                    tile.rotation.y = colOffset < 0 ? Math.PI/2 : -Math.PI/2; 
                    
                    const scale = 1.2 + Math.random()*0.2;
                    tile.scale.set(scale, scale, scale);
                    trackGroup.add(tile);
                }
            }
        } else if (biome.name === 'Savanna') {
            const baseAcacia = createProceduralAcacia();
            const baseBaobab = createProceduralBaobab();
            const baseBush = createProceduralBush();
            // Dense Golden Grass Instancing
            const grassCount = 18000;
            const grassGeo = new ConeGeometry(0.15, 2, 3);
            grassGeo.translate(0, 1, 0);
            const grassMat = new MeshStandardMaterial({ color: 0xcca844, roughness: 1.0, transparent: true, opacity: 0 });
            grassMat.userData = { baseOpacity: 0.9 };
            applyNonEuclideanCurve(grassMat);
            applyWindSway(grassMat);
            trackMaterials.push(grassMat);
            const grassInst = new InstancedMesh(grassGeo, grassMat, grassCount);
            grassInst.castShadow = true; grassInst.receiveShadow = true;
            const grassDummy = new Object3D();
            for (let i=0; i<grassCount; i++) {
                const gx = (Math.random()-0.5)*500;
                const gz = (Math.random()-0.5)*1400;
                grassDummy.position.set(gx, 0, gz);
                grassDummy.rotation.y = Math.random() * Math.PI;
                grassDummy.rotation.x = (Math.random()-0.5)*0.2;
                grassDummy.scale.setScalar(0.5 + Math.random()*1.0);
                grassDummy.updateMatrix();
                grassInst.setMatrixAt(i, grassDummy.matrix);
            }
            grassInst.position.set(0, 0, -(index * BIOME_SPACING));
            trackGroup.add(grassInst);


            for (let i = 0; i < 120; i++) {
                const x = (Math.random() - 0.5) * 500;
                const z = (Math.random() - 0.5) * 1200;
                
                if (Math.abs(x) > 10 || Math.abs(z) > 10) {
                    const rand = Math.random();
                    let tile: Group;
                    let isTree = true;
                    let scale = 1.0;

                    if (rand < 0.6) {
                        tile = baseAcacia.clone();
                        scale = 3.0 + Math.random() * 2.0;
                    } else {
                        tile = baseBaobab.clone();
                        scale = 2.5 + Math.random() * 1.5;
                    }

                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            const isTrunk = child.userData.isTrunk;
                            const isLeaf = child.userData.isLeaf;
                            
                            let plantColor = new Color();
                            if (isTrunk) {
                                plantColor.setHSL(0.08, 0.3, 0.25);
                            } else {
                                plantColor.setHSL(0.12, 0.4, 0.35); // Green
                            }

                            const coreMat = new MeshStandardMaterial({ color: plantColor, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0, depthWrite: true });
                            coreMat.userData = { baseOpacity: 1.0 };
                            applyNonEuclideanCurve(coreMat);
                            if (isLeaf) applyWindSway(coreMat);
                            trackMaterials.push(coreMat);
                            
                            childMesh.material = coreMat;
                            wrapWireframe(childMesh, coreMat, { color: 0x5effa4, opacity: 0.2, sway: isLeaf });
                        }
                    });

                    tile.position.set(x, 0, -(index * BIOME_SPACING) + z);
                    tile.rotation.y = Math.random() * Math.PI * 2;
                    tile.scale.set(scale, scale, scale);
                    trackGroup.add(tile);
                }
            }
        }

        // Tag all materials in this biome and disable frustum culling for its meshes
        for (let i = startMatIndex; i < trackMaterials.length; i++) {
            if (!trackMaterials[i].userData) trackMaterials[i].userData = {};
            trackMaterials[i].userData.biomeIndex = index;
        }
        for (let i = startMeshIndex; i < trackGroup.children.length; i++) {
            trackGroup.children[i].traverse((child) => {
                child.frustumCulled = false;
            });
        }
    });
    const TRACK_TRAVEL_DISTANCE = BIOME_SPACING * (biomes.length - 1);

    const ambientLight = new AmbientLight(0xffffff, 2.2);
    scene.add(ambientLight);
    


    const apparitionSprite = createApparitionSprite();
    scene.add(apparitionSprite);

    const resize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        // bokehPass doesn't have setSize directly, its internal targets need updates if it was exposed, but usually rebuilding or leaving it is fine for BokehPass in some Three.js versions. We'll update its uniforms if possible.
        if (bokehPass.renderTargetDepth) {
            bokehPass.renderTargetDepth.setSize(width, height);
        }
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        // Calculate compass heading
        const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const headingRad = Math.atan2(forward.x, forward.z);
        window.dispatchEvent(new CustomEvent('biome-heading', { detail: headingRad * (180 / Math.PI) }));
    };
    
    window.addEventListener('resize', resize);
    resize();

    let animationFrameId: number;
    let isDestroyed = false;
    let isRunning = false;

    let targetFocus = 50.0;
    let currentFocus = 50.0;
    const centerPoint = new Vector2(0, 0);

    const tick = () => {
        if (!isRunning || isDestroyed) return;
        animationFrameId = requestAnimationFrame(tick);

        const time = performance.now();

        // --- Weather Transitions ---
        if (lastWeatherChange === 0) lastWeatherChange = time;
        if (time - lastWeatherChange > 20000) {
            lastWeatherChange = time;
            const states: WeatherState[] = ['CLEAR', 'OVERCAST', 'STORM'];
            targetWeather = states[Math.floor(Math.random() * states.length)];
            targetWeatherTint = weatherTints[targetWeather].color;
            targetFogMult = weatherTints[targetWeather].fogMult;
            targetWetness = targetWeather === 'STORM' ? 1.0 : (targetWeather === 'OVERCAST' ? 0.3 : 0.0);
            console.log("Weather changed to:", targetWeather);
        }
        currentWeatherTint.lerp(targetWeatherTint, 0.005); // Smooth color blend
        currentFogMult = MathUtils.lerp(currentFogMult, targetFogMult, 0.005);
        currentWetness = MathUtils.lerp(currentWetness, targetWetness, 0.002);
        


        // Auto-Focus Raycast
        raycaster.setFromCamera(centerPoint, camera);
        const focusIntersects = raycaster.intersectObjects(trackGroup.children, true);
        if (focusIntersects.length > 0) {
            targetFocus = focusIntersects[0].distance;
        } else {
            targetFocus = 200.0; // Default infinity focus
        }
        
        // Smooth transition (large falloff/subtle switch)
        currentFocus = MathUtils.lerp(currentFocus, targetFocus, 0.05);
        bokehPass.uniforms['focus'].value = currentFocus;

        // Push wetness to materials
        trackMaterials.forEach(mat => {
            if (mat.userData && mat.userData.uWetness) {
                mat.userData.uWetness.value = currentWetness;
            }
        });
        
        // Update Lens Flare direction
        const camDir = new Vector3();
        camera.getWorldDirection(camDir);
        lensUniforms.uCamFwd.value.copy(camDir);
        
        const sunDir = new Vector3().copy(dirLight.position).normalize();
        lensUniforms.uSunDir.value.copy(sunDir);


        // --- Lightning Logic ---
        if (targetWeather === 'STORM' && Math.random() < 0.005) { // 0.5% chance per frame in a storm
            lightningFlash = 1.0;
        }
        lightningFlash = MathUtils.lerp(lightningFlash, 0, 0.1); // Quick fade out



        // --- Z-based Visibility Culling ---
        // The camera is at Z=0 looking down -Z.
        // TrackGroup moves positively along Z as we scroll.
        // Only render objects within a reasonable range of the camera.
        // Ground planes are exempt — they're single huge meshes whose origin doesn't
        // represent their visible extent.
        const activeZ = trackGroup.position.z;
        const cullFar = -BIOME_SPACING * 1.5;  // How far ahead (into -Z) to render
        const cullBehind = 200;                 // How far behind (+Z) to render
        trackGroup.children.forEach(child => {
            if (child.userData.isGround) return; // Never cull ground planes
            const worldZ = activeZ + child.position.z;
            if (worldZ < cullFar || worldZ > cullBehind) {
                child.visible = false;
            } else {
                child.visible = true;
            }
        });

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

        

        renderedProgressZ = MathUtils.lerp(renderedProgressZ, targetProgressZ, 0.035);
        
        const xLerpSpeed = isSnapActive ? 0.095 : 0.045;
        renderedProgressX = MathUtils.lerp(renderedProgressX, targetProgressX, xLerpSpeed);

        const entryProgress = 1.0 - MathUtils.clamp(renderedProgressZ / ENTRY_PHASE_END, 0, 1);
        const travelProgress = MathUtils.clamp((renderedProgressZ - ENTRY_PHASE_END) / (TRAVEL_PHASE_END - ENTRY_PHASE_END), 0, 1);
        const exitProgress = MathUtils.clamp((renderedProgressZ - TRAVEL_PHASE_END) / (1 - TRAVEL_PHASE_END), 0, 1);
        
        const travelZ = travelProgress * TRACK_TRAVEL_DISTANCE;
        const travelX = renderedProgressX * MAX_X_TRAVEL_RANGE;
        
        const entryEase = Math.pow(entryProgress, 6); // Steep curve: stays black much longer, reveals color only at the very end
        const exitEase = Math.pow(exitProgress, 4);
        const transitionBlackness = Math.max(entryEase, exitEase);
        
        // Dynamic Biome Environment Lerping
        if (typeof biomeEnvs !== 'undefined' && scene.fog) {
            const progress = travelZ / BIOME_SPACING;
            const idx = Math.floor(progress);
            const f = progress - idx;
            
            // Calculate dissolve state and true blackness gap
            // Everything (ground, models, horizon) dissolves together.
            // Out (0.35 -> 0.45), Black (0.45 -> 0.55), In (0.55 -> 0.65).
            let dissolveState = 0.0;
            if (f >= 0.35 && f <= 0.45) {
                dissolveState = (f - 0.35) / 0.1; // Morph out
            } else if (f > 0.45 && f < 0.55) {
                dissolveState = 1.0; // True Black dead zone
            } else if (f >= 0.55 && f <= 0.65) {
                dissolveState = 1.0 - (f - 0.55) / 0.1; // Morph in
            }

            const clampIdx = MathUtils.clamp(idx, 0, 3);
            const clampNext = MathUtils.clamp(idx + 1, 0, 3);
            
            const c0 = biomeEnvs[clampIdx];
            const c1 = biomeEnvs[clampNext];
            
            // Apply standard biome fog, but lerp to true black during the dead zone
            const baseFog = new Color(c0.fog).lerp(new Color(c1.fog), f);
            const trueBlack = new Color(0x000000);
            const fogColor = baseFog.lerp(trueBlack, dissolveState);
            
            if (scene.background instanceof Color) {
                scene.background.copy(fogColor);
            } else {
                scene.background = fogColor.clone();
            }

            // --- Horizon Uniforms Update ---
            horizonMaterial.uniforms.tDiffuseCurrent.value = horizonTextures[clampIdx];
            horizonMaterial.uniforms.tDiffuseNext.value = horizonTextures[clampNext];
            horizonMaterial.uniforms.uProgress.value = f;
            horizonMaterial.uniforms.uTime.value = time / 1000;
            horizonMaterial.uniforms.uFogColor.value.copy(fogColor);
            // Apply global weather tint
            fogColor.multiply(currentWeatherTint);
            
            // Lightning override
            if (lightningFlash > 0.05) {
                fogColor.lerp(new Color(0xffffff), lightningFlash * 0.8);
            }
            
            // Fade to black on entry/exit
            fogColor.lerp(new Color(0x000000), transitionBlackness);

            (scene.fog as FogExp2).color.copy(fogColor);
            scene.background = fogColor;
            (scene.fog as FogExp2).density = MathUtils.lerp(c0.density, c1.density, f) * currentFogMult;
            
            // Light color blending
            const lightCol = new Color(c0.light).lerp(new Color(c1.light), f).multiply(currentWeatherTint);
            if (lightningFlash > 0.05) {
                lightCol.lerp(new Color(0xffffff), lightningFlash);
            }
            // Fade lights to black on entry/exit
            lightCol.lerp(new Color(0x000000), transitionBlackness);
            dirLight.color.copy(lightCol);
            
            const baseIntensity = MathUtils.lerp(c0.intensity, c1.intensity, f) + (lightningFlash * 25.0);
            dirLight.intensity = baseIntensity * (1.0 - transitionBlackness);
            ambientLight.intensity = 2.2 * (1.0 - transitionBlackness);
        }

        let targetCamY = 5;
        let targetCamZ = 10;
        let targetFOV = 45;

        if (entryProgress > 0) {
            // Skydive Entry: Drop down from the sky (Y=100) into the biome
            targetCamY = MathUtils.lerp(5, 100.0, entryEase);
            targetCamZ = MathUtils.lerp(10, 30.0, entryEase); 
            targetFOV = MathUtils.lerp(45, 90, entryEase); 
        } else if (exitProgress > 0) {
            // Warp Speed Exit: Drop low and push FOV to simulate lightspeed before the flash
            targetCamY = MathUtils.lerp(5, 0.5, exitEase);
            targetCamZ = MathUtils.lerp(10, 20.0, exitEase);
            targetFOV = MathUtils.lerp(45, 160, exitEase);
        }

        const parallaxX = mouseNDC.x * 2.0;
        const parallaxY = mouseNDC.y * 1.2;

        camera.position.set(travelX + parallaxX, targetCamY + parallaxY, targetCamZ);
        
        // Add extreme camera shake during exit warp
        if (exitProgress > 0.5) {
            const shake = (exitProgress - 0.5) * 2.0;
            camera.position.x += (Math.random() - 0.5) * shake * 2.0;
            camera.position.y += (Math.random() - 0.5) * shake * 2.0;
        }
        
        camera.fov = targetFOV;
        
        // Dynamically tilt the camera up slightly on entry to see the horizon
        const dynamicTarget = _cameraTarget.clone().add(new Vector3(travelX + parallaxX * 0.5, parallaxY * 0.5 + (entryEase * 20.0), 0));
        camera.lookAt(dynamicTarget);
        camera.updateProjectionMatrix();
        
        // Calculate compass heading
        const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const headingRad = Math.atan2(forward.x, forward.z);
        window.dispatchEvent(new CustomEvent('biome-heading', { detail: headingRad * (180 / Math.PI) }));

        raycaster.setFromCamera(mouseNDC, camera);
        // PERFORMANCE FIX: Disabled recursive raycasting
        const intersects: any[] = [];
        
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

        // During warp exit, push the world towards the camera incredibly fast
        trackGroup.position.z = MathUtils.lerp(travelZ, travelZ + 500, exitEase);
        trackGroup.scale.setScalar(MathUtils.lerp(1, 0.01, exitEase));

        const dissolveOpacity = 1 - MathUtils.clamp((exitProgress - 0.7) / 0.3, 0, 1);
        
        // Calculate the same dissolve state to pass to NonEuclidean materials
        const globalProgress = travelZ / BIOME_SPACING;
        const currentIdx = Math.floor(globalProgress);
        const globalF = globalProgress - currentIdx;

        for (const mat of trackMaterials) {
            const baseCap = mat.userData?.baseOpacity ?? 1.0;
            mat.opacity = dissolveOpacity * (1 - entryEase) * baseCap;
            
            if (mat.userData && mat.userData.uMorphState) {
                const matBiome = mat.userData.biomeIndex;
                let morphState = 1.0; // Default fully invisible
                
                if (matBiome === currentIdx) {
                    // Current biome morphs out
                    if (globalF < 0.35) morphState = 0.0;
                    else if (globalF <= 0.45) morphState = (globalF - 0.35) / 0.1;
                    else morphState = 1.0;
                } else if (matBiome === currentIdx + 1) {
                    // Next biome morphs in
                    if (globalF < 0.55) morphState = 1.0;
                    else if (globalF <= 0.65) morphState = 1.0 - (globalF - 0.55) / 0.1;
                    else morphState = 0.0;
                }

                mat.userData.uMorphState.value = morphState;
            }
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
        
        // --- CRT Shutdown Effect (final biome exit only) ---
        // The last biome is index 3 (Savanna). When the global exit animation kicks in,
        // we want the CRT shutdown effect instead of the normal warp.
        const isLastBiome = (currentIdx >= 3);
        if (isLastBiome && exitProgress > 0) {
            // Map exitProgress to a smooth 0->1 CRT shutdown curve
            const shutdownProgress = MathUtils.clamp(exitProgress / 0.95, 0, 1);
            crtShutdownPass.uniforms.uShutdown.value = shutdownProgress;
        } else {
            crtShutdownPass.uniforms.uShutdown.value = 0.0;
        }

        // --- Fade-from-black overlay (covers EVERYTHING) ---
        fadeBlackPass.uniforms.uBlackness.value = transitionBlackness;

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

        horizonTextures.forEach(tex => tex.dispose());
        horizonMaterial.dispose();
        horizonGeo.dispose();

        // Comprehensive Memory Cleanup
        trackMaterials.forEach(mat => {
            if ((mat as any).map) (mat as any).map.dispose();
            if ((mat as any).normalMap) (mat as any).normalMap.dispose();
            if ((mat as any).bumpMap) (mat as any).bumpMap.dispose();
            if ((mat as any).roughnessMap) (mat as any).roughnessMap.dispose();
            if ((mat as any).emissiveMap) (mat as any).emissiveMap.dispose();
            mat.dispose();
        });
        
        trackGroup.traverse((child) => {
            if ((child as Mesh).isMesh) {
                const mesh = child as Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(m => m.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            }
        });
        
        if (lensPlane.material) {
            (lensPlane.material as any).uniforms.uDirtMap.value.dispose();
            (lensPlane.material as any).dispose();
        }
        if (lensPlane.geometry) lensPlane.geometry.dispose();
        
        composer.passes.forEach(pass => {
            if ((pass as any).dispose) (pass as any).dispose();
        });
        
        composer.dispose();
        renderer.dispose();
        
        // Remove scene
        scene.clear();
    };

    start();
    return { start, stop, destroy, resize };
}