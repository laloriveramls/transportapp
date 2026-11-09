// public/js/copy.js
// Copia texto al portapapeles sin usar alert(): intenta la API moderna, luego execCommand, y si falla
// selecciona el texto y muestra el aviso dentro del propio "toast" de la página.
"use strict";

(function () {
    function legacyCopy(text) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch {
            ok = false;
        }
        ta.remove();
        return ok;
    }

    function selectNode(el) {
        if (!el || !window.getSelection) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    /**
     * copyText(text, {toastEl, selectEl, okMs, errorText})
     * toastEl: the existing ".copy-toast" element ("Copiado"); it is reused to show the error too.
     * selectEl: element whose text gets selected when copying is impossible, so the user can copy by hand.
     */
    window.copyText = async function copyText(text, opts = {}) {
        const value = String(text || "");
        const toast = opts.toastEl || null;
        if (toast && toast.dataset.okHtml === undefined) toast.dataset.okHtml = toast.innerHTML;

        let ok = false;
        try {
            await navigator.clipboard.writeText(value);
            ok = true;
        } catch {
            ok = legacyCopy(value);
        }

        if (!ok) selectNode(opts.selectEl);

        if (toast) {
            toast.classList.toggle("is-error", !ok);
            if (ok) toast.innerHTML = toast.dataset.okHtml;
            else toast.textContent = opts.errorText || "No se pudo copiar. Mantén presionado el texto para copiarlo.";
            toast.style.display = "inline-flex";
            toast.setAttribute("role", ok ? "status" : "alert");
            clearTimeout(window.__copyToastTimer);
            window.__copyToastTimer = setTimeout(() => { toast.style.display = "none"; }, ok ? (opts.okMs || 1400) : 4000);
        }
        return ok;
    };
})();
