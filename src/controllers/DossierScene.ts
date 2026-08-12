import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { tweenManager, Easing } from '../utils/animation';
import { createDossierGeometry, type DossierPage } from './dossier/DossierGeometry';
import { attachTabToPage } from './dossier/DossierTabs';
import { spotlightConfig, spotlightUniforms } from './dossier/shaders';
import { createProjectTexture } from './dossier/DossierPageContent';
import { categories } from '../data/categories';

export function setupDossierScene() {
    const zone = document.querySelector('.dossier-zone');
    const canvas = document.getElementById('dossier-canvas') as HTMLCanvasElement | null;
    
    if (!zone || !canvas) return { destroy: () => {} };

    // Setup Three.js scene
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
    renderer.setClearColor(0x020508, 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020508);

    // Lighting
    const ambient = new THREE.AmbientLight(0x0a1420, 0.8);
    const keyLight = new THREE.PointLight(0xa6d8ff, 8, 20);
    keyLight.position.set(5, 5, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.001;
    const fillLight = new THREE.PointLight(0x4488cc, 4, 18);
    fillLight.position.set(-5, -3, 6);
    scene.add(ambient, keyLight, fillLight);

    // Spotlight
    const cursorLight = new THREE.SpotLight(0x82d6ff, 0, 12, Math.PI / 5, 0.8, 2.0);
    cursorLight.position.set(0, 0, 5);
    cursorLight.castShadow = true;
    cursorLight.shadow.mapSize.width = 1024;
    cursorLight.shadow.mapSize.height = 1024;
    cursorLight.shadow.bias = -0.002;
    const cursorLightTarget = new THREE.Object3D();
    cursorLightTarget.position.set(0, 0, 0);
    scene.add(cursorLightTarget);
    cursorLight.target = cursorLightTarget;
    scene.add(cursorLight);
    
    let cursorLightTargetIntensity = 0;

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, -2, 22);
    camera.lookAt(0, 0, 0);

    // Post-Processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85
    );
    bloomPass.threshold = 0.95;
    bloomPass.strength = 0.15;
    bloomPass.radius = 0.6;

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Build Dossier
    const dossier = createDossierGeometry();
    
    // Initial orientation — tilted and rotated
    const baseRotX = Math.PI / 8;
    const baseRotY = -Math.PI / 12;
    dossier.group.rotation.x = baseRotX;
    dossier.group.rotation.y = baseRotY;
    
    dossier.group.scale.set(0.85, 0.85, 0.85);
    dossier.group.position.y = -3;

    scene.add(dossier.group);

    const hitboxes: THREE.Mesh[] = [];
    const allPages: DossierPage[] = [];
    let currentSpreadIndex = 0;



    let pageZOffset = 0.06;
    let tabIndex = 0;
    const categoryStartIndices: Record<string, number> = {};

    categories.forEach(cat => {
        categoryStartIndices[cat.id] = allPages.length;

        cat.projects.forEach((proj, pIdx) => {
            const pageId = `${cat.id}-${pIdx}`;
            const page = dossier.createPage(pageId, pageZOffset);
            
            const { textTex, geomTex } = createProjectTexture(proj, cat, Object.keys(categoryStartIndices).length, dossier.BOOK_WIDTH, dossier.BOOK_HEIGHT);
            const pMat = page.mesh.material as THREE.MeshPhysicalMaterial;
            pMat.emissiveMap = textTex;
            pMat.emissive = new THREE.Color(0xffffff);
            pMat.emissiveIntensity = 1.5;
            
            page.uniforms.tGeometry = { value: geomTex };

            if (pIdx === 0) {
                const { hitbox } = attachTabToPage(
                    page.group, 
                    cat, 
                    tabIndex, 
                    categories.length, 
                    dossier.BOOK_WIDTH, 
                    dossier.BOOK_HEIGHT, 
                    dossier.materials
                );
                hitboxes.push(hitbox);
                tabIndex++;
            }
            
            page.group.userData = { project: proj, category: cat, baseZ: pageZOffset };
            allPages.push(page);
            pageZOffset -= 0.001;
        });
    });

    dossier.frontCover.rotation.y = 0;
    dossier.frontCover.userData = { baseZ: 0.15 };

    // --- State Machine ---
    let bookState: 'FLOATING' | 'OPENING' | 'OPEN' | 'CLOSING' = 'FLOATING';
    
    const targetParallax = new THREE.Vector2(0, 0);
    const currentParallax = new THREE.Vector2(0, 0);
    let hoveredTab: THREE.Object3D | null = null;

    // Page Flipping Logic (with Physics)
    const flipToPage = (targetIndex: number) => {
        if (targetIndex === currentSpreadIndex) return;

        const startIndex = Math.min(currentSpreadIndex, targetIndex);
        currentSpreadIndex = targetIndex;
        
        for (let i = 0; i < allPages.length; i++) {
            const page = allPages[i];
            const shouldBeOpen = i < targetIndex;

            if (page.isOpen !== shouldBeOpen) {
                page.isOpen = shouldBeOpen;
                
                const targetRot = shouldBeOpen ? -Math.PI : 0;
                const delay = Math.abs(i - startIndex) * 50;
                const baseZ = page.group.userData.baseZ;

                setTimeout(() => {
                    tweenManager.to({
                        from: page.group.rotation.y,
                        to: targetRot,
                        duration: 800,
                        easing: Easing.easeOutCubic,
                        onUpdate: (v) => {
                            page.group.rotation.y = v;
                            const rotNorm = Math.abs(v / Math.PI); 
                            
                            // Tension bend (Z and X)
                            const bend = Math.sin(rotNorm * Math.PI) * 0.8;
                            page.uniforms.uBendAmount.value = bend;
                            
                            // True Physical Stacking Z-Shift
                            const zShift = baseZ * (1.0 - 2.0 * rotNorm);
                            const zLift = Math.sin(rotNorm * Math.PI) * 0.05; // clear other pages
                            page.group.position.z = zShift + zLift;
                        }
                    });
                }, delay);
            }
        }
    };

    // Interaction 
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(9999, 9999);
    
    const trackingPlaneGeom = new THREE.PlaneGeometry(100, 100);
    const trackingPlane = new THREE.Mesh(trackingPlaneGeom, new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(trackingPlane);

    // Book Raycast Hitbox (invisible box covering the book)
    const bookHitboxGeom = new THREE.BoxGeometry(dossier.BOOK_WIDTH * 1.2, dossier.BOOK_HEIGHT * 1.2, 2.0);
    const bookHitbox = new THREE.Mesh(bookHitboxGeom, new THREE.MeshBasicMaterial({ visible: false }));
    dossier.group.add(bookHitbox);

    const onMouseMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        
        targetParallax.x = mouse.x * 0.15;
        targetParallax.y = mouse.y * 0.1;
    };
    window.addEventListener('mousemove', onMouseMove);

    const onClick = (e: MouseEvent) => {
        if (!entranceFinished) return;

        raycaster.setFromCamera(mouse, camera);
        
        if (bookState === 'FLOATING') {
            const intersects = raycaster.intersectObject(bookHitbox);
            if (intersects.length > 0) {
                // Open the book
                bookState = 'OPENING';
                
                // Tween group to flat
                tweenManager.to({
                    from: 0, to: 1, duration: 1200, easing: Easing.easeOutCubic,
                    onUpdate: (v) => {
                        dossier.group.rotation.x = baseRotX * (1 - v);
                        dossier.group.rotation.y = baseRotY * (1 - v);
                    }
                });

                // Tween cover open
                tweenManager.to({
                    from: 0, to: 1, duration: 1400, easing: Easing.easeOutCubic,
                    onUpdate: (v) => {
                        dossier.frontCover.rotation.y = -v * Math.PI;
                        const rotNorm = Math.abs(dossier.frontCover.rotation.y / Math.PI);
                        const baseZ = dossier.frontCover.userData.baseZ;
                        dossier.frontCover.position.z = baseZ * (1.0 - 2.0 * rotNorm) + (Math.sin(rotNorm * Math.PI) * 0.05);
                    },
                    onComplete: () => { bookState = 'OPEN'; }
                });
            }
        } 
        else if (bookState === 'OPEN') {
            const tabIntersects = raycaster.intersectObjects(hitboxes, true);
            if (tabIntersects.length > 0) {
                // Clicked a tab
                let obj: THREE.Object3D | null = tabIntersects[0].object;
                while (obj) {
                    if (obj.userData?.isTab && obj.userData?.categoryId) {
                        const targetIndex = categoryStartIndices[obj.userData.categoryId];
                        if (targetIndex !== undefined) {
                            flipToPage(targetIndex);
                            
                            // Cinematic Micro-Dolly Camera Push
                            tweenManager.to({
                                from: camera.fov, to: 42, duration: 800, easing: Easing.easeOutCubic,
                                onUpdate: (v) => { camera.fov = v; camera.updateProjectionMatrix(); }
                            });
                        }
                        break;
                    }
                    obj = obj.parent;
                }
            } else {
                const bookIntersects = raycaster.intersectObject(bookHitbox);
                if (bookIntersects.length === 0) {
                    // Clicked entirely outside the book -> Close it
                    bookState = 'CLOSING';
                    
                    flipToPage(0); // Flip all pages back
                    
                    // Reset Camera
                    tweenManager.to({
                        from: camera.fov, to: 45, duration: 800, easing: Easing.easeOutCubic,
                        onUpdate: (v) => { camera.fov = v; camera.updateProjectionMatrix(); }
                    });

                    // Tween group back to floating rotation
                    tweenManager.to({
                        from: 0, to: 1, duration: 1200, easing: Easing.easeOutCubic,
                        onUpdate: (v) => {
                            dossier.group.rotation.x = baseRotX * v;
                            dossier.group.rotation.y = baseRotY * v;
                        }
                    });

                    // Tween cover closed
                    tweenManager.to({
                        from: dossier.frontCover.rotation.y, to: 0, duration: 1200, easing: Easing.easeOutCubic,
                        onUpdate: (v) => {
                            dossier.frontCover.rotation.y = v;
                            const rotNorm = Math.abs(v / Math.PI);
                            const baseZ = dossier.frontCover.userData.baseZ;
                            dossier.frontCover.position.z = baseZ * (1.0 - 2.0 * rotNorm) + (Math.sin(rotNorm * Math.PI) * 0.05);
                        },
                        onComplete: () => { bookState = 'FLOATING'; }
                    });
                }
            }
        }
    };
    canvas.addEventListener('click', onClick);

    let animationFrameId: number;
    const clock = new THREE.Clock();
    let entranceFinished = false;

    const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        const timeNow = performance.now();
        const delta = clock.getDelta();
        
        tweenManager.update(timeNow);

        currentParallax.lerp(targetParallax, 0.05);
        
        if (entranceFinished && bookState === 'FLOATING') {
            dossier.group.position.y = Math.sin(timeNow * 0.0008) * 0.2;
            dossier.group.rotation.x = baseRotX - currentParallax.y;
            dossier.group.rotation.y = baseRotY + currentParallax.x;
        }

        // Update uTime for all dynamic materials
        allPages.forEach(page => {
            if (page.uniforms && page.uniforms.uTime) {
                page.uniforms.uTime.value += delta;
            }
        });
        
        // Update Spotlight position
        raycaster.setFromCamera(mouse, camera);
        const planeIntersect = raycaster.intersectObject(trackingPlane);
        if (planeIntersect.length > 0) {
            const hitPoint = planeIntersect[0].point;
            spotlightConfig.pos.lerp(hitPoint, 0.15);
            
            const lightPos = hitPoint.clone();
            lightPos.z += 4;
            cursorLight.position.lerp(lightPos, 0.12);
            cursorLightTarget.position.lerp(hitPoint, 0.12);
            
            const intersects = raycaster.intersectObjects(hitboxes, true);
            const isHoveringBook = intersects.length > 0;
            cursorLightTargetIntensity = isHoveringBook ? 1.5 : 0.5;
            spotlightConfig.intensity += ((isHoveringBook ? 1.0 : 0.8) - spotlightConfig.intensity) * 0.1;
            spotlightUniforms.uScannerIntensity.value = spotlightConfig.intensity;
            
            let currentTab: THREE.Object3D | null = null;
            if (isHoveringBook && bookState === 'OPEN') {
                let obj: THREE.Object3D | null = intersects[0].object;
                while (obj) {
                    if (obj.userData?.isTab) {
                        currentTab = obj;
                        break;
                    }
                    obj = obj.parent;
                }
            }
            
            if (currentTab !== hoveredTab) {
                if (hoveredTab) {
                    const mesh = hoveredTab.children.find(c => c instanceof THREE.Mesh && !(c.material instanceof THREE.MeshBasicMaterial)) as THREE.Mesh;
                    if (mesh && mesh.material) (mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 1.0;
                }
                hoveredTab = currentTab;
                if (hoveredTab) {
                    const mesh = hoveredTab.children.find(c => c instanceof THREE.Mesh && !(c.material instanceof THREE.MeshBasicMaterial)) as THREE.Mesh;
                    if (mesh && mesh.material) (mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 2.5; 
                }
            }
        } else {
            cursorLightTargetIntensity = 0;
            if (hoveredTab) {
                const mesh = hoveredTab.children.find(c => c instanceof THREE.Mesh && !(c.material instanceof THREE.MeshBasicMaterial)) as THREE.Mesh;
                if (mesh && mesh.material) (mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 1.0;
                hoveredTab = null;
            }
        }
        
        cursorLight.intensity += (cursorLightTargetIntensity - cursorLight.intensity) * 0.08;

        composer.render();
    };

    let hasAppeared = false;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                clock.start();
                if (!animationFrameId) animate();

                if (!hasAppeared) {
                    hasAppeared = true;
                    tweenManager.to({
                        from: 0, to: 1, duration: 1200, easing: Easing.easeOutCubic,
                        onUpdate: (v) => {
                            const s = 0.85 + v * 0.15;
                            dossier.group.scale.set(s, s, s);
                            dossier.group.position.y = -3 * (1 - v);
                        },
                        onComplete: () => { entranceFinished = true; }
                    });
                }
            } else {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = 0;
                }
            }
        });
    }, { threshold: 0 });
    observer.observe(zone);

    const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return {
        destroy: () => {
            observer.disconnect();
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('click', onClick);
            
            // Dispose of dynamically generated resources to prevent memory leaks
            allPages.forEach(page => {
                const mesh = page.mesh as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    const mat = mesh.material as THREE.MeshPhysicalMaterial;
                    if (mat.map) mat.map.dispose();
                    if (mat.emissiveMap) mat.emissiveMap.dispose();
                    mat.dispose();
                }
            });

            hitboxes.forEach(hitbox => {
                if (hitbox.geometry) hitbox.geometry.dispose();
                if (hitbox.material) {
                    if (Array.isArray(hitbox.material)) {
                        hitbox.material.forEach(m => m.dispose());
                    } else {
                        hitbox.material.dispose();
                    }
                }
            });

            trackingPlaneGeom.dispose();
            
            composer.dispose();
            renderer.dispose();
        }
    };
}
