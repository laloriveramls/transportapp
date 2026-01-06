const express = require("express");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const { pool, hasDb } = require("../db");

const router = express.Router();

/* -----------------------------
   Helpers
----------------------------- */

function requireDb(req, res, next) {
    if (hasDb) return next();
    return res.status(503).render("maintenance", {
        title: "Sitio en configuración",
        message: "El sitio está activo, pero la base de datos aún no está configurada. Intenta más tarde.",
    });
}

function directionLabel(direction) {
    return direction === "VIC_TO_LLE" ? "Victoria → Llera" : "Llera → Victoria";
}

function directionLabelShort(direction) {
    return direction === "VIC_TO_LLE" ? "Victoria - Llera" : "Llera - Victoria";
}

function buildBaseUrl(req) {
    const env = String(process.env.BASE_URL || "").trim();
    if (env) return env.replace(/\/+$/, "");

    const proto = req.headers["x-forwarded-proto"]
        ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
        : req.protocol;

    return `${proto}://${req.get("host")}`;
}

function mm(n) {
    // I convert millimeters to PDF points (72pt = 1 inch).
    return (Number(n) * 72) / 25.4;
}

function money(n) {
    const v = Number(n || 0);
    try {
        return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    } catch {
        return "$" + (Math.round(v * 100) / 100);
    }
}

function folioFrom(tripDate, reservationId) {
    const ymd = String(tripDate || "").replaceAll("-", "");
    return `RES-${ymd}-${String(reservationId || "").padStart(6, "0")}`;
}

function pickHHMM(timeStr) {
    return String(timeStr || "").slice(0, 5);
}

/* -----------------------------
   GET /ticket/:code  (HTML)
----------------------------- */
router.get("/ticket/:code", requireDb, async (req, res) => {
    const { code } = req.params;

    const [[row]] = await pool.query(
        `
            SELECT
                tk.code,
                r.id AS reservation_id,
                r.customer_name,
                r.phone,
                r.type,
                r.status,
                r.seats,
                r.package_details,
                r.payment_method,
                r.transfer_ref,
                r.amount_total_mxn,
                r.created_at,

                t.trip_date,
                dt.direction,
                dt.depart_time,

                GROUP_CONCAT(p.passenger_name ORDER BY p.id SEPARATOR ', ') AS passenger_names
            FROM transporte_tickets tk
                     JOIN transporte_reservations r ON r.id = tk.reservation_id
                     JOIN transporte_trips t ON t.id = r.trip_id
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
                     LEFT JOIN transporte_reservation_passengers p ON p.reservation_id = r.id
            WHERE tk.code = ?
            GROUP BY
                tk.code, r.id, r.customer_name, r.phone, r.type, r.status, r.seats, r.package_details,
                r.payment_method, r.transfer_ref, r.amount_total_mxn, r.created_at,
                t.trip_date, dt.direction, dt.depart_time
            LIMIT 1
        `,
        [code]
    );

    if (!row) return res.status(404).send("Ticket no encontrado.");

    const baseUrl = buildBaseUrl(req);
    const url = `${baseUrl}/ticket/${row.code}`;
    const folio = folioFrom(row.trip_date, row.reservation_id);

    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 420 });

    const returnUrl = req.query.return ? String(req.query.return) : null;

    return res.render("ticket", {
        row,
        folio,
        url,
        qrDataUrl,
        returnUrl,
        directionLabel,
    });
});

/* -----------------------------
   GET /ticket/:code/pdf
   - 48mm effective width
   - 1 page per passenger
   - dotted separators
   - NO header frame
   - bigger logo
   - smaller "TICKET PAGADO" + smaller business lines + smaller KV
----------------------------- */
router.get("/ticket/:code/pdf", requireDb, async (req, res) => {
    const { code } = req.params;

    const [[row]] = await pool.query(
        `
            SELECT
                tk.code,
                r.id AS reservation_id,
                r.customer_name,
                r.phone,
                r.type,
                r.status,
                r.seats,
                r.package_details,
                r.payment_method,
                r.transfer_ref,
                r.amount_total_mxn,
                r.created_at,

                t.trip_date,
                dt.direction,
                dt.depart_time
            FROM transporte_tickets tk
                     JOIN transporte_reservations r ON r.id = tk.reservation_id
                     JOIN transporte_trips t ON t.id = r.trip_id
                     JOIN transporte_departure_templates dt ON dt.id = t.template_id
            WHERE tk.code = ?
            LIMIT 1
        `,
        [code]
    );

    if (!row) return res.status(404).send("Ticket no encontrado.");

    const baseUrl = buildBaseUrl(req);
    const url = `${baseUrl}/ticket/${row.code}`;
    const folio = folioFrom(row.trip_date, row.reservation_id);

    // I generate a tight QR for crisp thermal print.
    const qrPng = await QRCode.toBuffer(url, { margin: 0, scale: 10 });

    // Logo path (this file is in src/routes, so I go up to project root)
    const logoPath = path.join(__dirname, "..", "..", "public", "assets", "logoticket.png");
    const hasLogo = fs.existsSync(logoPath);

    // Business lines (smaller)
    const BRAND_LINE_1 = "";
    const BRAND_LINE_2 = "Comodidad • Seguridad • WiFi gratis";
    const BRAND_LINE_3 = "WhatsApp: (834) 475-63-76";

    // Page sizing
    const PAGE_W_MM = 48;
    const PAD_MM = 0.7;

    // ✅ Smaller everything + bigger logo
    const S = {
        top: 0.0,
        bottom: 1.0,
        gap: 0.45,
        lineGap: 0.75,

        // ✅ Bigger logo (mm)
        logoW: 48,
        logoH: 25,

        // ✅ Smaller business lines
        tagline: 7.0,
        whatsapp: 7.5,

        // ✅ Smaller chip text
        title: 7.8,

        // ✅ Smaller overall text
        big: 9.4,
        label: 7.2,
        value: 7.6,
        small: 6.6,

        // QR smaller (mm)
        qr: 14,
    };

    const hhmm = pickHHMM(row.depart_time);
    const ruta = directionLabelShort(row.direction);

    const pay = String(row.payment_method || "-").toUpperCase();
    const payNice =
        pay === "CASH" || pay === "EFECTIVO" ? "EFECTIVO" :
            pay === "TRANSFER" || pay === "TRANSFERENCIA" ? "TRANSFER" :
                pay === "ONLINE" ? "ONLINE" :
                    (row.payment_method || "-");

    const totalNum =
        row.amount_total_mxn != null && row.amount_total_mxn !== "" && !Number.isNaN(Number(row.amount_total_mxn))
            ? Number(row.amount_total_mxn)
            : null;

    // 1 page per passenger
    let passengerNames = [];

    if (row.type === "PASSENGER") {
        const [ps] = await pool.query(
            `
                SELECT passenger_name
                FROM transporte_reservation_passengers
                WHERE reservation_id = ?
                ORDER BY id
            `,
            [row.reservation_id]
        );

        passengerNames = (ps || [])
            .map((p) => String(p.passenger_name || "").trim())
            .filter(Boolean);

        if (passengerNames.length === 0) {
            const n = Math.max(1, Number(row.seats || 1));
            const base = String(row.customer_name || "Pasajero").trim() || "Pasajero";
            passengerNames = Array.from({ length: n }, (_, i) => (n > 1 ? `${base} #${i + 1}` : base));
        }
    } else {
        passengerNames = [null];
    }

    const paxCount = row.type === "PASSENGER" ? Math.max(1, passengerNames.length) : 1;

    // Total per page
    const totalPerPageNum =
        row.type === "PASSENGER" && totalNum != null ? (totalNum / paxCount) : totalNum;

    const totalPerPageTxt = totalPerPageNum != null ? money(totalPerPageNum) : null;
    const totalLabel = row.type === "PASSENGER" ? "TOTAL (1 PASAJERO)" : "TOTAL";

    // Auto-trim height
    const mmToPt = (n) => (Number(n) * 72) / 25.4;
    const ptToMm = (pt) => (Number(pt) * 25.4) / 72;

    const PAGE_W = mmToPt(PAGE_W_MM);
    const x = mmToPt(PAD_MM);
    const w = PAGE_W - mmToPt(PAD_MM) * 2;

    const measureDoc = new PDFDocument({
        size: [PAGE_W, mmToPt(300)],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
    });

    const hTextMm = (font, size, text, widthPt, opts = {}) => {
        measureDoc.font(font).fontSize(size);
        const h = measureDoc.heightOfString(String(text || ""), {
            width: widthPt,
            align: opts.align || "left",
        });
        return ptToMm(h);
    };

    const hKVmm = (k, v) => {
        const leftW = w * 0.55;
        const rightW = w * 0.45;
        const hl = hTextMm("Helvetica-Bold", S.label, k, leftW);
        const hr = hTextMm("Helvetica", S.value, v, rightW, { align: "right" });
        return Math.max(hl, hr) + S.gap + S.lineGap;
    };

    const calcNeedMmForPage = (passengerName, idx, total) => {
        let need = 0;
        need += S.top;

        // Header: logo + business lines (no frame)
        need += S.logoH + 0.35;
        need += hTextMm("Helvetica", S.tagline, BRAND_LINE_1, w, { align: "center" }) + 0.05;
        need += hTextMm("Helvetica", S.tagline, BRAND_LINE_2, w, { align: "center" }) + 0.05;
        need += hTextMm("Helvetica-Bold", S.whatsapp, BRAND_LINE_3, w, { align: "center" }) + 0.35;

        // Chip
        const chipTextH = hTextMm("Helvetica-Bold", S.title, "TICKET PAGADO", w, { align: "center" });
        need += chipTextH + 1.2 + 0.35;

        need += S.lineGap;

        // Folio + code + pax
        need += hTextMm("Helvetica-Bold", S.big, folio, w, { align: "center" }) + 0.30;
        need += hTextMm("Helvetica", S.value, `CÓDIGO: ${row.code}`, w, { align: "center" }) + 0.10;

        if (row.type === "PASSENGER") {
            need += hTextMm("Helvetica", S.small, `PASAJERO ${idx}/${total}`, w, { align: "center" }) + 0.35;
        } else {
            need += 0.35;
        }

        need += S.lineGap;

        // Fields
        need += hKVmm("RUTA", ruta);
        need += hKVmm("FECHA", row.trip_date);
        need += hKVmm("HORA", hhmm);
        need += hKVmm("CONTACTO", row.customer_name || "-");
        need += hKVmm("TEL", row.phone || "-");
        need += hKVmm("PAGO", payNice);
        if (totalPerPageTxt) need += hKVmm(totalLabel, totalPerPageTxt);

        if (row.type === "PASSENGER") {
            need += hKVmm("PASAJERO", passengerName || "-");
        } else {
            need += hTextMm("Helvetica-Bold", S.label, "DETALLE", w) + 0.25;
            need += hTextMm("Helvetica", S.value, row.package_details || "-", w) + 0.8;
            need += S.lineGap;
        }

        if (String(row.transfer_ref || "").trim()) {
            need += hTextMm("Helvetica-Bold", S.label, "REFERENCIA", w) + 0.25;
            need += hTextMm("Helvetica", S.value, row.transfer_ref, w) + 0.55;
            need += S.lineGap;
        }

        // QR + footer
        need += S.qr + 2.6;
        need += hTextMm("Helvetica-Bold", S.value, "ESCANEA PARA VALIDAR", w, { align: "center" }) + 0.35;
        need += hTextMm("Helvetica", S.small, url, w, { align: "center" }) + 0.75;

        need += S.bottom;
        return need;
    };

    const maxNeedMm = passengerNames.reduce((acc, pName, i) => {
        const need = calcNeedMmForPage(pName, i + 1, passengerNames.length);
        return Math.max(acc, need);
    }, 0);

    const PAGE_H_MM = Math.max(58, Math.min(120, Math.ceil(maxNeedMm)));
    const PAGE_H = mmToPt(PAGE_H_MM);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${folio}.pdf"`);

    const doc = new PDFDocument({
        size: [PAGE_W, PAGE_H],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
    });

    doc.pipe(res);

    const dotsLine = (state) => {
        doc.save();
        doc.strokeColor("#000").lineWidth(1).lineCap("round").dash(1, { space: 2.2 });
        doc.moveTo(state.x, state.y).lineTo(state.x + state.w, state.y).stroke();
        doc.undash();
        doc.restore();
        state.y += mmToPt(S.lineGap);
    };

    const centerText = (state, font, size, txt, extraGapMm = S.gap) => {
        doc.font(font).fontSize(size).fillColor("#000");
        doc.text(String(txt || ""), state.x, state.y, { width: state.w, align: "center" });
        const h = doc.heightOfString(String(txt || ""), { width: state.w, align: "center" });
        state.y += h + mmToPt(extraGapMm);
    };

    const drawBlackChip = (state, text) => {
        const chipW = state.w * 0.55;
        const chipX = state.x + (state.w - chipW) / 2;

        const padX = mmToPt(1.2);
        const padY = mmToPt(0.35);

        // font base
        let fs = Math.max(7.2, (S.title || 9.2) - 1.6);

        doc.font("Helvetica-Bold").fontSize(fs);

        // ✅ shrink-to-fit para que no haga wrap (y el alto no cambie)
        const maxTextW = chipW - padX * 2;
        while (fs > 6.4 && doc.widthOfString(text) > maxTextW) {
            fs -= 0.2;
            doc.fontSize(fs);
        }

        // ✅ altura real de UNA línea en PDFKit (más consistente que heightOfString)
        const lineH = doc.currentLineHeight(true);
        const chipH = lineH + padY * 2;

        const chipY = state.y;

        // chip
        doc.save();
        doc.fillColor("#000");
        doc.roundedRect(chipX, chipY, chipW, chipH, 2.2).fill();

        // ✅ centrado vertical REAL (+ un “nudging” óptico mínimo)
        const optical = mmToPt(0.55); // prueba 0.00 a 0.20 si lo quieres perfecto
        const textY = chipY + (chipH - lineH) / 2 + optical;

        doc.fillColor("#fff");
        doc.text(text, chipX + padX, textY, {
            width: chipW - padX * 2,
            align: "center",
            lineBreak: false,
        });

        doc.restore();

        state.y += chipH + mmToPt(0.25);
    };

    const drawCenteredLogo = (state) => {
        const logoW = mmToPt(S.logoW);
        const logoH = mmToPt(S.logoH);
        const lx = state.x + (state.w - logoW) / 2;

        if (hasLogo) {
            doc.image(logoPath, lx, state.y, { fit: [logoW, logoH], align: "center", valign: "center" });
            state.y += logoH + mmToPt(0.35);
            return;
        }

        // fallback
        centerText(state, "Helvetica-Bold", 12, "TransportApp", 0.35);
    };

    const kv = (state, k, v) => {
        const leftW = state.w * 0.55;
        const rightW = state.w * 0.45;

        doc.font("Helvetica-Bold").fontSize(S.label).fillColor("#000");
        doc.text(k, state.x, state.y, { width: leftW });

        doc.font("Helvetica").fontSize(S.value).fillColor("#000");
        doc.text(String(v ?? "-"), state.x + leftW, state.y, { width: rightW, align: "right" });

        const hl = doc.heightOfString(k, { width: leftW });
        const hr = doc.heightOfString(String(v ?? "-"), { width: rightW, align: "right" });

        state.y += Math.max(hl, hr) + mmToPt(S.gap);
        dotsLine(state);
    };

    const renderPage = (passengerName, idx, total) => {
        const state = { x, w, y: mmToPt(S.top) };

        // Header (no frame)
        drawCenteredLogo(state);
        centerText(state, "Helvetica", S.tagline, BRAND_LINE_1, 0.05);
        centerText(state, "Helvetica", S.tagline, BRAND_LINE_2, 0.05);
        centerText(state, "Helvetica-Bold", S.whatsapp, BRAND_LINE_3, 0.35);

        // Chip title smaller
        drawBlackChip(state, "TICKET PAGADO");
        state.y += mmToPt(0.8);
        dotsLine(state);

        // Folio + code
        centerText(state, "Helvetica-Bold", S.big, folio, 0.35);
        centerText(state, "Helvetica", S.value, `CÓDIGO: ${row.code}`, 0.10);

        if (row.type === "PASSENGER") {
            centerText(state, "Helvetica", S.small, `PASAJERO ${idx}/${total}`, 0.35);
        } else {
            state.y += mmToPt(0.35);
        }

        dotsLine(state);

        // Fields smaller
        kv(state, "RUTA", ruta);
        kv(state, "FECHA", row.trip_date);
        kv(state, "HORA", hhmm);
        kv(state, "CONTACTO", row.customer_name || "-");
        kv(state, "TEL", row.phone || "-");
        kv(state, "PAGO", payNice);

        if (totalPerPageTxt) kv(state, totalLabel, totalPerPageTxt);

        if (row.type === "PASSENGER") {
            kv(state, "PASAJERO", passengerName || "-");
        } else {
            doc.font("Helvetica-Bold").fontSize(S.label).fillColor("#000");
            doc.text("DETALLE", state.x, state.y, { width: state.w });
            state.y += mmToPt(3.3);

            doc.font("Helvetica").fontSize(S.value).fillColor("#000");
            doc.text(String(row.package_details || "-"), state.x, state.y, { width: state.w });
            state.y += mmToPt(3.7);

            dotsLine(state);
        }

        if (String(row.transfer_ref || "").trim()) {
            doc.font("Helvetica-Bold").fontSize(S.label).fillColor("#000");
            doc.text("REFERENCIA", state.x, state.y, { width: state.w });
            state.y += mmToPt(3.3);

            doc.font("Helvetica").fontSize(S.value).fillColor("#000");
            doc.text(String(row.transfer_ref), state.x, state.y, { width: state.w });
            state.y += mmToPt(3.7);

            dotsLine(state);
        }

        // QR smaller
        const qrSize = mmToPt(S.qr);
        const qrX = state.x + (state.w - qrSize) / 2;

        doc.save();
        doc.strokeColor("#000").lineWidth(0.9);
        doc.roundedRect(qrX - mmToPt(0.55), state.y, qrSize + mmToPt(1.1), qrSize + mmToPt(1.1), 3).stroke();
        doc.restore();

        doc.image(qrPng, qrX, state.y + mmToPt(0.55), { fit: [qrSize, qrSize] });
        state.y += qrSize + mmToPt(2.1);

        doc.font("Helvetica-Bold").fontSize(S.value).fillColor("#000");
        doc.text("ESCANEA PARA VALIDAR", state.x, state.y, { width: state.w, align: "center" });
        state.y += mmToPt(3.4);

        doc.font("Helvetica").fontSize(S.small).fillColor("#000");
        doc.text(url, state.x, state.y, { width: state.w, align: "center" });
    };

    // Render each passenger as its own page.
    for (let i = 0; i < passengerNames.length; i++) {
        if (i > 0) doc.addPage({ size: [PAGE_W, PAGE_H], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
        renderPage(passengerNames[i], i + 1, passengerNames.length);
    }

    doc.end();
});

router.get("/ticket/:code/print", requireDb, async (req, res) => {
    const code = req.params.code;

    // I'm printing the already-generated PDF by embedding it in an iframe and calling print().
    const pdfUrl = `/ticket/${encodeURIComponent(code)}/pdf`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Imprimir ticket</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
    iframe { width: 100%; height: 100%; border: 0; }
    .fallback {
      position: fixed; top: 10px; left: 10px;
      background: #fff; border: 1px solid #ddd; border-radius: 10px;
      padding: 10px 12px; font-family: system-ui, sans-serif; font-size: 14px;
    }
    .fallback button {
      padding: 8px 10px; border-radius: 10px; border: 1px solid #111; background: #111; color: #fff;
      font-weight: 700; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="fallback">
    Si no se abre automáticamente:
    <button id="btn">Imprimir</button>
  </div>

  <iframe id="pdf" src="${pdfUrl}"></iframe>

  <script>
    const iframe = document.getElementById('pdf');
    const btn = document.getElementById('btn');

    function doPrint(){
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        window.print();
      }
    }

    iframe.addEventListener('load', () => {
      setTimeout(doPrint, 250);
    });

    btn.addEventListener('click', doPrint);
  </script>
</body>
</html>`);
});

module.exports = router;
