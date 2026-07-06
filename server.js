const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

const rooms = new Map();
const socketRooms = new Map();

const BOT_NAMES = [
  "Arisu",
  "Chishiya",
  "Usagi",
  "Kuina",
  "Niragi",
  "Ann",
  "Tatta",
  "Mira",
  "Aguni",
  "Hikari",
  "Ryo",
  "Kaito",
  "Ren",
  "Sora",
  "Yuna",
  "Akira",
  "Hana",
  "Kenji",
  "Mika",
  "Riku"
];

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 40; attempt++) {
    let code = "";

    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!rooms.has(code)) return code;
  }

  return String(Date.now()).slice(-4);
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/mestre/gi, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 18) || "Jogador";
}

function createHumanPlayer(socket, name, isHost = false) {
  return {
    id: socket.id,
    socketId: socket.id,
    name: sanitizeName(name),
    type: "human",
    host: isHost,
    connected: true,
    points: 0,
    eliminated: false
  };
}

function createBotPlayer(index, usedNames) {
  let available = BOT_NAMES.filter((name) => !usedNames.has(name));

  if (!available.length) {
    available = BOT_NAMES;
  }

  const name = available[Math.floor(Math.random() * available.length)];
  usedNames.add(name);

  return {
    id: `bot-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    socketId: null,
    name,
    type: "bot",
    host: false,
    connected: true,
    points: 0,
    eliminated: false,
    strategy: getRandomBotStrategy()
  };
}

function getRandomBotStrategy() {
  const strategies = [
    { id: "chaotic", min: 0, max: 100 },
    { id: "balanced", min: 35, max: 45 },
    { id: "low", min: 20, max: 30 },
    { id: "precise", min: 10, max: 20 }
  ];

  return strategies[Math.floor(Math.random() * strategies.length)];
}

function randomInteger(min, max) {
  const roundedMin = Math.ceil(min);
  const roundedMax = Math.floor(max);

  return Math.floor(Math.random() * (roundedMax - roundedMin + 1)) + roundedMin;
}

function chooseBotNumber(room, bot) {
  const activeCount = getActivePlayers(room).length;

  if (activeCount <= 2) {
    const choices = [0, 100, 1];
    return choices[Math.floor(Math.random() * choices.length)];
  }

  const strategy = bot.strategy || getRandomBotStrategy();

  return randomInteger(strategy.min, strategy.max);
}

function getFullName(player) {
  return `Mestre ${player.name}`;
}

function getActivePlayers(room) {
  return room.players.filter((player) => !player.eliminated);
}

function getActiveHumanPlayers(room) {
  return room.players.filter((player) => {
    return player.type === "human" && player.connected && !player.eliminated;
  });
}

function getPublicPlayers(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    fullName: getFullName(player),
    type: player.type,
    host: player.host,
    connected: player.connected,
    points: player.points,
    eliminated: player.eliminated
  }));
}

function emitRoomUpdate(room) {
  for (const player of room.players) {
    if (player.type !== "human" || !player.connected) continue;

    io.to(player.socketId).emit("room_update", {
      roomCode: room.code,
      status: room.status,
      round: room.round,
      selfId: player.id,
      isHost: player.host,
      players: getPublicPlayers(room),
      canStart: room.status === "waiting" && player.host && getActiveHumanPlayers(room).length >= 1
    });
  }
}

function emitError(socket, message) {
  socket.emit("game_error", { message });
}

function completeRoomWithBots(room) {
  const usedNames = new Set(room.players.map((player) => player.name));

  while (room.players.length < 5) {
    room.players.push(createBotPlayer(room.players.length + 1, usedNames));
  }
}

function startGame(room) {
  if (room.status !== "waiting") return;

  completeRoomWithBots(room);
  room.status = "playing";
  room.round = 1;
  room.choices = {};
  room.rulesShown = {
    duplicate: false,
    exact: false,
    finalDuel: false
  };

  emitRoundStart(room);
}

function emitRoundStart(room) {
  room.choices = {};
  room.status = "playing";

  const activePlayers = getActivePlayers(room);
  const rules = getActiveRules(activePlayers.length);

  for (const player of room.players) {
    if (player.type !== "human" || !player.connected) continue;

    const canChoose = !player.eliminated;
    io.to(player.socketId).emit("round_start", {
      roomCode: room.code,
      round: room.round,
      selfId: player.id,
      canChoose,
      rules,
      players: getPublicPlayers(room),
      message: canChoose ? "Escolha seu número." : "Você foi eliminado. Acompanhe a rodada."
    });
  }

  if (!getActiveHumanPlayers(room).length) {
    finishRound(room);
  }
}

function handleChoice(socket, payload) {
  const roomCode = String(payload?.roomCode || "").trim().toUpperCase();
  const number = Number(payload?.number);
  const room = rooms.get(roomCode);

  if (!room) {
    emitError(socket, "Sala não encontrada.");
    return;
  }

  if (room.status !== "playing") {
    emitError(socket, "A partida ainda não está aceitando escolhas.");
    return;
  }

  const player = room.players.find((item) => item.id === socket.id);

  if (!player || player.eliminated || player.type !== "human") {
    emitError(socket, "Você não pode escolher nesta rodada.");
    return;
  }

  if (!Number.isInteger(number) || number < 0 || number > 100) {
    emitError(socket, "Escolha um número inteiro entre 0 e 100.");
    return;
  }

  if (room.choices[player.id] !== undefined) {
    emitError(socket, "Você já escolheu nesta rodada.");
    return;
  }

  room.choices[player.id] = number;

  socket.emit("choice_confirmed", {
    roomCode: room.code,
    round: room.round,
    number,
    message: `Você escolheu ${number}. Aguardando os outros jogadores.`
  });

  io.to(room.code).emit("choice_status", {
    roomCode: room.code,
    chosenHumanCount: getActiveHumanPlayers(room).filter((human) => room.choices[human.id] !== undefined).length,
    totalHumanCount: getActiveHumanPlayers(room).length
  });

  const allHumansChose = getActiveHumanPlayers(room).every((human) => {
    return room.choices[human.id] !== undefined;
  });

  if (allHumansChose) {
    finishRound(room);
  }
}

function finishRound(room) {
  if (room.status === "animating" || room.status === "ended") return;

  room.status = "animating";

  const activeBots = room.players.filter((player) => {
    return player.type === "bot" && !player.eliminated;
  });

  for (const bot of activeBots) {
    room.choices[bot.id] = chooseBotNumber(room, bot);
  }

  const playersBefore = getPublicPlayers(room);
  const result = calculateResult(room);

  applyPenalties(room, result);

  const playersAfter = getPublicPlayers(room);
  const activeAfter = getActivePlayers(room);
  const gameEnded = getGameEndPayload(room, activeAfter);

  const payload = {
    roomCode: room.code,
    round: room.round,
    playersBefore,
    playersAfter,
    choices: result.choices,
    total: result.total,
    average: result.average,
    requiredNumber: result.requiredNumber,
    distances: result.distances,
    winners: result.winners.map((player) => player.id),
    winnerNames: result.winners.map(getFullName),
    winnerIds: [...result.winnerIds],
    penalties: result.penalties,
    rules: result.rules,
    duplicateNumbers: [...result.duplicateNumbers],
    invalidDuplicateIds: [...result.invalidDuplicateIds],
    exactRuleTriggered: result.exactRuleTriggered,
    finalDuelTriggered: result.finalDuelTriggered,
    finalDuelReason: result.finalDuelReason,
    newRules: getNewRuleMessages(room, result.rules),
    gameEnded
  };

  for (const rule of payload.newRules) {
    room.rulesShown[rule.key] = true;
  }

  io.to(room.code).emit("round_result", payload);

  if (gameEnded) {
    room.status = "ended";
  } else {
    room.status = "review";
  }

  emitRoomUpdate(room);
}

function getGameEndPayload(room, activePlayers) {
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];

    return {
      title: `${getFullName(winner)} venceu`,
      text: "Todos os outros jogadores chegaram a -10 pontos."
    };
  }

  if (activePlayers.length === 0) {
    return {
      title: "Todos foram eliminados",
      text: "Nenhum jogador continuou ativo na partida."
    };
  }

  return null;
}

function applyPenalties(room, result) {
  for (const penalty of result.penalties) {
    if (!penalty.pointsLost) continue;

    const player = room.players.find((item) => item.id === penalty.playerId);
    if (!player) continue;

    player.points -= penalty.pointsLost;

    if (player.points <= -10) {
      player.points = -10;
      player.eliminated = true;
    }
  }
}

function nextRound(socket, payload) {
  const roomCode = String(payload?.roomCode || "").trim().toUpperCase();
  const room = rooms.get(roomCode);

  if (!room) {
    emitError(socket, "Sala não encontrada.");
    return;
  }

  const player = room.players.find((item) => item.id === socket.id);

  if (!player?.host) {
    emitError(socket, "Apenas o criador da sala pode avançar a rodada.");
    return;
  }

  if (room.status !== "review") {
    emitError(socket, "A rodada ainda não pode avançar.");
    return;
  }

  room.round += 1;
  emitRoundStart(room);
}

function getActiveRules(activePlayerCount) {
  return {
    duplicate: activePlayerCount <= 4,
    exact: activePlayerCount <= 3,
    finalDuel: activePlayerCount === 2
  };
}

function getDuplicateNumbers(players, choices) {
  const countByNumber = new Map();

  for (const player of players) {
    const choice = choices[player.id];
    countByNumber.set(choice, (countByNumber.get(choice) || 0) + 1);
  }

  const duplicateNumbers = new Set();

  countByNumber.forEach((count, number) => {
    if (count >= 2) duplicateNumbers.add(number);
  });

  return duplicateNumbers;
}

function getFinalDuelResult(players, choices, rules) {
  if (!rules.finalDuel || players.length !== 2) {
    return { triggered: false, winners: [], reason: "" };
  }

  const zeroPlayers = players.filter((player) => choices[player.id] === 0);
  const hundredPlayers = players.filter((player) => choices[player.id] === 100);

  if (zeroPlayers.length > 0 && hundredPlayers.length > 0) {
    return {
      triggered: true,
      winners: hundredPlayers,
      reason: "0 contra 100: quem escolheu 100 vence."
    };
  }

  if (zeroPlayers.length === 1) {
    return {
      triggered: true,
      winners: zeroPlayers,
      reason: "0 contra qualquer número diferente de 100: quem escolheu 0 vence."
    };
  }

  return { triggered: false, winners: [], reason: "" };
}

function getNewRuleMessages(room, rules) {
  const messages = [];

  if (rules.duplicate && !room.rulesShown.duplicate) {
    messages.push({
      key: "duplicate",
      title: "Números repetidos são inválidos",
      description: "Se duas ou mais pessoas escolherem o mesmo número, esse número não conta. Cada jogador repetido perde 2 pontos."
    });
  }

  if (rules.exact && !room.rulesShown.exact) {
    messages.push({
      key: "exact",
      title: "Acerto exato dobra a penalidade",
      description: "Se alguém acertar exatamente o alvo, todos os outros têm a penalidade dobrada. Repetidos passam de -2 para -4."
    });
  }

  if (rules.finalDuel && !room.rulesShown.finalDuel) {
    messages.push({
      key: "finalDuel",
      title: "Duelo final",
      description: "Com 2 jogadores, o 0 decide: 0 perde para 100, mas vence qualquer outro número. O bot final escolhe entre 0, 1 ou 100."
    });
  }

  return messages;
}

function calculateResult(room) {
  const activePlayers = getActivePlayers(room);
  const rules = getActiveRules(activePlayers.length);
  const choices = { ...room.choices };
  const numbers = activePlayers.map((player) => choices[player.id]);
  const total = numbers.reduce((sum, number) => sum + number, 0);
  const average = total / numbers.length;
  const requiredNumber = average * 0.8;

  const distances = {};
  activePlayers.forEach((player) => {
    distances[player.id] = Math.abs(choices[player.id] - requiredNumber);
  });

  const duplicateNumbers = getDuplicateNumbers(activePlayers, choices);
  const invalidDuplicateIds = new Set();

  if (rules.duplicate) {
    activePlayers.forEach((player) => {
      if (duplicateNumbers.has(choices[player.id])) {
        invalidDuplicateIds.add(player.id);
      }
    });
  }

  const specialDuel = getFinalDuelResult(activePlayers, choices, rules);
  let winners = [];
  let exactRuleTriggered = false;
  let finalDuelTriggered = false;

  if (specialDuel.triggered) {
    winners = specialDuel.winners;
    finalDuelTriggered = true;
    invalidDuplicateIds.clear();
  } else {
    const validPlayers = activePlayers.filter((player) => !invalidDuplicateIds.has(player.id));

    if (rules.exact) {
      const exactPlayers = validPlayers.filter((player) => {
        return Math.abs(choices[player.id] - requiredNumber) < 0.0001;
      });

      if (exactPlayers.length) {
        winners = exactPlayers;
        exactRuleTriggered = true;
      }
    }

    if (!winners.length && validPlayers.length) {
      const smallestDistance = Math.min(...validPlayers.map((player) => distances[player.id]));
      winners = validPlayers.filter((player) => Math.abs(distances[player.id] - smallestDistance) < 0.0001);
    }
  }

  const winnerIds = new Set(winners.map((player) => player.id));
  const multiplier = exactRuleTriggered ? 2 : 1;

  const penalties = activePlayers.map((player) => {
    let pointsLost = 0;
    let reason = "";

    if (!winnerIds.has(player.id)) {
      if (invalidDuplicateIds.has(player.id)) {
        pointsLost = 2 * multiplier;
        reason = exactRuleTriggered ? "Número repetido inválido com penalidade dobrada" : "Número repetido inválido";
      } else {
        pointsLost = 1 * multiplier;
        reason = exactRuleTriggered ? "Penalidade dobrada por acerto exato" : "Perdeu a rodada";
      }
    }

    return {
      playerId: player.id,
      pointsLost,
      reason
    };
  });

  return {
    choices,
    total,
    average,
    requiredNumber,
    distances,
    winners,
    winnerIds,
    penalties,
    rules,
    duplicateNumbers,
    invalidDuplicateIds,
    exactRuleTriggered,
    finalDuelTriggered,
    finalDuelReason: specialDuel.reason || ""
  };
}

function getRoomBySocket(socket) {
  const roomCode = socketRooms.get(socket.id);
  if (!roomCode) return null;

  return rooms.get(roomCode) || null;
}

function leaveRoom(socket) {
  const room = getRoomBySocket(socket);
  if (!room) return;

  const player = room.players.find((item) => item.socketId === socket.id);

  if (!player) return;

  if (room.status === "waiting") {
    room.players = room.players.filter((item) => item.id !== player.id);

    if (player.host && room.players.some((item) => item.type === "human")) {
      room.players.find((item) => item.type === "human").host = true;
    }

    if (!room.players.some((item) => item.type === "human")) {
      rooms.delete(room.code);
    } else {
      emitRoomUpdate(room);
    }
  } else {
    player.connected = false;
    player.type = "bot";
    player.strategy = getRandomBotStrategy();

    if (!room.players.some((item) => item.type === "human" && item.connected && item.host)) {
      const nextHuman = room.players.find((item) => item.type === "human" && item.connected);
      if (nextHuman) nextHuman.host = true;
    }

    emitRoomUpdate(room);
  }

  socketRooms.delete(socket.id);
}

io.on("connection", (socket) => {
  socket.on("create_room", (payload) => {
    const code = createRoomCode();
    const room = {
      code,
      status: "waiting",
      round: 0,
      players: [createHumanPlayer(socket, payload?.playerName, true)],
      choices: {},
      rulesShown: {
        duplicate: false,
        exact: false,
        finalDuel: false
      }
    };

    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    socket.join(code);

    socket.emit("room_created", {
      roomCode: code,
      selfId: socket.id
    });

    emitRoomUpdate(room);
  });

  socket.on("join_room", (payload) => {
    const code = String(payload?.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      emitError(socket, "Sala não encontrada.");
      return;
    }

    if (room.status !== "waiting") {
      emitError(socket, "Essa partida já começou.");
      return;
    }

    if (room.players.filter((player) => player.type === "human").length >= 5) {
      emitError(socket, "Essa sala já está cheia.");
      return;
    }

    if (socketRooms.has(socket.id)) {
      leaveRoom(socket);
    }

    room.players.push(createHumanPlayer(socket, payload?.playerName, false));
    socketRooms.set(socket.id, code);
    socket.join(code);

    socket.emit("room_joined", {
      roomCode: code,
      selfId: socket.id
    });

    emitRoomUpdate(room);
  });

  socket.on("start_game", (payload) => {
    const code = String(payload?.roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      emitError(socket, "Sala não encontrada.");
      return;
    }

    const player = room.players.find((item) => item.id === socket.id);

    if (!player?.host) {
      emitError(socket, "Apenas o criador da sala pode iniciar.");
      return;
    }

    startGame(room);
  });

  socket.on("choose_number", (payload) => {
    handleChoice(socket, payload);
  });

  socket.on("next_round", (payload) => {
    nextRound(socket, payload);
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Concurso de Beleza online rodando em http://${HOST}:${PORT}`);
});
