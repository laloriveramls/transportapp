// public/js/theme.js

(function () {
    const root = document.documentElement;
    const btn = document.getElementById("themeToggle");
    const moonIcon = btn?.querySelector(".theme-icon-moon");
    const sunIcon = btn?.querySelector(".theme-icon-sun");

    function applyTheme(theme) {
        root.setAttribute("data-theme", theme);
        localStorage.setItem("theme", theme);

        if (moonIcon && sunIcon) {
            const isDark = theme === "dark";
            moonIcon.style.display = isDark ? "none" : "";
            sunIcon.style.display = isDark ? "" : "none";
        }

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute("content", theme === "dark" ? "#0a0a0a" : "#fafafa");
        }
    }

    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") {
        applyTheme(saved);
    } else {
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        applyTheme(prefersDark ? "dark" : "light");
    }

    if (btn) {
        btn.addEventListener("click", () => {
            const current = root.getAttribute("data-theme") || "light";
            applyTheme(current === "dark" ? "light" : "dark");
        });
    }
})();
