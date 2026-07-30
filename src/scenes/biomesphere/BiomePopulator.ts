import { Mesh, PlaneGeometry, MeshStandardMaterial, InstancedMesh, Object3D, Color, Group, ConeGeometry } from 'three';
import { createNonEuclideanMaterial, applyNonEuclideanCurve } from '../../materials/NonEuclideanMaterial';
import { generateMapsFromDiffuse, createForestGround, createCanyonGround, createCityGround, createSavannaGround, createProceduralFacadeTexture } from './BiomeTextures';
import { createProceduralPineTree, createProceduralDeciduousTree, createProceduralBush, createProceduralRock, createProceduralLog, createProceduralMushroom, createProceduralMesa, createProceduralArch, createProceduralHouse, createProceduralMansion, createProceduralFence, createProceduralAcacia, createProceduralBaobab } from './BiomeGeometry';
import { wrapWireframe, applyWindSway } from './BiomeShaders';
import { BIOME_NAMES } from './BiomeState';

const CLEAR_RADIUS = 25; // Keep the center clear for the UI

export function populateBiomes(trackGroup: Group, trackMaterials: any[], BIOME_SPACING: number, timeUniforms: any) {
    const facadeMaps = createProceduralFacadeTexture();

    const biomesData = [
        { name: 'Forest',      color: 0x1B3320 },
        { name: 'Canyon',      color: 0x5C4033 },
        { name: 'City',        color: 0x222222 },
        { name: 'Savanna',     color: 0x111116 },
    ];

    biomesData.forEach((biome, index) => {
        const startMatIndex = trackMaterials.length;
        const startMeshIndex = trackGroup.children.length;

        const geo = new PlaneGeometry(800, 4500, 64, 128); 
        geo.rotateX(-Math.PI / 2);
        
        let diffuseCanvas: HTMLCanvasElement | null = null;
        let diffuseTex = null;
        
        if (biome.name === 'Forest') diffuseTex = createForestGround();
        else if (biome.name === 'Canyon') diffuseTex = createCanyonGround();
        else if (biome.name === 'City') diffuseTex = createCityGround();
        else if (biome.name === 'Savanna') diffuseTex = createSavannaGround();
        
        let matProps: any = { color: 0xffffff, roughness: 1.0, metalness: 0.1, wireframe: false };
        
        if (diffuseTex) {
            diffuseCanvas = diffuseTex.image;
            const maps = generateMapsFromDiffuse(diffuseCanvas);
            diffuseTex.repeat.set(8, 8);
            maps.normalMap.repeat.set(8, 8);
            maps.bumpMap.repeat.set(8, 8);
            matProps.map = diffuseTex;
            matProps.normalMap = maps.normalMap;
            matProps.roughnessMap = maps.bumpMap;
            matProps.bumpMap = maps.bumpMap;
            matProps.bumpScale = 0.5;
        }
        
        const mat = createNonEuclideanMaterial(matProps);
        mat.transparent = true;
        trackMaterials.push(mat);
        
        const mesh = new Mesh(geo, mat);
        mesh.position.z = -(index * BIOME_SPACING);
        mesh.receiveShadow = true;
        mesh.userData.isGround = true;
        trackGroup.add(mesh);

        if (biome.name === 'Forest') {
            const basePine = createProceduralPineTree();
            const baseDeciduous = createProceduralDeciduousTree();
            const baseBush = createProceduralBush();
            
            const grassCount = 20000;
            const grassGeo = new ConeGeometry(0.15, 2, 3);
            grassGeo.translate(0, 1, 0);
            const grassMat = new MeshStandardMaterial({ color: 0xcca844, roughness: 1.0, transparent: true, opacity: 0 });
            grassMat.userData = { baseOpacity: 0.9 };
            applyNonEuclideanCurve(grassMat);
            applyWindSway(grassMat, timeUniforms);
            trackMaterials.push(grassMat);
            const grassInst = new InstancedMesh(grassGeo, grassMat, grassCount);
            grassInst.castShadow = true; grassInst.receiveShadow = true;
            const grassDummy = new Object3D();
            for (let i=0; i<grassCount; i++) {
                const gx = (Math.random()-0.5)*500;
                const gz = (Math.random()-0.5)*1400;
                if (Math.sqrt(gx*gx + gz*gz) < CLEAR_RADIUS) continue; // Clear center
                grassDummy.position.set(gx, 0, gz);
                grassDummy.rotation.y = Math.random() * Math.PI;
                grassDummy.rotation.x = (Math.random()-0.5)*0.2;
                grassDummy.scale.setScalar(0.5 + Math.random()*1.0);
                grassDummy.updateMatrix();
                grassInst.setMatrixAt(i, grassDummy.matrix);
            }
            grassInst.position.set(0, 0, -(index * BIOME_SPACING));
            trackGroup.add(grassInst);

            const baseRock = createProceduralRock();
            const baseLog = createProceduralLog();
            const baseMushroom = createProceduralMushroom();
            
            for (let x = -200; x <= 200; x += 15) {
                for (let z = -600; z <= 600; z += 15) {
                    if (Math.sqrt(x*x + z*z) < CLEAR_RADIUS) continue;
                    
                    const pathCurve = Math.sin(z * 0.02) * 30;
                    const distToPath = Math.abs(x - pathCurve);
                    
                    if (distToPath < 10) continue; 
                    if (Math.random() > 0.5) continue;

                    const r = Math.random();
                    let tile: Group;
                    let defaultScale = 1.0;
                    
                    if (r < 0.4) { tile = basePine.clone(); defaultScale = 4.0 + Math.random() * 4.0; }
                    else if (r < 0.6) { tile = baseDeciduous.clone(); defaultScale = 3.5 + Math.random() * 4.0; }
                    else if (r < 0.75) { tile = baseBush.clone(); defaultScale = 1.5 + Math.random() * 2.5; }
                    else if (r < 0.9) { tile = baseRock.clone(); defaultScale = 1.5 + Math.random() * 4.5; }
                    else if (r < 0.95) { tile = baseLog.clone(); defaultScale = 2.0 + Math.random() * 2.0; }
                    else { tile = baseMushroom.clone(); defaultScale = 2.0 + Math.random() * 2.0; }
                    
                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            let baseColor = new Color();
                            if (childMesh.userData.isTrunk) baseColor.setHSL(0.06 + (Math.random() - 0.5) * 0.05, 0.7, 0.2 + Math.random() * 0.1);
                            else if (childMesh.userData.isLeaf) baseColor.setHSL(0.35 + (Math.random() - 0.5) * 0.1, 0.8, 0.2 + Math.random() * 0.1);
                            else if (childMesh.userData.isRock) baseColor.setHSL(0.0, 0.0, 0.3 + Math.random() * 0.2);
                            else if (childMesh.userData.isMushroomStalk) baseColor.setHSL(0.1, 0.3, 0.8);
                            else if (childMesh.userData.isMushroomCap) baseColor.setHSL(0.5 + Math.random()*0.4, 0.9, 0.5 + Math.random()*0.2); 
                            else baseColor.setHSL(0.3, 0.8, 0.2);

                            const emissiveColor = (childMesh.userData.isMushroomCap) ? baseColor.clone() : new Color(0x000000);
                            const emissiveIntensity = (childMesh.userData.isMushroomCap) ? 1.5 : 0;

                            const coreMat = new MeshStandardMaterial({
                                color: baseColor, emissive: emissiveColor, emissiveIntensity: emissiveIntensity,
                                roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0, depthWrite: true
                            });
                            coreMat.userData = { baseOpacity: 1.0 };
                            
                            applyNonEuclideanCurve(coreMat);
                            if (childMesh.userData.isLeaf || childMesh.userData.isTrunk) applyWindSway(coreMat, timeUniforms);
                            trackMaterials.push(coreMat);
                            
                            wrapWireframe(childMesh, coreMat, { matchColor: true, sway: childMesh.userData.isLeaf || childMesh.userData.isTrunk }, trackMaterials, timeUniforms);
                        }
                    });

                    tile.position.set(x + (Math.random()-0.5)*8, 0, -(index * BIOME_SPACING) + z + (Math.random()-0.5)*8);
                    tile.rotation.y = Math.random() * Math.PI * 2; 
                    tile.scale.set(defaultScale, defaultScale, defaultScale);
                    trackGroup.add(tile);
                }
            }
        } else if (biome.name === 'Canyon') {
            const baseMesa = createProceduralMesa();
            const baseArch = createProceduralArch();
            const baseRock = createProceduralRock();
            
            for (let x = -200; x <= 200; x += 15) {
                for (let z = -600; z <= 600; z += 15) {
                    if (Math.sqrt(x*x + z*z) < CLEAR_RADIUS) continue;
                    const pathCurve = Math.sin(z * 0.02) * 20;
                    const distToPath = Math.abs(x - pathCurve);
                    
                    if (distToPath < 12) continue; 
                    if (Math.random() > 0.45) continue;

                    const r = Math.random();
                    let tile: Group;
                    let defaultScale = 1.0;
                    
                    if (r < 0.3) { tile = baseMesa.clone(); defaultScale = 3.0 + Math.random() * 2.0; }
                    else if (r < 0.5 && distToPath > 20) { tile = baseArch.clone(); defaultScale = 4.0 + Math.random() * 3.0; }
                    else { tile = baseRock.clone(); defaultScale = 2.0 + Math.random() * 3.0; }
                    
                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            const rockColor = new Color().setHSL(0.05 + (Math.random()-0.5)*0.08, 0.6 + Math.random()*0.3, 0.4 + Math.random()*0.2);
                            const coreMat = new MeshStandardMaterial({ color: rockColor, roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0, depthWrite: true });
                            coreMat.userData = { baseOpacity: 1.0 };
                            applyNonEuclideanCurve(coreMat);
                            trackMaterials.push(coreMat);
                            wrapWireframe(childMesh, coreMat, { matchColor: true, opacity: 0.25 }, trackMaterials, timeUniforms);
                        }
                    });

                    tile.position.set(x + (Math.random()-0.5)*5, 0, -(index * BIOME_SPACING) + z + (Math.random()-0.5)*5);
                    tile.rotation.y = Math.random() * Math.PI * 2; 
                    tile.scale.set(defaultScale, defaultScale, defaultScale);
                    trackGroup.add(tile);
                }
            }
        } else if (biome.name === 'City') {
            const baseHouse = createProceduralHouse();
            const baseMansion = createProceduralMansion();
            const baseFence = createProceduralFence();

            for (let row = -60; row <= 60; row++) {
                for (let colOffset of [-220, -170, -120, -80, -40, 40, 80, 120, 170, 220]) {
                    const x = colOffset + (Math.random()-0.5)*10;
                    const z = row * 20 + (Math.random()-0.5)*4; 
                    if (Math.sqrt(x*x + z*z) < CLEAR_RADIUS + 20) continue; // Slightly larger clearing for city
                    
                    if (row === 0 && Math.abs(colOffset) < 100) continue; 
                    
                    const rand = Math.random();
                    let tile: Group;
                    
                    if (rand < 0.15) tile = baseMansion.clone();
                    else if (rand < 0.85) tile = baseHouse.clone();
                    else tile = baseFence.clone();
                    
                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            const isBuilding = child.userData.isBuilding;
                            const isRoof = child.userData.isRoof;
                            
                            let matColor = new Color();
                            if (isBuilding) matColor.setHSL(0.1 + Math.random()*0.1, 0.4, 0.3 + Math.random()*0.3); 
                            else if (isRoof) matColor.setHSL(0.0, 0.0, 0.15 + Math.random()*0.1); 
                            
                            const coreMat = new MeshStandardMaterial({ 
                                color: matColor, 
                                roughness: 0.8, 
                                metalness: 0.1, 
                                transparent: true, 
                                opacity: 0, 
                                depthWrite: true,
                                map: isBuilding ? facadeMaps.diffuseMap : null, emissiveMap: isBuilding ? facadeMaps.emissiveMap : null, emissive: isBuilding ? new Color(0xffaa55) : new Color(0x000000), emissiveIntensity: isBuilding ? 0.8 : 0
                            });
                            coreMat.userData = { baseOpacity: 1.0 };
                            applyNonEuclideanCurve(coreMat);
                            trackMaterials.push(coreMat);
                            childMesh.material = coreMat;
                            wrapWireframe(childMesh, coreMat, { matchColor: true, opacity: 0.45 }, trackMaterials, timeUniforms);
                        }
                    });

                    tile.position.set(x, 0, -(index * BIOME_SPACING) + z);
                    tile.rotation.y = colOffset < 0 ? Math.PI/2 : -Math.PI/2; 
                    const scale = 1.2 + Math.random()*0.2;
                    tile.scale.set(scale, scale, scale);
                    trackGroup.add(tile);
                }
            }
        } else if (biome.name === 'Savanna') {
            const baseAcacia = createProceduralAcacia();
            const baseBaobab = createProceduralBaobab();
            
            const grassCount = 18000;
            const grassGeo = new ConeGeometry(0.15, 2, 3);
            grassGeo.translate(0, 1, 0);
            const grassMat = new MeshStandardMaterial({ color: 0xcca844, roughness: 1.0, transparent: true, opacity: 0 });
            grassMat.userData = { baseOpacity: 0.9 };
            applyNonEuclideanCurve(grassMat);
            applyWindSway(grassMat, timeUniforms);
            trackMaterials.push(grassMat);
            const grassInst = new InstancedMesh(grassGeo, grassMat, grassCount);
            grassInst.castShadow = true; grassInst.receiveShadow = true;
            const grassDummy = new Object3D();
            for (let i=0; i<grassCount; i++) {
                const gx = (Math.random()-0.5)*500;
                const gz = (Math.random()-0.5)*1400;
                if (Math.sqrt(gx*gx + gz*gz) < CLEAR_RADIUS) continue;
                grassDummy.position.set(gx, 0, gz);
                grassDummy.rotation.y = Math.random() * Math.PI;
                grassDummy.rotation.x = (Math.random()-0.5)*0.2;
                grassDummy.scale.setScalar(0.5 + Math.random()*1.0);
                grassDummy.updateMatrix();
                grassInst.setMatrixAt(i, grassDummy.matrix);
            }
            grassInst.position.set(0, 0, -(index * BIOME_SPACING));
            trackGroup.add(grassInst);

            for (let i = 0; i < 250; i++) {
                const x = (Math.random() - 0.5) * 500;
                const z = (Math.random() - 0.5) * 1200;
                
                if (Math.sqrt(x*x + z*z) > CLEAR_RADIUS) {
                    const rand = Math.random();
                    let tile: Group;
                    let scale = 1.0;

                    if (rand < 0.6) {
                        tile = baseAcacia.clone();
                        scale = 3.0 + Math.random() * 2.0;
                    } else {
                        tile = baseBaobab.clone();
                        scale = 2.5 + Math.random() * 1.5;
                    }

                    tile.traverse((child) => {
                        if ((child as Mesh).isMesh && !child.userData.isTronWireframe) {
                            const childMesh = child as Mesh;
                            const isTrunk = child.userData.isTrunk;
                            const isLeaf = child.userData.isLeaf;
                            
                            let plantColor = new Color();
                            if (isTrunk) plantColor.setHSL(0.08, 0.3, 0.25);
                            else plantColor.setHSL(0.12, 0.4, 0.35); 

                            const coreMat = new MeshStandardMaterial({ color: plantColor, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0, depthWrite: true });
                            coreMat.userData = { baseOpacity: 1.0 };
                            applyNonEuclideanCurve(coreMat);
                            if (isLeaf) applyWindSway(coreMat, timeUniforms);
                            trackMaterials.push(coreMat);
                            
                            childMesh.material = coreMat;
                            wrapWireframe(childMesh, coreMat, { color: 0x5effa4, opacity: 0.2, sway: isLeaf }, trackMaterials, timeUniforms);
                        }
                    });

                    tile.position.set(x, 0, -(index * BIOME_SPACING) + z);
                    tile.rotation.y = Math.random() * Math.PI * 2;
                    tile.scale.set(scale, scale, scale);
                    trackGroup.add(tile);
                }
            }
        }

        for (let i = startMatIndex; i < trackMaterials.length; i++) {
            if (!trackMaterials[i].userData) trackMaterials[i].userData = {};
            trackMaterials[i].userData.biomeIndex = index;
        }
        for (let i = startMeshIndex; i < trackGroup.children.length; i++) {
            trackGroup.children[i].traverse((child) => {
                child.frustumCulled = false;
                child.userData.biomeIndex = index; // Tag the mesh root too
            });
        }
    });
}
