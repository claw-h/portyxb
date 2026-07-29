import { MeshStandardMaterial, type MeshStandardMaterialParameters, Material } from 'three';

export function applyNonEuclideanCurve(material: Material, extrusionFactor = 0.0) {
    material.userData = {
        uExtrusionFactor: { value: extrusionFactor },
        uMorphState: { value: 0.0 }
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uExtrusionFactor = material.userData.uExtrusionFactor;
        shader.uniforms.uWetness = material.userData.uWetness;
        shader.uniforms.uMorphState = material.userData.uMorphState;
        shader.uniforms.uTime = { value: 0.0 }; // Will be updated globally if needed, or we can use a local time if we pass it. For now let's just add it.

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uExtrusionFactor;
            varying vec2 vPlaneCoord;
            `
        );

        // Copy/paste the exact True Sphere projection math you already wrote
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vec4 mvPosition = vec4( transformed, 1.0 );
            vPlaneCoord = transformed.xz;
            
            #ifdef USE_BATCHING
                mvPosition = batchingMatrix * mvPosition;
            #endif
            #ifdef USE_INSTANCING
                mvPosition = instanceMatrix * mvPosition;
            #endif
            
            mvPosition = modelViewMatrix * mvPosition;
            
            float PLANET_RADIUS = 200.0; 
            float distXZ = length(mvPosition.xz);
            float theta = min(distXZ / PLANET_RADIUS, 1.5708);            
            
            float currentY = mvPosition.y;
            mvPosition.y = (currentY + PLANET_RADIUS) * cos(theta) - PLANET_RADIUS;
            
            if (distXZ > 0.0) {
                float squeeze = (PLANET_RADIUS * sin(theta)) / distXZ;
                mvPosition.x *= squeeze;
                mvPosition.z *= squeeze;
            }
            
            float distanceFlare = smoothstep(PLANET_RADIUS * 0.4, 0.0, distXZ);
            mvPosition.y += (uExtrusionFactor * distanceFlare * 20.0);
            
            gl_Position = projectionMatrix * mvPosition;
            `
        );

        // Inject Morph logic into Fragment Shader for imported materials
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uMorphState;
            varying vec2 vPlaneCoord;
            
            // 2D Random
            float randomMorph(in vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            // 2D Noise
            float noiseMorph(in vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = randomMorph(i);
                float b = randomMorph(i + vec2(1.0, 0.0));
                float c = randomMorph(i + vec2(0.0, 1.0));
                float d = randomMorph(i + vec2(1.0, 1.0));
                vec2 u = f*f*(3.0-2.0*f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `
            #include <dithering_fragment>
            if (uMorphState > 0.0) {
                float n = noiseMorph(vPlaneCoord * 0.5);
                // Discard pixels that fall below the morph state threshold
                if (n < uMorphState) {
                    discard;
                }
                // Add glowing edges
                float sparkEdge = smoothstep(uMorphState, uMorphState + 0.1, n) - smoothstep(uMorphState + 0.05, uMorphState + 0.15, n);
                gl_FragColor.rgb += vec3(0.1, 0.8, 1.0) * sparkEdge * 3.0;
            }
            `
        );
    };
}


export function createNonEuclideanMaterial(parameters: MeshStandardMaterialParameters) {
    const material = new MeshStandardMaterial(parameters);
    
    material.userData = {
        uExtrusionFactor: { value: 0.0 },
        uWetness: { value: 0.0 },
        uMorphState: { value: 0.0 }
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uExtrusionFactor = material.userData.uExtrusionFactor;
        shader.uniforms.uWetness = material.userData.uWetness;
        shader.uniforms.uMorphState = material.userData.uMorphState;

        // 1. VERTEX SHADER: Inject our custom uniform and varying
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uExtrusionFactor;
            varying vec2 vPlaneCoord;
            `
        );

        // 2. VERTEX SHADER: Hijack projection for the sphere and capture local coordinates
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vec4 mvPosition = vec4( transformed, 1.0 );
            
            // Capture the raw XZ coordinates before world transforms to anchor the grid to the mesh
            vPlaneCoord = transformed.xz;
            
            #ifdef USE_BATCHING
                mvPosition = batchingMatrix * mvPosition;
            #endif
            #ifdef USE_INSTANCING
                mvPosition = instanceMatrix * mvPosition;
            #endif
            
            // 1. Get position relative to the camera lens
            mvPosition = modelViewMatrix * mvPosition;
            
            // 2. TRUE SPHERICAL WRAP VARIABLES
            // Massive radius prevents the track from looping inside-out
            float PLANET_RADIUS = 200.0; 
            
            // Distance from the camera on the flat XZ plane
            float distXZ = length(mvPosition.xz);
            
            // Map distance to an angle around our massive sphere
            float theta = min(distXZ / PLANET_RADIUS, 1.5708);            
            
            // 3. APPLY TRUE SPHERE MATH
            // Curve the Y down into the horizon
            float currentY = mvPosition.y;
            mvPosition.y = (currentY + PLANET_RADIUS) * cos(theta) - PLANET_RADIUS;
            
            // Pull the X (width) and Z (depth) inward to wrap the edges
            if (distXZ > 0.0) {
                float squeeze = (PLANET_RADIUS * sin(theta)) / distXZ;
                mvPosition.x *= squeeze;
                mvPosition.z *= squeeze;
            }
            
            // 4. TENSION FLARE
            // Bulge upwards aggressively when near the camera (distXZ near 0)
            float distanceFlare = smoothstep(PLANET_RADIUS * 0.4, 0.0, distXZ);
            mvPosition.y += (uExtrusionFactor * distanceFlare * 20.0);
            
            // 5. Final Screen Projection
            gl_Position = projectionMatrix * mvPosition;
            `
        );



        // Inject Wetness uniforms into Fragment Shader
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uWetness;
            uniform float uMorphState;
            varying vec2 vPlaneCoord;
            
            // 2D Random
            float randomMorph(in vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            // 2D Noise
            float noiseMorph(in vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = randomMorph(i);
                float b = randomMorph(i + vec2(1.0, 0.0));
                float c = randomMorph(i + vec2(0.0, 1.0));
                float d = randomMorph(i + vec2(1.0, 1.0));
                vec2 u = f*f*(3.0-2.0*f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }
            `
        );

        // Dynamically reduce roughness to simulate water
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `
            #include <roughnessmap_fragment>
            roughnessFactor = mix(roughnessFactor, 0.05, uWetness);
            `
        );

        // Dynamically increase metalness to simulate water reflectivity
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <metalnessmap_fragment>',
            `
            #include <metalnessmap_fragment>
            metalnessFactor = mix(metalnessFactor, 0.8, uWetness);
            
            // Darken diffuse slightly when wet
            diffuseColor.rgb *= mix(1.0, 0.6, uWetness);
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `
            #include <dithering_fragment>
            if (uMorphState > 0.0) {
                float n = noiseMorph(vPlaneCoord * 0.5);
                // Discard pixels that fall below the morph state threshold
                if (n < uMorphState) {
                    discard;
                }
                // Add glowing edges
                float sparkEdge = smoothstep(uMorphState, uMorphState + 0.1, n) - smoothstep(uMorphState + 0.05, uMorphState + 0.15, n);
                gl_FragColor.rgb += vec3(0.1, 0.8, 1.0) * sparkEdge * 3.0;
            }
            `
        );
    };

    return material;
}