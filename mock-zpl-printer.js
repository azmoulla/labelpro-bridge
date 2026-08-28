// mock-zpl-printer.js
// Stand-in for a real Zebra printer's raw TCP listener (port 9100), for testing the
// Direct Network print path end-to-end WITHOUT owning a physical Zebra printer.
//
// This does NOT touch any app code — it's a standalone dev utility. Run it in its own
// terminal, then in the real app set a printer's Calibration to Direct Network with IP
// 127.0.0.1, select it as the Active Warehouse Printer, and hit Print. The real Bridge
// (running normally via `npm start`) will open a real TCP socket to this script exactly
// as it would to a real printer — this verifies the whole chain (UI -> generateZPLForTemplate
// -> Bridge's /print-zpl-socket -> raw socket send) except the final physical print.
//
// Each received label is printed to the console and saved to ./received-zpl/ so you can
// paste it into Labelary (http://labelary.com/viewer.html) to visually confirm it renders
// correctly, closing the loop between what the real app generates and what a printer would
// actually receive.
//
// Usage: node mock-zpl-printer.js

const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 9100; // matches the Bridge's hardcoded fallback (App.jsx doesn't send a
                    // custom port yet, so this is the only port worth listening on)
const OUT_DIR = path.join(__dirname, 'received-zpl');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const server = net.createServer((socket) => {
    const chunks = [];
    console.log(`\n📡 Connection from ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (chunk) => chunks.push(chunk));

    socket.on('end', () => {
        const zpl = Buffer.concat(chunks).toString('utf8');
        const filename = `label-${Date.now()}.zpl`;
        fs.writeFileSync(path.join(OUT_DIR, filename), zpl);

        console.log(`✅ Received ${Buffer.byteLength(zpl, 'utf8')} bytes, saved to received-zpl/${filename}`);
        console.log('--- ZPL content ---');
        console.log(zpl);
        console.log('-------------------');
        console.log(`Paste this into http://labelary.com/viewer.html to see how it would print.`);
    });

    socket.on('error', (err) => console.error('Socket error:', err.message));
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`🖨️  Mock ZPL printer listening on 127.0.0.1:${PORT}`);
    console.log(`   Set your printer's Calibration IP to 127.0.0.1, select it as your`);
    console.log(`   Active Warehouse Printer, and print a label from the app.`);
    console.log(`   Received labels are saved to: ${OUT_DIR}`);
});
