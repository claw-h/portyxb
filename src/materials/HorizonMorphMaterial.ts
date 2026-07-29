import { ShaderMaterial, CanvasTexture, RepeatWrapping, DoubleSide, Color } from 'three';

export function createHorizonTextures(): CanvasTexture[] {
    const width = 1024;
    const height = 256;

    // 1. Forest Horizon
    const forestCanvas = document.createElement('canvas');
    forestCanvas.width = width; forestCanvas.height = height;
    const fCtx = forestCanvas.getContext('2d')!;
    fCtx.fillStyle = '#0a1d12'; // Base dark
    fCtx.fillRect(0, 0, width, height);
    for (let i = 0; i < 50; i++) {
        fCtx.fillStyle = `rgba(16, 40, 25, ${0.5 + Math.random()*0.5})`;
        const cx = Math.random() * width;
        const cy = height - Math.random() * 80;
        const r = 20 + Math.random() * 80;
        fCtx.beginPath();
        fCtx.arc(cx, cy, r, 0, Math.PI * 2);
        fCtx.fill();
        // Trees
        fCtx.fillStyle = '#06120b';
        fCtx.beginPath();
        fCtx.moveTo(cx, cy - r*1.5);
        fCtx.lineTo(cx - 15, cy);
        fCtx.lineTo(cx + 15, cy);
        fCtx.fill();
    }
    const forestTex = new CanvasTexture(forestCanvas);
    forestTex.wrapS = RepeatWrapping; forestTex.wrapT = RepeatWrapping;

    // 2. Canyon Horizon
    const canyonCanvas = document.createElement('canvas');
    canyonCanvas.width = width; canyonCanvas.height = height;
    const cCtx = canyonCanvas.getContext('2d')!;
    const canyonGrad = cCtx.createLinearGradient(0, 0, 0, height);
    canyonGrad.addColorStop(0, '#5C4033'); // Sky tint
    canyonGrad.addColorStop(1, '#2a1208'); // Dark base
    cCtx.fillStyle = canyonGrad;
    cCtx.fillRect(0, 0, width, height);
    
    cCtx.fillStyle = '#1d0b04';
    let cx = 0;
    while(cx < width) {
        const w = 40 + Math.random() * 80;
        const h = 50 + Math.random() * 120;
        cCtx.fillRect(cx, height - h, w, h);
        cx += w + (Math.random() * 20);
    }
    const canyonTex = new CanvasTexture(canyonCanvas);
    canyonTex.wrapS = RepeatWrapping; canyonTex.wrapT = RepeatWrapping;

    // 3. City Horizon
    const cityCanvas = document.createElement('canvas');
    cityCanvas.width = width; cityCanvas.height = height;
    const ctCtx = cityCanvas.getContext('2d')!;
    ctCtx.fillStyle = '#11131a';
    ctCtx.fillRect(0, 0, width, height);
    
    let ctxX = 0;
    while (ctxX < width) {
        const bw = 20 + Math.random() * 40;
        const bh = 80 + Math.random() * 150;
        ctCtx.fillStyle = '#080a0f'; // Dark silhouette
        ctCtx.fillRect(ctxX, height - bh, bw, bh);
        
        // Windows
        ctCtx.fillStyle = '#ffaa33';
        for(let wy = height - bh + 10; wy < height - 10; wy += 15) {
            for(let wx = ctxX + 5; wx < ctxX + bw - 10; wx += 10) {
                if (Math.random() > 0.6) {
                    ctCtx.fillRect(wx, wy, 4, 8);
                }
            }
        }
        ctxX += bw + (Math.random() * 10);
    }
    const cityTex = new CanvasTexture(cityCanvas);
    cityTex.wrapS = RepeatWrapping; cityTex.wrapT = RepeatWrapping;

    // 4. Savanna Horizon
    const savannaCanvas = document.createElement('canvas');
    savannaCanvas.width = width; savannaCanvas.height = height;
    const sCtx = savannaCanvas.getContext('2d')!;
    const savGrad = sCtx.createLinearGradient(0, 0, 0, height);
    savGrad.addColorStop(0, '#7a6141');
    savGrad.addColorStop(1, '#2c1e10');
    sCtx.fillStyle = savGrad;
    sCtx.fillRect(0, 0, width, height);
    
    // Acacia silhouettes
    for(let i=0; i<15; i++) {
        const ax = Math.random() * width;
        const ay = height - (20 + Math.random() * 40);
        sCtx.fillStyle = '#110c08';
        sCtx.fillRect(ax - 2, ay, 4, height - ay); // trunk
        sCtx.beginPath();
        sCtx.ellipse(ax, ay, 30 + Math.random()*20, 8 + Math.random()*5, 0, 0, Math.PI*2);
        sCtx.fill();
    }
    const savannaTex = new CanvasTexture(savannaCanvas);
    savannaTex.wrapS = RepeatWrapping; savannaTex.wrapT = RepeatWrapping;

    return [forestTex, canyonTex, cityTex, savannaTex];
}


export function createHorizonMaterial() {
    return new ShaderMaterial({
        uniforms: {
            tDiffuseCurrent: { value: null },
            tDiffuseNext: { value: null },
            uProgress: { value: 0.0 }, // 0 to 1
            uTime: { value: 0.0 },
            uFogColor: { value: new Color() }
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            void main() {
                vUv = uv;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuseCurrent;
            uniform sampler2D tDiffuseNext;
            uniform float uProgress;
            uniform float uTime;
            uniform vec3 uFogColor;
            varying vec2 vUv;
            varying vec3 vWorldPosition;

            // 2D Random
            float random(in vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            // 2D Noise based on Morgan McGuire
            float noise(in vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = random(i);
                float b = random(i + vec2(1.0, 0.0));
                float c = random(i + vec2(0.0, 1.0));
                float d = random(i + vec2(1.0, 1.0));
                vec2 u = f*f*(3.0-2.0*f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            void main() {
                // We want to combine them: organic -> matrix -> black -> matrix -> organic
                
                // Dissolve Threshold (synced with geometry — everything goes together)
                float dissolveState = 0.0;
                if (uProgress >= 0.35 && uProgress <= 0.45) {
                    dissolveState = (uProgress - 0.35) / 0.1;
                } else if (uProgress > 0.45 && uProgress < 0.55) {
                    dissolveState = 1.0;
                } else if (uProgress >= 0.55 && uProgress <= 0.65) {
                    dissolveState = 1.0 - (uProgress - 0.55) / 0.1;
                }
                
                // UV Distortion for tearing effect
                float tearNoise = noise(vUv * 15.0 - uTime * 0.2);
                float distortionStrength = sin(uProgress * 3.14159) * 0.15;
                vec2 distortedUv = vUv + vec2(tearNoise - 0.5) * distortionStrength;
                
                // Sample textures with distortion
                vec4 colorCurrent = texture2D(tDiffuseCurrent, distortedUv);
                vec4 colorNext = texture2D(tDiffuseNext, distortedUv);

                // Blend horizons with fog color at the bottom to feather it out
                float feather = smoothstep(0.0, 0.2, vUv.y); 
                float topFade = smoothstep(1.0, 0.8, vUv.y);

                colorCurrent.a *= feather * topFade;
                colorNext.a *= feather * topFade;

                colorCurrent.rgb = mix(uFogColor, colorCurrent.rgb, colorCurrent.a);
                colorNext.rgb = mix(uFogColor, colorNext.rgb, colorNext.a);

                // UE-style Emissive Particles (Sparks)
                // High frequency noise for particles
                float particleNoise = noise(vUv * 80.0 + uTime * 1.5);
                float sparkIntensity = smoothstep(0.7, 0.95, particleNoise) * sin(dissolveState * 3.14159) * 2.5;
                
                // Subtle crossfade
                // Since there's a black gap, we can just crossfade instantly at uProgress = 0.5 because it's completely black!
                float fade = step(0.5, uProgress);
                vec3 baseColor = mix(colorCurrent.rgb, colorNext.rgb, fade);
                
                // Fade out the base color into true black using dissolveState
                // When dissolveState = 1.0, it is fully black.
                baseColor *= (1.0 - dissolveState);
                
                // Add glowing sparks (Cyan / Blue energy) - they peak as it dissolves
                vec3 sparkColor = vec3(0.1, 0.8, 1.0) * sparkIntensity;
                
                // Final color assembly
                vec4 finalColor = vec4(baseColor + sparkColor, 1.0);

                // Blend into fog at the top and bottom to hide the cylinder geometry edges
                finalColor.rgb = mix(uFogColor, finalColor.rgb, feather * topFade);

                gl_FragColor = finalColor;
            }
        `
    });
}
