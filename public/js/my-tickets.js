/* Mis boletos: lista de boletos guardados en este dispositivo (sin cuenta). */
(function () {
    "use strict";

    var KEY = "savedTickets";
    var MAX = 12;
    var CODE_RE = /^[0-9A-Z]{6,16}$/;

    function read() {
        try {
            var list = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(list) ? list.filter(function (c) { return CODE_RE.test(c); }) : [];
        } catch (e) { return []; }
    }
    function write(list) {
        try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* sin almacenamiento */ }
    }

    // Lo usa la página del boleto para guardar su código.
    window.TicketStore = {
        add: function (code) {
            code = String(code || "").toUpperCase();
            if (!CODE_RE.test(code)) return;
            write([code].concat(read().filter(function (c) { return c !== code; })));
        }
    };

    var box = document.getElementById("mtSaved");
    var forget = document.getElementById("mtForget");
    if (!box) return;

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function empty(msg) {
        box.textContent = "";
        var wrap = el("div", "mt-empty-box");
        var ico = el("span", "mt-empty-ico");
        ico.innerHTML = window.Icons ? window.Icons.svg("ticket", { size: 22 }) : "";
        wrap.appendChild(ico);
        wrap.appendChild(el("p", "mt-empty", msg));
        var cta = el("a", "btn btn-wine btn-xs", "Reservar un viaje");
        cta.href = "/reserve";
        wrap.appendChild(cta);
        box.appendChild(wrap);
        if (forget) forget.hidden = true;
    }

    function icon(name) {
        return window.Icons ? window.Icons.svg(name, { size: 15 }) : "";
    }

    // "Hoy", "Mañana", "Ayer" o la fecha corta, según el día del viaje (hora de Monterrey)
    function dayTag(dateISO) {
        var now = new Date().toLocaleDateString("en-CA", { timeZone: "America/Monterrey" });
        function diff(a, b) {
            var x = a.split("-").map(Number), y = b.split("-").map(Number);
            return Math.round((Date.UTC(x[0], x[1] - 1, x[2]) - Date.UTC(y[0], y[1] - 1, y[2])) / 86400000);
        }
        var d = diff(dateISO, now);
        if (d === 0) return "Hoy";
        if (d === 1) return "Mañana";
        if (d === -1) return "Ayer";
        return "";
    }

    var MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

    function row(t) {
        var a = el("article", "mt-row" + (t.upcoming ? "" : " is-past"));
        var parts = String(t.date).split("-");
        var date = el("div", "mt-date");
        date.appendChild(el("b", "", String(Number(parts[2]))));
        date.appendChild(el("span", "", MONTHS[Number(parts[1]) - 1] || ""));
        a.appendChild(date);

        var main = el("div", "mt-row-main");
        main.appendChild(el("strong", "", t.route));
        var tag = dayTag(t.date);
        var meta = (tag ? tag + ", " : "") + t.timeLabel + ", " + t.kind +
            (t.kind === "Pasaje" && t.seats ? " (" + t.seats + (t.seats === 1 ? " lugar)" : " lugares)") : "");
        main.appendChild(el("span", "mt-row-meta" + (tag === "Hoy" || tag === "Mañana" ? " is-soon" : ""), meta));
        a.appendChild(main);

        a.appendChild(el("span", "pill " + (t.statusClass || ""), t.status));

        var actions = el("div", "mt-row-actions");
        var see = el("a", "btn btn-wine btn-xs", "Ver boleto");
        see.href = t.url;
        var again = el("a", "btn btn-ghost btn-xs", "Reservar de nuevo");
        again.href = t.rebook;
        actions.appendChild(see);
        actions.appendChild(again);
        a.appendChild(actions);
        return a;
    }

    var codes = read();
    if (!codes.length) {
        empty("Aún no hay boletos guardados. Cuando reserves o abras un boleto, aparecerá aquí.");
        return;
    }

    fetch("/mis-boletos/guardados", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ codes: codes })
    }).then(function (r) { return r.json(); }).then(function (data) {
        if (!data || !data.ok) { empty("No pudimos cargar tus boletos. Intenta de nuevo."); return; }
        if (data.missing && data.missing.length) {
            write(read().filter(function (c) { return data.missing.indexOf(c) === -1; }));
        }
        if (!data.items.length) { empty("Aún no hay boletos guardados."); return; }
        box.textContent = "";
        var up = data.items.filter(function (t) { return t.upcoming; });
        var past = data.items.filter(function (t) { return !t.upcoming; });
        if (up.length) {
            box.appendChild(el("h3", "mt-group", "Próximos viajes"));
            up.slice().reverse().forEach(function (t) { box.appendChild(row(t)); });
        }
        if (past.length) {
            box.appendChild(el("h3", "mt-group", "Viajes anteriores"));
            past.forEach(function (t) { box.appendChild(row(t)); });
        }
        if (forget) forget.hidden = false;
        var count = document.getElementById("mtCount");
        if (count) { count.textContent = String(data.items.length); count.hidden = false; }
        // Si hay boletos guardados y no hubo un error de búsqueda, abro esa pestaña primero
        if (!document.getElementById("mtError") && window.MtTabs && !location.hash) window.MtTabs.show("guardados");
    }).catch(function () { empty("No pudimos cargar tus boletos. Revisa tu conexión."); });

    if (forget) forget.addEventListener("click", function () {
        write([]);
        empty("Se quitaron los boletos de este dispositivo.");
    });
})();

/* Formulario de búsqueda: limpia el código, da formato al teléfono y evita envíos dobles. */
(function () {
    "use strict";

    var form = document.querySelector("form.mt-form");
    if (!form) return;
    var code = document.getElementById("mtCode");
    var phone = document.getElementById("mtPhone");
    var hint = document.getElementById("mtCodeHint");
    var hintDefault = hint ? hint.textContent : "";

    function cleanCode(raw) {
        var text = String(raw || "");
        var m = text.match(/\/ticket\/([0-9A-Za-z]+)/); // enlace pegado completo
        if (m) text = m[1];
        return text.toUpperCase().replace(/[^0-9A-Z]/g, "");
    }

    function formatPhone(raw) {
        var d = String(raw || "").replace(/\D/g, "");
        if (d.length > 10) d = d.slice(-10);
        return d.replace(/^(\d{3})(\d{0,3})(\d{0,4}).*$/, function (_, a, b, c) {
            return [a, b, c].filter(Boolean).join(" ");
        });
    }

    function mark(name, ok) {
        var w = document.querySelector('[data-wrap="' + name + '"]');
        if (w) w.classList.toggle("is-valid", !!ok);
    }
    function checkCode() { var n = cleanCode(code.value).length; mark("code", n >= 8 && n <= 12); }
    function checkPhone() { mark("phone", phone.value.replace(/\D/g, "").length === 10); }

    if (code) {
        code.addEventListener("input", function () {
            checkCode();
            var cleaned = cleanCode(code.value);
            if (cleaned !== code.value.toUpperCase()) code.value = cleaned;
            else code.value = code.value.toUpperCase();
            if (hint) {
                var n = cleaned.length;
                hint.textContent = n && (n < 8 || n > 12) ? "Llevas " + n + " caracteres. Los códigos tienen de 8 a 12." : hintDefault;
            }
        });
        // Si lo pegan, también limpio de inmediato
        code.addEventListener("paste", function () { setTimeout(function () { code.value = cleanCode(code.value); checkCode(); }, 0); });
        checkCode();
    }

    if (phone) {
        phone.addEventListener("input", function () { phone.value = formatPhone(phone.value); checkPhone(); });
        phone.value = formatPhone(phone.value);
        checkPhone();
    }

    form.addEventListener("submit", function () {
        var btn = form.querySelector(".mt-submit");
        if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    });
})();

/* Pestañas: Buscar boleto / En este dispositivo (mismo componente visual que la portada). */
(function () {
    "use strict";
    var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-mt-tab]"));
    if (!tabs.length) return;
    var panes = {};
    tabs.forEach(function (b) { panes[b.getAttribute("data-mt-tab")] = document.getElementById(b.getAttribute("aria-controls")); });

    function show(name) {
        if (!panes[name]) name = "buscar";
        Object.keys(panes).forEach(function (k) {
            var on = k === name;
            panes[k].hidden = !on;
            panes[k].classList.toggle("is-active", on);
        });
        tabs.forEach(function (b) {
            var on = b.getAttribute("data-mt-tab") === name;
            b.classList.toggle("active", on);
            b.setAttribute("aria-selected", on ? "true" : "false");
        });
    }
    window.MtTabs = { show: show };

    tabs.forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-mt-tab")); }); });
    var hash = String(location.hash || "").replace("#", "");
    show(panes[hash] ? hash : "buscar");

    var err = document.getElementById("mtError");
    if (err) {
        var code = document.getElementById("mtCode");
        if (code) code.focus();
    }
})();
