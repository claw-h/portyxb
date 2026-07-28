import './GrafxLoader.css';

export function setupGrafxLoader() {
  const shell = document.querySelector('[data-grafx-shell]');
  const tabs = document.querySelectorAll('.grafx-tab');
  const contents = document.querySelectorAll('.grafx-tab-content');
  const closeBtn = document.querySelector('.grafx-btn--close');

  if (!shell) return;

  // We can manually boot the OS for testing purposes or wait for TelevisionScene to trigger it
  // For now, let's expose a global way to boot it, which TelevisionScene will call
  (window as any).bootGrafxOS = () => {
    shell.classList.add('is-booting');
  };

  // Tab switching logic
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetId = (e.currentTarget as HTMLElement).getAttribute('data-tab-target');
      
      // Remove active classes
      tabs.forEach(t => t.classList.remove('is-active'));
      contents.forEach(c => c.classList.remove('is-active'));

      // Add active class to clicked tab and its target content
      tab.classList.add('is-active');
      const targetContent = document.getElementById(targetId || '');
      if (targetContent) {
        targetContent.classList.add('is-active');
      }
    });
  });

  // Basic close functionality
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      shell.classList.remove('is-booting');
    });
  }
}
