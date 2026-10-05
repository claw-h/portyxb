const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768, isMobile: true, hasTouch: true });
    await page.goto('data:text/html,<html><body><script>document.write(window.matchMedia("(pointer: coarse)").matches)</script></body></html>');
    const result = await page.evaluate(() => document.body.innerText);
    console.log("Pointer coarse:", result);
    await browser.close();
})();
