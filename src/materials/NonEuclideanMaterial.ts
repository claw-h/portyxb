import { MeshStandardMaterial, type MeshStandardMaterialParameters, Material } from 'three';

export function applyNonEuclideanCurve(material: Material, extrusionFactor = 0.0) {
    material.userData = {
        uExtrusionFactor: { value: extrusionFactor }
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uExtrusionFactor = material.userData.uExtrusionFactor;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uExtrusionFactor;
            `
        );

        // Copy/paste the exact True Sphere projection math you already wrote
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vec4 mvPosition = vec4( transformed, 1.0 );
            
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
    };
}


export function createNonEuclideanMaterial(parameters: MeshStandardMaterialParameters) {
    const material = new MeshStandardMaterial(parameters);
    
    material.userData = {
        uExtrusionFactor: { value: 0.0 }
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uExtrusionFactor = material.userData.uExtrusionFactor;

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

        // 3. FRAGMENT SHADER: Receive the custom varying
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec2 vPlaneCoord;
            `
        );

        // 4. FRAGMENT SHADER: Draw the procedural grid on top of the PBR material
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #include <map_fragment>
            
            // Create a grid pattern using modulo arithmetic on the local coordinates.
            // Multiplying by 0.5 creates a 2-unit grid size across the 40x60 plane.
            // fwidth ensures the lines stay a consistent pixel-width regardless of distance/scale.
            vec2 grid = abs(fract(vPlaneCoord * 0.5) - 0.5) / fwidth(vPlaneCoord * 0.5);
            float line = min(grid.x, grid.y);
            
            // Invert so the line is 1.0 (bright) and empty space is 0.0 (dark)
            float gridLine = 1.0 - min(line, 1.0);
            
            // Define the glowing grid color (Neon Blue driven past 1.0 for bloom)
            vec3 gridColor = vec3(0.0, 0.8, 1.0) * 2.0; 
            
            // Mix the glowing grid directly over the base diffuse color
            diffuseColor.rgb = mix(diffuseColor.rgb, gridColor, gridLine * 0.8);
            `
        );
    };

    return material;
}