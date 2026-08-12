import * as THREE from 'three';
import type { Category } from '../../data/categories';

export function createTabTexture(category: Category): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);

    // Fill transparent
    ctx.clearRect(0, 0, 128, 512);

    // Draw Tab Base
    ctx.fillStyle = 'rgba(8, 28, 51, 0.8)';
    ctx.fillRect(10, 10, 108, 492);

    // Draw Border
    ctx.strokeStyle = category.accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 108, 492);

    // Text (Rotated)
    ctx.save();
    ctx.translate(64, 256);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(category.label.toUpperCase(), 0, 0);
    ctx.restore();

    // Axis Glyph
    ctx.fillStyle = category.accent;
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(category.axis, 64, 60);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    return texture;
}

export function attachTabToPage(
    pageGroup: THREE.Group,
    category: Category,
    tabIndex: number,
    totalTabs: number,
    bookWidth: number,
    bookHeight: number,
    materials: any
) {
    const TAB_WIDTH = 0.4;
    const TAB_HEIGHT = 1.2;
    const TAB_THICKNESS = 0.02;

    const tabGeom = new THREE.BoxGeometry(TAB_WIDTH, TAB_HEIGHT, TAB_THICKNESS);
    const texture = createTabTexture(category);

    const tabMat = materials.solidMaterial.clone();
    tabMat.map = texture;
    tabMat.emissiveMap = texture;
    tabMat.emissiveIntensity = 1.0;

    const tabSolid = new THREE.Mesh(tabGeom, tabMat);
    const tabEdges = new THREE.LineSegments(new THREE.EdgesGeometry(tabGeom), materials.edgeMaterial);

    const tabGroup = new THREE.Group();
    tabGroup.add(tabSolid, tabEdges);

    // Calculate Y position based on index to distribute tabs vertically
    // Tab origin is center. Book height is BOOK_HEIGHT.
    const startY = (bookHeight / 2) - (TAB_HEIGHT / 2) - 0.2;
    const spacingY = (bookHeight - 0.4) / totalTabs;
    const yPos = startY - (tabIndex * spacingY);

    // X position: right edge of the page
    const xPos = bookWidth * 0.95 + (TAB_WIDTH / 2);

    tabGroup.position.set(xPos, yPos, 0);
    tabGroup.userData = { isTab: true, categoryId: category.id };
    
    // Add hitbox for raycasting
    const hitboxGeom = new THREE.BoxGeometry(TAB_WIDTH * 1.5, TAB_HEIGHT * 1.5, 0.4);
    const hitboxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitbox = new THREE.Mesh(hitboxGeom, hitboxMat);
    tabGroup.add(hitbox);

    pageGroup.add(tabGroup);

    return { tabGroup, hitbox };
}
