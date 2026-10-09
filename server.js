
const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const ROOM_NAME = "global-room";
const MAX_PARTICIPANTS = 20;

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// Serve index.html from the same folder as server.js.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// LiveKit's room-management API uses HTTPS, not the browser's WSS URL.
function getLiveKitHttpUrl(url) {
  return url
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:");
}

let roomService;
let initializationError = null;

// Create the room with a server-enforced participant limit.
async function initializeRoom() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error("Missing LiveKit environment variables.");
  }

  roomService = new RoomServiceClient(
    getLiveKitHttpUrl(LIVEKIT_URL),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET
  );

  const rooms = await roomService.listRooms([ROOM_NAME]);
  const existingRoom = rooms.find((room) => room.name === ROOM_NAME);

  if (!existingRoom) {
    await roomService.createRoom({
      name: ROOM_NAME,
      maxParticipants: MAX_PARTICIPANTS,
      emptyTimeout: 300,
    });

    console.log(`Created room: ${ROOM_NAME}`);
  } else {
    console.log(`Using existing room: ${ROOM_NAME}`);
  }
}

// Issue an anonymous, short-lived token for the fixed room.
app.post("/api/token", async (req, res) => {
  try {
    if (initializationError || !roomService) {
      return res.status(503).json({
        error: "Video service is not ready. Check server credentials.",
      });
    }

    const rooms = await roomService.listRooms([ROOM_NAME]);
    const currentRoom = rooms.find((room) => room.name === ROOM_NAME);

    if (
      currentRoom &&
      currentRoom.numParticipants >= MAX_PARTICIPANTS
    ) {
      return res.status(409).json({
        error: "This call is full. Please try again later.",
      });
    }

    const identity = `guest-${randomUUID()}`;

    const token = new AccessToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      {
        identity,
        ttl: "10m",
      }
    );

    token.addGrant({
      roomJoin: true,
      room: ROOM_NAME,
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();

    res.json({
      serverUrl: LIVEKIT_URL,
      participantToken: jwt,
    });
  } catch (error) {
    console.error("Token generation failed:", error.message);

    res.status(500).json({
      error: "Could not prepare the call. Please try again.",
    });
  }
});

// Start accepting requests only after the room is initialized.
async function startServer() {
  try {
    await initializeRoom();

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("LiveKit initialization failed:", error.message);
    process.exit(1);
  }
}

startServer();
