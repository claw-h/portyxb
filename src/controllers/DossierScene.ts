import * as THREE from 'three';
import { createLoopController } from '../utils/canvas';

function createAsciiAtlas() {
    const chars = '@%#*+=-:. ';
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '80px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < chars.length; i++) {
        ctx.fillText(chars[i], i * 100 + 50, 50);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    return tex;
}

export async function setupDossierScene() {
    const zone = document.querySelector('.dossier-zone');
    const canvas = document.getElementById('dossier-canvas') as HTMLCanvasElement | null;
    
    if (!zone || !canvas) return { destroy: () => {} };

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020305);
    
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 35;

    const atlasTexture = createAsciiAtlas();
    const imageTexture = new THREE.Texture();
    
    const shaderMat = new THREE.ShaderMaterial({
        uniforms: {
            tAtlas: { value: atlasTexture },
            tImage: { value: imageTexture },
            uTime: { value: 0 },
            uMorphProgress: { value: 1.0 },
            uColor: { value: new THREE.Color(0x82d6ff) },
            uMousePos: { value: new THREE.Vector3(9999, 9999, 0) },
            uRadius: { value: 12.0 },
            uArchiveOpen: { value: 0.0 }
        },
        vertexShader: `
            attribute vec2 aInstanceUv;
            
            uniform sampler2D tImage;
            uniform float uMorphProgress;
            uniform float uTime;
            uniform float uArchiveOpen;
            
            varying vec2 vUv;
            varying float vBrightness;
            varying vec3 vColor;
            varying vec3 vWorldPos;

            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
                vUv = uv;
                
                vec4 imgCol = texture2D(tImage, aInstanceUv);
                float brightness = dot(imgCol.rgb, vec3(0.299, 0.587, 0.114));
                vColor = imgCol.rgb;
                
                float n = random(aInstanceUv + floor(uTime * 15.0));
                float activeBrightness = mix(n, brightness, smoothstep(0.0, 1.0, uMorphProgress));
                vBrightness = activeBrightness;

                vec3 transformed = position;
                float zExtrusion = (activeBrightness * 3.0) - 1.5;
                float explode = mix(n * 20.0 - 10.0, zExtrusion, smoothstep(0.0, 1.0, uMorphProgress));
                transformed.z += explode;

                vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
                // Ocean-like Layered Split:
                vec4 instanceCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                float splitDir = sign(instanceCenter.y);
                if (splitDir == 0.0) splitDir = 1.0;
                
                // Darker pixels (valleys) pull away first. Brighter pixels (peaks) drag behind.
                float brightnessDelay = activeBrightness * 0.15;
                // Add a subtle spatial wave across X
                float waveDelay = (sin(instanceCenter.x * 0.2) * 0.5 + 0.5) * 0.1;
                
                float totalDelay = brightnessDelay + waveDelay;
                
                // Map global uArchiveOpen [0, 1] to local progress
                float localProgress = smoothstep(totalDelay, totalDelay + 0.75, uArchiveOpen);
                
                // Smooth easing curve
                float easedSplit = smoothstep(0.0, 1.0, localProgress);
                
                worldPos.y += splitDir * (easedSplit * 40.0);
                
                vWorldPos = worldPos.xyz;
                
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D tAtlas;
            uniform vec3 uColor;
            uniform vec3 uMousePos;
            uniform float uRadius;
            
            varying vec2 vUv;
            varying float vBrightness;
            varying vec3 vColor;
            varying vec3 vWorldPos;

            void main() {
                float dist = distance(vWorldPos.xy, uMousePos.xy);
                float wetMix = 1.0 - smoothstep(0.0, uRadius, dist);
                wetMix = pow(wetMix, 1.5);
                
                float charIndex = floor((1.0 - vBrightness) * 9.9);
                charIndex = clamp(charIndex, 0.0, 9.0);
                vec2 atlasUv = vec2((charIndex + vUv.x) / 10.0, 1.0 - vUv.y);
                vec4 asciiCol = texture2D(tAtlas, atlasUv);
                
                float depthFog = smoothstep(0.1, 0.8, vBrightness);
                
                vec3 dryBg = vec3(0.01, 0.015, 0.02);
                vec3 dryText = uColor * (vBrightness + 0.2) * 1.5;
                vec3 dryColor = mix(dryBg, dryText, asciiCol.r * depthFog);
                
                vec3 wetBg = vColor * 0.4;
                vec3 wetText = vColor * 2.0;
                vec3 wetColor = mix(wetBg, wetText, asciiCol.r);
                
                vec3 finalColor = mix(dryColor, wetColor, wetMix);
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        transparent: false
    });

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // Image texture requires mirrored wrapping to infinitely extend off-screen
    imageTexture.wrapS = THREE.MirroredRepeatWrapping;
    imageTexture.wrapT = THREE.MirroredRepeatWrapping;

    const cols = 350;
    const rows = 250;
    const count = cols * rows;
    
    // Tiny mathematical planes for ultra-high resolution
    const planeGeo = new THREE.PlaneGeometry(0.14, 0.14);
    const instanceUvs = new Float32Array(count * 2);
    const instancedMesh = new THREE.InstancedMesh(planeGeo, shaderMat, count);
    
    const dummy = new THREE.Object3D();
    let i = 0;
    
    const spacingX = 0.16;
    const spacingY = 0.16;
    const totalWidth = cols * spacingX;
    const totalHeight = rows * spacingY;

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const px = (x * spacingX) - (totalWidth / 2);
            const py = ((rows - 1 - y) * spacingY) - (totalHeight / 2);
            
            dummy.position.set(px, py, 0);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
            
            instanceUvs[i * 2] = (px / 40.0) + 0.5;
            instanceUvs[i * 2 + 1] = (py / 30.0) + 0.5;
            
            i++;
        }
    }
    
    planeGeo.setAttribute('aInstanceUv', new THREE.InstancedBufferAttribute(instanceUvs, 2));
    masterGroup.add(instancedMesh);
    
    // Ghost Background Plane for the Deep Bleed
    const bgMat = new THREE.ShaderMaterial({
        uniforms: {
            tImage: { value: imageTexture },
            uMorphProgress: { value: 1.0 },
            uMousePos: { value: new THREE.Vector3(9999, 9999, 0) },
            uRadius: { value: 12.0 },
            uArchiveOpen: { value: 0.0 }
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPos;
            void main() {
                vUv = vec2(position.x / 40.0 + 0.5, position.y / 30.0 + 0.5);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D tImage;
            uniform float uMorphProgress;
            uniform vec3 uMousePos;
            uniform float uRadius;
            uniform float uArchiveOpen;
            
            varying vec2 vUv;
            varying vec3 vWorldPos;

            void main() {
                float dist = distance(vWorldPos.xy, uMousePos.xy);
                float wetMix = 1.0 - smoothstep(0.0, uRadius * 1.5, dist);
                
                vec4 imgCol = texture2D(tImage, vUv);
                float morphFade = smoothstep(0.7, 1.0, uMorphProgress);
                
                // Fade out background plane when archive opens
                float fade = 1.0 - smoothstep(0.0, 0.5, uArchiveOpen);
                
                gl_FragColor = vec4(imgCol.rgb * wetMix * 0.5 * morphFade, fade);
            }
        `,
        transparent: true,
        depthWrite: false
    });
    const bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(totalWidth, totalHeight), bgMat);
    bgPlane.position.z = -12; // Sit behind the ASCII grid
    masterGroup.add(bgPlane);

    // --- WebGL Liquid Previews & CRT Post-Processing (Phase 1 & 2) ---
    const transparentData = new Uint8Array([0, 0, 0, 0]);
    const emptyTexture = new THREE.DataTexture(transparentData, 1, 1, THREE.RGBAFormat);
    emptyTexture.needsUpdate = true;

    const previewMat = new THREE.ShaderMaterial({
        uniforms: {
            tPreview: { value: emptyTexture },
            uTime: { value: 0 },
            uHoverFade: { value: 0 },
            uMousePos: { value: new THREE.Vector2(99, 99) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                // Subtle breathing scale
                vec3 pos = position;
                pos *= 1.0 + sin(uv.y * 5.0) * 0.01;
                gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tPreview;
            uniform float uTime;
            uniform float uHoverFade;
            uniform vec2 uMousePos;
            
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                
                // Subtle liquid distortion based on time and mouse
                float dist = distance(uv, uMousePos);
                float wave = sin(dist * 15.0 - uTime * 2.0) * 0.02 * smoothstep(0.6, 0.0, dist);
                uv += wave * uHoverFade;
                
                // Chromatic Aberration
                float caShift = 0.02 * uHoverFade * (1.0 + wave * 5.0);
                
                vec4 texR = texture2D(tPreview, uv + vec2(caShift, 0.0));
                vec4 texG = texture2D(tPreview, uv);
                vec4 texB = texture2D(tPreview, uv - vec2(caShift, 0.0));
                
                // Use a generic gradient if texture is missing
                vec3 fallback = vec3(uv.x, uv.y, sin(uTime)*0.5+0.5);
                
                vec3 col = vec3(texR.r, texG.g, texB.b);
                if (texG.a < 0.1) col = fallback; // Safefall
                
                // CRT Scanlines
                float scanline = sin(vUv.y * 600.0) * 0.06;
                col -= scanline;
                
                // Film Grain
                float grain = fract(sin(dot(vUv, vec2(12.9898, 78.233)) + uTime) * 43758.5453) * 0.06;
                col += grain;
                
                // Fade edges smoothly into the void
                float vignette = smoothstep(0.7, 0.1, length(vUv - 0.5));
                col *= vignette;
                
                // Slight color tint to match the site
                col *= vec3(0.8, 0.9, 1.0);
                
                gl_FragColor = vec4(col, uHoverFade * vignette);
            }
        `,
        transparent: true,
        depthWrite: false
    });
    
    // Enormous plane to act as the void backdrop for previews
    const previewPlane = new THREE.Mesh(new THREE.PlaneGeometry(50, 35), previewMat);
    previewPlane.position.z = -15; // Deeper than the ghost plane
    masterGroup.add(previewPlane);

    let targetMorph = 1.0;
    let isFetching = false;
    
    const fetchNewImage = () => {
        if (isFetching) return;
        isFetching = true;
        targetMorph = 0.0;
        
        // Fetch full COLOR photography to fuel the realistic tint and bleed
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `https://picsum.photos/1000/750?random=${Math.random()}`;
        
        img.onload = () => {
            const offscreen = document.createElement('canvas');
            offscreen.width = 1000;
            offscreen.height = 750;
            const ctx = offscreen.getContext('2d')!;
            ctx.drawImage(img, 0, 0, 1000, 750);
            imageTexture.image = offscreen;
            imageTexture.needsUpdate = true;
            targetMorph = 1.0;
            isFetching = false;
        };
        
        img.onerror = () => {
            // If picsum throws a 503 or CORS error, retry immediately
            isFetching = false;
            fetchNewImage();
        };
    };

    fetchNewImage();
    const onClick = () => fetchNewImage();
    window.addEventListener('click', onClick);

    let targetRotX = 0;
    let targetRotY = 0;
    const mouse = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();

    const onMouseMove = (e: MouseEvent) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        
        targetRotX = mouse.y * 0.05;
        targetRotY = mouse.x * 0.08;
    };
    window.addEventListener('mousemove', onMouseMove);

    const onResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    // Blast Door logic
    let targetArchiveOpen = 0.0;
    const onToggleArchive = ((e: CustomEvent) => {
        targetArchiveOpen = e.detail.open ? 1.0 : 0.0;
    }) as EventListener;
    window.addEventListener('toggle-archive', onToggleArchive);

    // Liquid Preview logic
    let targetPreviewHover = 0.0;
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');
    const previewCache = new Map<string, THREE.Texture>();
    
    const onPreviewHover = ((e: CustomEvent) => {
        const url = e.detail.url;
        if (url) {
            targetPreviewHover = 1.0;
            if (previewCache.has(url)) {
                previewMat.uniforms.tPreview.value = previewCache.get(url);
            } else {
                textureLoader.load(url, (tex) => {
                    previewCache.set(url, tex);
                    previewMat.uniforms.tPreview.value = tex;
                });
            }
        } else {
            targetPreviewHover = 0.0;
        }
    }) as EventListener;
    window.addEventListener('project-hover', onPreviewHover);

    const controller = createLoopController(zone, (time: number) => {
        const t = time * 0.001;
        shaderMat.uniforms.uTime.value = t;
        previewMat.uniforms.uTime.value = t;
        
        shaderMat.uniforms.uMorphProgress.value += (targetMorph - shaderMat.uniforms.uMorphProgress.value) * 0.05;
        bgMat.uniforms.uMorphProgress.value = shaderMat.uniforms.uMorphProgress.value;
        
        // Asymmetric animation speeds: Slower elegant ocean open, fast snappy close
        const splitSpeed = targetArchiveOpen > 0.5 ? 0.025 : 0.12;
        shaderMat.uniforms.uArchiveOpen.value += (targetArchiveOpen - shaderMat.uniforms.uArchiveOpen.value) * splitSpeed;
        bgMat.uniforms.uArchiveOpen.value = shaderMat.uniforms.uArchiveOpen.value;

        // Preview fade and mouse uniforms
        previewMat.uniforms.uHoverFade.value += (targetPreviewHover - previewMat.uniforms.uHoverFade.value) * 0.08;
        previewMat.uniforms.uMousePos.value.lerp(new THREE.Vector2(mouse.x * 0.5 + 0.5, mouse.y * 0.5 + 0.5), 0.1);

        masterGroup.rotation.x += (targetRotX - masterGroup.rotation.x) * 0.05;
        masterGroup.rotation.y += (targetRotY - masterGroup.rotation.y) * 0.05;

        // Use Raycaster math plane to find exactly where the mouse intersects the Z=0 plane of the grid
        masterGroup.updateMatrixWorld();
        raycaster.setFromCamera(mouse, camera);
        
        // Z=0 in local space of masterGroup. Simple approximation since rotation is small.
        const worldZ = masterGroup.position.z; 
        const distToPlane = (worldZ - raycaster.ray.origin.z) / raycaster.ray.direction.z;
        if (distToPlane > 0) {
            const hit = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, distToPlane);
            // Smoothly move the reality spotlight
            shaderMat.uniforms.uMousePos.value.lerp(hit, 0.1);
            bgMat.uniforms.uMousePos.value.lerp(hit, 0.1);
        }

        renderer.render(scene, camera);
    });

    // Precompile shaders and upload geometry to GPU now to prevent a massive 
    // freeze/black splash when the IntersectionObserver triggers the first render
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    return {
        destroy: () => {
            controller.destroy();
            window.removeEventListener('resize', onResize);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('click', onClick);
            window.removeEventListener('toggle-archive', onToggleArchive);
            window.removeEventListener('project-hover', onPreviewHover);
            renderer.dispose();
            atlasTexture.dispose();
            imageTexture.dispose();
            shaderMat.dispose();
            bgMat.dispose();
            previewMat.dispose();
            previewPlane.geometry.dispose();
            planeGeo.dispose();
        }
    };
}
