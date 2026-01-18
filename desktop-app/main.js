const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 450,
        height: 650,
        minWidth: 400,
        minHeight: 500,
        resizable: true,
        icon: path.join(__dirname, 'icon.ico'),
        frame: true, // Trình chạy Electron nên có frame để dễ đóng/di chuyển
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        title: "NovaOTP Desktop",
        autoHideMenuBar: true
    });

    win.loadFile('index.html');

    // Mở các link ngoài bằng trình duyệt hệ thống
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
