const { contextBridge, ipcRenderer } = require('electron');

// We "bridge" only the specific commands the RIP worker needs
contextBridge.exposeInMainWorld('bridgeAPI', {
    onExecuteRip: (callback) => ipcRenderer.on('execute-rip', (event, data) => callback(data)),
    sendRipComplete: (jobId, pageImages) => ipcRenderer.send('rip-complete-' + jobId, pageImages)
});