// 1. IMPORTS
const { app, Tray, Menu, nativeImage } = require('electron');
const express = require('express');
const cors = require('cors');
const path = require('path');
const ptp = require('pdf-to-printer'); 
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const Vault = require('./vault'); // Ensure vault.js is in the same folder
const { exec } = require('child_process');

// 2. Initialize Supabase
const supabaseUrl = 'https://zzkzdlxhgpjfebsydygv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6a3pkbHhoZ3BqZmVic3lkeWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MDEwODYsImV4cCI6MjA4MDI3NzA4Nn0.nyfdWkKOJIoTdzekYK5Jxvni6K4vPOONKSqnEB1uMy8';
const { BrowserWindow, ipcMain } = require('electron');
// 3. Initialize the server
const server = express();
server.use(cors({ origin: '*' })); 
server.use(express.json({ limit: '50mb' })); 

// 1. Force the app to be a "Single Instance"
const isPrimaryInstance = app.requestSingleInstanceLock();

if (!isPrimaryInstance) {
    app.quit(); 
} else {
    // 2. Register the protocol 'labelpro://'
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('labelpro', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('labelpro');
    }
    // --- 🛡️ VIRTUAL PRINTER HELPERS RESTORED ---


const validatePrinterName = async (name) => {
    if (!name || typeof name !== 'string') return null;
    try {
        const printers = await ptp.getPrinters();
        const hit = printers.find(p => p.name === name);
        return hit ? hit.name : null;
    } catch (e) {
        return null;
    }
};
    // 3. Handle when the browser calls labelpro://
    app.on('second-instance', (event, commandLine) => {
        console.log("Browser signaled the Bridge via Protocol.");
    });

    // --- 🔌 ENDPOINTS ---

    // 1. STATUS
    server.get('/status', async (req, res) => {
        console.log("🔍 [DEBUG] App is pinging /status");
        try {
            const printers = await ptp.getPrinters();
            const identity = Vault.loadIdentity(); 
            
            res.status(200).json({ 
                status: 'online', 
                printers: printers,
                pairedUser: identity ? identity.userId : 'NONE'
            });
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    });

    // 2. PAIR (SECURED WITH VH2 VAULT)
    server.post('/pair', (req, res) => {
        console.log("🤝 [DEBUG] Receiving Pairing Request...");
        const { userId, sessionToken } = req.body; 

        console.log("   -> Received UserID:", userId);
        console.log("   -> Token Length:", sessionToken ? sessionToken.length : 0);

        if (!userId || !sessionToken) {
            console.error("❌ [DEBUG] Pairing failed: Missing ID or Token");
            return res.status(400).json({ error: "Missing identity data." });
        }

        const success = Vault.saveIdentity(userId, sessionToken); 

        if (success) {
            console.log(`✅ [VAULT] Hardware encrypted and locked to ${userId}.`);
            res.status(200).json({ success: true, message: "Handshake Secured in Vault" });
        } else {
            console.error("❌ [VAULT] Hardware Encryption Failed.");
            res.status(500).json({ error: "Hardware Encryption Failed" });
        }
    });

    // 3. THE CLEANUP (Logout)
    server.post('/logout', (req, res) => {
        Vault.clearIdentity(); 
        console.log("[VAULT] Hardware unlinked (User Logged Out)");
        res.status(200).json({ success: true });
    });

    // 4. HARDWARE PROBE (Phase 2)
    server.post('/probe', async (req, res) => {
        console.log("🔍 [PROBE] Receiving Hardware DNA Request...");
        const { printer } = req.body;
        
        if (!printer) {
            console.error("❌ [PROBE] Failed: Missing printer name.");
            return res.status(400).json({ error: "Missing printer name." });
        }

        console.log(`   -> Probing: "${printer}"`);

        const virtualTerms = ['pdf', 'onenote', 'virtual', 'xps', 'fax'];
        const isVirtual = virtualTerms.some(term => printer.toLowerCase().includes(term));

        if (isVirtual) {
            console.log("⚠️ [PROBE] Virtual Device detected. Applying standard 300DPI/0-Margin DNA.");
            const fallbackDna = { dpiX: 300, dpiY: 300, offsetX: 0, offsetY: 0 };
            return res.status(200).json({ success: true, dna: fallbackDna });
        }

        const psScript = `
            try {
                Add-Type -AssemblyName System.Drawing;
                $s = New-Object System.Drawing.Printing.PrinterSettings;
                $s.PrinterName = '${printer}';
                if ($s.IsValid) {
                    $p = $s.DefaultPageSettings;
                    $res = $s.PrinterResolution;
                    if (!$res) { $res = $p.PrinterResolution }
                    $data = @{
                        dpiX = [int]$res.X;
                        dpiY = [int]$res.Y;
                        offsetX = [float]$p.HardMarginX;
                        offsetY = [float]$p.HardMarginY;
                    };
                    $data | ConvertTo-Json -Compress;
                } else {
                    throw "Printer not valid in .NET context";
                }
            } catch {
                Write-Error $_.Exception.Message;
                exit 1;
            }
        `.replace(/\n/g, ' '); 

        exec(`powershell -NoProfile -Command "${psScript}"`, (err, stdout, stderr) => {
            if (err || stderr) {
                console.error("❌ [PROBE] Hardware inspection failed. Using fallback.");
                const emergencyDna = { dpiX: 300, dpiY: 300, offsetX: 0, offsetY: 0 };
                return res.status(200).json({ success: true, dna: emergencyDna, note: "power-shell-fallback" });
            }

            try {
                if (!stdout || stdout.trim().length === 0) throw new Error("Empty output");
                const dna = JSON.parse(stdout);
                console.log(`✅ [PROBE] DNA Extracted: DPI(${dna.dpiX}x${dna.dpiY}) Offset(${dna.offsetX},${dna.offsetY})`);
                res.status(200).json({ success: true, dna });
            } catch (parseErr) {
                console.error("❌ [PROBE] Parse error:", parseErr.message);
                res.status(500).json({ error: "Failed to parse hardware DNA." });
            }
        });
    });

    // 5. PHASE 3: V2H ENGINE (Trace Mode - Preserves all Moat/Auth logic)
server.post('/print-v2h', async (req, res) => {
        console.log("\n--- 🚀 V2H ENGINE: NATIVE ELECTRON PRINT START ---");
        const { dna, userId, printer } = req.body;
        
        try {
            const identity = Vault.loadIdentity();
            if (!identity || identity.userId !== userId) {
                return res.status(403).json({ error: "Bridge/Account mismatch." });
            }

            const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
                global: { headers: { Authorization: `Bearer ${identity.token}` } },
                 realtime: { transport: WebSocket }
            });

            const { data: profile } = await userSupabase.from('profiles').select('subscription_status').eq('id', userId).maybeSingle();
            const { data: memberData } = await userSupabase.from('organization_members').select('organizations(subscription_status)').eq('user_id', userId).maybeSingle();
            
            const authorizedStatuses = ['active', 'trialing', 'past_due', 'gold', 'silver', 'diamond', 'ultimate'];
            const profileStatus = String(profile?.subscription_status || 'inactive').toLowerCase();
            const orgStatus = String(memberData?.organizations?.subscription_status || 'inactive').toLowerCase();
            const isAuthorized = authorizedStatuses.includes(profileStatus) || authorizedStatuses.includes(orgStatus);

            if (!isAuthorized) {
                return res.status(403).json({ error: "Account inactive." });
            }

            const safePrinter = await validatePrinterName(printer);
            if (!safePrinter) return res.status(400).json({ error: 'Printer not found.' });

            const { objects, hardwareDNA, dimensions, batchData } = dna;
            const offX = (hardwareDNA?.offsetX || 0) * 0.254 * 3.78;
            const offY = (hardwareDNA?.offsetY || 0) * 0.254 * 3.78;

            // Resolve physical page size in mm → microns for webContents.print()
            const PAGE_SIZES_MM = { a4: [210, 297], letter: [215.9, 279.4], a5: [148, 210], a3: [297, 420] };
            let pgW, pgH;
            if (Array.isArray(dimensions.pageFormat)) {
                [pgW, pgH] = dimensions.pageFormat;
            } else if (typeof dimensions.pageFormat === 'string' && PAGE_SIZES_MM[dimensions.pageFormat.toLowerCase()]) {
                [pgW, pgH] = PAGE_SIZES_MM[dimensions.pageFormat.toLowerCase()];
            } else {
                pgW = dimensions.pageWidth || 210;
                pgH = dimensions.pageHeight || 297;
            }

            const jobId = Date.now().toString() + Math.random().toString(36).substring(7);

            // rip-error listener MUST be registered before execute-rip is sent,
            // otherwise worker errors silently swallow and the request hangs forever.
            ipcMain.once('rip-error-' + jobId, (event, msg) => {
                ipcMain.removeAllListeners('rip-ready-' + jobId);
                ripWorker.webContents.send('clear-rip');
                console.error("❌ RIP WORKER ERROR:", msg);
                if (!res.headersSent) res.status(500).json({ error: "RIP Error: " + msg });
            });

            ipcMain.once('rip-ready-' + jobId, () => {
                ipcMain.removeAllListeners('rip-error-' + jobId);
                console.log(`📍 Milestone 6: Native Spooling to ${safePrinter}...`);
                ripWorker.webContents.print({
                    silent: true,
                    deviceName: safePrinter,
                    margins: { marginType: 'none' },
                    printBackground: true,
                    pageSize: {
                        width:  Math.floor(pgW * 1000),
                        height: Math.floor(pgH * 1000)
                    }
                }, (success, errorReason) => {
                    ripWorker.webContents.send('clear-rip');
                    if (success) {
                        console.log("✅ V2H COMPLETE: Native Spool Success.");
                        if (!res.headersSent) res.status(200).json({ success: true });
                    } else {
                        console.error("❌ PRINT FAIL:", errorReason);
                        if (!res.headersSent) res.status(500).json({ error: "Spooling failed: " + errorReason });
                    }
                });
            });

            ripWorker.webContents.send('execute-rip', { objects, dimensions, offX, offY, jobId, batchData, hardwareDNA });

           
        } catch (err) {
            console.error("💥 V2H ENGINE CRITICAL ERROR:", err.message);
            res.status(500).json({ error: "Internal Engine Error: " + err.message });
        }
    });
    // 6. LEGACY PRINT (PDF Fallback)
    server.post('/print', async (req, res) => {
        console.log("--- 🕵️ MOAT INSPECTION START ---");
        const { printer, fileData, userId } = req.body;
        
        const identity = Vault.loadIdentity(); 

        console.log("1. Request UserID:", userId);
        console.log("2. Saved Vault UserID:", identity?.userId);
        
        const tokenParts = identity?.token ? identity.token.split('.').length : 0;
        console.log("3. Token Integrity Check (Parts):", tokenParts);

        try {
            if (!identity || identity.userId !== userId) {
                console.error("❌ MOAT FAIL: ID Mismatch");
                return res.status(403).json({ error: "Bridge/Account mismatch." });
            }

            if (tokenParts !== 3) {
                console.error("❌ MOAT FAIL: Security Token invalid.");
                return res.status(403).json({ error: "Security Token invalid. Please re-log in." });
            }

            const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
                global: { headers: { Authorization: `Bearer ${identity.token}` } },
                realtime: { transport: WebSocket }
            });

            console.log("4. Fetching Profiles Table via User JWT...");
            const { data: profile, error: pError } = await userSupabase
                .from('profiles')
                .select('subscription_status')
                .eq('id', userId)
                .maybeSingle();

            if (pError) console.error("   DB Error (Profile):", pError.message);
            
            console.log("5. Fetching Org Members Table via User JWT...");
            const { data: memberData, error: mError } = await userSupabase
                .from('organization_members')
                .select('organizations(subscription_status)')
                .eq('user_id', userId)
                .maybeSingle();

            if (mError) console.error("   DB Error (Org):", mError.message);

            const authorizedStatuses = ['active', 'trialing', 'past_due', 'gold', 'silver', 'diamond', 'ultimate'];
            const profileStatus = String(profile?.subscription_status || 'inactive').toLowerCase();
            const orgStatus = String(memberData?.organizations?.subscription_status || 'inactive').toLowerCase();

            const isAuthorized = authorizedStatuses.includes(profileStatus) || authorizedStatuses.includes(orgStatus);
            const currentStatus = authorizedStatuses.includes(orgStatus) ? orgStatus : profileStatus;

            if (!isAuthorized) {
                console.error(`❌ DENIED: Account locked (Status: ${currentStatus})`);
                return res.status(403).json({ error: "Account inactive. Please renew to resume printing." });
            }

            console.log(`✅ MOAT PASSED: Account Active (${currentStatus}). Sending to printer...`);
            
            // Inside server.post('/print'), update the file writing section:
if (fileData && printer) {
    const tempFilePath = path.join(app.getPath('temp'), `labelpro_${Date.now()}.pdf`);
    
    // USE writeFileSync to block until done
    fs.writeFileSync(tempFilePath, fileData, 'base64');
    
    // ADD A 250ms "Safety Buffer" for Windows file locking
    setTimeout(async () => {
        try {
           await ptp.print(tempFilePath, { printer: printer.trim() });
            console.log(`✅ Legacy Spool Success.`);
            if (!res.headersSent) res.status(200).json({ success: true });
        } catch (printErr) {
            console.error("❌ Physical Printer Error:", printErr.message);
            if (!res.headersSent) res.status(500).json({ error: printErr.message });
        } finally {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        }
    }, 250);
}
            res.status(200).json({ success: true });

        } catch (err) {
            console.error("💥 CRITICAL ERROR:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ---------------------------------------------------------
    // 2. THE GHOST (Electron Tray Wrapper)
    // ---------------------------------------------------------
  
    //app.disableHardwareAcceleration();

    // Global reference for our RIP engine
let ripWorker = null;
let tray = null; // Keep tray globally to prevent garbage collection

app.whenReady().then(() => {
    // --- PART 1: CORE BRIDGE LOGIC (DO NOT REMOVE) ---
    app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe')
    });
    
    if (app.dock) app.dock.hide();

    // Start the local bridge listener
    server.listen(4000, () => {
        console.log('✅ Ghost Bridge active on port 4000');
    });

    // Setup the System Tray
    let iconPath = path.join(__dirname, 'icon.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();

    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'LabelPro Print Bridge', enabled: false },
        { type: 'separator' },
        { label: '🟢 Status: Online', enabled: false },
        { label: '🔌 Port: 4000', enabled: false }, 
        { type: 'separator' },
        { 
            label: 'Quit Bridge', 
            click: () => { 
                app.quit(); 
                process.exit(0);
            } 
        }
    ]);

    tray.setToolTip('LabelPro Print Bridge');
    tray.setContextMenu(contextMenu);
    tray.setTitle(' LabelPro'); 
console.log("📍 Initializing V2H RIP Engine...");
    
ripWorker = new BrowserWindow({
    width: 1200, // Increased to ensure A4/Letter fits
    height: 1200,
    show: true,  // MUST be true so Chromium paints the vectors
    x: -5000,    // Move it far to the left of the monitor
    y: -5000,    // Move it far above the monitor
    focusable: false,
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
    }
});

    // CRITICAL: Pipe hidden worker logs to your terminal
    ripWorker.webContents.on('console-message', (event, level, message) => {
        console.log(`[RIP WORKER] ${message}`);
    });

const workerHtml = `
    <html>
    <head>
        <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&display=swap" rel="stylesheet">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></script>
        <style>
            @page { margin: 0; size: auto; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #fff; }

            /* One div per physical page */
            .rip-page {
                position: relative;
                overflow: hidden;
                page-break-after: always;
                page-break-inside: avoid;
                background: #fff;
            }
            .rip-page:last-child { page-break-after: avoid; }

            /* Each label slot is absolutely positioned within its page */
            .rip-slot {
                position: absolute;
                overflow: hidden;
            }

            /* The SVG from fabric.toSVG() fills the slot exactly.
               width/height on the <svg> element are overridden to 100%
               so the viewBox handles all scaling — fully resolution-independent. */
            .rip-slot svg {
                display: block;
                width: 100%;
                height: 100%;
            }

            /* Scratch canvas — never printed */
            canvas { display: none; }
        </style>
    </head>
    <body>
        <canvas id="labelCanvas"></canvas>
    </body>
    <script>
        const { ipcRenderer } = require('electron');

        const PAGE_SIZES_MM = { a4:[210,297], letter:[215.9,279.4], a5:[148,210], a3:[297,420] };
        // fabric.js object coordinates are in screen pixels (96 DPI = 3.78 px/mm)
        const SCREEN_PX = 96 / 25.4;

        const GUIDE_IDS = [
            'guide','safe-guide','bleed-guide','guide-v','guide-h',
            'ghost-zone','ghost-zone-bg','ghost-zone-text','hole-punch-guide'
        ];

        document.fonts.load('16px "Alex Brush"').then(() => console.log("RIP: Fonts Primed"));

        // Re-render a barcode value to a PNG data URL using JsBarcode.
        // Called whenever a variable barcode's text changes so the src updates.
        const renderBarcodeSVG = (value, type) => {
            try {
                if (!value) return null;
                const safeType = (type || 'code128').toUpperCase();
                let format = 'CODE128';
                if (safeType.includes('EAN13') || safeType === 'EAN') format = 'EAN13';
                else if (safeType.includes('EAN8'))  format = 'EAN8';
                else if (safeType.includes('UPC'))   format = 'UPC';
                else if (safeType.includes('ITF'))   format = 'ITF14';
                else if (safeType.includes('CODE39')) format = 'CODE39';
                
                const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                JsBarcode(svgNode, String(value), {
                    format: format, 
                    width: 2, 
                    height: 40,        // Bar height
                    displayValue: true, // Show numbers
                    margin: 0,         // FIX: No margin prevents shrinking
                    fontSize: 18       // Large font for readability
                });
                
                // Capture the actual dimensions JsBarcode generated
                const bw = svgNode.getAttribute('width') || "150";
                const bh = svgNode.getAttribute('height') || "70";
                
                // Manual concatenation avoids backtick nesting crashes
                const safeViewBox = svgNode.getAttribute('viewBox') || ("0 0 " + bw + " " + bh);
                
                return {
                    viewBox: safeViewBox,
                    inner: svgNode.innerHTML
                };
            } catch (e) {
                console.warn('Barcode render failed: ' + e.message);
                return null;
            }
        };

        ipcRenderer.on('clear-rip', () => {
            document.body.innerHTML = '<canvas id="labelCanvas" style="display:none;"></canvas>';
        });

        ipcRenderer.on('execute-rip', async (event, payload) => {
            let { objects, dimensions, offX, offY, jobId, batchData } = payload;
            try {
                if (typeof objects === 'string') objects = JSON.parse(objects);
                if (objects && objects.objects) objects = objects.objects;

                const cols          = dimensions.cols || 1;
                const rows          = dimensions.rows || 1;
                const labelsPerPage = cols * rows;

                // ── PAGE SIZE (mm) ───────────────────────────────────────────────────
                let pW, pH;
                if (Array.isArray(dimensions.pageFormat)) {
                    [pW, pH] = dimensions.pageFormat;
                } else if (typeof dimensions.pageFormat === 'string' && PAGE_SIZES_MM[dimensions.pageFormat.toLowerCase()]) {
                    [pW, pH] = PAGE_SIZES_MM[dimensions.pageFormat.toLowerCase()];
                } else {
                    pW = dimensions.pageWidth  || 210;
                    pH = dimensions.pageHeight || 297;
                }

                // ── LABEL GEOMETRY (mm) ──────────────────────────────────────────────
                // SVG is resolution-independent — all positioning is in mm, no DPI needed.
                const labelWmm  = dimensions.width;
                const labelHmm  = dimensions.height;
                const xMarginMm = dimensions.x_margin || 0;
                const yMarginMm = dimensions.y_margin || 0;
                const xGapMm    = dimensions.x_gap    || 0;
                const yGapMm    = dimensions.y_gap    || 0;

                // Hardware offset: offX/offY arrive in screen pixels from the main process.
                // Convert to mm for SVG positioning.
                const offXmm = (offX || 0) / SCREEN_PX;
                const offYmm = (offY || 0) / SCREEN_PX;

                // ── LABEL CANVAS (screen-pixel size — matches fabric.js coord space) ─
                // toSVG() exports with a viewBox matching these pixel dimensions,
                // so placing the SVG in a CSS mm-sized slot scales it correctly.
                const labelWpx = Math.ceil(labelWmm * SCREEN_PX);
                const labelHpx = Math.ceil(labelHmm * SCREEN_PX);

                // ── HELPER: apply one CSV row's variable data ────────────────────────
                const applyRow = (rowData) =>
                    objects
                        .filter(o => !GUIDE_IDS.includes(o.id))
                        .map(obj => {
                            if (obj.isVariable && obj.variableName && rowData) {
                                const val = rowData[obj.variableName];
                                if (val !== undefined && val !== null) return { ...obj, text: String(val) };
                            }
                            return { ...obj };
                        });

                // ── RESET DOM ────────────────────────────────────────────────────────
                document.body.innerHTML = '<canvas id="labelCanvas" style="display:none;"></canvas>';

                // Fabric canvas created after DOM reset so the element reference is valid
                const labelEl = document.getElementById('labelCanvas');
                labelEl.width  = labelWpx;
                labelEl.height = labelHpx;
                const lc = new fabric.StaticCanvas(labelEl, {
                    width: labelWpx, height: labelHpx, enableRetinaScaling: false
                });

                // ── PAGINATION LOOP ──────────────────────────────────────────────────
                const totalPages = Math.ceil(batchData.length / labelsPerPage);

                for (let page = 0; page < totalPages; page++) {
                    const pageDiv = document.createElement('div');
                    pageDiv.className = 'rip-page';
                    pageDiv.style.width  = pW + 'mm';
                    pageDiv.style.height = pH + 'mm';

                    for (let slot = 0; slot < labelsPerPage; slot++) {
                        const batchIdx = page * labelsPerPage + slot;
                        if (batchIdx >= batchData.length) break;

                        const labelObjs = applyRow(batchData[batchIdx]);

                        // Variable linear barcodes are fabric.Group objects made of rect+text
                        // children — there is no image src to update. Exclude them from the
                        // fabric render and re-inject as fresh JsBarcode SVG elements instead.
                        const isVarBC = (o) => (o.isBarcode && !o.isQrCode &&
                            o.barcodeType !== 'datamatrix' && o.isVariable && o.text);
                        const varBarcodes = labelObjs.filter(isVarBC);
                        const fabricObjs  = labelObjs.filter((o) => !isVarBC(o));

                        // Load non-barcode objects into fabric and export SVG
                        await new Promise(resolve => {
                            lc.clear();
                            lc.loadFromJSON({ objects: fabricObjs }, () => {
                                lc.getObjects().forEach(o => { if (o.type && o.type.includes('text')) o.initDimensions(); });
                                lc.renderAll();
                                resolve();
                            });
                        });

                        // fabric.toSVG() produces a complete, self-contained SVG with
                        // a viewBox matching the label's pixel dimensions. Placed inside
                        // a CSS mm-sized slot, Chromium scales it to the exact physical
                        // true vector, no rasterisation, no DPI dependency.
                        let svgString = lc.toSVG();

                        // Inject each variable barcode as a JsBarcode vector SVG
                      // FIX 2: Use "overflow=visible" to ensure numbers aren't clipped
                        for (const bc of varBarcodes) {
                            try {
                                const svgData = renderBarcodeSVG(bc.text, bc.barcodeType);
                                if (svgData) {
                                    const sX = bc.scaleX || 1, sY = bc.scaleY || 1;
                                    const objW = (bc.width  || 100) * sX;
                                    const objH = (bc.height || 50)  * sY;
                                    let tlX = bc.left || 0, tlY = bc.top || 0;
                                    
                                    if ((bc.originX || 'left') === 'center') tlX -= objW / 2;
                                    if ((bc.originY || 'top')  === 'center') tlY -= objH / 2;
                                    
                                    // preserveAspectRatio="none" stretches the vector to fill your box exactly
                                    const nestedSvgTag = '<svg x="' + Math.round(tlX) + '" y="' + Math.round(tlY) +
                                        '" width="' + Math.round(objW) + '" height="' + Math.round(objH) +
                                        '" viewBox="' + svgData.viewBox + '" preserveAspectRatio="none" overflow="visible">' + 
                                        svgData.inner + '</svg>';
                                        
                                    const lastClose = svgString.lastIndexOf('</svg>');
                                    if (lastClose !== -1) {
                                        svgString = svgString.slice(0, lastClose) + nestedSvgTag + '</svg>';
                                    }
                                }
                            } catch(e) {
                                console.warn('[RIP] BC inject failed: ' + e.message);
                            }
                        }

                        const col   = slot % cols;
                        const row   = Math.floor(slot / cols);
                        const xMm   = xMarginMm + col * (labelWmm + xGapMm) + offXmm;
                        const yMm   = yMarginMm + row * (labelHmm + yGapMm) + offYmm;

                        const slotDiv = document.createElement('div');
                        slotDiv.className    = 'rip-slot';
                        slotDiv.style.left   = xMm + 'mm';
                        slotDiv.style.top    = yMm + 'mm';
                        slotDiv.style.width  = labelWmm + 'mm';
                        slotDiv.style.height = labelHmm + 'mm';
                        slotDiv.innerHTML    = svgString;

                        // Override the SVG's pixel width/height so CSS controls the size
                        const svgEl = slotDiv.querySelector('svg');
                        if (svgEl) {
                            svgEl.setAttribute('width',  '100%');
                            svgEl.setAttribute('height', '100%');
                        }

                        pageDiv.appendChild(slotDiv);
                    }

                    document.body.appendChild(pageDiv);
                }

                lc.dispose();
                console.log('RIP: SVG Ready — ' + totalPages + ' page(s), ' + batchData.length + ' label(s)');

                // One frame for Chromium to lay out the SVG DOM before printing
                requestAnimationFrame(() => setTimeout(() => ipcRenderer.send('rip-ready-' + jobId), 300));

            } catch (err) {
                console.error('WORKER ERROR: ' + err.message);
                ipcRenderer.send('rip-error-' + jobId, err.message);
            }
        });
    </script>
    </html>
`;

    const workerPath = path.join(app.getPath('userData'), 'rip_worker.html');
    fs.writeFileSync(workerPath, workerHtml);
    ripWorker.loadFile(workerPath);
});

app.on('window-all-closed', (e) => e.preventDefault());

process.on('uncaughtException', (err) => {
    console.error('⚠️ PREVENTED CRASH: ', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ UNHANDLED REJECTION: ', reason);
});
}
