import { BufferGeometry, Group, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, ConeGeometry, BoxGeometry, Mesh, TorusGeometry } from 'three';

export function displaceGeometry(geometry: BufferGeometry, intensity: number, scale: number = 1.0) {
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        
        const nx = Math.sin(x * scale) * Math.cos(z * scale) * Math.sin(y * scale);
        const ny = Math.cos(x * scale * 1.5) * Math.sin(z * scale * 1.5);
        const nz = Math.sin(x * scale * 2) * Math.sin(y * scale * 2);
        
        positions.setXYZ(i, x + nx * intensity, y + ny * intensity, z + nz * intensity);
    }
    geometry.computeVertexNormals();
}

export function createProceduralDeciduousTree(): Group {
    const group = new Group();
    const trunkGeo = new CylinderGeometry(0.5, 0.8, 3, 5);
    trunkGeo.translate(0, 1.5, 0);
    const trunkMesh = new Mesh(trunkGeo);
    trunkMesh.userData.isTrunk = true;
    group.add(trunkMesh);
    
    const canopyGeo = new DodecahedronGeometry(3.5, 0);
    canopyGeo.translate(0, 4.5, 0);
    const canopyMesh = new Mesh(canopyGeo);
    canopyMesh.userData.isLeaf = true;
    group.add(canopyMesh);
    return group;
}

export function createProceduralBush(): Group {
    const group = new Group();
    for (let i = 0; i < 3; i++) {
        const bushGeo = new IcosahedronGeometry(1.5 + Math.random(), 0);
        bushGeo.translate((Math.random()-0.5)*2, 0.5 + Math.random(), (Math.random()-0.5)*2);
        const bushMesh = new Mesh(bushGeo);
        bushMesh.userData.isLeaf = true;
        group.add(bushMesh);
    }
    return group;
}

export function createProceduralRock(): Group {
    const group = new Group();
    const rockGeo = new IcosahedronGeometry(2, 0);
    rockGeo.scale(1 + Math.random(), 0.5 + Math.random()*0.8, 1 + Math.random());
    rockGeo.translate(0, 1, 0);
    const rockMesh = new Mesh(rockGeo);
    rockMesh.userData.isRock = true;
    group.add(rockMesh);
    return group;
}

export function createProceduralLog(): Group {
    const group = new Group();
    const logGeo = new CylinderGeometry(0.6, 0.6, 4 + Math.random()*3, 5);
    logGeo.rotateZ(Math.PI / 2);
    logGeo.translate(0, 0.4, 0);
    const logMesh = new Mesh(logGeo);
    logMesh.userData.isTrunk = true;
    group.add(logMesh);
    return group;
}

export function createProceduralMushroom(): Group {
    const group = new Group();
    const stalkGeo = new CylinderGeometry(0.1, 0.15, 1, 4);
    stalkGeo.translate(0, 0.5, 0);
    const stalkMesh = new Mesh(stalkGeo);
    stalkMesh.userData.isMushroomStalk = true;
    group.add(stalkMesh);
    
    const capGeo = new ConeGeometry(0.6, 0.4, 6);
    capGeo.translate(0, 1.1, 0);
    const capMesh = new Mesh(capGeo);
    capMesh.userData.isMushroomCap = true;
    group.add(capMesh);
    
    return group;
}

export function createProceduralPineTree(): Group {
    const group = new Group();
    const trunkGeo = new CylinderGeometry(0.3, 0.6, 2, 5);
    trunkGeo.translate(0, 1, 0);
    const trunkMesh = new Mesh(trunkGeo);
    trunkMesh.userData.isTrunk = true;
    group.add(trunkMesh);
    
    const heights = [3, 2.5, 2];
    const radii = [2.2, 1.6, 1.0];
    const yOffsets = [2, 3.5, 4.8];
    
    for (let i = 0; i < 3; i++) {
        const coneGeo = new ConeGeometry(radii[i], heights[i], 5);
        coneGeo.translate(0, yOffsets[i] + heights[i]/2, 0);
        const coneMesh = new Mesh(coneGeo);
        coneMesh.userData.isLeaf = true;
        group.add(coneMesh);
    }
    
    return group;
}

export function createProceduralMesa(): Group {
    const group = new Group();
    const heights = [4, 3, 2];
    const radii = [3, 2.2, 1.5];
    let y = 0;
    for (let i = 0; i < 3; i++) {
        const geo = new CylinderGeometry(radii[i], radii[i]*1.2, heights[i], 12, 4);
        displaceGeometry(geo, 0.4, 1.5);
        geo.translate(0, y + heights[i]/2, 0);
        const mesh = new Mesh(geo);
        mesh.userData.isRock = true;
        group.add(mesh);
        y += heights[i];
    }
    return group;
}

export function createProceduralArch(): Group {
    const group = new Group();
    const geo = new TorusGeometry(5, 1.5, 12, 16, Math.PI);
    displaceGeometry(geo, 0.5, 1.2);
    geo.translate(0, 0, 0);
    const mesh = new Mesh(geo);
    mesh.userData.isRock = true;
    group.add(mesh);
    return group;
}

export function createProceduralHouse(): Group {
    const group = new Group();
    const w = 6 + Math.random()*2;
    const d = 5 + Math.random()*3;
    const h = 4 + Math.random()*2;
    const baseGeo = new BoxGeometry(w, h, d);
    baseGeo.translate(0, h/2, 0);
    const baseMesh = new Mesh(baseGeo);
    baseMesh.userData.isBuilding = true;
    group.add(baseMesh);
    
    const roofGeo = new ConeGeometry(Math.max(w,d)*0.7, 3, 4);
    roofGeo.translate(0, h + 1.5, 0);
    roofGeo.rotateY(Math.PI/4);
    const roofMesh = new Mesh(roofGeo);
    roofMesh.userData.isRoof = true;
    group.add(roofMesh);
    
    return group;
}

export function createProceduralMansion(): Group {
    const group = new Group();
    const w = 10 + Math.random()*4;
    const d = 8 + Math.random()*3;
    const h = 6 + Math.random()*2;
    const baseGeo = new BoxGeometry(w, h, d);
    baseGeo.translate(0, h/2, 0);
    const baseMesh = new Mesh(baseGeo);
    baseMesh.userData.isBuilding = true;
    group.add(baseMesh);
    
    const roofGeo = new ConeGeometry(Math.max(w,d)*0.7, 4, 4);
    roofGeo.translate(0, h + 2, 0);
    roofGeo.rotateY(Math.PI/4);
    const roofMesh = new Mesh(roofGeo);
    roofMesh.userData.isRoof = true;
    group.add(roofMesh);
    
    return group;
}

export function createProceduralFence(): Group {
    const group = new Group();
    const geo = new BoxGeometry(4, 1.5, 0.2);
    geo.translate(0, 0.75, 0);
    const mesh = new Mesh(geo);
    mesh.userData.isBuilding = true;
    group.add(mesh);
    return group;
}

export function createProceduralAcacia(): Group {
    const group = new Group();
    const buildBranch = (parent: Group | Mesh, len: number, rad: number, yOffset: number, rotZ: number, rotY: number, depth: number) => {
        const geo = new CylinderGeometry(rad*0.6, rad, len, 5);
        geo.translate(0, len/2, 0);
        const mesh = new Mesh(geo);
        mesh.userData.isTrunk = true;
        mesh.rotation.z = rotZ;
        mesh.rotation.y = rotY;
        mesh.position.y = yOffset;
        parent.add(mesh);
        
        if (depth > 0) {
            buildBranch(mesh, len*0.8, rad*0.6, len*0.9, rotZ + 0.4, rotY + 1.2, depth - 1);
            buildBranch(mesh, len*0.8, rad*0.6, len*0.9, rotZ - 0.4, rotY - 1.2, depth - 1);
        } else {
            const canopyGeo = new DodecahedronGeometry(len*1.5, 0);
            canopyGeo.scale(1, 0.3, 1);
            canopyGeo.translate(0, len, 0);
            const canopyMesh = new Mesh(canopyGeo);
            canopyMesh.userData.isLeaf = true;
            mesh.add(canopyMesh);
        }
    };
    buildBranch(group, 5, 0.6, 0, 0, 0, 2);
    return group;
}

export function createProceduralBaobab(): Group {
    const group = new Group();
    
    let y = 0;
    let rad = 3.5;
    for (let i = 0; i < 5; i++) {
        const h = 2;
        const geo = new CylinderGeometry(rad*0.8, rad, h, 8);
        geo.translate((Math.random()-0.5)*0.2, y + h/2, (Math.random()-0.5)*0.2);
        const mesh = new Mesh(geo);
        mesh.userData.isTrunk = true;
        group.add(mesh);
        y += h;
        rad *= 0.8;
    }
    
    for (let i = 0; i < 4; i++) {
        const canopyGeo = new DodecahedronGeometry(2, 0);
        canopyGeo.translate((Math.random()-0.5)*4, y + Math.random()*2, (Math.random()-0.5)*4);
        const canopyMesh = new Mesh(canopyGeo);
        canopyMesh.userData.isLeaf = true;
        group.add(canopyMesh);
    }
    
    return group;
}
