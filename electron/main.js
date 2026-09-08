const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let server;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    title: "LynDrop",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../client/public/icon-512.png"),
  });

  // Open the local server
  win.loadURL("http://localhost:3000");
}

app.whenReady().then(() => {
  const serverPath = path.join(__dirname, "../server/index.js");

  // Use Electron's bundled Node (works after installation)
  server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  setTimeout(createWindow, 1200);
});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});