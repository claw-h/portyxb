import * as THREE from 'three';

export const spotlightConfig = {
	pos: new THREE.Vector3(0, 0, 0),
	radius: 3.0,
	intensity: 0.8
};

export const spotlightUniforms = {
	uScannerPos: { value: spotlightConfig.pos },
	uScannerRadius: { value: spotlightConfig.radius },
	uScannerIntensity: { value: spotlightConfig.intensity }
};

export const injectSpotlightReveal = (shader: any, extraUniforms: any = null, isPage: boolean = false) => {
	shader.uniforms.uScannerPos = spotlightUniforms.uScannerPos;
	shader.uniforms.uScannerRadius = spotlightUniforms.uScannerRadius;
	shader.uniforms.uScannerIntensity = spotlightUniforms.uScannerIntensity;

    if (extraUniforms) {
        for (const key in extraUniforms) {
            shader.uniforms[key] = extraUniforms[key];
        }
    }

    let extraVertexUniforms = `
        varying vec3 vWorldPos;
    `;
    let extraVertexLogic = `
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `;

    if (extraUniforms && extraUniforms.uBendAmount) {
        extraVertexUniforms += `\nuniform float uBendAmount;`;
        extraVertexLogic += `
            float normalizedX = transformed.x / 12.0; 
            
            // Bow outward toward the camera (+Z)
            transformed.z += sin(normalizedX * 3.14159) * uBendAmount * 3.0; 
            
            // Contract X-axis to preserve physical arc-length (Tension effect)
            transformed.x -= (1.0 - cos(normalizedX * 3.14159)) * uBendAmount * 1.5;
        `;
    }

    // Physical vertex displacement from spotlight (dimple effect)
    extraVertexUniforms += `
        uniform vec3 uScannerPos;
        uniform float uScannerRadius;
        uniform float uScannerIntensity;
    `;
    extraVertexLogic += `
        float spotDist = distance(vWorldPos, uScannerPos);
        float spotInfluence = 1.0 - smoothstep(0.0, uScannerRadius * 0.6, spotDist);
        spotInfluence = pow(spotInfluence, 2.0) * uScannerIntensity;
        // Push vertices deeply inward (along -Z) to make the monoliths sink away from the light
        transformed.z -= spotInfluence * 4.0;
    `;

	shader.vertexShader = `
		${extraVertexUniforms}
        varying vec2 vMyUv;
		${shader.vertexShader}
	`.replace(
		`#include <project_vertex>`,
		`#include <project_vertex>\n${extraVertexLogic}\n vMyUv = uv;`
	);

	shader.fragmentShader = `
		uniform vec3 uScannerPos;
		uniform float uScannerRadius;
		uniform float uScannerIntensity;
        ${isPage ? `
        uniform sampler2D tGeometry;
        uniform float uTime;
        ` : ''}
        
        // --- Noise Functions for Caustics/Aurora ---
        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }
        float noise(vec2 st) {
            vec2 i = floor(st);
            vec2 f = fract(st);
            float a = random(i);
            float b = random(i + vec2(1.0, 0.0));
            float c = random(i + vec2(0.0, 1.0));
            float d = random(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

		varying vec3 vWorldPos;
        varying vec2 vMyUv;
		${shader.fragmentShader}
	`.replace(
		`#include <dithering_fragment>`,
		`
		#include <dithering_fragment>
        
        ${isPage ? `
        // 1. Dual Texture Processing (Living Canvas)
        vec2 center = vec2(0.7, 0.6); // Center of Astrolabe
        vec2 geomUv = vMyUv - center;
        float angle = uTime * 0.05; // Slow rotation
        float s = sin(angle);
        float c = cos(angle);
        mat2 rot = mat2(c, -s, s, c);
        geomUv = (rot * geomUv) + center;
        
        vec4 geomCol = texture2D(tGeometry, geomUv);
        
        // Microgrid background
        vec2 microGrid = fract(vMyUv * 80.0);
        float microLine = step(0.9, microGrid.x) + step(0.9, microGrid.y);
        microLine = clamp(microLine, 0.0, 1.0);
        
        // 2. Back-Face Culling
        if (!gl_FrontFacing) {
            // Let text bleed through slightly for realistic paper feel
            gl_FragColor.rgb *= 0.15;
            gl_FragColor.rgb += geomCol.rgb * 0.15;
        } else {
            // Front side gets both text and geometry
            gl_FragColor.rgb += geomCol.rgb * 0.5; // Subtle geometry
        }
        
        // Add microgrid to the physical paper (both sides)
        gl_FragColor.rgb += (vec3(0.1, 0.15, 0.25) * microLine * 0.15);
        ` : ''}

        // 3. Volumetric Spotlight & Caustics
		float shaderDist = distance(vWorldPos, uScannerPos);
        float causticNoise = noise(vWorldPos.xy * 2.0);
        causticNoise += noise(vWorldPos.xy * 4.0) * 0.5;

		vec3 volumetricColor = vec3(0.48, 0.82, 1.0);
		float volumetricFalloff = pow(1.0 - clamp(shaderDist / uScannerRadius, 0.0, 1.0), 2.5);
        
		gl_FragColor.rgb += volumetricColor * volumetricFalloff * uScannerIntensity * (0.15 + causticNoise * 0.2);
        gl_FragColor.rgb *= 1.0 + (causticNoise * 0.3 * (1.0 - volumetricFalloff));
		`
	);
};

const createProceduralNoiseTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 60000; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
            ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
};

let sharedNoiseTexture: THREE.CanvasTexture | null = null;

export const createDossierMaterials = () => {
    if (!sharedNoiseTexture) {
        sharedNoiseTexture = createProceduralNoiseTexture();
    }

    // 1. Solid base - OPAQUE physical material for perfect depth sorting
    const solidMaterial = new THREE.MeshPhysicalMaterial({
		color: 0x040810, // Very dark, matte blue-black paper
		emissive: 0x000000,
		transparent: false, 
		roughness: 0.8, // Matte paper finish
		metalness: 0.1, 
        bumpMap: sharedNoiseTexture,
        bumpScale: 0.005,
        clearcoat: 0.0,
        clearcoatRoughness: 0.0,
		side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1, // Push solid back slightly
        polygonOffsetUnits: 1
	});

    // 2. Edges - Crisp Tron outlines
	const edgeMaterial = new THREE.LineBasicMaterial({
		color: 0x82d6ff,
		transparent: true,
		opacity: 0.5,
        depthTest: true
	});

    return { solidMaterial, edgeMaterial };
};

export const createAnimusMaterial = () => {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uColor: { value: new THREE.Color(0x82d6ff) },
            uBendAmount: { value: 0.0 }
        },
        vertexShader: `
            uniform float uBendAmount;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vec3 transformed = position;
                
                float normalizedX = transformed.x / 12.0; 
                
                // Bow outward toward the camera (+Z)
                transformed.z += sin(normalizedX * 3.14159) * uBendAmount * 3.0; 
                
                // Contract X-axis to preserve physical arc-length (Tension effect)
                transformed.x -= (1.0 - cos(normalizedX * 3.14159)) * uBendAmount * 1.5;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            varying vec2 vUv;
            
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }
            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = random(i);
                float b = random(i + vec2(1.0, 0.0));
                float c = random(i + vec2(0.0, 1.0));
                float d = random(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            void main() {
                vec2 pos = vUv * 4.0;
                float n = noise(pos + uTime * 0.5);
                n += noise(pos * 2.0 - uTime * 0.3) * 0.5;
                
                float dist = distance(vUv, vec2(0.5));
                float glow = smoothstep(0.9, 0.0, dist);
                
                vec3 baseColor = vec3(0.01, 0.02, 0.05); 
                vec3 energyColor = mix(uColor * 0.05, uColor * 0.3, clamp(n * glow, 0.0, 1.0));
                
                // Add a bright core
                float core = smoothstep(0.3, 0.0, dist) * n;
                energyColor += vec3(0.5, 0.6, 0.8) * clamp(core, 0.0, 1.0) * 0.3;

                gl_FragColor = vec4(baseColor + energyColor, 1.0);
            }
        `,
        transparent: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 2, // Push it furthest back so it never clips through the project pages
        polygonOffsetUnits: 2
    });
};
