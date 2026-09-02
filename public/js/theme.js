// public/js/theme.js

(function(){
    const root = document.documentElement;
    const icon = document.getElementById('themeIcon');
    const btn = document.getElementById('themeToggle');

    function applyTheme(theme){
        root.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (icon) {
            icon.src = theme === 'dark' ? '/assets/icons/sun.svg' : '/assets/icons/moon.svg';
            icon.alt = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
        }
    }

    // init
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
        applyTheme(saved);
    } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    }

    if (btn){
        btn.addEventListener('click', () => {
            const current = root.getAttribute('data-theme') || 'light';
            applyTheme(current === 'dark' ? 'light' : 'dark');
        });
    }
})();
