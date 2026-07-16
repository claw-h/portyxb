import { Vector3, WebGLRenderer, ACESFilmicToneMapping, FogExp2, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Mesh, PlaneGeometry, Group } from 'three';
import { createNonEuclideanMaterial } from '../materials/NonEuclideanMaterial';
import type { LoopController } from '../utils/canvas';

// ─── Zero-Allocation Math Objects ─────────────────────────────
// Pre-allocate temporary vectors outside the render loop to prevent 
// garbage collection stutter during scroll/animation.
const _cameraTarget = new Vector3(0, 0, -10);

export function setupBiomeSphere(): LoopController | null {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-biome-canvas]');
    
    if (!canvas) {
        console.warn('BiomeSphere: Canvas not found. Aborting initialization.');
        return null;
    }

    // ─── 1. Core Engine Setup ─────────────────────────────────
    const renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false, // Assuming custom post-processing or high-density screens
        powerPreference: 'high-performance'
    });
    
    // Cap pixel ratio to save fill rate on ultra-HD screens while maintaining crispness
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    const scene = new Scene();
    scene.fog = new FogExp2(0x141822, 0.12);
    
    // Position camera looking straight down the -Z axis.
    // The vertex shader will eventually wrap the track *beneath* this view.
    const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    camera.lookAt(_cameraTarget);

    // ─── 2. The Z-Track Architecture ──────────────────────────
    // This master group slides linearly along the Z-axis based on scroll.
    // Our custom NonEuclideanMaterial will warp everything inside this globally.
    const trackGroup = new Group();
    scene.add(trackGroup);

    // Distance between each biome's center on the flat Z-axis
    const BIOME_SPACING = 60; 
    
    // Placeholder configuration for the 4 biomes
    const biomes = [
        { name: 'New York',    color: 0x222222 },
        { name: 'Forest',      color: 0x1B3320 },
        { name: 'Western',     color: 0x5C4033 },
        { name: 'Night Canyon',color: 0x111116 }
    ];

    // Scaffold temporary planes to represent our flat modular diorama strips.
    // We will inject the Non-Euclidean shader into these materials in the next step.
    biomes.forEach((biome, index) => {
        // High segment count (64x64) is REQUIRED for smooth vertex bending.
        // Without it, the sphere will look jagged and low-poly.
        const geo = new PlaneGeometry(40, 60, 64, 64); 
        geo.rotateX(-Math.PI / 2); // Lay flat on the X/Z plane
        
        // Swap MeshStandardMaterial for our custom factory
        const mat = createNonEuclideanMaterial({ 
            color: biome.color,
            roughness: 0.8,
            metalness: 0.2,
            wireframe: true // ⬅️ I HIGHLY recommend keeping this true for 5 minutes so you can see the math working
        });
        
        const mesh = new Mesh(geo, mat);
        mesh.position.z = -(index * BIOME_SPACING);
        
        trackGroup.add(mesh);
    });

    // ─── 3. Lighting ──────────────────────────────────────────
    const ambientLight = new AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const dirLight = new DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // ─── 4. Window Resizing ───────────────────────────────────
    const resize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    
    window.addEventListener('resize', resize);
    resize(); // Force initial sizing

// ─── 5. Render Loop Management ────────────────────────────
    let animationFrameId: number;
    let isDestroyed = false;
    let isRunning = false;

    const tick = () => {
        if (!isRunning || isDestroyed) return;
        
        // Schedule next frame
        animationFrameId = requestAnimationFrame(tick);

        // 🚧 Incoming: Uniform updates and track movement will go here

        renderer.render(scene, camera);
    };

    const start = () => {
        if (isRunning) return; // Prevent duplicate loops
        isRunning = true;
        tick();
    };

    const stop = () => {
        isRunning = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    };

    // ─── 6. Hard Cleanup ──────────────────────────────────────
    const destroy = () => {
        isDestroyed = true;
        stop(); // Ensure the loop is halted
        
        window.removeEventListener('resize', resize);

        // Aggressive VRAM teardown
        trackGroup.traverse((child) => {
            if ((child as Mesh).isMesh) {
                const mesh = child as Mesh;
                mesh.geometry.dispose();
                
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        });
        
        renderer.dispose();
    };

    // Auto-start the scene upon initialization
    start();

    // Match the strict LoopController interface exactly
    return { start, stop, destroy, resize };
}