try {
    const isTouchOrMobile = 
        window.matchMedia('(max-width: 1366px) and (pointer: coarse)').matches || 
        window.matchMedia('(max-width: 768px)').matches ||
        ('ontouchstart' in window) || 
        navigator.maxTouchPoints > 0 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
} catch (e) { console.log(e.toString()); }
