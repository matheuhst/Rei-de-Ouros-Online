const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const socket = io();

let clientState = {
  roomCode: "",
  selfId: "",
  isHost: false,
  players: [],
  canChoose: false,
  lastResult: null
};

document.addEventListener("DOMContentLoaded", () => {
  $("#createRoomBtn")?.addEventListener("click", createRoom);
  $("#joinRoomBtn")?.addEventListener("click", joinRoom);
  $("#startGameBtn")?.addEventListener("click", startGame);
  $("#nextRoundBtn")?.addEventListener("click", nextRound);
  $("#playAgainBtn")?.addEventListener("click", () => window.location.reload());
  $("#themeToggleBtn")?.addEventListener("click", toggleTheme);
  $("#rulesBtn")?.addEventListener("click", openRulesModal);
  $("#closeRulesBtn")?.addEventListener("click", closeRulesModal);

  $("#rulesModal")?.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-rules]")) closeRulesModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRulesModal();
  });

  $("#numberGrid")?.addEventListener("click", handleNumberGridClick);
  $("#roomCodeInput")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });

  applySavedTheme();
  buildNumberGrid();
  registerSocketEvents();
});

function registerSocketEvents() {
  socket.on("connect", () => {
    setSetupMessage("Conectado ao servidor.");
  });

  socket.on("disconnect", () => {
    setSetupMessage("Conexão perdida. Recarregue a página se não reconectar.");
  });

  socket.on("game_error", (payload) => {
    showMessage(payload.message || "Erro no jogo.");
    setSetupMessage(payload.message || "Erro no jogo.");
  });

  socket.on("room_created", (payload) => {
    clientState.roomCode = payload.roomCode;
    clientState.selfId = payload.selfId;
    $("#roomCodeInput").value = payload.roomCode;
    showLobby();
    setSetupMessage(`Sala ${payload.roomCode} criada.`);
  });

  socket.on("room_joined", (payload) => {
    clientState.roomCode = payload.roomCode;
    clientState.selfId = payload.selfId;
    showLobby();
    setSetupMessage(`Você entrou na sala ${payload.roomCode}.`);
  });

  socket.on("room_update", (payload) => {
    clientState.roomCode = payload.roomCode;
    clientState.selfId = payload.selfId;
    clientState.isHost = payload.isHost;
    clientState.players = payload.players || [];

    renderLobby(payload);
  });

  socket.on("round_start", (payload) => {
    clientState.roomCode = payload.roomCode;
    clientState.selfId = payload.selfId;
    clientState.players = payload.players || [];
    clientState.canChoose = payload.canChoose;

    $("#setup").classList.add("hidden");
    $("#game").classList.remove("hidden");
    $("#arenaBoard").classList.add("hidden");
    $("#choicePanel").classList.remove("hidden");
    $("#nextRoundBtn").classList.add("hidden");

    updateActiveRulesPanel(payload.rules);
    setNumberGridDisabled(!payload.canChoose);

    $("#roundMeta").textContent = `Rodada ${payload.round}`;
    $("#currentPlayerName").textContent = payload.canChoose ? "Sua escolha" : "Você está eliminado";
    $("#turnDescription").textContent = payload.message || "Escolha um número.";
    showMessage(payload.canChoose ? "Escolha um número na grade." : "Aguardando a rodada terminar.");
  });

  socket.on("choice_confirmed", (payload) => {
    setNumberGridDisabled(true);
    showMessage(payload.message || "Escolha registrada.");
  });

  socket.on("choice_status", (payload) => {
    if (!clientState.canChoose) return;

    showMessage(`Aguardando escolhas: ${payload.chosenHumanCount}/${payload.totalHumanCount}.`);
  });

  socket.on("round_result", async (payload) => {
    clientState.lastResult = payload;
    clientState.players = payload.playersBefore || [];

    $("#choicePanel").classList.add("hidden");
    $("#arenaBoard").classList.remove("hidden");
    $("#nextRoundBtn").classList.add("hidden");

    updateActiveRulesPanel(payload.rules);
    await runRoundAnimation(payload);

    if (payload.gameEnded) {
      showEndModal(payload.gameEnded.title, payload.gameEnded.text);
      return;
    }

    if (clientState.isHost) {
      $("#nextRoundBtn").classList.remove("hidden");
      $("#nextRoundBtn").textContent = "Próxima rodada";
    } else {
      $("#nextRoundBtn").classList.add("hidden");
      setPhase("Pontuação", "Rodada concluída", "Aguardando o criador da sala avançar para a próxima rodada.");
    }
  });
}

function getPlayerName() {
  return ($("#playerNameInput").value || "Jogador").trim().slice(0, 18);
}

function createRoom() {
  socket.emit("create_room", {
    playerName: getPlayerName()
  });
}

function joinRoom() {
  const roomCode = ($("#roomCodeInput").value || "").trim().toUpperCase();

  if (!roomCode) {
    setSetupMessage("Digite o código da sala.");
    return;
  }

  socket.emit("join_room", {
    roomCode,
    playerName: getPlayerName()
  });
}

function startGame() {
  if (!clientState.roomCode) {
    setSetupMessage("Crie ou entre em uma sala primeiro.");
    return;
  }

  socket.emit("start_game", {
    roomCode: clientState.roomCode
  });
}

function nextRound() {
  socket.emit("next_round", {
    roomCode: clientState.roomCode
  });
}

function showLobby() {
  $("#lobbyBox").classList.remove("hidden");
}

function renderLobby(payload) {
  showLobby();

  $("#roomCodeDisplay").textContent = payload.roomCode || "----";
  $("#lobbyMessage").textContent = payload.status === "waiting"
    ? "Envie esse código para outro jogador. O servidor completa com bots até 5 participantes."
    : "Partida em andamento.";

  const container = $("#lobbyPlayers");
  container.innerHTML = "";

  (payload.players || []).forEach((player) => {
    const item = document.createElement("div");
    item.className = "lobby-player";
    item.innerHTML = `
      <span>${escapeHtml(player.fullName || `Mestre ${player.name}`)}</span>
      <span>${player.host ? "Criador" : player.type === "bot" ? "Bot" : "Online"}</span>
    `;
    container.appendChild(item);
  });

  const startBtn = $("#startGameBtn");
  if (payload.canStart) {
    startBtn.classList.remove("hidden");
    startBtn.textContent = "Iniciar partida";
  } else {
    startBtn.classList.add("hidden");
  }
}

function buildNumberGrid() {
  const grid = $("#numberGrid");
  if (!grid) return;

  grid.innerHTML = "";

  for (let number = 0; number <= 100; number++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "number-cell";
    button.dataset.number = String(number);
    button.textContent = String(number);

    if (number === 100) button.classList.add("number-cell-100");

    grid.appendChild(button);
  }
}

function handleNumberGridClick(event) {
  const button = event.target.closest(".number-cell");
  if (!button || button.disabled || !clientState.canChoose) return;

  const number = Number(button.dataset.number);

  if (!Number.isInteger(number) || number < 0 || number > 100) return;

  socket.emit("choose_number", {
    roomCode: clientState.roomCode,
    number
  });

  setNumberGridDisabled(true);
  showMessage(`Você escolheu ${number}.`);
}

function setNumberGridDisabled(disabled) {
  $$(".number-cell").forEach((button) => {
    button.disabled = disabled;
  });
}

async function runRoundAnimation(result) {
  const players = result.playersBefore || [];
  const choices = result.choices || {};
  const numbers = players.filter((player) => choices[player.id] !== undefined).map((player) => choices[player.id]);

  const newRules = result.newRules || [];

  setPhase("Sistema", `Rodada ${result.round}`, "Os números serão revelados um por um.");
  renderPlayersBoard(result, { showChoices: false, markWinners: false });
  setMathLine("", "", true);
  await sleep(650);

  for (const rule of newRules) {
    setPhase("Nova regra", rule.title, rule.description);
    setMathLine("Regra adicionada", "!", false);
    await sleep(2400);
    setMathLine("", "", true);
  }

  for (const player of players) {
    if (choices[player.id] === undefined) continue;

    revealChoice(player.id, choices[player.id]);
    setPhase("Escolhas", `${getFullName(player)} escolheu ${choices[player.id]}`, "");
    await sleep(780);
  }

  if (result.finalDuelTriggered) {
    setPhase("Duelo final", "Regra decisiva", result.finalDuelReason || "A regra final decidiu a rodada.");
    setMathLine("Regra do duelo final", result.winnerIds.some((id) => choices[id] === 100) ? "100 vence" : "0 vence", false);
    await sleep(1600);

    renderPlayersBoard(result, { showChoices: true, markWinners: true, showInvalid: true });
    setPhase("Resultado", `${result.winnerNames.join(", ")} venceu`, result.finalDuelReason || "A regra final decidiu a rodada.");
    await sleep(900);

    await animatePenalties(result);
    finishRoundText(result);
    return;
  }

  setPhase("Cálculo", "Somando as escolhas", "Cada número revelado entra na soma da rodada.");
  setMathLine("", "", false);

  let runningTotal = 0;
  const expressionParts = [];

  for (const player of players) {
    if (choices[player.id] === undefined) continue;

    const number = choices[player.id];
    runningTotal += number;
    expressionParts.push(number);
    highlightCard(player.id, "summing");
    setMathLine(expressionParts.join(" + "), String(runningTotal), false);
    await sleep(620);
  }

  clearCardClass("summing");
  await sleep(420);

  await moveMathResultIntoNextFormula(`${result.total} ÷ ${numbers.length}`);

  setPhase("Média", "Dividindo pelo número de jogadores", "A soma vira a base da média.");
  setMathLine(`${result.total} ÷ ${numbers.length}`, "0.00", false);
  await animateNumber("#mathResult", result.average, 1100);
  await sleep(600);

  setPhase("Regra", "Aplicando 80% da média", "Os números somem por um instante. Agora vale apenas a média.");
  renderPlayersBoard(result, { showChoices: false, markWinners: false });

  await moveMathResultIntoNextFormula(`${result.average.toFixed(2)} × 0,8`);

  setMathLine(`${result.average.toFixed(2)} × 0,8`, "0.00", false);
  await animateNumber("#mathResult", result.requiredNumber, 1200);
  await sleep(700);

  if ((result.invalidDuplicateIds || []).length) {
    setPhase("Regra ativa", "Número repetido inválido", `Número repetido: ${(result.duplicateNumbers || []).join(", ")}. Esses jogadores não podem vencer esta rodada.`);
    renderPlayersBoard(result, { showChoices: true, markWinners: false, showInvalid: true });
    setMathLine("Número inválido", (result.duplicateNumbers || []).join(", "), false);
    await sleep(2100);
  }

  if (result.exactRuleTriggered) {
    setPhase("Regra ativa", "Alvo exato atingido", `${result.winnerNames.join(", ")} acertou exatamente. A penalidade dos outros jogadores será dobrada.`);
    setMathLine("Acerto exato", result.requiredNumber.toFixed(2), false);
    await sleep(2100);
  }

  setPhase("Comparação", `Alvo: ${result.requiredNumber.toFixed(2)}`, "Os números voltam para você analisar quem ficou mais perto.");
  renderPlayersBoard(result, { showChoices: true, markWinners: false, showInvalid: true });
  setMathLine("Alvo da rodada", result.requiredNumber.toFixed(2), false);
  await sleep(900);

  for (const player of players) {
    if (choices[player.id] === undefined) continue;

    highlightCard(player.id, "comparing");
    const invalid = (result.invalidDuplicateIds || []).includes(player.id);
    const description = invalid
      ? `${getFullName(player)} escolheu ${choices[player.id]}, mas esse número ficou inválido.`
      : `${getFullName(player)} escolheu ${choices[player.id]}.`;
    setPhase("Comparação", `Alvo: ${result.requiredNumber.toFixed(2)}`, description);
    await sleep(570);
  }

  clearCardClass("comparing");
  renderPlayersBoard(result, { showChoices: true, markWinners: true, showInvalid: true });

  const winnerText = result.winnerNames?.length ? `${result.winnerNames.join(", ")} venceu` : "Nenhum número válido venceu";
  const penaltyText = result.exactRuleTriggered
    ? "A penalidade foi dobrada pela regra do acerto exato."
    : "Os outros jogadores perdem pontos conforme as regras ativas.";

  setPhase("Resultado", winnerText, penaltyText);
  setMathLine("Alvo final", result.requiredNumber.toFixed(2), false);
  await sleep(850);

  await animatePenalties(result);
  finishRoundText(result);
}

function finishRoundText(result) {
  const activeAfter = (result.playersAfter || []).filter((player) => !player.eliminated).length;
  setPhase("Pontuação", "Rodada concluída", `Analise os números antes de avançar. ${activeAfter} jogador${activeAfter === 1 ? "" : "es"} ainda ativo${activeAfter === 1 ? "" : "s"}.`);
}

function renderPlayersBoard(result, options = {}) {
  const {
    showChoices = false,
    markWinners = false,
    showInvalid = false
  } = options;

  const board = $("#playersBoard");
  const players = result.playersBefore || [];
  const choices = result.choices || {};
  const winnerIds = new Set(result.winnerIds || []);
  const invalidIds = new Set(showInvalid ? result.invalidDuplicateIds || [] : []);
  const penalties = result.penalties || [];

  board.innerHTML = "";

  players.forEach((player) => {
    const choice = choices[player.id];
    const won = winnerIds.has(player.id);
    const invalid = invalidIds.has(player.id);
    const penalty = penalties.find((item) => item.playerId === player.id);
    const isSelf = player.id === clientState.selfId;

    const card = document.createElement("article");
    card.className = "player-card";
    card.dataset.playerId = player.id;

    if (isSelf) card.classList.add("main-player");
    if (player.eliminated) card.classList.add("eliminated");
    if (invalid) card.classList.add("invalid-choice");

    if (markWinners) {
      card.classList.add(won ? "winner" : "loser");
    }

    let statusText = player.eliminated ? "Eliminado" : "Ativo";
    let statusClass = player.eliminated ? "dead" : "";

    if (markWinners) {
      if (won) {
        statusText = "Venceu";
        statusClass = "win";
      } else if (invalid) {
        statusText = penalty?.pointsLost ? `Inválido -${penalty.pointsLost}` : "Inválido";
        statusClass = "invalid";
      } else if (penalty?.pointsLost) {
        statusText = `Perdeu -${penalty.pointsLost}`;
        statusClass = "lose";
      }
    } else if (invalid) {
      statusText = "Inválido";
      statusClass = "invalid";
    }

    card.innerHTML = `
      <div class="player-card-name">${escapeHtml(getFullName(player))}</div>
      <span class="player-kind">${player.type === "bot" ? "Bot" : isSelf ? "Você" : "Online"}</span>

      <div class="choice-row">
        <span>Número</span>
        <strong class="choice-value ${showChoices ? "big-choice" : ""}">${showChoices ? choice : "—"}</strong>
      </div>

      <div class="score-row">
        <span>Pontos</span>
        <strong class="score-value">${player.points}</strong>
      </div>

      <div class="status-pill ${statusClass}">${statusText}</div>
    `;

    board.appendChild(card);
  });
}

function revealChoice(playerId, number) {
  const card = getPlayerCard(playerId);
  if (!card) return;

  const value = card.querySelector(".choice-value");
  if (value) {
    value.textContent = number;
    value.classList.add("big-choice");
  }

  card.classList.add("revealed");
  card.style.animation = "pop .34s ease both";

  window.setTimeout(() => {
    card.style.animation = "";
  }, 360);
}

async function animatePenalties(result) {
  const playersAfterById = new Map((result.playersAfter || []).map((player) => [player.id, player]));

  for (const penalty of result.penalties || []) {
    if (!penalty.pointsLost) continue;

    const card = getPlayerCard(penalty.playerId);
    if (!card) continue;

    const fly = document.createElement("div");
    fly.className = "penalty-fly";
    fly.textContent = `-${penalty.pointsLost}`;
    card.appendChild(fly);

    await sleep(420);

    const after = playersAfterById.get(penalty.playerId);
    const score = card.querySelector(".score-value");

    if (score && after) {
      score.textContent = after.points;
      score.classList.remove("score-hit");
      void score.offsetWidth;
      score.classList.add("score-hit");
    }

    const pill = card.querySelector(".status-pill");

    if (pill && after?.eliminated) {
      pill.textContent = "Eliminado";
      pill.className = "status-pill dead";
      card.classList.add("eliminated");
    }

    await sleep(520);
  }
}

function updateActiveRulesPanel(rules) {
  const panel = $("#activeRulesPanel");
  const list = $("#activeRulesList");

  if (!panel || !list) return;

  const activeRules = [];

  if (rules?.duplicate) {
    activeRules.push({
      title: "Números repetidos são inválidos",
      text: "Se duas ou mais pessoas escolherem o mesmo número, esse número não conta e cada uma perde 2 pontos."
    });
  }

  if (rules?.exact) {
    activeRules.push({
      title: "Acerto exato dobra a penalidade",
      text: "Se alguém acertar exatamente o alvo, todos os outros têm a penalidade dobrada. Repetidos vão de -2 para -4."
    });
  }

  if (rules?.finalDuel) {
    activeRules.push({
      title: "Duelo final",
      text: "Com 2 jogadores, o 0 decide: 0 perde para 100, mas vence qualquer outro número. O bot final escolhe entre 0, 1 ou 100."
    });
  }

  if (!activeRules.length) {
    panel.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  list.innerHTML = activeRules.map((rule) => `
    <article class="active-rule-card">
      <strong>${escapeHtml(rule.title)}</strong>
      <span>${escapeHtml(rule.text)}</span>
    </article>
  `).join("");
}

async function moveMathResultIntoNextFormula(nextExpression) {
  const resultElement = $("#mathResult");
  const expressionElement = $("#mathExpression");
  const mathLine = $("#mathLine");

  if (!resultElement || !expressionElement || !mathLine || mathLine.classList.contains("hidden")) return;

  const value = resultElement.textContent.trim();
  if (!value) return;

  mathLine.classList.add("math-converting");

  resultElement.classList.remove("math-result-convert");
  void resultElement.offsetWidth;
  resultElement.classList.add("math-result-convert");

  await sleep(360);

  resultElement.textContent = "";
  expressionElement.textContent = nextExpression;

  expressionElement.classList.remove("formula-enter");
  void expressionElement.offsetWidth;
  expressionElement.classList.add("formula-enter");

  await sleep(420);

  resultElement.classList.remove("math-result-convert");
  expressionElement.classList.remove("formula-enter");
  mathLine.classList.remove("math-converting");

  mathLine.classList.remove("math-line-pulse");
  void mathLine.offsetWidth;
  mathLine.classList.add("math-line-pulse");

  await sleep(180);
}

function setPhase(label, title, description) {
  $("#phaseLabel").textContent = label;
  $("#phaseTitle").textContent = title;
  $("#phaseDescription").textContent = description;
}

function setMathLine(expression, result, hide) {
  const mathLine = $("#mathLine");

  if (hide) {
    mathLine.classList.add("hidden");
  } else {
    mathLine.classList.remove("hidden");
  }

  $("#mathExpression").textContent = expression;
  $("#mathResult").textContent = result;
}

function highlightCard(playerId, className) {
  clearCardClass(className);
  const card = getPlayerCard(playerId);
  if (card) card.classList.add(className);
}

function clearCardClass(className) {
  $$(".player-card").forEach((card) => card.classList.remove(className));
}

function getPlayerCard(playerId) {
  return $(`.player-card[data-player-id="${playerId}"]`);
}

async function animateNumber(selector, finalValue, duration) {
  const element = $(selector);
  const steps = 42;
  const interval = duration / steps;

  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = finalValue * eased;

    element.textContent = value.toFixed(2);
    await sleep(interval);
  }

  element.textContent = finalValue.toFixed(2);
}

function showEndModal(title, text) {
  $("#endTitle").textContent = title;
  $("#endText").textContent = text;
  $("#endModal").classList.remove("hidden");
}

function showMessage(message) {
  $("#message").textContent = message || "";
}

function setSetupMessage(message) {
  $("#setupMessage").textContent = message || "";
}

function getFullName(player) {
  return player.fullName || `Mestre ${player.name}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openRulesModal() {
  const modal = $("#rulesModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeRulesModal() {
  const modal = $("#rulesModal");
  if (!modal) return;

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem("concursoBelezaTheme") || "dark";
  const isDark = savedTheme === "dark";

  document.body.classList.toggle("theme-dark", isDark);
  updateThemeButton(isDark);
}

function toggleTheme() {
  const isDark = !document.body.classList.contains("theme-dark");

  document.body.classList.toggle("theme-dark", isDark);
  localStorage.setItem("concursoBelezaTheme", isDark ? "dark" : "light");
  updateThemeButton(isDark);
}

function updateThemeButton(isDark) {
  const button = $("#themeToggleBtn");
  if (!button) return;

  button.textContent = isDark ? "Modo claro" : "Modo dark";
  button.setAttribute("aria-pressed", String(isDark));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
