
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { socket } from "./socket";
import { createPeer, listenSignals, getChannel } from "./webrtc";

export default function App() {
  const [devices, setDevices] = useState([]);
  const [myId, setMyId] = useState("");
  const [connecting, setConnecting] = useState("");
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [serverURL, setServerURL] = useState("");
  const [previews, setPreviews] = useState([]);
  const [pairRequest, setPairRequest] = useState(null);
  const [pairing, setPairing] = useState(false);
  const [theme, setTheme] = useState(
  localStorage.getItem("theme") || "dark"
);

  // NEW: Progress
  const [progress, setProgress] = useState({
  active: false,
  fileName: "",
  sent: 0,
  total: 0,
  speed: 0,
  eta: 0,
});

  // Save theme
useEffect(() => {
  localStorage.setItem("theme", theme);
}, [theme]);

// Initialize app
useEffect(() => {
  const hostname =
    localStorage.getItem("hostname") ||
    `DESKTOP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  localStorage.setItem("hostname", hostname);

  listenSignals(socket);

  const host = window.location.hostname;
const protocol = window.location.protocol;
const port = window.location.port || "3000";

setServerURL(`${protocol}//${host}:${port}`);

  socket.on("connect", () => {
    setMyId(socket.id);

    socket.emit("register-device", {
      name: "Windows PC",
      hostname,
    });
  });
  
  socket.on("pair-request", (data) => {
  setPairRequest(data);
});

socket.on("pair-response", (data) => {
  if (!data.accepted) {
    alert("Pairing rejected.");
    setPairing(false);
  }
});

  socket.on("device-list", setDevices);
  socket.on("file-request", setIncoming);

  return () => {
    socket.off("connect");
    socket.off("device-list");
    socket.off("file-request");
    socket.off("signal");
  };
}, []);

  const connectToDevice = async (device) => {
  if (device.id === myId) return;

  const code = Math.floor(
    100000 + Math.random() * 900000
  ).toString();

  socket.emit("pair-request", {
    target: device.id,
    code,
  });

  alert(`Pairing Code: ${code}`);

  setPairing(true);

  const accepted = await new Promise((resolve) => {
    socket.once("pair-response", (r) => resolve(r.accepted));
  });

  if (!accepted) {
    setPairing(false);
    return;
  }

  setSelectedDevice(device);
  setConnecting(device.hostname);

  await createPeer(device.id, socket);

  setConnecting("");
  setPairing(false);
};

  const sendFile = async (file) => {
    if (!selectedDevice) {
      alert("Select a device first.");
      return;
    }

    const channel = getChannel(selectedDevice.id);

    if (!channel || channel.readyState !== "open") {
      alert("Connect to the device first.");
      return;
    }

    // Ask receiver permission
    socket.emit("file-request", {
      target: selectedDevice.id,
      name: file.name,
      size: file.size,
      hostname: localStorage.getItem("hostname"),
    });

    const response = await new Promise((resolve) => {
      socket.once("file-response", resolve);
    });

    if (!response.accepted) {
      alert("Receiver rejected the file.");
      return;
    }

    // Metadata
    channel.send(
      JSON.stringify({
        type: "meta",
        name: file.name,
        size: file.size,
      })
    );

    // Start progress
    setProgress({
  active: true,
  fileName: file.name,
  sent: 0,
  total: file.size,
  speed: 0,
  eta: 0,
});

const startTime = performance.now();
const chunkSize = 64 * 1024;
let offset = 0;

while (offset < file.size) {

  while (channel.bufferedAmount > 4 * 1024 * 1024) {
    await new Promise((r) => setTimeout(r, 5));
  }

  const slice = file.slice(offset, offset + chunkSize);
  channel.send(await slice.arrayBuffer());

  offset += chunkSize;

  const elapsed = (performance.now() - startTime) / 1000;
  const speed = offset / Math.max(elapsed, 0.1);
  const eta = (file.size - offset) / speed;

  setProgress({
    active: true,
    fileName: file.name,
    sent: Math.min(offset, file.size),
    total: file.size,
    speed,
    eta,
  });
}

    channel.send(JSON.stringify({ type: "end" }));

    setProgress({
      active: false,
      fileName: "",
      sent: 0,
      total: 0,
    });

    alert(`${file.name} sent successfully!`);
  };
const sendFiles = async (files) => {
  if (!selectedDevice) {
    alert("Select a device first.");
    return;
  }

  const channel = getChannel(selectedDevice.id);

  if (!channel || channel.readyState !== "open") {
    alert("Connect to the device first.");
    return;
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  socket.emit("file-request", {
    target: selectedDevice.id,
    name: `${files.length} files`,
    size: totalSize,
    hostname: localStorage.getItem("hostname"),
  });

  const response = await new Promise((resolve) => {
    socket.once("file-response", resolve);
  });

  if (!response.accepted) return;

  const startTime = performance.now();
  let sentBytes = 0;

  setProgress({
    active: true,
    fileName: "Folder Transfer",
    sent: 0,
    total: totalSize,
    speed: 0,
    eta: 0,
  });

  for (const file of files) {
    channel.send(
      JSON.stringify({
        type: "meta",
        name: file.name,
        path: file.webkitRelativePath || file.name,
        size: file.size,
      })
    );

    let offset = 0;
    const chunkSize = 64 * 1024;

    while (offset < file.size) {
      while (channel.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 5));
      }

      const slice = file.slice(offset, offset + chunkSize);
      channel.send(await slice.arrayBuffer());

      offset += chunkSize;
      sentBytes += slice.size;

      const elapsed = (performance.now() - startTime) / 1000;
      const speed = sentBytes / Math.max(elapsed, 0.1);
      const eta = (totalSize - sentBytes) / speed;

      setProgress({
        active: true,
        fileName: file.webkitRelativePath || file.name,
        sent: sentBytes,
        total: totalSize,
        speed,
        eta,
      });
    }

    channel.send(JSON.stringify({ type: "end" }));
}

// NEW: Tell receiver the folder is complete
channel.send(JSON.stringify({ type: "folder-end" }));

setProgress({
  active: false,
  fileName: "",
  sent: 0,
  total: 0,
  speed: 0,
  eta: 0,
});

alert("Folder transfer completed!");
};

const generatePreviews = (files) => {
  const list = files.map((file) => ({
    file,
    url: URL.createObjectURL(file),
    type: file.type,
  }));

  setPreviews(list);
};

  const handleDrop = (e) => {
  e.preventDefault();
  setDragging(false);

  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;

  generatePreviews(files);

  if (files.length === 1 && !files[0].webkitRelativePath) {
    sendFile(files[0]);
  } else {
    sendFiles(files);
  }
};

  return (
    <div
  className={`min-h-screen transition-colors duration-500 ${
    theme === "dark"
      ? "bg-[#070B18] text-white"
      : "bg-slate-100 text-slate-900"
  }`}
>
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="w-96 h-96 bg-cyan-500/10 blur-[120px] rounded-full absolute -top-24 -left-24"></div>
        <div className="w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full absolute bottom-0 right-0"></div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="relative text-center mb-10">
  <button
    onClick={() =>
      setTheme(theme === "dark" ? "light" : "dark")
    }
    className={`absolute right-0 top-0 px-4 py-2 rounded-xl border ${
      theme === "dark"
        ? "bg-slate-800 border-slate-700 text-white"
        : "bg-white border-slate-300 text-slate-900"
    }`}
  >
    {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
  </button>

  <h1 className="text-5xl font-bold tracking-wide">
    LynDrop
  </h1>

  <p
    className={`mt-3 ${
      theme === "dark" ? "text-slate-400" : "text-slate-600"
    }`}
  >
    Secure Peer-to-Peer File Sharing over LAN
  </p>
</div>

        {/* Status */}
        {connecting && (
          <div className="mb-6 bg-cyan-500/10 border border-cyan-500 rounded-xl p-4 text-center text-cyan-300">
            Connecting to <b>{connecting}</b>...
          </div>
        )}

        {/* Devices */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Nearby Devices</h2>
            <span className="text-sm text-slate-400">
              {devices.length} Online
            </span>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {devices.map((device) => {
              const isMe = device.id === myId;
              const active = selectedDevice?.id === device.id;

              return (
                <div
                  key={device.id}
                  onClick={() => !isMe && connectToDevice(device)}
                  className={`rounded-2xl p-3 border backdrop-blur-xl transition-all duration-300 ${
                    isMe
                      ? "border-cyan-400 bg-cyan-500/10"
                      : active
                      ? "border-cyan-400 bg-cyan-500/10 scale-105"
                      : "border-white/10 bg-white/5 hover:border-cyan-500 hover:scale-[1.02] cursor-pointer"
                  }`}
                >
                  {isMe && (
                    <div className="inline-flex px-2 py-1 rounded-full text-xs bg-cyan-500 mb-4">
                      YOU
                    </div>
                  )}

                  <div className="flex justify-center mb-3">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-2xl">
                      💻
                    </div>
                  </div>

                  <h3 className="text-center font-semibold text-lg">
                    {isMe ? "This PC" : "Windows PC"}
                  </h3>

                  <p className="text-center text-sm text-slate-400 mt-1">
                    {device.hostname}
                  </p>

                  {!isMe && (
                    <button
                      className={`w-full mt-5 py-2 rounded-xl font-medium ${
                        active
                          ? "bg-cyan-500"
                          : "bg-slate-800 hover:bg-cyan-600"
                      }`}
                    >
                      {active ? "Connected" : "Connect"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

{/* Mobile QR */}
<div className="mb-5 bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-xl">

  <div className="flex flex-col md:flex-row items-center gap-6">

    <div className="bg-white p-4 rounded-2xl">
      <QRCodeSVG value={serverURL} size={120} />
    </div>

    <div className="flex-1">
      <h2 className="text-2xl font-bold">
        Connect Your Phone
      </h2>

      <p className="text-slate-400 mt-2">
        Scan this QR code while connected to the same Wi-Fi.
      </p>

      <div className="mt-4 bg-slate-800 rounded-xl px-4 py-3 text-sm break-all">
  {serverURL}
</div>

      <p className="text-xs text-slate-500 mt-3">
        Android • iPhone • Tablet • Any modern browser
      </p>
    </div>

  </div>

</div>

        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-[28px] border-2 border-dashed transition-all duration-300 p-8 text-center ${
  dragging
    ? "border-cyan-400 bg-cyan-500/10"
    : "border-slate-600 bg-white/5"
}`}
        >
          <div className="text-5xl mb-3">📁</div>

          <h2 className="text-2xl font-bold">Drag & Drop Files</h2>

          <p className="text-slate-400 mt-3">
            {selectedDevice
              ? `Ready to send to ${selectedDevice.hostname}`
              : "Select a nearby device first"}
          </p>

          {/* File Picker */}
<input
  id="filePicker"
  type="file"
  multiple
  className="hidden"
  onChange={(e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    generatePreviews(files);
    sendFiles(files);

    e.target.value = "";
  }}
/>

{/* Folder Picker */}
<input
  id="folderPicker"
  type="file"
  multiple
  webkitdirectory=""
  className="hidden"
  onChange={(e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    generatePreviews(files);
    sendFiles(files);

    e.target.value = "";
  }}
/>

          <div className="flex justify-center gap-4 mt-5">
  <label
    htmlFor="filePicker"
    className="px-7 py-3 rounded-2xl bg-cyan-500 hover:bg-cyan-600 font-semibold cursor-pointer transition cursor-pointer"
  >
    📄 Browse Files
  </label>

  <label
    htmlFor="folderPicker"
    className="px-7 py-3 rounded-2xl bg-slate-700 hover:bg-slate-600 font-semibold cursor-pointer transition cursor-pointer"
  >
    📁 Browse Folder
  </label>
</div>
        </div>
		
		{previews.length > 0 && (
  <div className="mt-8">
    <h2 className="text-xl font-semibold mb-4">
      Selected Files ({previews.length})
    </h2>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {previews.map((item, i) => (
        <div
          key={i}
          className="bg-white/5 rounded-2xl p-3 border border-white/10"
        >
          {item.type.startsWith("image/") ? (
            <img
              src={item.url}
              className="w-full h-32 object-cover rounded-xl"
            />
          ) : item.type.startsWith("video/") ? (
            <video
              src={item.url}
              className="w-full h-32 object-cover rounded-xl"
              muted
            />
          ) : (
            <div className="h-32 flex items-center justify-center text-5xl">
              📄
            </div>
          )}

          <p className="text-xs mt-2 truncate">
            {item.file.name}
          </p>

          <p className="text-[11px] text-slate-400">
            {(item.file.size / 1024 / 1024).toFixed(1)} MB
          </p>
        </div>
      ))}
    </div>
  </div>
)}

{/* Progress Bar */}
{progress.active && (
  <div className="mt-8 bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-xl">

    <div className="flex justify-between items-center">
      <h3 className="font-semibold text-lg">
        {progress.fileName}
      </h3>

      <span className="text-cyan-400 font-bold text-lg">
        {Math.round((progress.sent / progress.total) * 100)}%
      </span>
    </div>

    <div className="w-full h-3 bg-slate-700 rounded-full mt-4 overflow-hidden">
      <div
        className="h-3 bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-100"
        style={{
          width: `${(progress.sent / progress.total) * 100}%`,
        }}
      />
    </div>

    <div className="grid grid-cols-2 gap-4 mt-5">
      <div className="bg-slate-800/60 rounded-xl p-3">
        <p className="text-xs text-slate-400">Speed</p>
        <p className="text-xl font-bold text-cyan-400">
          {(progress.speed / 1024 / 1024).toFixed(1)}
        </p>
        <p className="text-xs text-slate-500">MB/s</p>
      </div>

      <div className="bg-slate-800/60 rounded-xl p-3">
        <p className="text-xs text-slate-400">ETA</p>
        <p className="text-xl font-bold">
          {Math.max(0, Math.ceil(progress.eta))}
        </p>
        <p className="text-xs text-slate-500">seconds</p>
      </div>
    </div>

    <div className="flex justify-between mt-4 text-sm">
      <span className="text-slate-400">
        {(progress.sent / 1024 / 1024).toFixed(1)} MB
      </span>

      <span className="text-slate-400">
        {(progress.total / 1024 / 1024).toFixed(1)} MB
      </span>
    </div>

  </div>
)}
        {/* Footer */}
        <div className="text-center mt-8 text-sm text-slate-500">
          Peer-to-Peer • End-to-End • Local Network Only
        </div>
      </div>

{pairRequest && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-[#111827] w-[360px] rounded-3xl p-6">
      <h2 className="text-2xl font-bold text-center">
        Pair Device
      </h2>

      <p className="text-center text-slate-400 mt-3">
        {pairRequest.hostname}
      </p>

      <div className="text-center text-5xl font-bold tracking-[8px] mt-5 text-cyan-400">
        {pairRequest.code}
      </div>

      <p className="text-center text-sm text-slate-500 mt-2">
        Verify this code matches the sender
      </p>

      <div className="flex gap-3 mt-6">
        <button
          onClick={() => {
            socket.emit("pair-response", {
              target: pairRequest.from,
              accepted: false,
            });
            setPairRequest(null);
          }}
          className="flex-1 py-3 rounded-xl bg-slate-700"
        >
          Reject
        </button>

        <button
          onClick={() => {
            socket.emit("pair-response", {
              target: pairRequest.from,
              accepted: true,
            });
            setPairRequest(null);
          }}
          className="flex-1 py-3 rounded-xl bg-cyan-500"
        >
          Pair
        </button>
      </div>
    </div>
  </div>
)}


      {/* Accept / Reject Popup */}
      {incoming && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#111827] w-[380px] rounded-3xl p-6 border border-slate-700">
            <h2 className="text-2xl font-bold text-center">
              Incoming File
            </h2>

            <div className="text-center mt-5">
              <div className="text-5xl">💻</div>

              <p className="mt-2 text-slate-400">{incoming.hostname}</p>

              <h3 className="mt-3 font-semibold">{incoming.name}</h3>

              <p className="text-sm text-slate-500 mt-1">
                {(incoming.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  socket.emit("file-response", {
                    target: incoming.from,
                    accepted: false,
                  });

                  setIncoming(null);
                }}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600"
              >
                Reject
              </button>

              <button
                onClick={() => {
                  socket.emit("file-response", {
                    target: incoming.from,
                    accepted: true,
                  });

                  setIncoming(null);
                }}
                className="flex-1 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-600"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}