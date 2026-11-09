// public/js/confirm.js
// Diálogo de confirmación propio (reemplaza window.confirm) + formularios con data-confirm + anti doble envío.
"use strict";

(function () {
    const ICONS = {danger: "triangle-alert", primary: "info"};
    let opened = null; // only one dialog at a time

    function icon(name, size) {
        return window.Icons && typeof window.Icons.svg === "function" ? window.Icons.svg(name, {size}) : "";
    }

    function focusables(root) {
        return Array.from(root.querySelectorAll("button:not([disabled]), [href], input:not([disabled])"));
    }

    /**
     * Confirm.ask({title, message, confirmText, cancelText, tone, action})
     * - tone: "danger" | "primary"
     * - action (optional): async () => ({ok, message}). While it runs the dialog stays open with a spinner;
     *   if it fails the message is shown inside the dialog and the user can retry or cancel.
     * Resolves true when confirmed (and the action, if any, succeeded), false otherwise.
     */
    function ask(opts = {}) {
        if (opened) opened.close(false);

        const tone = opts.tone === "danger" ? "danger" : "primary";
        const previous = document.activeElement;
        const uid = `cdlg${Date.now()}`;

        const overlay = document.createElement("div");
        overlay.className = "cdlg-overlay";
        overlay.innerHTML = `
            <div class="cdlg is-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="${uid}-t" aria-describedby="${uid}-m">
                <div class="cdlg-ico" aria-hidden="true">${icon(opts.icon || ICONS[tone], 22)}</div>
                <h2 class="cdlg-title" id="${uid}-t"></h2>
                <p class="cdlg-msg" id="${uid}-m"></p>
                <p class="cdlg-error" role="alert" hidden></p>
                <div class="cdlg-actions">
                    <button type="button" class="cdlg-btn cdlg-cancel"></button>
                    <button type="button" class="cdlg-btn cdlg-ok"></button>
                </div>
            </div>`;

        const dlg = overlay.querySelector(".cdlg");
        const okBtn = overlay.querySelector(".cdlg-ok");
        const cancelBtn = overlay.querySelector(".cdlg-cancel");
        const errEl = overlay.querySelector(".cdlg-error");
        overlay.querySelector(".cdlg-title").textContent = opts.title || "¿Confirmar?";
        overlay.querySelector(".cdlg-msg").textContent = opts.message || "";
        okBtn.textContent = opts.confirmText || "Confirmar";
        cancelBtn.textContent = opts.cancelText || "Cancelar";
        if (!opts.message) overlay.querySelector(".cdlg-msg").hidden = true;

        let busy = false;
        let settle;
        const done = new Promise((resolve) => { settle = resolve; });

        function close(result) {
            if (!opened || opened.overlay !== overlay) return;
            opened = null;
            overlay.classList.remove("is-open");
            document.body.classList.remove("cdlg-lock");
            document.removeEventListener("keydown", onKey, true);
            setTimeout(() => overlay.remove(), 160);
            if (previous && typeof previous.focus === "function") previous.focus({preventScroll: true});
            settle(result);
        }

        async function confirmNow() {
            if (busy) return;
            if (typeof opts.action !== "function") return close(true);

            busy = true;
            errEl.hidden = true;
            okBtn.classList.add("is-busy");
            okBtn.disabled = true;
            cancelBtn.disabled = true;

            let res;
            try {
                res = await opts.action();
            } catch {
                res = {ok: false, message: "No pude completar la acción. Intenta de nuevo."};
            }

            busy = false;
            okBtn.classList.remove("is-busy");
            okBtn.disabled = false;
            cancelBtn.disabled = false;

            if (res && res.ok === false) {
                errEl.textContent = res.message || "No se pudo completar la acción.";
                errEl.hidden = false;
                okBtn.focus();
                return;
            }
            close(true);
        }

        function onKey(e) {
            if (e.key === "Escape") {
                e.preventDefault();
                if (!busy) close(false);
                return;
            }
            if (e.key !== "Tab") return;
            const items = focusables(dlg);
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        okBtn.addEventListener("click", confirmNow);
        cancelBtn.addEventListener("click", () => { if (!busy) close(false); });
        overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && !busy) close(false); });

        document.body.appendChild(overlay);
        document.body.classList.add("cdlg-lock");
        document.addEventListener("keydown", onKey, true);
        opened = {overlay, close};
        requestAnimationFrame(() => overlay.classList.add("is-open"));

        // Destructive dialogs start on "Cancelar" so Enter never confirms by accident.
        (tone === "danger" ? cancelBtn : okBtn).focus({preventScroll: true});
        return done;
    }

    window.Confirm = {ask};

    /* ---------- Forms: <form data-confirm="..." data-confirm-title="..." data-confirm-ok="..." data-confirm-tone="danger"> ---------- */
    function markBusy(form, submitter) {
        const buttons = submitter ? [submitter] : Array.from(form.querySelectorAll("button[type=submit], input[type=submit]"));
        // Deferred so the browser has already collected the submitter's name/value.
        setTimeout(() => {
            form.classList.add("is-submitting");
            buttons.forEach((b) => { b.classList.add("is-busy"); b.setAttribute("aria-busy", "true"); b.disabled = true; });
        }, 0);
    }

    document.addEventListener("submit", async (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (form.classList.contains("is-submitting")) { e.preventDefault(); return; }

        const submitter = e.submitter || null;

        if (form.hasAttribute("data-confirm") && form.dataset.confirmed !== "1") {
            e.preventDefault();
            const ok = await ask({
                title: form.dataset.confirmTitle || "¿Confirmar?",
                message: form.dataset.confirm,
                confirmText: form.dataset.confirmOk || "Confirmar",
                tone: form.dataset.confirmTone || "primary",
            });
            if (!ok) return;
            form.dataset.confirmed = "1";
            if (typeof form.requestSubmit === "function") form.requestSubmit(submitter || undefined);
            else form.submit();
            return;
        }

        if (String(form.method).toLowerCase() === "post") markBusy(form, submitter);
    }, true);

    // Back/forward cache: never leave a form stuck in the busy state.
    window.addEventListener("pageshow", () => {
        document.querySelectorAll("form.is-submitting").forEach((f) => {
            f.classList.remove("is-submitting");
            delete f.dataset.confirmed;
            f.querySelectorAll(".is-busy").forEach((b) => { b.classList.remove("is-busy"); b.removeAttribute("aria-busy"); b.disabled = false; });
        });
    });
})();
