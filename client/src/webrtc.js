import JSZip from "jszip";

const peers = {};

// Receive folder/files
const receivedFiles = [];
let currentFile = null;

export function getChannel(targetId) {
  return peers[targetId]?.channel;
}

export async function createPeer(targetId, socket) {
  const peer = new RTCPeerConnection();

  const channel = peer.createDataChannel("files");
  channel.bufferedAmountLowThreshold = 1024 * 1024;

  peers[targetId] = { peer, channel };

  setupChannel(channel);

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", {
        target: targetId,
        signal: { candidate: e.candidate },
      });
    }
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  socket.emit("signal", {
    target: targetId,
    signal: { sdp: peer.localDescription },
  });
}

function setupChannel(channel) {
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    alert("Peer Connected!");
  };

  channel.onmessage = async (event) => {
    // JSON messages
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);

      // Start receiving a file
      if (msg.type === "meta") {
        currentFile = {
          path: msg.path || msg.name,
          chunks: [],
        };
        return;
      }

      // One file completed
      if (msg.type === "end") {
        receivedFiles.push({
          path: currentFile.path,
          blob: new Blob(currentFile.chunks),
        });

        currentFile = null;
        return;
      }

      // Entire folder completed → Create ZIP
      if (msg.type === "folder-end") {
        const zip = new JSZip();

        for (const file of receivedFiles) {
          zip.file(file.path, file.blob);
        }

        const zipBlob = await zip.generateAsync({
          type: "blob",
        });

        const url = URL.createObjectURL(zipBlob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "LANDrop_Folder.zip";
        a.click();

        URL.revokeObjectURL(url);

        receivedFiles.length = 0;
        return;
      }

      return;
    }

    // Binary data
    if (currentFile) {
      currentFile.chunks.push(event.data);
    }
  };
}

export function listenSignals(socket) {
  socket.on("signal", async ({ from, signal }) => {
    let conn = peers[from];

    if (!conn) {
      const peer = new RTCPeerConnection();

      peers[from] = { peer };

      peer.ondatachannel = (e) => {
        const channel = e.channel;
        channel.bufferedAmountLowThreshold = 1024 * 1024;

        peers[from].channel = channel;
        setupChannel(channel);
      };

      peer.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("signal", {
            target: from,
            signal: { candidate: ev.candidate },
          });
        }
      };

      conn = peers[from];
    }

    const peer = conn.peer;

    if (signal.sdp) {
      await peer.setRemoteDescription(signal.sdp);

      if (signal.sdp.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("signal", {
          target: from,
          signal: { sdp: peer.localDescription },
        });
      }
    }

    if (signal.candidate) {
      try {
        await peer.addIceCandidate(signal.candidate);
      } catch {}
    }
  });
}