/* Carretera animada Victoria - Llera (portada y Mis boletos). */
/* ===== Ruta animada: la camioneta va y viene entre Victoria y Llera ===== */
(function () {
    const scene = document.getElementById("roadScene");
    const car = document.getElementById("roadCar");
    const toggle = document.getElementById("roadToggle");
    if (!scene || !car) return;

    const signStart = scene.querySelector('[data-road-end="start"]');
    const signEnd = scene.querySelector('[data-road-end="end"]');
    const iconPause = toggle && toggle.querySelector('[data-road-icon="pause"]');
    const iconPlay = toggle && toggle.querySelector('[data-road-icon="play"]');

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const STORE_KEY = "roadAnim";
    const DWELL_MS = 2600;     // parada en cada ciudad
    const ACCEL = 230;         // px/s²
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

    let width = 0, carW = 0, pad = 24, vmax = 120;
    let x = 0, v = 0, tilt = 0;
    let dir = 1;               // 1 = hacia Llera (derecha), -1 = hacia Victoria
    let mode = "dwell";        // dwell | cruise | follow
    let dwellUntil = null;
    let target = null;
    let last = 0, raf = 0, visible = false, releaseTimer = 0;
    let at = "";               // "start" | "end" | ""

    function readStored() {
        try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    }
    function writeStored(val) {
        try { localStorage.setItem(STORE_KEY, val); } catch (e) { /* sin almacenamiento */ }
    }

    const stored = readStored();
    let paused = stored ? stored === "paused" : reduce.matches;

    function bounds() {
        return { min: pad, max: Math.max(pad, width - carW - pad) };
    }

    function measure() {
        width = scene.clientWidth;
        carW = car.offsetWidth;
        pad = clamp(width * 0.04, 14, 72);
        vmax = clamp(width / 8, 90, 190);
        scene.style.setProperty("--pad", pad.toFixed(0) + "px");
        scene.style.setProperty("--carw", carW + "px");
    }

    function setAt(next) {
        if (next === at) return;
        at = next;
        if (signStart) signStart.classList.toggle("is-here", at === "start");
        if (signEnd) signEnd.classList.toggle("is-here", at === "end");
    }

    function paint() {
        car.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0)";
        car.style.setProperty("--tilt", tilt.toFixed(2) + "deg");
        car.classList.toggle("is-flip", dir > 0);
        car.classList.toggle("is-moving", Math.abs(v) > 6);
        // El cartel de la ciudad se resalta siempre que la camioneta esté en ella (también en modo seguir)
        const b = bounds();
        setAt(x <= b.min + 10 ? "start" : (x >= b.max - 10 ? "end" : ""));
        // Parallax de los cerros según la posición de la camioneta (-0.5 … 0.5)
        const px = width > 0 ? (x + carW / 2) / width - 0.5 : 0;
        scene.style.setProperty("--px", px.toFixed(3));
    }

    function syncToggle() {
        if (!toggle) return;
        toggle.setAttribute("aria-label", paused ? "Reanudar animación de la camioneta" : "Pausar animación de la camioneta");
        toggle.title = paused ? "Reanudar animación" : "Pausar animación";
        if (iconPause) iconPause.hidden = paused;
        if (iconPlay) iconPlay.hidden = !paused;
        scene.classList.toggle("is-paused", paused);
    }

    function frame(t) {
        raf = 0;
        if (!visible || document.hidden || paused) { last = 0; return; }
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
        last = t;
        const { min, max } = bounds();
        const prevV = v;
        let desired = 0;

        if (mode === "follow" && target !== null) {
            const goal = clamp(target - carW / 2, min, max);
            const dx = goal - x;
            if (Math.abs(dx) > 3) {
                dir = dx > 0 ? 1 : -1;
                desired = dir * Math.min(vmax * 2.2, Math.sqrt(2 * ACCEL * 1.6 * Math.abs(dx)));
            }
        } else if (mode === "dwell") {
            if (dwellUntil === null) dwellUntil = t + DWELL_MS;
            if (t >= dwellUntil) {
                dwellUntil = null;
                dir = -dir;
                mode = "cruise";
            }
        } else {
            const remaining = dir > 0 ? max - x : x - min;
            desired = dir * Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, remaining)) + 8);
            if (remaining < 0.8 && Math.abs(v) < 14) {
                x = dir > 0 ? max : min;
                v = 0;
                desired = 0;
                mode = "dwell";
                dwellUntil = null;
                setAt(dir > 0 ? "end" : "start");
            }
        }

        const maxDv = ACCEL * dt * (desired === 0 ? 1.6 : 1);
        v += clamp(desired - v, -maxDv, maxDv);
        x = clamp(x + v * dt, min, max);
        if ((x === min && v < 0) || (x === max && v > 0)) v = 0;

        // Cabeceo leve al arrancar y al frenar
        const accel = dt > 0 ? (v - prevV) / dt : 0;
        tilt += (clamp(-accel / ACCEL, -1, 1) * 1.4 - tilt) * Math.min(1, dt * 8);

        paint();
        raf = requestAnimationFrame(frame);
    }

    function start() {
        if (raf || paused || !visible || document.hidden) return;
        last = 0;
        raf = requestAnimationFrame(frame);
    }

    function park() {
        measure();
        x = Math.max(0, (width - carW) / 2);
        v = 0;
        tilt = 0;
        paint();
    }

    function setPaused(next) {
        paused = next;
        writeStored(paused ? "paused" : "playing");
        syncToggle();
        if (paused) {
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
            v = 0;
            tilt = 0;
            paint();
        } else {
            if (mode === "follow") mode = "cruise";
            start();
        }
    }

    if (toggle) toggle.addEventListener("click", () => setPaused(!paused));

    scene.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch" || paused) return;
        if (toggle && toggle.contains(e.target)) return;
        target = e.clientX - scene.getBoundingClientRect().left;
        mode = "follow";
        dwellUntil = null;
        clearTimeout(releaseTimer);
        start();
    });

    scene.addEventListener("pointerleave", () => {
        if (mode !== "follow") return;
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(() => {
            target = null;
            mode = "cruise";
        }, 1200);
    });

    function spawn(cls, host, styles, text) {
        const el = document.createElement("span");
        el.className = cls;
        if (text) el.textContent = text;
        Object.assign(el.style, styles);
        el.addEventListener("animationend", () => el.remove(), { once: true });
        host.appendChild(el);
    }

    scene.addEventListener("pointerdown", (e) => {
        if (toggle && toggle.contains(e.target)) return;
        // En pantallas táctiles el toque manda la camioneta hacia ese punto
        if (e.pointerType === "touch" && !paused) {
            target = e.clientX - scene.getBoundingClientRect().left;
            mode = "follow";
            dwellUntil = null;
            clearTimeout(releaseTimer);
            releaseTimer = setTimeout(() => { target = null; mode = "cruise"; }, 1800);
            start();
        }
        if (reduce.matches) return;
        car.classList.remove("is-hop");
        void car.offsetWidth;
        car.classList.add("is-hop");

        // Nubecitas de polvo detrás de las llantas
        const back = dir > 0 ? x + carW * 0.14 : x + carW * 0.86;
        for (let i = 0; i < 4; i++) {
            spawn("road-dust", scene, {
                left: (back + (Math.random() - 0.5) * 14).toFixed(0) + "px",
                "--dx": ((dir > 0 ? -1 : 1) * (14 + Math.random() * 26)).toFixed(0) + "px",
                "--s": (0.7 + Math.random() * 0.9).toFixed(2),
                animationDelay: (i * 40) + "ms",
            });
        }
    });

    car.addEventListener("animationend", (e) => {
        if (e.animationName === "road-car-hop") car.classList.remove("is-hop");
    });

    window.addEventListener("resize", () => {
        measure();
        const { min, max } = bounds();
        x = clamp(x, min, max);
        if (paused) park(); else paint();
    });
    document.addEventListener("visibilitychange", start);

    measure();
    syncToggle();
    if (paused) {
        park();
    } else {
        x = bounds().min;
        dir = 1;
        setAt("start");
        paint();
    }

    if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
            visible = entries[0].isIntersecting;
            if (visible) start();
        }, { threshold: 0.1 }).observe(scene);
    } else {
        visible = true;
        start();
    }
})();
