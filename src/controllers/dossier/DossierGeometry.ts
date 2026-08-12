import * as THREE from 'three';
import { createDossierMaterials, injectSpotlightReveal } from './shaders';

export interface DossierPage {
    id: string; 
    group: THREE.Group;
    mesh: THREE.Mesh; 
    uniforms: { uBendAmount: { value: number } };
    isOpen: boolean; 
}

export function createDossierGeometry() {
    const group = new THREE.Group();
    const materials = createDossierMaterials();

    const BOOK_WIDTH = 12.0;
    const BOOK_HEIGHT = 16.0;

    // --- Covers ---
    const createCover = (isBack = false) => {
        const cGroup = new THREE.Group();
        const COVER_THICKNESS = 0.15;
        // Solid cover
        const cGeom = new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, COVER_THICKNESS, 32, 32, 2);
        cGeom.translate(BOOK_WIDTH / 2, 0, 0);

        const uniforms = { uBendAmount: { value: 0.0 }, uTime: { value: 0.0 }, tGeometry: { value: null } };
        const cMat = materials.solidMaterial.clone();
        cMat.onBeforeCompile = (shader) => injectSpotlightReveal(shader, uniforms);

        const cSolid = new THREE.Mesh(cGeom, cMat);
        cSolid.castShadow = true;
        cSolid.receiveShadow = true;
        
        // Edge geometry
        const baseEdgesGeom = new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, COVER_THICKNESS);
        baseEdgesGeom.translate(BOOK_WIDTH / 2, 0, 0);
        const edgesGeom = new THREE.EdgesGeometry(baseEdgesGeom);
        
        const cEdgesMat = materials.edgeMaterial.clone();
        cEdgesMat.onBeforeCompile = (shader) => injectSpotlightReveal(shader, uniforms);
        const cEdges = new THREE.LineSegments(edgesGeom, cEdgesMat);

        cGroup.add(cSolid, cEdges);
        cGroup.position.set(0, 0, isBack ? -0.15 : 0.15);
        
        return { group: cGroup, uniforms };
    };

    const backCover = createCover(true);
    const frontCover = createCover(false);
    group.add(backCover.group, frontCover.group);

    // --- Magical Energy Core (Spine) ---
    const spineGroup = new THREE.Group();
    
    // A glowing, ethereal cylinder binding the book
    const coreGeom = new THREE.CylinderGeometry(0.08, 0.08, BOOK_HEIGHT, 16);
    const coreMat = new THREE.MeshPhysicalMaterial({
        color: 0x82d6ff,
        emissive: 0x82d6ff,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.7,
        roughness: 0.3
    });
    const energyCore = new THREE.Mesh(coreGeom, coreMat);
    energyCore.castShadow = true;
    
    // An outer softer glow
    const glowGeom = new THREE.CylinderGeometry(0.15, 0.15, BOOK_HEIGHT * 1.02, 16);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x82d6ff,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide
    });
    const coreGlow = new THREE.Mesh(glowGeom, glowMat);

    spineGroup.add(energyCore, coreGlow);
    spineGroup.position.set(0, 0, 0); // Anchor at x=0
    group.add(spineGroup);

    // --- Pages Factory ---
    const pages: DossierPage[] = [];

    const createPage = (id: string, zOffset: number): DossierPage => {
        const pGroup = new THREE.Group();
        
        // High segment count for bending shader
        const pGeom = new THREE.PlaneGeometry(BOOK_WIDTH * 0.95, BOOK_HEIGHT * 0.95, 64, 64);
        pGeom.translate((BOOK_WIDTH * 0.95) / 2, 0, 0);

        const uniforms = { 
            uBendAmount: { value: 0.0 },
            uRevealProgress: { value: 0.0 },
            uTime: { value: 0.0 },
            tGeometry: { value: null }
        };
        
        const pMat = materials.solidMaterial.clone();
        pMat.onBeforeCompile = (shader) => injectSpotlightReveal(shader, uniforms, true);

        const pMesh = new THREE.Mesh(pGeom, pMat);
        pMesh.castShadow = true;
        pMesh.receiveShadow = true;
        
        const pEdgesGeom = new THREE.EdgesGeometry(new THREE.PlaneGeometry(BOOK_WIDTH * 0.95, BOOK_HEIGHT * 0.95));
        pEdgesGeom.translate((BOOK_WIDTH * 0.95) / 2, 0, 0);
        
        const pEdgesMat = materials.edgeMaterial.clone();
        pEdgesMat.onBeforeCompile = (shader) => injectSpotlightReveal(shader, uniforms);
        const pEdges = new THREE.LineSegments(pEdgesGeom, pEdgesMat);

        pGroup.add(pMesh, pEdges);
        pGroup.position.set(0.05, 0, zOffset);
        
        group.add(pGroup);

        return { id, group: pGroup, mesh: pMesh, uniforms, isOpen: false };
    };

    return { 
        group, 
        frontCover: frontCover.group, 
        backCover: backCover.group, 
        createPage,
        materials,
        BOOK_WIDTH,
        BOOK_HEIGHT
    };
}
