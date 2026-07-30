import { MeshBasicMaterial, Color, Mesh } from 'three';
import { applyNonEuclideanCurve } from '../../materials/NonEuclideanMaterial';

export function applyWindSway(mat: any, timeUniforms: any) {
    const originalCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader: any, renderer: any) => {
        if (originalCompile) originalCompile(shader, renderer);

        shader.uniforms.uTime = timeUniforms.uTime;

        shader.vertexShader = `
            uniform float uTime;
            ${shader.vertexShader}
        `.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            
            vec4 windWorldPos = modelMatrix * vec4(position, 1.0);
            
            float treeHeight = max(0.0, position.y);
            float bend = treeHeight * treeHeight * 0.012; 
            
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

export function wrapWireframe(childMesh: Mesh, coreMat: any, wireProps: any, trackMaterials: any[], timeUniforms: any) {
    childMesh.material = coreMat;
    
    let wireColor = new Color(wireProps.color);
    if (wireProps.matchColor && coreMat.color) {
        wireColor.copy(coreMat.color);
        const hsl = { h: 0, s: 0, l: 0 };
        wireColor.getHSL(hsl);
        wireColor.setHSL(hsl.h, Math.min(1.0, hsl.s * 1.5), Math.min(0.8, hsl.l * 2.0 + 0.2));
    }

    const wireMat = new MeshBasicMaterial({ wireframe: true, transparent: true, depthWrite: true, color: wireColor, opacity: wireProps.opacity || 0.15 });
    applyNonEuclideanCurve(wireMat);
    if (wireProps.sway) applyWindSway(wireMat, timeUniforms);
    trackMaterials.push(wireMat);
    const wireMesh = new Mesh(childMesh.geometry, wireMat);
    wireMesh.userData.isTronWireframe = true;
    childMesh.add(wireMesh);
}

export const FisheyeShader = {
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

export const CRTShutdownShader = {
    uniforms: {
        tDiffuse: { value: null },
        uShutdown: { value: 0.0 }
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

            float vSqueeze = smoothstep(0.0, 0.6, uShutdown);
            float hSqueeze = smoothstep(0.6, 0.9, uShutdown);
            float dotFade  = smoothstep(0.9, 1.0, uShutdown);

            float halfH = mix(0.5, 0.003, vSqueeze);
            float halfW = mix(0.5, 0.006, hSqueeze);

            if (abs(uv.y - center.y) > halfH || abs(uv.x - center.x) > halfW) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }

            vec2 remappedUv;
            remappedUv.x = (uv.x - center.x) / (halfW * 2.0) + 0.5;
            remappedUv.y = (uv.y - center.y) / (halfH * 2.0) + 0.5;

            vec4 col = texture2D(tDiffuse, remappedUv);

            float edgeDist = abs(uv.y - center.y) / max(halfH, 0.001);
            float lineGlow = (1.0 - edgeDist) * vSqueeze * (1.0 - hSqueeze) * 0.5;
            col.rgb += vec3(0.6, 0.8, 1.0) * lineGlow;

            float dotDist = length(uv - center) / max(halfW, 0.001);
            float dotGlow = (1.0 - dotDist) * hSqueeze * (1.0 - dotFade) * 1.5;
            col.rgb += vec3(0.7, 0.9, 1.0) * dotGlow;

            col.rgb *= (1.0 - dotFade);

            gl_FragColor = col;
        }
    `
};

export const FadeBlackShader = {
    uniforms: {
        tDiffuse: { value: null },
        uBlackness: { value: 1.0 }
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
