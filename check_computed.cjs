const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('data:text/html,<html><head><style>.parent{display:none;}</style></head><body><div class="parent"><div class="child" style="width: 100%; height: 100%;"></div></div></body></html>');
    const result = await page.evaluate(() => {
        const child = document.querySelector('.child');
        return window.getComputedStyle(child).display;
    });
    console.log("Child display:", result);
    await browser.close();
})();
