import { CanvasTexture, RepeatWrapping } from 'three';

export function generateMapsFromDiffuse(diffuseCanvas: HTMLCanvasElement): { normalMap: CanvasTexture, bumpMap: CanvasTexture } {
    const width = diffuseCanvas.width;
    const height = diffuseCanvas.height;
    
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = width;
    bumpCanvas.height = height;
    const bumpCtx = bumpCanvas.getContext('2d')!;
    
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = width;
    normalCanvas.height = height;
    const normalCtx = normalCanvas.getContext('2d')!;
    
    const dCtx = diffuseCanvas.getContext('2d')!;
    const imgData = dCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const bumpData = bumpCtx.createImageData(width, height);
    const bData = bumpData.data;
    
    const normalImgData = normalCtx.createImageData(width, height);
    const nData = normalImgData.data;
    
    const heights = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
        bData[i] = lum;
        bData[i+1] = lum;
        bData[i+2] = lum;
        bData[i+3] = 255;
        heights[i/4] = lum / 255.0;
    }
    bumpCtx.putImageData(bumpData, 0, 0);
    
    const strength = 4.0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const left = heights[y * width + Math.max(x - 1, 0)];
            const right = heights[y * width + Math.min(x + 1, width - 1)];
            const up = heights[Math.max(y - 1, 0) * width + x];
            const down = heights[Math.min(y + 1, height - 1) * width + x];
            
            let dx = (right - left) * strength;
            let dy = (down - up) * strength;
            let dz = 1.0;
            
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            dx /= len; dy /= len; dz /= len;
            
            const i = (y * width + x) * 4;
            nData[i] = (dx * 0.5 + 0.5) * 255;
            nData[i+1] = (dy * 0.5 + 0.5) * 255;
            nData[i+2] = (dz * 0.5 + 0.5) * 255;
            nData[i+3] = 255;
        }
    }
    normalCtx.putImageData(normalImgData, 0, 0);
    
    const nTex = new CanvasTexture(normalCanvas);
    nTex.wrapS = RepeatWrapping; nTex.wrapT = RepeatWrapping;
    
    const bTex = new CanvasTexture(bumpCanvas);
    bTex.wrapS = RepeatWrapping; bTex.wrapT = RepeatWrapping;
    
    return { normalMap: nTex, bumpMap: bTex };
}

export function createForestGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#1a2916';
    ctx.fillRect(0, 0, 512, 512);
    
    for (let i = 0; i < 4000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = 1 + Math.random() * 5;
        ctx.fillStyle = Math.random() > 0.5 ? '#243b22' : '#304a29';
        ctx.fillRect(x, y, s, s);
    }
    
    for (let i = 0; i < 1500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = 2 + Math.random() * 4;
        ctx.fillStyle = 'rgba(40, 25, 15, 0.6)'; 
        ctx.fillRect(x, y, s, s);
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

export function createCanyonGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#6d4021';
    ctx.fillRect(0, 0, 512, 512);
    
    ctx.strokeStyle = '#4a2812';
    ctx.lineWidth = 2;
    for (let i = 0; i < 300; i++) {
        ctx.beginPath();
        const startX = Math.random() * 512;
        const startY = Math.random() * 512;
        ctx.moveTo(startX, startY);
        let cx = startX;
        let cy = startY;
        for (let j = 0; j < 5; j++) {
            cx += (Math.random() - 0.5) * 40;
            cy += (Math.random() - 0.5) * 40;
            ctx.lineTo(cx, cy);
        }
        ctx.stroke();
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

export function createCityGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, 512, 512);
    
    for (let i = 0; i < 15000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const l = Math.floor(20 + Math.random() * 40);
        ctx.fillStyle = `rgb(${l},${l},${l})`;
        ctx.fillRect(x, y, 1.5, 1.5);
    }
    
    ctx.fillStyle = '#ccaa33';
    ctx.fillRect(246, 0, 20, 512);
    ctx.fillStyle = '#222222';
    for(let i=0; i<512; i+=40) {
        ctx.fillRect(246, i+20, 20, 20);
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

export function createSavannaGround(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#8f7a4e';
    ctx.fillRect(0, 0, 512, 512);
    
    for (let i = 0; i < 10000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const s = Math.random() > 0.5 ? 2 : 1;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(200, 180, 100, 0.4)' : 'rgba(100, 80, 40, 0.4)';
        ctx.fillRect(x, y, s, s);
    }
    
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
    return tex;
}

export function createProceduralBarkTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#1e120b';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 1800; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const h = 12 + Math.random() * 45;
        const alpha = 0.04 + Math.random() * 0.12;
        ctx.fillStyle = Math.random() > 0.5 ? `rgba(180, 120, 70, ${alpha})` : `rgba(10, 5, 2, ${alpha})`;
        ctx.fillRect(x, y, 1.5, h);
    }
    
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
    return texture;
}

export function createProceduralFacadeTexture(): { diffuseMap: CanvasTexture, emissiveMap: CanvasTexture } {
    const dCanvas = document.createElement('canvas');
    dCanvas.width = 512; dCanvas.height = 512;
    const dCtx = dCanvas.getContext('2d')!;
    
    const eCanvas = document.createElement('canvas');
    eCanvas.width = 512; eCanvas.height = 512;
    const eCtx = eCanvas.getContext('2d')!;
    
    dCtx.fillStyle = '#9e8b76';
    dCtx.fillRect(0, 0, 512, 512);
    dCtx.fillStyle = '#8a7966';
    for(let i=0; i<512; i+=16) {
        dCtx.fillRect(0, i, 512, 2);
    }
    
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, 512, 512);
    
    const drawWindow = (x: number, y: number, w: number, h: number) => {
        const isLit = Math.random() > 0.4;
        dCtx.fillStyle = isLit ? '#ffcca4' : '#222222';
        dCtx.fillRect(x, y, w, h);
        
        if (isLit) {
            eCtx.fillStyle = '#ffffff';
            eCtx.fillRect(x, y, w, h);
        }
        
        dCtx.fillStyle = '#ffffff';
        dCtx.fillRect(x + w/2 - 2, y, 4, h); 
        dCtx.fillRect(x, y + h/2 - 2, w, 4); 
        
        if (isLit) {
            eCtx.fillStyle = '#000000'; 
            eCtx.fillRect(x + w/2 - 2, y, 4, h); 
            eCtx.fillRect(x, y + h/2 - 2, w, 4); 
        }
        
        dCtx.strokeStyle = '#333333';
        dCtx.lineWidth = 4;
        dCtx.strokeRect(x, y, w, h);
    };

    drawWindow(64, 128, 128, 128);
    drawWindow(320, 128, 128, 128);
    
    dCtx.fillStyle = '#553311';
    dCtx.fillRect(200, 320, 112, 192);
    
    const dTex = new CanvasTexture(dCanvas);
    dTex.wrapS = RepeatWrapping; dTex.wrapT = RepeatWrapping; dTex.repeat.set(1, 1);
    
    const eTex = new CanvasTexture(eCanvas);
    eTex.wrapS = RepeatWrapping; eTex.wrapT = RepeatWrapping; eTex.repeat.set(1, 1);
    
    return { diffuseMap: dTex, emissiveMap: eTex };
}

export function createProceduralLeafTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#4da84a';
    ctx.beginPath();
    ctx.moveTo(32, 4);
    ctx.quadraticCurveTo(60, 20, 32, 60);
    ctx.quadraticCurveTo(4, 20, 32, 4);
    ctx.fill();
    
    ctx.strokeStyle = '#2d682a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(32, 60); ctx.lineTo(32, 10);
    ctx.moveTo(32, 40); ctx.lineTo(45, 25);
    ctx.moveTo(32, 40); ctx.lineTo(19, 25);
    ctx.moveTo(32, 50); ctx.lineTo(42, 40);
    ctx.moveTo(32, 50); ctx.lineTo(22, 40);
    ctx.stroke();
    
    return new CanvasTexture(canvas);
}

export function createProceduralFoliageTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#0a1d12';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 3500; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const r = 1 + Math.random() * 3.5;
        const alpha = 0.06 + Math.random() * 0.22;
        ctx.fillStyle = Math.random() > 0.35 ? `rgba(34, 197, 94, ${alpha})` : `rgba(16, 85, 48, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
    return texture;
}

export function createParticleTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new CanvasTexture(canvas);
}
