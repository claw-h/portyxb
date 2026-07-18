import { 
    Vector3, WebGLRenderer, ACESFilmicToneMapping, FogExp2, Scene, 
    PerspectiveCamera, AmbientLight, DirectionalLight, Mesh, PlaneGeometry, 
    Group, MathUtils, Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending 
} from 'three';
import { createNonEuclideanMaterial } from '../materials/NonEuclideanMaterial';
import type { LoopController } from '../utils/canvas';

const _cameraTarget = new Vector3(0, 0, -10);

function createApparitionSprite(): Sprite {
    // Doubled resolution for crisp, razor-sharp starlight
    const size = 256; 
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;

    // 1. Tighter, Bloom-heavy Core
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)'); 
    glow.addColorStop(0.04, 'rgba(200, 230, 255, 0.9)');  
    glow.addColorStop(0.12, 'rgba(70, 130, 255, 0.4)'); 
    glow.addColorStop(0.4, 'rgba(0, 50, 255, 0)'); 
    
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(c, c);
    
    // Enable canvas-native bloom for the drawn shapes
    ctx.shadowColor = 'rgba(200, 230, 255, 1)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    
    // 2. Primary 4-Point Cross (Razor thin, stretching to the very edges)
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

    // 3. Secondary Diagonal Sparks (For the "twinkle" complexity)
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

let targetProgress = 0;
let renderedProgress = 0;

let isFlashSequenceActive = false;
let isFlashSequenceComplete = false;
let flashStartTime = 0;
const FLASH_DURATION_MS = 600; 

export function setBiomeScrollProgress(progress: number): void {
    if (isFlashSequenceActive && !isFlashSequenceComplete) {
        targetProgress = MathUtils.clamp(progress, 0, 0.999);
        return;
    }
    targetProgress = MathUtils.clamp(progress, 0, 1);
}

export function setupBiomeSphere(): LoopController | null {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-biome-canvas]');
    if (!canvas) return null;

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    const scene = new Scene();
    scene.fog = new FogExp2(0x141822, 0.12);
    
    const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

    const trackGroup = new Group();
    scene.add(trackGroup);

    const BIOME_SPACING = 60; 
    const biomes = [
        { name: 'New York',    color: 0x222222 },
        { name: 'Forest',      color: 0x1B3320 },
        { name: 'Western',     color: 0x5C4033 },
        { name: 'Night Canyon',color: 0x111116 }
    ];

    const trackMaterials: Array<{ transparent: boolean; opacity: number }> = [];

    biomes.forEach((biome, index) => {
        const geo = new PlaneGeometry(40, 60, 64, 64); 
        geo.rotateX(-Math.PI / 2);
        
        const mat = createNonEuclideanMaterial({ 
            color: biome.color, roughness: 0.8, metalness: 0.2, wireframe: true 
        });
        mat.transparent = true;
        trackMaterials.push(mat);
        
        const mesh = new Mesh(geo, mat);
        mesh.position.z = -(index * BIOME_SPACING);
        trackGroup.add(mesh);
    });

    const TRACK_TRAVEL_DISTANCE = BIOME_SPACING * (biomes.length - 1);

    scene.add(new AmbientLight(0xffffff, 0.2));
    
    const dirLight = new DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const apparitionSprite = createApparitionSprite();
    scene.add(apparitionSprite);

    const resize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        camera.aspect = window.innerWidth / window.innerHeight;
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

        renderedProgress = MathUtils.lerp(renderedProgress, targetProgress, 0.08);

        const entryProgress = 1.0 - MathUtils.clamp(renderedProgress / ENTRY_PHASE_END, 0, 1);
        const travelProgress = MathUtils.clamp((renderedProgress - ENTRY_PHASE_END) / (TRAVEL_PHASE_END - ENTRY_PHASE_END), 0, 1);
        const exitProgress = MathUtils.clamp((renderedProgress - TRAVEL_PHASE_END) / (1 - TRAVEL_PHASE_END), 0, 1);
        
        const travelZ = travelProgress * TRACK_TRAVEL_DISTANCE;

        const entryEase = Math.pow(entryProgress, 3);
        const exitEase = Math.pow(exitProgress, 4);

        let targetCamY = 5;
        let targetCamZ = 10;
        let targetFOV = 45;

        if (entryProgress > 0) {
            targetCamY = MathUtils.lerp(5, 0.02, entryEase);
            targetCamZ = MathUtils.lerp(10, -8, entryEase); 
            targetFOV = MathUtils.lerp(45, 110, entryEase); 
        } else if (exitProgress > 0) {
            targetCamY = MathUtils.lerp(5, 0, exitEase);
            targetCamZ = 10;
            targetFOV = MathUtils.lerp(45, 140, exitEase);
        }

        camera.position.set(0, targetCamY, targetCamZ);
        camera.fov = targetFOV;
        camera.lookAt(_cameraTarget);
        camera.updateProjectionMatrix();

        trackGroup.position.z = MathUtils.lerp(travelZ, _cameraTarget.z, exitEase);
        trackGroup.scale.setScalar(MathUtils.lerp(1, 0.0001, exitEase));

        const dissolveOpacity = 1 - MathUtils.clamp((exitProgress - 0.7) / 0.3, 0, 1);
        for (const mat of trackMaterials) {
            mat.opacity = dissolveOpacity * (1 - entryEase);
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
            const elapsed = performance.now() - flashStartTime;
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
                targetProgress = 1; 
            }
        } else if (!isFlashSequenceComplete) {
            apparitionMaterial.opacity = 0;
        }
        
        renderer.render(scene, camera);
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

        targetProgress = 0;
        renderedProgress = 0;
        isFlashSequenceActive = false;
        isFlashSequenceComplete = false;
        flashStartTime = 0;

        window.removeEventListener('resize', resize);

        const apparitionMaterial = apparitionSprite.material as SpriteMaterial;
        apparitionMaterial.map?.dispose();
        apparitionMaterial.dispose();

        trackGroup.traverse((child) => {
            if ((child as Mesh).isMesh) {
                const mesh = child as Mesh;
                mesh.geometry.dispose();
                Array.isArray(mesh.material) ? mesh.material.forEach(m => m.dispose()) : mesh.material.dispose();
            }
        });
        
        renderer.dispose();
    };

    start();
    return { start, stop, destroy, resize };
}