import { MeshStandardMaterial, type MeshStandardMaterialParameters } from 'three';

export function createNonEuclideanMaterial(parameters: MeshStandardMaterialParameters) {
    const material = new MeshStandardMaterial(parameters);
    
    material.userData = {
        uExtrusionFactor: { value: 0.0 }
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

        // We completely hijack the projection to build a True Sphere
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
    };

    return material;
}