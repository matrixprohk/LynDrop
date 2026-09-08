const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Serve React build
app.use(express.static(path.join(__dirname, "../client/dist")));

const io = new Server(server);

const devices = {};

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Register device
  socket.on("register-device", (device) => {
    devices[socket.id] = {
      id: socket.id,
      name: device.name,
      hostname: device.hostname,
    };

    io.emit("device-list", Object.values(devices));
  });

  // WebRTC signaling
  socket.on("signal", (data) => {
    io.to(data.target).emit("signal", {
      from: socket.id,
      signal: data.signal,
    });
  });

  // ===== 6-DIGIT PAIRING =====

  // Sender requests pairing
  socket.on("pair-request", (data) => {
    io.to(data.target).emit("pair-request", {
      from: socket.id,
      hostname: devices[socket.id]?.hostname,
      code: data.code,
    });
  });

  // Receiver accepts / rejects pairing
  socket.on("pair-response", (data) => {
    io.to(data.target).emit("pair-response", {
      accepted: data.accepted,
    });
  });

  // ===== FILE PERMISSION =====

  // Ask receiver before sending
  socket.on("file-request", (data) => {
    io.to(data.target).emit("file-request", {
      from: socket.id,
      name: data.name,
      size: data.size,
      hostname: data.hostname,
    });
  });

  // Receiver accepts / rejects file
  socket.on("file-response", (data) => {
    io.to(data.target).emit("file-response", {
      accepted: data.accepted,
    });
  });

  // Disconnect
  socket.on("disconnect", () => {
    delete devices[socket.id];

    io.emit("device-list", Object.values(devices));

    console.log("Disconnected:", socket.id);
  });
});

// React fallback
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

server.listen(3000, "0.0.0.0", () => {
  console.log("LANDrop running on http://localhost:3000");
});