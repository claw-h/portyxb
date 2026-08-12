import * as THREE from 'three';
import type { Category, Project } from '../../data/categories';

export function createProjectTexture(project: Project, category: Category, categoryIndex: number, width: number, height: number): { textTex: THREE.CanvasTexture, geomTex: THREE.CanvasTexture } {
    const scale = 128;
    const w = width * scale;
    const h = height * scale;

    // --- GEOMETRY CANVAS ---
    const geomCanvas = document.createElement('canvas');
    geomCanvas.width = w;
    geomCanvas.height = h;
    const gCtx = geomCanvas.getContext('2d');
    
    if (gCtx) {
        gCtx.clearRect(0, 0, w, h);
        gCtx.lineWidth = 1;
        gCtx.strokeStyle = `rgba(130, 214, 255, 0.25)`; // Slightly brighter since it'll be masked/rotated
        
        const cx = w * 0.7;
        const cy = h * 0.6;
        const variant = categoryIndex % 3;
        
        if (variant === 0) {
            // Orbital rings
            for(let i=1; i<=5; i++) {
                gCtx.beginPath();
                gCtx.arc(cx, cy, i * 180, 0, Math.PI * 2);
                gCtx.stroke();
            }
            gCtx.beginPath(); gCtx.moveTo(cx, cy - 900); gCtx.lineTo(cx, cy + 900); gCtx.stroke();
            gCtx.beginPath(); gCtx.moveTo(cx - 900, cy); gCtx.lineTo(cx + 900, cy); gCtx.stroke();
        } else if (variant === 1) {
            // Metatron's Cube abstract
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 / 6) * i;
                const px = cx + Math.cos(angle) * 350;
                const py = cy + Math.sin(angle) * 350;
                gCtx.beginPath(); gCtx.arc(px, py, 150, 0, Math.PI * 2); gCtx.stroke();
                gCtx.beginPath(); gCtx.moveTo(cx, cy); gCtx.lineTo(px, py); gCtx.stroke();
            }
            gCtx.beginPath(); gCtx.arc(cx, cy, 350, 0, Math.PI * 2); gCtx.stroke();
        } else {
            // Seed of Life abstract
            gCtx.beginPath(); gCtx.arc(cx, cy, 250, 0, Math.PI * 2); gCtx.stroke();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 / 6) * i;
                const px = cx + Math.cos(angle) * 250;
                const py = cy + Math.sin(angle) * 250;
                gCtx.beginPath(); gCtx.arc(px, py, 250, 0, Math.PI * 2); gCtx.stroke();
            }
        }
        
        gCtx.save();
        gCtx.translate(cx, cy);
        gCtx.rotate(categoryIndex * Math.PI / 2);
        gCtx.beginPath();
        for (let i = 0; i < 400; i++) {
            const angle = 0.1 * i;
            const x = (1 + angle) * Math.cos(angle) * 15;
            const y = (1 + angle) * Math.sin(angle) * 15;
            if (i === 0) gCtx.moveTo(x, y);
            else gCtx.lineTo(x, y);
        }
        gCtx.strokeStyle = `rgba(130, 214, 255, 0.12)`;
        gCtx.stroke();
        gCtx.restore();

        // Apply edge mask to geometry
        gCtx.globalCompositeOperation = 'destination-in';
        const gMask = gCtx.createRadialGradient(w/2, h/2, h*0.1, w/2, h/2, h*0.8);
        gMask.addColorStop(0, 'rgba(0,0,0,1)');
        gMask.addColorStop(1, 'rgba(0,0,0,0)');
        gCtx.fillStyle = gMask;
        gCtx.fillRect(0, 0, w, h);
        gCtx.globalCompositeOperation = 'source-over';
    }

    // --- TEXT CANVAS ---
    const textCanvas = document.createElement('canvas');
    textCanvas.width = w;
    textCanvas.height = h;
    const tCtx = textCanvas.getContext('2d');
    
    if (tCtx) {
        tCtx.clearRect(0, 0, w, h);
        const px = 140;
        const py = 200;
        let yCursor = py;

        tCtx.font = '300 22px "Fira Code", monospace, sans-serif';
        tCtx.fillStyle = 'rgba(160, 192, 208, 0.6)';
        tCtx.letterSpacing = '4px';
        tCtx.fillText(`REC.${Math.floor(Math.random() * 9000) + 1000} // CLS: OMEGA // SECTOR: ${category.id.toUpperCase()}`, px, yCursor - 60);
        tCtx.letterSpacing = '0px';

        tCtx.font = '500 24px monospace';
        tCtx.fillStyle = category.accent;
        tCtx.fillText(`[ ${category.label.toUpperCase()} ]`, px, yCursor);
        yCursor += 80;

        tCtx.font = 'italic 400 130px "Playfair Display", "Georgia", serif';
        tCtx.fillStyle = '#ffffff';
        const titleMaxWidth = w - (px * 2.5);
        const titleWords = project.title.split(' ');
        let titleLine = '';
        const titleLineHeight = 140;
        
        for (let n = 0; n < titleWords.length; n++) {
            const testLine = titleLine + titleWords[n] + ' ';
            const metrics = tCtx.measureText(testLine);
            if (metrics.width > titleMaxWidth && n > 0) {
                tCtx.fillText(titleLine, px, yCursor);
                titleLine = titleWords[n] + ' ';
                yCursor += titleLineHeight;
            } else {
                titleLine = testLine;
            }
        }
        tCtx.fillText(titleLine, px, yCursor);
        yCursor += 120;

        tCtx.beginPath();
        tCtx.moveTo(px, yCursor - 40);
        tCtx.lineTo(px + 200, yCursor - 40);
        tCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        tCtx.lineWidth = 2;
        tCtx.stroke();

        tCtx.font = '300 38px "Inter", "Helvetica Neue", sans-serif';
        tCtx.fillStyle = '#a0c0d0';
        const blurbMaxWidth = w * 0.6;
        const words = project.blurb.split(' ');
        let line = '';
        const lineHeight = 60;
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = tCtx.measureText(testLine);
            if (metrics.width > blurbMaxWidth && n > 0) {
                tCtx.fillText(line, px, yCursor);
                line = words[n] + ' ';
                yCursor += lineHeight;
            } else {
                line = testLine;
            }
        }
        tCtx.fillText(line, px, yCursor);
        
        const bY = h - 140;
        tCtx.font = '20px monospace';
        tCtx.fillStyle = 'rgba(160, 192, 208, 0.4)';
        const hash = Math.random().toString(36).substring(2, 10).toUpperCase();
        tCtx.fillText(`SYS.HASH: ${hash} | LAT: ${Math.random().toFixed(4)} LON: ${Math.random().toFixed(4)}`, px, bY);

        // Apply edge mask to text
        tCtx.globalCompositeOperation = 'destination-in';
        const tMask = tCtx.createRadialGradient(w/2, h/2, h*0.2, w/2, h/2, h*0.7);
        tMask.addColorStop(0, 'rgba(0,0,0,1)');
        tMask.addColorStop(1, 'rgba(0,0,0,0)');
        tCtx.fillStyle = tMask;
        tCtx.fillRect(0, 0, w, h);
        tCtx.globalCompositeOperation = 'source-over';
    }

    const geomTex = new THREE.CanvasTexture(geomCanvas);
    geomTex.anisotropy = 8;
    
    const textTex = new THREE.CanvasTexture(textCanvas);
    textTex.anisotropy = 8;

    return { textTex, geomTex };
}
