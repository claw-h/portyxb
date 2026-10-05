const puppeteer = require('puppeteer');

(async () => {
    console.log("Launching browser...");
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Simulate larger mobile device (iPad Mini or large phone)
    await page.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    
    console.log("Navigating...");
    await page.goto('http://localhost:4322', { waitUntil: 'networkidle0' });
    
    console.log("Waiting for preloader...");
    // Wait for preloader to fade (it takes about 2.5s)
    await new Promise(r => setTimeout(r, 4000));
    
    await page.screenshot({ path: 'screenshot-ipad.png' });
    
    // Evaluate if buttons exist and their dimensions/visibility
    const buttonStats = await page.evaluate(() => {
        const idCard = document.querySelector('.id-card');
        const archive = document.querySelector('.archive-btn');
        const overlay = document.querySelector('.dom-overlay');
        const gate = document.querySelector('#mobile-gate');
        const wrapper = document.querySelector('.dossier-wrapper');
        const sticky = document.querySelector('.dossier-sticky');
        const zone = document.querySelector('.dossier-zone');
        
        const getStyle = (el, name) => {
            if (!el) return null;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
                id: name,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right },
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                zIndex: style.zIndex,
                position: style.position,
                bottom: style.bottom,
                left: style.left,
                right: style.right,
                pointerEvents: style.pointerEvents,
                containerHeight: el.parentElement ? el.parentElement.clientHeight : null
            };
        };
        
        return {
            isMobileGateClass: document.documentElement.classList.contains('is-mobile-gate'),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            zone: getStyle(zone, 'zone'),
            sticky: getStyle(sticky, 'sticky'),
            wrapper: getStyle(wrapper, 'wrapper'),
            overlay: getStyle(overlay, 'overlay'),
            gate: getStyle(gate, 'gate'),
            idCard: getStyle(idCard, 'idCard'),
            archive: getStyle(archive, 'archive')
        };
    });
    
    console.log(JSON.stringify(buttonStats, null, 2));
    
    await browser.close();
})();
