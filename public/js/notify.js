// public/js/notify.js
"use strict";

(function () {
    function hasBootstrapToast() {
        return window.bootstrap && typeof window.bootstrap.Toast === "function";
    }

    function restartProgress(toastEl) {
        // Re-trigger CSS progress animation when the same toast is shown again.
        toastEl.classList.remove("show");
        // Force reflow so removing + re-adding .show restarts toastIn / progress.
        void toastEl.offsetWidth;
    }

    window.notify = function notify(message, opts = {}) {
        const msg = String(message || "").trim() || "Listo";
        const variant = (opts.variant || "dark"); // dark | success | danger | warning | info
        const delay = Number.isFinite(opts.delay) ? opts.delay : 2200;

        const toastEl = document.getElementById("appToast");
        const msgEl = document.getElementById("appToastMsg");
        const titleEl = document.getElementById("appToastTitle");
        const iconEl = document.getElementById("appToastIcon");

        if (!toastEl || !msgEl) {
            alert(msg);
            return;
        }

        toastEl.setAttribute("data-variant", variant);
        toastEl.style.setProperty("--toast-duration", `${delay}ms`);

        const titles = {
            dark: "Listo",
            success: "Listo",
            info: "Info",
            warning: "Atención",
            danger: "Error"
        };
        const icons = {
            dark: "check",
            success: "check",
            info: "info",
            warning: "triangle-alert",
            danger: "ban"
        };

        if (titleEl) titleEl.textContent = opts.title || titles[variant] || "Listo";
        if (iconEl) {
            const iconName = icons[variant] || "info";
            iconEl.innerHTML = (window.Icons && typeof window.Icons.svg === "function")
                ? window.Icons.svg(iconName, { size: 18, className: "ico ico-toast" })
                : "";
        }
        msgEl.textContent = msg;

        restartProgress(toastEl);

        if (!hasBootstrapToast()) {
            toastEl.classList.add("show");
            window.clearTimeout(toastEl._hideTimer);
            toastEl._hideTimer = window.setTimeout(() => toastEl.classList.remove("show"), delay);
            return;
        }

        const t = window.bootstrap.Toast.getOrCreateInstance(toastEl, {
            delay,
            autohide: true,
            animation: false // CSS owns enter animation
        });
        t.show();
    };
})();
