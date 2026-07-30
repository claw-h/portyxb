import { Object3D, InstancedMesh, PlaneGeometry, IcosahedronGeometry, ConeGeometry, DoubleSide, MeshBasicMaterial } from 'three';
import { applyNonEuclideanCurve } from '../../materials/NonEuclideanMaterial';
import { createProceduralLeafTexture } from './BiomeTextures';

export function createDebrisSystem(trackGroup: any, trackMaterials: any[], BIOME_SPACING: number) {
    const debrisAnimations: Array<() => void> = [];
    
    const buildDebris = (geo: any, count: number, matProps: any, zOffset: number, behavior: string, biomeIndex: number) => {
        const mat = new MeshBasicMaterial({ ...matProps, transparent: true, depthWrite: false });
        mat.userData = { baseOpacity: matProps.opacity || 0.8, biomeIndex };
        trackMaterials.push(mat);
        applyNonEuclideanCurve(mat);
        const imesh = new InstancedMesh(geo, mat, count);
        imesh.userData.biomeIndex = biomeIndex;
        
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
                    positions[i*3] += Math.sin(time * 2.5) * 0.08 + (Math.random()-0.5)*0.05;
                    positions[i*3+1] += Math.cos(time * 3.1) * 0.08 + (Math.random()-0.5)*0.05;
                    positions[i*3+2] += Math.sin(time * 1.7) * 0.08;
                    
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

    const leafTex = createProceduralLeafTexture();
    buildDebris(new PlaneGeometry(0.8, 0.8), 200, { map: leafTex, color: 0xffffff, side: DoubleSide, transparent: true, alphaTest: 0.1 }, 0, 'leaf', 0); // Forest
    buildDebris(new IcosahedronGeometry(0.8, 0), 100, { color: 0xffaa44, wireframe: true }, -BIOME_SPACING, 'tumble', 1); // Canyon
    buildDebris(new PlaneGeometry(0.8, 1.2), 150, { color: 0xaaaabb, side: DoubleSide }, -BIOME_SPACING*2, 'paper', 2); // City
    buildDebris(new ConeGeometry(0.2, 0.4, 3), 300, { color: 0xffffaa }, -BIOME_SPACING*3, 'moth', 3); // Savanna

    return {
        update: () => debrisAnimations.forEach(anim => anim())
    };
}
