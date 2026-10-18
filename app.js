const firebaseConfig = {
  apiKey: "AIzaSyDjcD0GeZR2LgvWFXM1fpYgkqORpRAy73E",
  authDomain: "draftsimulater.firebaseapp.com",
  databaseURL: "https://draftsimulater-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "draftsimulater",
  storageBucket: "draftsimulater.firebasestorage.app",
  messagingSenderId: "57853150710",
  appId: "1:57853150710:web:36e7ced1faf87e437a73d7",
  measurementId: "G-4GK7GSKHB2"
};

let db = null;
let isFirebaseReady = false;
try {
  const useFirebaseEmulator = new URLSearchParams(window.location.search).get("emulator") === "1";
  const appConfig = useFirebaseEmulator
    ? { ...firebaseConfig, projectId: "demo-draftsimulater", databaseURL: "https://demo-draftsimulater-default-rtdb.firebaseio.com" }
    : firebaseConfig;
  firebase.initializeApp(appConfig);
  db = firebase.database();
  if (useFirebaseEmulator) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      throw new Error("Firebase Emulator mode is allowed only on localhost.");
    }
    db.useEmulator("127.0.0.1", 9000);
  }
  isFirebaseReady = true;
} catch(e) {
  console.warn("Firebase初期化警告:", e.message);
}

const PASS_PLAYER = {
  名前: "【選択終了】",
  出身: "-",
  所属: "",
  ポイント: 0,
  isPass: true
};

window.openFormationSection = function() {
  const formationSec = document.getElementById("formationSection");
  if (formationSec) {
    formationSec.style.display = "block";
    formationSec.scrollIntoView({ behavior: 'smooth' });
    switchSportTab('idol');
  }
};

window.switchSportTab = function(sport) {
  document.querySelectorAll('.final-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sport-panel').forEach(p => p.style.display = 'none');

  if (sport === 'idol') {
    document.getElementById('btnTabIdol').classList.add('active');
    document.getElementById('sportPanelIdol').style.display = 'block';
    renderIdolForm();
  } else if (sport === 'baseball') {
    document.getElementById('btnTabBaseball').classList.add('active');
    document.getElementById('sportPanelBaseball').style.display = 'block';
    buildBaseballField();
  } else if (sport === 'soccer') {
    document.getElementById('btnTabSoccer').classList.add('active');
    document.getElementById('sportPanelSoccer').style.display = 'block';
    applySoccerTemplate();
  }
};

let gameMode = "solo";
let currentRoomId = null;
let myPlayerSlot = 0;
let isHost = false;
let maxTeams = 8;
let draftSystem = "waiver";

let allMasterData = []; 
let currentSession = 1; 
let sessionPool = [];    
let teams = [];
let round = 1;
let isDraftCompleted = false;
let isSessionEnding = false;

let isReNomination = false;
let reAttemptCount = 0;

let currentUserCurrentRoundPick = null;
let currentLotteryResolver = null;
let currentLotteryData = null;
let isLotteryLocked = false;
let pendingBids = [];
let pendingConfirmedPicks = [];

let waiverOrder = [];
let currentWaiverIndex = 0;

let lastLogMessage = "";
let lastLogTime = 0;

function writeLog(msg) {
  const term = document.getElementById("logTerminal");
  if (!term) return;

  const now = Date.now();
  if (msg === lastLogMessage && (now - lastLogTime < 1000)) {
    return;
  }
  lastLogMessage = msg;
  lastLogTime = now;

  term.innerHTML += `<div>${msg}</div>`;
  term.scrollTop = term.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function filterInappropriateText(text) {
  if (!text) return "";
  const badWords = ["死ね", "殺す", "ゴミ", "ブス", "ババア", "無能"];
  let sanitized = text;
  badWords.forEach(word => { sanitized = sanitized.replace(new RegExp(word, "gi"), "〇〇"); });
  return sanitized;
}

function normalizeOrigin(val) {
  if (!val) return "高卒";
  const str = String(val).trim();
  if (str === "高" || str === "高卒" || str === "高校生") return "高卒";
  if (str === "大" || str === "大卒" || str === "大学生") return "大卒";
  if (str === "社" || str === "社会人") return "社会人";
  if (str === "独" || str === "独L" || str === "独立" || str === "独立L") return "独L";
  return str;
}

function openRuleTab() {
  if (typeof google !== "undefined" && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(url) {
      if (url) window.open(url + '?page=rules', '_blank');
      else alert("WebアプリのURLが取得できませんでした。");
    }).getAppUrl();
  } else {
    window.open("rules.html", "_blank", "noopener");
  }
}

function initTeams() {
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const names = [];
  for (let i = 0; i < maxTeams; i++) names.push(`球団${letters[i]}`);

  const policies = ["pure_pt", "academic", "popularity", "working", "pure_pt", "academic", "popularity", "pure_pt", "working", "pure_pt"];

  teams = names.map((name, idx) => ({
    id: idx,
    name: name,
    isUser: (gameMode === "solo") ? (idx === 0) : (idx === myPlayerSlot),
    isCpu: true,
    rank: maxTeams,
    sessionPicks: [],
    allPicks: [],
    isFinished: false,
    sessionTargetLimit: 0,
    lotteryHistory: [],
    cpuPolicy: policies[idx % policies.length]
  }));

  updateUIForTeamCount();
}

function updateUIForTeamCount() {
  const systemName = (draftSystem === "waiver") ? "通常ウェーバー制" : "全巡抽選制";
  document.getElementById("appTitle").innerText = `坂道グループ 疑似ドラフト会議 (${maxTeams}球団制 / ${systemName})`;
  document.getElementById("teamsHeading").innerText = `各球団の指名獲得状況 (計${maxTeams}球団)`;
  
  const rankSelect = document.getElementById("rankSelect");
  if (rankSelect) {
    rankSelect.innerHTML = "";
    for (let r = 1; r <= maxTeams; r++) {
      const opt = document.createElement("option");
      opt.value = r;
      if (r === 1) opt.innerText = `1位 (前年優勝)`;
      else if (r === maxTeams) opt.innerText = `${maxTeams}位 (前年最下位 - 2巡目1番手)`;
      else opt.innerText = `${r}位`;
      if (r === maxTeams) opt.selected = true;
      rankSelect.appendChild(opt);
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    if (row.some(value => value !== "")) rows.push(row);
  }
  return rows;
}

function parseDraftMembers(csvText) {
  const rows = parseCsv(csvText);
  return rows.slice(1).filter(row => row[0]).map(row => ({
    名前: row[0],
    所属: row[2] || "",
    出身: normalizeOrigin(row[4]),
    登場週目: Number.parseInt(row[5], 10) || 1,
    競合率: Number(row[6]) || 0,
    ポイント: Number(row[7]) || 0,
    写真: row[9] || row[8] || ""
  }));
}

window.onload = async function() {
  const loadingEl = document.getElementById("loading");
  try {
    const response = await fetch(new URL("members.csv", document.baseURI));
    if (!response.ok) throw new Error(`CSV読込に失敗しました (${response.status})`);
    allMasterData = parseDraftMembers(await response.text());
    if (allMasterData.length === 0) {
      loadingEl.innerText = "⚠️ CSVに候補者データがありません。";
      return;
    }
    loadingEl.style.display = "none";
    document.getElementById("roundDisplay").style.display = "inline";
    writeLog(`✅ CSVから <b>${allMasterData.length}</b> 名のデータを読み込みました。`);
  } catch (error) {
    loadingEl.innerText = `❌ 候補者CSVの読込エラー: ${error.message}`;
  }
};

function switchBaseballView(viewType) {
  const tableContainer = document.getElementById("baseballTableContainer");
  const visualContainer = document.getElementById("baseballVisualContainer");
  const btnTable = document.getElementById("btnBbTable");
  const btnVisual = document.getElementById("btnBbVisual");

  if (viewType === 'table') {
    tableContainer.style.display = "block";
    visualContainer.style.display = "none";
    btnTable.style.background = "#2e7d32";
    btnVisual.style.background = "#333";
    buildBaseballField();
  } else {
    tableContainer.style.display = "none";
    visualContainer.style.display = "block";
    btnTable.style.background = "#333";
    btnVisual.style.background = "#2e7d32";
    buildBaseballVisualGround();
  }
}

function buildBaseballVisualGround() {
  const ground = document.getElementById("baseballGround");
  if (!ground) return;
  ground.innerHTML = `
    <div class="ballpark-stand">🏟️ BALLPARK STADIUM (外野スタンド・スコアボード) 🏟️</div>
    <div class="foul-line-left"></div>
    <div class="foul-line-right"></div>
    <div class="infield-dirt">
      <div class="infield-grass"></div>
    </div>
    <div class="baseball-base" style="top: 38%; left: 50%;"></div>
    <div class="baseball-base" style="top: 55%; left: 74%;"></div>
    <div class="baseball-base" style="top: 55%; left: 26%;"></div>
    <div class="home-base"></div>
    <div class="batter-box-left"></div>
    <div class="batter-box-right"></div>
  `;

  const positions = [
    { pos: "投手 (P)", x: 50, y: 62 },
    { pos: "捕手 (C)", x: 50, y: 90 },
    { pos: "一塁 (1B)", x: 78, y: 56 },
    { pos: "二塁 (2B)", x: 62, y: 40 },
    { pos: "三塁 (3B)", x: 22, y: 56 },
    { pos: "遊撃 (SS)", x: 38, y: 40 },
    { pos: "左翼 (LF)", x: 18, y: 24 },
    { pos: "中堅 (CF)", x: 50, y: 14 },
    { pos: "右翼 (RF)", x: 82, y: 24 },
    { pos: "DH", x: 88, y: 85 }
  ];

  const optionsHtml = getUserPicksOptionsHtml();

  positions.forEach(c => {
    const slot = document.createElement("div");
    slot.className = "draggable-slot";
    slot.style.left = c.x + "%";
    slot.style.top = c.y + "%";
    slot.innerHTML = `
      <span style="font-size:10px; color:#ffd700; font-weight:bold; text-shadow: 1px 1px 2px #000;">${c.pos}</span>
      <select style="font-size:10px; width:100%; background:#222; color:#fff; border:none; margin-top:2px; padding:2px;">${optionsHtml}</select>
    `;
    makeDraggable(slot);
    ground.appendChild(slot);
  });
}

function initSoloMode() {
  maxTeams = parseInt(document.getElementById("teamCountSelect").value, 10) || 8;
  draftSystem = document.getElementById("draftSystemSelect").value;
  gameMode = "solo";
  isHost = true;
  myPlayerSlot = 0;
  document.getElementById("modeSelectBox").style.display = "none";
  const lobbySetup = document.getElementById("multiLobbySetup");
  if (lobbySetup) lobbySetup.style.display = "none";
  document.getElementById("controlPanel").style.display = "block";
  document.getElementById("startBtn").style.display = "inline-block";
  
  document.getElementById("logPanel").style.display = "block";
  document.getElementById("teamsHeading").style.display = "block";
  document.getElementById("teamsContainer").style.display = "grid";

  initTeams();
  teams[0].name = "あなた(球団A)";
  for(let i=1; i<maxTeams; i++) teams[i].name = "CPU・" + teams[i].name;
  renderTeams();
  const systemName = (draftSystem === "waiver") ? "通常ウェーバー制" : "全巡抽選制";
  writeLog(`👤 <b>【1人プレイモード】(${maxTeams}球団制 / ${systemName})</b> を開始しました。「第1周目ドラフトを開始する」を押してください。`);
}

function openMultiLobbySetup() {
  const lobbyModal = document.getElementById("multiLobbySetup");
  if (lobbyModal) {
    lobbyModal.style.display = "block";
  }
}

function createOrJoinRoom() {
  const rawId = document.getElementById("inputRoomId").value.trim();
  const rId = rawId.replace(/[^a-zA-Z0-9]/g, "");
  if (!rId || rId.length < 3 || rId.length > 8) { 
    alert("部屋番号は3〜8文字の半角英数字で入力してください。"); 
    return; 
  }
  currentRoomId = rId;

  let inputName = prompt("あなたのユーザーネームを入力してください:", "プレイヤー");
  if (!inputName || !inputName.trim()) {
    inputName = "プレイヤー" + Math.floor(Math.random() * 900 + 100);
  }
  const myUserName = filterInappropriateText(inputName.trim());

  writeLog(`🌐 部屋番号 <b>${currentRoomId}</b> にアクセス中...`);
  const roomRef = db.ref(`rooms/${currentRoomId}`);

  roomRef.once('value').then(snapshot => {
    const data = snapshot.val();
    const isRoomAbandoned = data && (!data.slots || !data.slots.slot_0 || data.slots.slot_0.isCpu === true || data.status === "closed");

    if (!data || isRoomAbandoned) {
      isHost = true;
      myPlayerSlot = 0;

      const initialSlots = {};
      const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
      for (let i = 0; i < maxTeams; i++) {
        initialSlots[`slot_${i}`] = (i === 0) 
          ? { isCpu: false, name: myUserName, rank: maxTeams } 
          : { isCpu: true, name: `CPU・球団${letters[i]}`, rank: maxTeams - i };
      }

      return roomRef.set({
        createdAt: Date.now(),
        hostSlot: 0,
        teamCount: maxTeams,
        draftSystem: draftSystem,
        status: "waiting",
        slots: initialSlots
      }).then(() => {
        writeLog(`✅ 部屋番号 <b>${currentRoomId} (${maxTeams}球団制 / ${draftSystem === 'waiver' ? '通常ウェーバー制' : '全巡抽選制'})</b> の準備が完了しました。他の参加者を待機中...`);
        setupDisconnectionHandling();
        enterLobbyWait(true);
      });
    } else {
      if (data.status === "started") {
        alert("この部屋はすでにドラフトが開始されています。");
        return;
      }

      if (data.teamCount) maxTeams = data.teamCount;
      if (data.draftSystem) draftSystem = data.draftSystem;

      let assignedSlot = -1;
      for (let i = 1; i < maxTeams; i++) {
        const slotData = data.slots[`slot_${i}`];
        if (slotData && slotData.isCpu === true) {
          assignedSlot = i;
          break;
        }
      }

      if (assignedSlot === -1) {
        alert(`この部屋は満員です（${maxTeams}球団枠）。`);
        return;
      }

      isHost = false;
      myPlayerSlot = assignedSlot;

      return roomRef.child(`slots/slot_${assignedSlot}`).update({
        isCpu: false,
        name: myUserName,
        rank: maxTeams - assignedSlot
      }).then(() => {
        writeLog(`✅ スロット ${assignedSlot + 1} (${myUserName}) に正常に着席しました！`);
        setupDisconnectionHandling();
        enterLobbyWait(false);
      });
    }
  }).catch(err => {
    writeLog(`<span style="color:#ff5252;">❌ Firebase通信エラー: ${err.message}</span>`);
  });
}

function setupDisconnectionHandling() {
  if (!currentRoomId || !db) return;
  const roomRef = db.ref(`rooms/${currentRoomId}`);
  const mySlotRef = roomRef.child(`slots/slot_${myPlayerSlot}`);
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

  if (isHost) {
    roomRef.onDisconnect().remove();
  } else {
    mySlotRef.onDisconnect().set({
      isCpu: true,
      name: `CPU・球団${letters[myPlayerSlot]}`,
      rank: maxTeams - myPlayerSlot
    });
  }
}

function enterLobbyWait(amIHost) {
  gameMode = "multi";
  document.getElementById("inputRoomId").disabled = true;
  document.getElementById("roomWaitArea").style.display = "block";
  document.getElementById("dispRoomId").innerText = currentRoomId;
  document.getElementById("dispTeamCountBadge").innerText = `${maxTeams}球団制`;
  document.getElementById("dispSystemBadge").innerText = (draftSystem === "waiver") ? "通常ウェーバー制" : "全巡抽選制";
  
  document.getElementById("hostBadge").style.display = amIHost ? "inline-block" : "none";
  document.getElementById("hostControlBtns").style.display = amIHost ? "block" : "none";

  const lobbySlotsRef = db.ref(`rooms/${currentRoomId}/slots`);
  lobbySlotsRef.on('value', snap => {
    const slots = snap.val();
    if (!slots) return;

    const grid = document.getElementById("lobbySlotsGrid");
    grid.innerHTML = "";
    initTeams();

    for (let i = 0; i < maxTeams; i++) {
      const s = slots[`slot_${i}`];
      if (!s) continue;
      
      const isMe = (i === myPlayerSlot);
      const cleanName = escapeHtml(filterInappropriateText(s.name));
      teams[i].name = isMe ? `${cleanName} (あなた)` : cleanName;
      teams[i].isCpu = s.isCpu;
      teams[i].isUser = isMe;
      teams[i].rank = s.rank || (maxTeams - i);

      let slotDiv = document.createElement("div");
      slotDiv.className = `lobby-slot ${!s.isCpu ? 'occupied' : ''}`;
      slotDiv.innerHTML = `
        <div style="font-size:12px; color:#546e7a;">スロット ${i + 1} (${teams[i].rank}位)</div>
        <div style="font-size:14px; margin-top:4px;"><b>${teams[i].name}</b></div>
        <div style="font-size:11px; color:${s.isCpu ? '#78909c' : '#00897b'}; font-weight:bold; margin-top:2px;">
          ${s.isCpu ? '🤖 CPU' : '👤 人間'}
        </div>
      `;
      grid.appendChild(slotDiv);
    }
  });

  const statusRef = db.ref(`rooms/${currentRoomId}/status`);
  statusRef.on('value', snap => {
    const val = snap.val();
    if (val === "started") {
      writeLog(`🚀 ホストがドラフト会議を開始しました！`);
      lobbySlotsRef.off();
      statusRef.off();

      db.ref(`rooms/${currentRoomId}/slots`).once('value', sSnap => {
        const slotsData = sSnap.val();
        if (slotsData) {
          for (let i = 0; i < maxTeams; i++) {
            const s = slotsData[`slot_${i}`];
            if (s) {
              teams[i].name = (i === myPlayerSlot) ? `${s.name} (あなた)` : s.name;
              teams[i].isCpu = s.isCpu;
              teams[i].isUser = (i === myPlayerSlot);
              teams[i].rank = s.rank || (maxTeams - i);
            }
          }
        }
        
        document.getElementById("modeSelectBox").style.display = "none";
        document.getElementById("multiLobbySetup").style.display = "none";
        document.getElementById("roomWaitArea").style.display = "none";
        
        document.getElementById("controlPanel").style.display = "block";
        document.getElementById("sessionBar").style.display = "flex";
        
        setupDraftGameListeners();
        startSession(1);
      });
    } else if (val === "closed") {
      alert("ホストによってルームが開放・解散されました。初期画面に戻ります。");
      confirmReset();
    }
  });
}

function applyConfirmedPicks(list) {
  list.forEach(item => {
    if (!item || !item.playerName) return;
    const team = teams[item.slot];
    const picked = (item.playerName === PASS_PLAYER.名前)
      ? PASS_PLAYER
      : (allMasterData.find(p => p.名前 === item.playerName) || sessionPool.find(p => p.名前 === item.playerName));

    if (!team || !picked) return;

    const pickRound = item.round || round;
    const existingPick = team.sessionPicks.find(p => p.draftRound === pickRound);
    if (!existingPick || existingPick.名前 !== picked.名前) {
      assignPick(team, picked, pickRound);
    }
    if (!picked.isPass) sessionPool = sessionPool.filter(p => p.名前 !== picked.名前);

    if (team.id === myPlayerSlot) {
      currentUserCurrentRoundPick = picked.isPass
        ? { name: "【今周 選択終了】", origin: null, msg: "今周の指名を終了しました。他チームの完了を待機しています...", isPass: true }
        : { name: picked.名前, origin: normalizeOrigin(picked.出身), msg: "🎉 交渉権獲得！他チームの指名完了を待機しています...", isMiss: false };
      updateUserPickStatusBanner();
    }
  });
}

function setupDraftGameListeners() {
  db.ref(`rooms/${currentRoomId}/roundEvent`).on('value', async snap => {
    const event = snap.val();
    if (!event) return;
    if (isHost && event.isProcessedByHost) return;
    if (!isHost && Array.isArray(event.confirmedList)) {
      applyConfirmedPicks(event.confirmedList);
    }

    if (!isHost && (event.type === "round_reveal" || event.type === "re_nomination_reveal")) {
      const bids = event.bids.map(item => {
        const pChoice = (item.playerName === PASS_PLAYER.名前) 
          ? PASS_PLAYER 
          : (sessionPool.find(p => p.名前 === item.playerName) || allMasterData.find(p => p.名前 === item.playerName));
        return { team: teams[item.slot], choice: pChoice };
      });
      await executeSyncedReveal(bids, event.attempt || 0);
    }

    if (!isHost && (event.type === "pick_confirmed" || event.type === "round_all_picks_confirmed")) {
      let list = [];
      if (event.type === "round_all_picks_confirmed") {
        list = event.confirmedList || [];
      } else {
        list = Array.isArray(event) ? event : [event];
      }

      applyConfirmedPicks(list);

      const modal = document.getElementById("lotteryModal");
      if (modal) modal.style.display = "none";

      const boardPanel = document.getElementById("roundBoardPanel");
      if (boardPanel) {
        boardPanel.style.display = "block";
        boardPanel.style.setProperty("display", "block", "important");
      }
      
      renderTeams();
      updateRoundBoardVisualizer(round);
    }

    if (!isHost && event.type === "lottery_phase_start") {
      document.getElementById("roundBoardSubStatus").innerText = "🎲 重複指名の抽選を開始します...";
      writeLog("🎲 <b>重複指名の抽選へ進みます。くじ引き画面を開きます...</b>");
    }

    if (event.type === "re_nomination_start") {
      reAttemptCount = event.attempt || 1;
      const amILoser = event.loserSlots && event.loserSlots.includes(myPlayerSlot);

      const boardPanel = document.getElementById("roundBoardPanel");
      if (boardPanel) {
        boardPanel.style.display = "block";
        boardPanel.style.setProperty("display", "block", "important");
      }
      updateRoundBoardVisualizer(round, event.loserSlots);
      renderTeams();

      if (amILoser) {
        currentUserCurrentRoundPick = {
          name: "（再入札中）",
          origin: null,
          msg: `❌ 抽選に外れました。【外れ指名 (第${reAttemptCount}回)】のメンバーを選択してください。`,
          isMiss: true
        };
        updateUserPickStatusBanner();

        writeLog(`👉 <b style="color:#d81b60;">抽選に外れました。【外れ指名 (第${reAttemptCount}回)】のメンバーを選択してください。</b>`);
        isReNomination = true;
        prepareUserSelection(`外れ指名 (第${reAttemptCount}回)`, false);
        document.getElementById("actionControls").style.display = "flex";
        document.getElementById("nominateBtn").disabled = false;
      } else {
        document.getElementById("actionControls").style.display = "none";
        writeLog(`⏳ 抽選に外れた球団が外れ指名（第${reAttemptCount}回）を行っています。しばらくお待ちください...`);
      }
    }

    if (event.type === "round_ready_wait") {
      round = event.round;
      promptNextRoundReady();
    }

    if (event.type === "round_advance") {
      const readyBtn = document.getElementById("readyNextRoundBtn");
      if (readyBtn) readyBtn.style.display = "none";
      document.getElementById("proceedLotteryBtn").style.display = "none";
      document.getElementById("actionControls").style.display = "none";

      currentUserCurrentRoundPick = null;
      updateUserPickStatusBanner();

      round = event.nextRound;
      isReNomination = false;
      reAttemptCount = 0;
      document.getElementById("roundDisplay").innerText = `第 ${currentSession} 周目 - 第 ${round} 巡目`;
      writeLog(`<br>✨ <b>全員の確認が完了しました。第 ${round} 巡目の指名を開始します！</b>`);

      renderTeams();
      runRound();
    }

    if (event.type === "waiver_step") {
      executeSyncedWaiverStep(event.slot, event.playerName, event.round || round);
    }

    if (event.type === "next_session_start") {
      currentSession = event.session;
      startSession(currentSession);
    }
  });

  db.ref(`rooms/${currentRoomId}/finalResults`).on('value', snap => {
    const fData = snap.val();
    if (!fData || isHost) return;

    globalStandings = fData.standings.map(item => ({
      team: teams[item.teamId] || { name: item.teamName, isUser: item.isUser },
      totalPt: item.totalPt,
      picksCount: item.picksCount
    }));
    globalTopPlayers = fData.topPlayers;

    isDraftCompleted = true;
    document.getElementById("roundDisplay").innerText = "全 7 周 ドラフト会議 完全終了";
    document.getElementById("teamsHeading").innerText = `【最終結果】各球団の週別獲得選手・累計総pt一覧 (全${maxTeams}球団)`;
    document.getElementById("actionControls").style.display = "none";
    document.getElementById("goToFormationBtn").style.display = "inline-block";

    showFinalTab("team");
    renderTeams();
  });

  db.ref(`rooms/${currentRoomId}/activeWaiverSlot`).on('value', snap => {
    const activeSlot = snap.val();
    if (activeSlot === null || activeSlot === undefined) return;
    handleWaiverTurn(activeSlot);
  });

  db.ref(`rooms/${currentRoomId}/lotterySync`).on('value', snap => {
    const lData = snap.val();
    if (!lData) return;
    handleSyncedLotteryState(lData);
  });

  db.ref(`rooms/${currentRoomId}/finishedSlots`).on('value', snap => {
    const fSlots = snap.val() || {};
    for (const slotKey in fSlots) {
      const slotId = parseInt(slotKey.replace("slot_", ""), 10);
      if (teams[slotId]) teams[slotId].isFinished = true;
    }
    renderTeams();
  });
}

function startMultiDraft() {
  if (!isHost) return;
  const updates = {};
  for (let i = 0; i < maxTeams; i++) {
    updates[`slots/slot_${i}/rank`] = teams[i].rank;
    updates[`slots/slot_${i}/isCpu`] = teams[i].isCpu;
    updates[`slots/slot_${i}/name`] = teams[i].name.replace(" (あなた)", "");
  }
  updates["status"] = "started";
  db.ref(`rooms/${currentRoomId}`).update(updates);
}

function confirmReset() {
  if (currentRoomId && db) {
    try {
      db.ref(`rooms/${currentRoomId}`).off();
      if (isHost) db.ref(`rooms/${currentRoomId}`).remove();
    } catch (e) {}
  }

  if (window.userPickResolve) { window.userPickResolve(null); window.userPickResolve = null; }
  if (window.userDrawResolve) { window.userDrawResolve(); window.userDrawResolve = null; }
  if (currentLotteryResolver) { currentLotteryResolver(teams[0]); currentLotteryResolver = null; }

  currentSession = 1;
  round = 1;
  isDraftCompleted = false;
  isReNomination = false;
  reAttemptCount = 0;
  isLotteryLocked = false;
  pendingBids = [];
  waiverOrder = [];
  currentWaiverIndex = 0;
  currentRoomId = null;
  myPlayerSlot = 0;
  isHost = false;
  gameMode = "solo";
  currentUserCurrentRoundPick = null;

  document.getElementById("modeSelectBox").style.display = "block";
  document.getElementById("multiLobbySetup").style.display = "none";
  document.getElementById("roomWaitArea").style.display = "none";
  document.getElementById("hostBadge").style.display = "none";
  document.getElementById("hostControlBtns").style.display = "none";
  document.getElementById("inputRoomId").disabled = false;
  document.getElementById("inputRoomId").value = "";

  document.getElementById("sessionBar").style.display = "none";
  document.getElementById("controlPanel").style.display = "none";
  document.getElementById("rankSettingArea").style.display = "none";
  document.getElementById("actionControls").style.display = "none";
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("proceedLotteryBtn").style.display = "none";
  document.getElementById("readyNextRoundBtn").style.display = "none";
  document.getElementById("nextSessionBtn").style.display = "none";
  document.getElementById("goToFormationBtn").style.display = "none";
  document.getElementById("closeRoomBtn").style.display = "none";

  updateUserPickStatusBanner();

  document.getElementById("roundBoardGrid").innerHTML = "";
  document.getElementById("formationSection").style.display = "none";
  document.getElementById("lotteryModal").style.display = "none";

  document.getElementById("logPanel").style.display = "none";
  document.getElementById("teamsHeading").style.display = "none";
  document.getElementById("teamsContainer").style.display = "none";

  document.getElementById("roundDisplay").innerText = "ドラフト待機中";
  document.getElementById("logTerminal").innerHTML = "";

  initTeams();
  renderTeams();
  writeLog("🔄 <b>ドラフト会議を初期化しました。</b> プレイモードを選択してください。");
}

function promptSessionStart() {
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("sessionBar").style.display = "flex";
  isDraftCompleted = false;
  currentSession = 1;
  openInitialRankSetting();
}

function openInitialRankSetting() {
  document.getElementById("actionControls").style.display = "none";
  document.getElementById("nextSessionBtn").style.display = "none";
  document.getElementById("rankSettingArea").style.display = "block";
  document.getElementById("currentSessionLabel").innerText = `第 1 周目 ドラフト会議 (全7周)`;
  
  sessionPool = allMasterData.filter(m => Number(m.登場週目) === 1);
  const poolCount = sessionPool.length;
  const minLimit = Math.max(1, Math.floor(poolCount / 7));
  const maxLimit = Math.max(minLimit, Math.floor(poolCount / 4));
  document.getElementById("sessionPoolCount").innerText = poolCount;
  document.getElementById("quotaRange").innerText = `${minLimit}〜${maxLimit}`;
}

function confirmInitialRankAndStart() {
  document.getElementById("rankSettingArea").style.display = "none";
  const userRank = parseInt(document.getElementById("rankSelect").value, 10);
  teams[myPlayerSlot].rank = userRank;

  let availableRanks = [];
  for (let r = 1; r <= maxTeams; r++) {
    if (r !== userRank) availableRanks.push(r);
  }
  availableRanks.sort(() => Math.random() - 0.5);

  let rankIdx = 0;
  for (let i = 0; i < teams.length; i++) {
    if (i !== myPlayerSlot) teams[i].rank = availableRanks[rankIdx++];
  }

  startSession(1);
}

function determineNextSessionRanks() {
  let rankingList = teams.map(t => ({
    team: t,
    point: t.sessionPicks.filter(p => !p.isPass).reduce((sum, p) => sum + Number(p.ポイント || 0), 0),
    tiebreaker: Math.random()
  }));

  rankingList.sort((a, b) => (b.point !== a.point) ? (b.point - a.point) : (a.tiebreaker - b.tiebreaker));

  writeLog(`<br>📊 <b>【第 ${currentSession} 周目 終了 ➔ 次周ウェーバー順位確定】</b>`);
  rankingList.forEach((item, index) => {
    let assignedRank = index + 1;
    item.team.rank = assignedRank;
    writeLog(`・第 ${assignedRank} 位: <b>${item.team.name}</b> ${assignedRank === maxTeams ? `<span style="color:#d81b60; font-weight:bold;">(次周2巡目 1番手)</span>` : ''}`);
  });

  if (gameMode === "multi" && isHost) {
    const updates = {};
    teams.forEach(t => { updates[`slots/slot_${t.id}/rank`] = t.rank; });
    db.ref(`rooms/${currentRoomId}`).update(updates);
  }
}

function startSession(sNum) {
  round = 1;
  currentSession = sNum;
  isSessionEnding = false;
  const boardPanel = document.getElementById("roundBoardPanel");
  if (boardPanel) {
    boardPanel.style.display = "block";
  }
  sessionPool = allMasterData.filter(m => Number(m.登場週目) === sNum);
  const poolCount = sessionPool.length;

  const minLimit = Math.max(1, Math.floor(poolCount / 7));
  const maxLimit = Math.max(minLimit, Math.floor(poolCount / 4));

  teams.forEach(t => {
    t.sessionPicks = [];
    t.isFinished = false;
    t.lotteryHistory = [];
    t.sessionTargetLimit = t.isUser ? maxLimit : Math.floor(Math.random() * (maxLimit - minLimit + 1)) + minLimit;
  });

  if (gameMode === "multi" && isHost) {
    db.ref(`rooms/${currentRoomId}/finishedSlots`).remove();
  }

  currentUserCurrentRoundPick = null;
  updateUserPickStatusBanner();

  document.getElementById("logPanel").style.display = "block";
  document.getElementById("teamsHeading").style.display = "block";
  document.getElementById("teamsContainer").style.display = "grid";

  initRoundBoard(0, []);
  document.getElementById("proceedLotteryBtn").style.display = "none";
  document.getElementById("readyNextRoundBtn").style.display = "none";
  document.getElementById("currentSessionLabel").innerText = `第 ${sNum} 周目 ドラフト会議 (全7周)`;
  document.getElementById("sessionPoolCount").innerText = poolCount;
  document.getElementById("quotaRange").innerText = `${minLimit}〜${maxLimit}`;
  document.getElementById("nextSessionBtn").style.display = "none";

  writeLog(`<br>==================================================`);
  writeLog(`🎯 <b>【第 ${sNum} 周目 ドラフト会議 開始】</b> (自チーム順位: ${teams[myPlayerSlot].rank}位 / 全${maxTeams}球団 / ${draftSystem === 'waiver' ? '通常ウェーバー制' : '全巡抽選制'})`);
  writeLog(`==================================================`);

  renderTeams();
  runRound();
}

function runRound() {
  pendingConfirmedPicks = [];
  const activeTeams = teams.filter(t => !t.isFinished);
  if (activeTeams.length === 0 || sessionPool.length === 0) {
    endCurrentSession();
    return;
  }

  document.getElementById("roundDisplay").innerText = `第 ${currentSession} 周目 - 第 ${round} 巡目`;
  document.getElementById("sessionPoolCount").innerText = sessionPool.length;

  currentUserCurrentRoundPick = null;
  updateUserPickStatusBanner();

  if (round === 1 || draftSystem === "all_lottery") {
    isReNomination = false;
    reAttemptCount = 0;
    if (gameMode === "multi" && isHost) {
      db.ref(`rooms/${currentRoomId}/currentBids`).remove();
      db.ref(`rooms/${currentRoomId}/reBids`).remove();
    }
    
    if (teams[myPlayerSlot].isFinished) {
      document.getElementById("actionControls").style.display = "none";
      currentUserCurrentRoundPick = {
        name: "【今周 選択終了】",
        origin: null,
        msg: "今周の指名を終了しています。他球団の進行を待機中...",
        isPass: true
      };
      updateUserPickStatusBanner();
      
      if (gameMode === "multi") {
        db.ref(`rooms/${currentRoomId}/currentBids/slot_${myPlayerSlot}`).set({
          name: PASS_PLAYER.名前,
          slot: myPlayerSlot
        });
      }
    } else {
      prepareUserSelection(`第 ${round} 巡目 入札メンバーを選択してください`);
    }

    if (isHost && gameMode === "multi") {
      waitForAllBidsAndProceed();
    }
  } else {
    processWaiverRound();
  }
}

function prepareUserSelection(promptText, allowPass = true) {
  const select = document.getElementById("playerDropdown");
  select.innerHTML = "";
  
  const displayPool = [...sessionPool].sort((a, b) => a.名前.localeCompare(b.名前, 'ja'));
  displayPool.forEach(p => {
    const originLabel = normalizeOrigin(p.出身);
    const opt = document.createElement("option");
    opt.value = p.名前;
    opt.innerText = `${p.名前} 【${originLabel}】${p.所属 ? ` (${p.所属})` : ''}`;
    select.appendChild(opt);
  });

  document.getElementById("actionControls").style.display = "flex";
  document.getElementById("nominateBtn").disabled = false;
  document.getElementById("passBtn").disabled = !allowPass || (round === 1 && !isReNomination && draftSystem === "waiver");
}

function updateUserPickStatusBanner() {
  const banner = document.getElementById("userPickStatusBox");
  const nameEl = document.getElementById("userConfirmedPickName");
  const origEl = document.getElementById("userConfirmedPickOrigin");
  const msgEl = document.getElementById("userWaitingMsg");

  if (!currentUserCurrentRoundPick) {
    banner.style.display = "none";
    return;
  }

  banner.classList.remove("is-miss", "is-pass");
  if (currentUserCurrentRoundPick.isMiss) banner.classList.add("is-miss");
  else if (currentUserCurrentRoundPick.isPass) banner.classList.add("is-pass");

  nameEl.innerText = currentUserCurrentRoundPick.name;
  if (currentUserCurrentRoundPick.origin && currentUserCurrentRoundPick.origin !== "-") {
    origEl.innerText = currentUserCurrentRoundPick.origin;
    origEl.className = `badge badge-${currentUserCurrentRoundPick.origin}`;
    origEl.style.display = "inline-block";
  } else {
    origEl.style.display = "none";
  }
  msgEl.innerText = currentUserCurrentRoundPick.msg || "⏳ 他チームの選択完了・確定を待機しています...";
  banner.style.display = "flex";
}

function onUserNominate() {
  const chosenName = document.getElementById("playerDropdown").value;
  const userChoice = sessionPool.find(p => p.名前 === chosenName);
  if (!userChoice) return;

  const originLabel = normalizeOrigin(userChoice.出身);

  document.getElementById("nominateBtn").disabled = true;
  document.getElementById("passBtn").disabled = true;
  document.getElementById("actionControls").style.display = "none";

  currentUserCurrentRoundPick = {
    name: userChoice.名前,
    origin: originLabel,
    msg: "⏳ あなたの指名が確定しました。他チームの選択・開票を待機しています...",
    isMiss: false
  };
  updateUserPickStatusBanner();

  if (gameMode === "multi") {
    if (round === 1 || draftSystem === "all_lottery") {
      if (isReNomination) {
        writeLog(`⏳ <b>あなたの外れ指名 [第${reAttemptCount}回] (${userChoice.名前}) を送信しました。</b> 他球団の選択完了を待機中...`);
        db.ref(`rooms/${currentRoomId}/reBids/attempt_${reAttemptCount}/slot_${myPlayerSlot}`).set({
          name: userChoice.名前,
          slot: myPlayerSlot,
          ts: Date.now()
        });
      } else {
        writeLog(`⏳ <b>あなたの第 ${round} 巡目入札 (${userChoice.名前}) を送信しました。</b> 他球団の選択完了を待機中...`);
        db.ref(`rooms/${currentRoomId}/currentBids/slot_${myPlayerSlot}`).set({
          name: userChoice.名前,
          slot: myPlayerSlot
        });
      }
    } else {
      writeLog(`⏳ <b>あなたの指名 (${userChoice.名前}) を送信しました。</b> 次の手番・確定を待機中...`);
      db.ref(`rooms/${currentRoomId}/waiverSubmit`).set({
        slot: myPlayerSlot,
        playerName: userChoice.名前,
        round: round,
        ts: Date.now()
      });
    }
  } else {
    if (round === 1 || draftSystem === "all_lottery") {
      if (isReNomination) {
        if (window.userPickResolve) window.userPickResolve(userChoice);
      } else {
        handleRoundLottery(userChoice);
      }
    } else {
      if (window.userPickResolve) window.userPickResolve(userChoice);
    }
  }
}

function onUserPass() {
  document.getElementById("nominateBtn").disabled = true;
  document.getElementById("passBtn").disabled = true;
  document.getElementById("actionControls").style.display = "none";

  teams[myPlayerSlot].isFinished = true;
  writeLog(`🛑 <b>${teams[myPlayerSlot].name}</b> は今周の【選択終了】を宣言しました。`);

  currentUserCurrentRoundPick = {
    name: "【今周 選択終了】",
    origin: null,
    msg: "今周の指名を終了しました。他球団の進行を待機中...",
    isPass: true
  };
  updateUserPickStatusBanner();

  if (gameMode === "multi") {
    db.ref(`rooms/${currentRoomId}/finishedSlots/slot_${myPlayerSlot}`).set(true);

    if (round === 1 || draftSystem === "all_lottery") {
      db.ref(`rooms/${currentRoomId}/currentBids/slot_${myPlayerSlot}`).set({
        name: PASS_PLAYER.名前,
        slot: myPlayerSlot
      });
    } else {
      db.ref(`rooms/${currentRoomId}/waiverSubmit`).set({
        slot: myPlayerSlot,
        playerName: PASS_PLAYER.名前,
        round: round,
        ts: Date.now()
      });
    }
  } else {
    if (window.userPickResolve) { window.userPickResolve(PASS_PLAYER); }
  }

  renderTeams();
  checkEndConditions();
}

function waitForAllBidsAndProceed() {
  const bidsRef = db.ref(`rooms/${currentRoomId}/currentBids`);
  bidsRef.on('value', async snap => {
    const bidsData = snap.val() || {};
    const allHumansReady = teams.filter(t => !t.isCpu).every(t => bidsData[`slot_${t.id}`]);

    if (allHumansReady) {
      bidsRef.off();
      
      let bids = [];
      teams.forEach(t => {
        if (!t.isCpu) {
          const bInfo = bidsData[`slot_${t.id}`];
          if (bInfo) {
            const choice = (bInfo.name === PASS_PLAYER.名前) 
              ? PASS_PLAYER 
              : sessionPool.find(p => p.名前 === bInfo.name);
            if (choice) bids.push({ team: t, choice: choice });
          }
        } else {
          if (t.isFinished) {
            bids.push({ team: t, choice: PASS_PLAYER });
          } else {
            let cpuChoice = chooseCpuPick(sessionPool, t);
            if (cpuChoice) {
              bids.push({ team: t, choice: cpuChoice });
            } else {
              t.isFinished = true;
              bids.push({ team: t, choice: PASS_PLAYER });
            }
          }
        }
      });

      if (bids.every(b => b.choice.isPass)) {
        endCurrentSession();
        return;
      }

      db.ref(`rooms/${currentRoomId}/roundEvent`).set({
        type: "round_reveal",
        bids: bids.map(b => ({ slot: b.team.id, playerName: b.choice.名前 })),
        attempt: 0
      });

      await executeSyncedReveal(bids, 0);
    }
  });
}

function initRoundBoard(attempt = 0, currentBiddingSlotIds = []) {
  const boardPanel = document.getElementById("roundBoardPanel");
  if (boardPanel) {
    boardPanel.style.display = "block";
    boardPanel.style.setProperty("display", "block", "important");
  }
  const grid = document.getElementById("roundBoardGrid");
  const title = document.getElementById("roundBoardTitle");
  const subStatus = document.getElementById("roundBoardSubStatus");

  const titlePrefix = (attempt === 0) 
    ? `◆ 第 ${currentSession} 周目 - 第 ${round} 巡目 入札速報 ◆` 
    : `◆ 第 ${currentSession} 周目 - 第 ${round} 巡目 外れ指名(第${attempt}回) 開票速報 ◆`;

  title.innerText = titlePrefix;
  subStatus.innerText = "指名順に順次開票中...";
  grid.innerHTML = "";

  teams.forEach(t => {
    const isTargetTeam = currentBiddingSlotIds.includes(t.id);
    const pick = t.sessionPicks.find(p => p.draftRound === round);
    let cell = document.createElement("div");
    cell.className = "npb-cell";
    cell.id = `npb-cell-slot-${t.id}`;

    let bodyHtml = "";
    if (pick) {
      if (pick.isPass) {
        bodyHtml = `<div class="pass-state">なし</div>`;
      } else {
        cell.classList.add("is-confirmed-cell");
        const originLabel = normalizeOrigin(pick.出身);
        bodyHtml = `
          <div class="lottery-track"><span class="stamp-green">確定</span></div>
          <div>
            <div class="player-name-main">${pick.名前}</div>
            <div class="player-meta-sub">
              <span>出身: <b>${originLabel}</b></span>
              <span>${pick.所属 ? `所属: <b>${pick.所属}</b>` : ''}</span>
            </div>
          </div>
        `;
      }
    } else if (isTargetTeam) {
      bodyHtml = `<div class="card-closed">【 入札封筒 未開封 】</div>`;
    } else if (t.isFinished) {
      bodyHtml = `<div class="pass-state">なし</div>`;
    } else {
      bodyHtml = `<div style="color:#b0bec5; font-size:13px; text-align:center; width:100%;">指名待機中...</div>`;
    }

    cell.innerHTML = `
      <div class="npb-cell-header ${t.isUser ? 'is-user' : ''}">
        <span>${t.name}</span>
        <span class="status-slot">${pick ? (pick.isPass ? '<span style="color:#78909c;">終了</span>' : '<span style="color:#2e7d32; font-weight:bold;">確定</span>') : (isTargetTeam ? `${t.rank}位 (開票前)` : `${t.rank}位`)}</span>
      </div>
      <div class="npb-cell-body">${bodyHtml}</div>
    `;
    grid.appendChild(cell);
  });
}

async function executeSyncedReveal(bids, attempt = 0) {
  const boardPanel = document.getElementById("roundBoardPanel");
  if (boardPanel) {
    boardPanel.style.display = "block";
    boardPanel.style.setProperty("display", "block", "important");
  }
  pendingBids = bids;
  const currentBiddingSlotIds = bids.map(b => b.team.id);

  initRoundBoard(attempt, currentBiddingSlotIds);

  const subStatus = document.getElementById("roundBoardSubStatus");
  let openOrderBids = [...bids].sort((a, b) => b.team.rank - a.team.rank);
  let openedSoFar = [];

  for (let i = 0; i < openOrderBids.length; i++) {
    const b = openOrderBids[i];
    const cell = document.getElementById(`npb-cell-slot-${b.team.id}`);
    if (!cell) continue;

    const body = cell.querySelector(".npb-cell-body");
    const statusSlot = cell.querySelector(".status-slot");

    cell.classList.add("is-active-turn");
    subStatus.innerText = `【開票】${b.team.name}(${b.team.rank}位) 開票中...`;

    await new Promise(res => setTimeout(res, 450));

    cell.classList.remove("is-active-turn");
    cell.classList.add("opening-now");

    openedSoFar.push(b);

    if (b.choice.isPass) {
      if (statusSlot) statusSlot.innerHTML = `<span style="color:#78909c;">終了</span>`;
      if (body) body.innerHTML = `<div class="pass-state">なし</div>`;
      writeLog(`[${attempt === 0 ? `第${round}巡` : `外れ(第${attempt}回)`}] ${b.team.name} ➔ <span style="color:#78909c;">なし(選択終了)</span>`);
    } else {
      const originLabel = normalizeOrigin(b.choice.出身);
      const matchingOpened = openedSoFar.filter(item => !item.choice.isPass && item.choice.名前 === b.choice.名前);
      const isConflictNow = matchingOpened.length > 1;

      if (isConflictNow) {
        matchingOpened.forEach(item => {
          const cCell = document.getElementById(`npb-cell-slot-${item.team.id}`);
          if (cCell) {
            cCell.classList.add("is-conflict");
            const cStatus = cCell.querySelector(".status-slot");
            if (cStatus) cStatus.innerHTML = `<span class="conflict-banner">🔥 競合 (${matchingOpened.length}球団)</span>`;
          }
        });
      } else {
        if (statusSlot) statusSlot.innerHTML = `<span style="color:#2e7d32; font-weight:bold;">単独</span>`;
      }

      if (body) {
        body.innerHTML = `
          <div class="lottery-track">
            <span class="stamp-red">公表</span>
          </div>
          <div>
            <div class="player-name-main">${b.choice.名前}</div>
            <div class="player-meta-sub">
              <span>出身: <b>${originLabel}</b></span>
              <span>${b.choice.所属 ? `所属: <b>${b.choice.所属}</b>` : ''}</span>
            </div>
          </div>
        `;
      }

      const logPrefix = (attempt === 0) ? `[第${round}巡開票]` : `[外れ指名(第${attempt}回)開票]`;
      writeLog(`${logPrefix} ${b.team.name} ➔ <b>${b.choice.名前}</b> [${originLabel}] ${b.choice.所属 ? `(${b.choice.所属})` : ''}${isConflictNow ? ' <span style="color:#ff9800; font-weight:bold;">【重複発生】</span>' : ''}`);
    }

    await new Promise(res => setTimeout(res, 200));
  }

  let counts = {};
  bids.filter(b => !b.choice.isPass).forEach(b => {
    counts[b.choice.名前] = (counts[b.choice.名前] || 0) + 1;
  });

  const hasConflict = Object.values(counts).some(c => c > 1);

  if (hasConflict) {
    subStatus.innerText = "⚠️ 競合発生！抽選へ移行します...";
    writeLog("⚠️ <b style='color:#ff9800;'>重複指名（競合）が発生しました！自動的に抽選を開始します...</b>");

    if (gameMode === "multi") {
      if (isHost) {
        db.ref(`rooms/${currentRoomId}/roundEvent`).set({
          type: "lottery_phase_start",
          ts: Date.now()
        });
        startLotteryResolutionPhase();
      }
    } else {
      startLotteryResolutionPhase();
    }

  } else {
    subStatus.innerText = "✨ 単独指名 確定！";
    writeLog("✨ <b>指名が確定しました！</b>");
    
    const boardPanel = document.getElementById("roundBoardPanel");
    if (boardPanel) {
      boardPanel.style.display = "block";
      boardPanel.style.setProperty("display", "block", "important");
    }
    renderTeams();
    updateRoundBoardVisualizer(round);

    if (isHost || gameMode === "solo") {
      setTimeout(() => {
        resolveBidsLoop(pendingBids, () => {
          triggerAllPlayersReadyWait();
        });
      }, 600);
    }
  }
}

function chooseCpuPick(pool, teamObj = null) {
  if (!pool || pool.length === 0) return null;

  const allPoints = pool.map(p => Number(p.ポイント || 0)).sort((a, b) => b - a);
  const maxPtInPool = allPoints[0];
  
  const cutoffPt = Math.max(10, Math.floor(maxPtInPool * 0.6));
  let qualifiedPool = pool.filter(p => Number(p.ポイント || 0) >= cutoffPt);
  
  if (qualifiedPool.length === 0) {
    qualifiedPool = pool.slice(0, Math.min(5, pool.length));
  }

  const policy = teamObj ? teamObj.cpuPolicy : "pure_pt";
  let targetPool = qualifiedPool;

  if (policy === "academic") {
    const academic = qualifiedPool.filter(p => {
      const orig = normalizeOrigin(p.出身);
      return orig === "高卒" || orig === "大卒";
    });
    if (academic.length > 0) targetPool = academic;

  } else if (policy === "working") {
    const working = qualifiedPool.filter(p => {
      const orig = normalizeOrigin(p.出身);
      return orig === "社会人" || orig === "独L";
    });
    if (working.length > 0) targetPool = working;

  } else if (policy === "popularity") {
    const topPtThreshold = allPoints[Math.floor(allPoints.length * 0.4)] || 0;
    const starCandidates = qualifiedPool.filter(p => Number(p.ポイント || 0) >= topPtThreshold);
    if (starCandidates.length > 0) {
      targetPool = starCandidates.sort((a, b) => Number(b.競合率 || 0) - Number(a.競合率 || 0));
      return targetPool[0];
    }
  }

  const sorted = [...targetPool].sort((a, b) => {
    const ptA = Number(a.ポイント || 0);
    const ptB = Number(b.ポイント || 0);
    const confA = Number(a.競合率 || 0);
    const confB = Number(b.競合率 || 0);

    if (teamObj.cpuPolicy === "pure_pt") {
      if (Math.abs(ptA - ptB) <= 3500) {
        return Math.random() - 0.5;
      }
      return ptB - ptA;
    }

    const scoreA = ptA / (confA + 0.01);
    const scoreB = ptB / (confB + 0.01);

    if (Math.abs(scoreA - scoreB) <= 2) {
      return Math.random() - 0.5;
    }
    return scoreB - scoreA;
  });

  const highestPt = Number(sorted[0].ポイント || 0);
  const topTier = sorted.filter(p => Number(p.ポイント || 0) >= highestPt - 2);
  
  return topTier[Math.floor(Math.random() * topTier.length)];
}

async function handleRoundLottery(userChoice) {
  writeLog(`<br>---【第 ${round} 巡目 入札受付完了】---`);
  let bids = [];
  bids.push({ team: teams[myPlayerSlot], choice: userChoice || PASS_PLAYER });

  for (let i = 0; i < teams.length; i++) {
    if (i !== myPlayerSlot) {
      if (teams[i].isFinished) {
        bids.push({ team: teams[i], choice: PASS_PLAYER });
      } else {
        let cpuChoice = chooseCpuPick(sessionPool, teams[i]);
        if (cpuChoice) {
          bids.push({ team: teams[i], choice: cpuChoice });
        } else {
          teams[i].isFinished = true;
          bids.push({ team: teams[i], choice: PASS_PLAYER });
        }
      }
    }
  }

  if (bids.every(b => b.choice.isPass)) {
    endCurrentSession();
    return;
  }

  await executeSyncedReveal(bids, 0);
}

function startLotteryResolutionPhase() {
  document.getElementById("proceedLotteryBtn").style.display = "none";
  if (gameMode === "multi" && isHost) {
    db.ref(`rooms/${currentRoomId}/roundEvent`).set({
      type: "lottery_phase_start",
      ts: Date.now()
    });
  }
  resolveBidsLoop(pendingBids, () => {
    triggerAllPlayersReadyWait();
  });
}

async function resolveBidsLoop(bids, onFinish) {
  let groups = {};
  bids.forEach(b => {
    if (!groups[b.choice.名前]) groups[b.choice.名前] = [];
    groups[b.choice.名前].push(b.team);
  });

  let losers = [];
  let confirmedThisStep = [];

  for (let name in groups) {
    let candidateTeams = groups[name];

    if (name === PASS_PLAYER.名前) {
      candidateTeams.forEach(t => {
        assignPick(t, PASS_PLAYER, round);
        t.isFinished = true;
        confirmedThisStep.push({ type: "pick_confirmed", slot: t.id, playerName: PASS_PLAYER.名前, round: round });
      });
      continue;
    }

    let chosenPlayer = sessionPool.find(p => p.名前 === name);
    if (!chosenPlayer) {
      candidateTeams.forEach(t => {
        assignPick(t, PASS_PLAYER, round);
        writeLog(`⚠️ <span style="color:#ff5252;">${name} は既に獲得済みまたは存在しないため、${t.name} の入札が無効化されました。</span>`);
      });
      continue;
    }

    if (candidateTeams.length === 1) {
      let t = candidateTeams[0];
      assignPick(t, chosenPlayer, round);
      if (!t.lotteryHistory.some(h => h.name === chosenPlayer.名前 && h.result === 'single')) {
        t.lotteryHistory.push({ name: chosenPlayer.名前, result: 'single' });
      }
      sessionPool = sessionPool.filter(p => p.名前 !== chosenPlayer.名前);
      writeLog(`✨ <span style="color:#4caf50;">【確定】</span>${t.name} が <b>${chosenPlayer.名前}</b> の交渉権を獲得！`);

      confirmedThisStep.push({ type: "pick_confirmed", slot: t.id, playerName: chosenPlayer.名前, round: round });

      if (t.isUser) {
        currentUserCurrentRoundPick = {
          name: chosenPlayer.名前,
          origin: normalizeOrigin(chosenPlayer.出身),
          msg: "🎉 単独指名で交渉権獲得！",
          isMiss: false
        };
        updateUserPickStatusBanner();
      }
    } else {
      writeLog(`🎲 <span style="color:#ffb74d;">【競合抽選】</span><b>${name}</b> に ${candidateTeams.length} 球団重複！くじ引きを行います...`);
      
      let winner = null;
      const userInvolved = candidateTeams.some(t => t.isUser);
      if (gameMode === "solo" && !userInvolved) {
        winner = candidateTeams[Math.floor(Math.random() * candidateTeams.length)];
        await new Promise(r => setTimeout(r, 600));
      } else {
        winner = await openInteractiveLotteryModal(chosenPlayer, candidateTeams);
      }
      
      assignPick(winner, chosenPlayer, round);
      if (!winner.lotteryHistory.some(h => h.name === chosenPlayer.名前 && h.result === 'hit')) {
        winner.lotteryHistory.push({ name: chosenPlayer.名前, result: 'hit' });
      }
      sessionPool = sessionPool.filter(p => p.名前 !== chosenPlayer.名前);
      writeLog(`🎉 <span style="color:#81d4fa;">【当たりくじ】</span><b>${winner.name}</b> が当選！(<b>${chosenPlayer.名前}</b>)`);

      confirmedThisStep.push({ type: "pick_confirmed", slot: winner.id, playerName: chosenPlayer.名前, round: round });

      if (winner.isUser) {
        currentUserCurrentRoundPick = {
          name: chosenPlayer.名前,
          origin: normalizeOrigin(chosenPlayer.出身),
          msg: "🎉 くじ引き当選！交渉権獲得！",
          isMiss: false
        };
        updateUserPickStatusBanner();
      }

      candidateTeams.forEach(team => {
        if (team.id !== winner.id) {
          if (!team.lotteryHistory.some(h => h.name === chosenPlayer.名前 && h.result === 'miss')) {
            team.lotteryHistory.push({ name: chosenPlayer.名前, result: 'miss' });
          }
          losers.push(team);
        }
      });
    }
  }

  confirmedThisStep.forEach(item => {
    const exists = pendingConfirmedPicks.some(pick =>
      pick.slot === item.slot && pick.round === item.round && pick.playerName === item.playerName
    );
    if (!exists) pendingConfirmedPicks.push(item);
  });

  if (gameMode === "multi" && isHost) {
    db.ref(`rooms/${currentRoomId}/roundEvent`).set({
      type: "round_all_picks_confirmed",
      confirmedList: pendingConfirmedPicks,
      nonce: Math.random(),
      ts: Date.now()
    });
  }

  const boardPanel = document.getElementById("roundBoardPanel");
  if (boardPanel) {
    boardPanel.style.display = "block";
    boardPanel.style.setProperty("display", "block", "important");
  }
  updateRoundBoardVisualizer(round, losers.map(l => l.id));
  renderTeams();

  if (losers.length > 0 && sessionPool.length > 0) {
    reAttemptCount++;
    writeLog(`<br>---【外れ指名 [第${reAttemptCount}回] 入札受付】---`);

    if (gameMode === "multi") {
      if (isHost) {
        handleMultiReNomination(losers, onFinish, pendingConfirmedPicks);
      }
    } else {
      let nextBids = [];
      let userLoser = losers.find(t => t.isUser);
      let cpuLosers = losers.filter(t => !t.isUser);

      cpuLosers.forEach(t => {
        let rePick = chooseCpuPick(sessionPool, t);
        if (rePick) nextBids.push({ team: t, choice: rePick });
        else nextBids.push({ team: t, choice: PASS_PLAYER });
      });

      if (userLoser) {
        currentUserCurrentRoundPick = {
          name: "（再入札中）",
          origin: null,
          msg: `❌ 抽選に外れました。外れ指名 [第${reAttemptCount}回] のメンバーを選択してください。`,
          isMiss: true
        };
        updateUserPickStatusBanner();

        writeLog(`👉 <b style="color:#d81b60;">抽選に外れました。外れ指名 [第${reAttemptCount}回] の指名メンバーを再選択してください。</b>`);
        isReNomination = true;
        
        prepareUserSelection(`外れ指名 (第${reAttemptCount}回)`, false);
        document.getElementById("actionControls").style.display = "flex";
        document.getElementById("nominateBtn").disabled = false;
        
        let userReChoice = await new Promise(resolve => { window.userPickResolve = resolve; });
        nextBids.unshift({ team: userLoser, choice: userReChoice || PASS_PLAYER });
      } else {
        cpuLosers.forEach(t => {
          let rePick = chooseCpuPick(sessionPool, t);
          if (rePick) nextBids.push({ team: t, choice: rePick });
          else nextBids.push({ team: t, choice: PASS_PLAYER });
        });
      }

      await executeSyncedReveal(nextBids, reAttemptCount);
    }
  } else {
    setTimeout(() => {
      onFinish();
    }, 800);
  }
}

function handleMultiReNomination(losers, onFinish, confirmedList = []) {
  const loserSlots = losers.map(t => t.id);
  const currentAttempt = reAttemptCount;

  db.ref(`rooms/${currentRoomId}/roundEvent`).set({
    type: "re_nomination_start",
    loserSlots: loserSlots,
    attempt: currentAttempt,
    confirmedList: confirmedList,
    ts: Date.now()
  });

  const humanLosers = losers.filter(t => !t.isCpu);

  if (humanLosers.length === 0) {
    let nextBids = [];
    losers.forEach(t => {
      let cpuChoice = chooseCpuPick(sessionPool, t);
      if (cpuChoice) nextBids.push({ team: t, choice: cpuChoice });
      else nextBids.push({ team: t, choice: PASS_PLAYER });
    });

    db.ref(`rooms/${currentRoomId}/roundEvent`).set({
      type: "re_nomination_reveal",
      bids: nextBids.map(b => ({ slot: b.team.id, playerName: b.choice.名前 })),
      attempt: currentAttempt,
      confirmedList: confirmedList,
      ts: Date.now()
    });

    executeSyncedReveal(nextBids, currentAttempt);
    return;
  }

  const reBidsAttemptRef = db.ref(`rooms/${currentRoomId}/reBids/attempt_${currentAttempt}`);
  reBidsAttemptRef.on('value', async snap => {
    const reBidsData = snap.val() || {};
    const allHumansSubmitted = humanLosers.every(t => reBidsData[`slot_${t.id}`] && reBidsData[`slot_${t.id}`].name);

    if (allHumansSubmitted) {
      reBidsAttemptRef.off();

      let nextBids = [];
      losers.forEach(t => {
        if (!t.isCpu) {
          const pName = reBidsData[`slot_${t.id}`].name;
          let choice = (pName === PASS_PLAYER.名前) 
            ? PASS_PLAYER 
            : (sessionPool.find(p => p.名前 === pName) || allMasterData.find(p => p.名前 === pName));
          
          if (choice && !choice.isPass && !sessionPool.some(p => p.名前 === choice.名前)) {
            writeLog(`⚠️ <span style="color:#ff5252;">${t.name} が外れ再入札で指定した ${choice.名前} は既に獲得されているため、パス扱いになります。</span>`);
            choice = PASS_PLAYER;
          }

          if (choice) nextBids.push({ team: t, choice: choice });
        } else {
          let cpuChoice = chooseCpuPick(sessionPool, t);
          if (cpuChoice) nextBids.push({ team: t, choice: cpuChoice });
          else nextBids.push({ team: t, choice: PASS_PLAYER });
        }
      });

      db.ref(`rooms/${currentRoomId}/roundEvent`).set({
        type: "re_nomination_reveal",
        bids: nextBids.map(b => ({ slot: b.team.id, playerName: b.choice.名前 })),
        attempt: currentAttempt,
        confirmedList: confirmedList,
        ts: Date.now()
      });

      await executeSyncedReveal(nextBids, currentAttempt);
    }
  });
}

function triggerAllPlayersReadyWait() {
  checkEndConditions();
  const activeTeams = teams.filter(t => !t.isFinished);
  if (activeTeams.length === 0 || sessionPool.length === 0) {
    endCurrentSession();
    return;
  }

  if (gameMode === "multi") {
    if (isHost) {
      db.ref(`rooms/${currentRoomId}/readySlots`).remove();
      db.ref(`rooms/${currentRoomId}/roundEvent`).set({
        type: "round_ready_wait",
        round: round,
        ts: Date.now()
      });
      waitForAllPlayersReadyAndAdvance();
    }
  } else {
    promptNextRoundReady();
  }
}

function promptNextRoundReady() {
  document.getElementById("actionControls").style.display = "none";
  updateRoundBoardVisualizer(round);
  renderTeams();

  if (teams[myPlayerSlot].isFinished) {
    if (gameMode === "multi") {
      db.ref(`rooms/${currentRoomId}/readySlots/slot_${myPlayerSlot}`).set(true);
    }
    return;
  }

  const readyBtn = document.getElementById("readyNextRoundBtn");
  readyBtn.disabled = false;
  readyBtn.innerText = `➔ 第 ${round} 巡目の指名を確認完了：第 ${round + 1} 巡目の指名へ進む`;
  readyBtn.style.display = "inline-block";
  writeLog(`<br>📋 <b>第 ${round} 巡目の全チームの指名が完了しました。ボードで結果を確認し、「次の指名へ進む」を押してください。</b>`);
}

function onUserReadyNextRound() {
  const readyBtn = document.getElementById("readyNextRoundBtn");
  readyBtn.disabled = true;

  if (gameMode === "multi") {
    readyBtn.innerText = "⏳ 他プレイヤーの確認完了を待機中...";
    db.ref(`rooms/${currentRoomId}/readySlots/slot_${myPlayerSlot}`).set(true);
  } else {
    readyBtn.style.display = "none";
    round++;
    renderTeams();
    runRound();
  }
}

function waitForAllPlayersReadyAndAdvance() {
  const readyRef = db.ref(`rooms/${currentRoomId}/readySlots`);
  readyRef.on('value', snap => {
    const readyData = snap.val() || {};
    const activeHumans = teams.filter(t => !t.isCpu && !t.isFinished).map(t => t.id);
    const allReady = activeHumans.length === 0 || activeHumans.every(slotId => readyData[`slot_${slotId}`] === true);

    if (allReady) {
      readyRef.off();
      db.ref(`rooms/${currentRoomId}/roundEvent`).set({
        type: "round_advance",
        nextRound: round + 1,
        ts: Date.now()
      });
    }
  });
}

async function processWaiverRound() {
  const isEvenRound = (round % 2 === 0);
  writeLog(`<br>---【第 ${round} 巡目 ${isEvenRound ? `ウェーバー (${maxTeams}位➔1位)` : `逆ウェーバー (1位➔${maxTeams}位)`} 指名】---`);

  waiverOrder = [...teams].sort((a, b) => isEvenRound ? (b.rank - a.rank) : (a.rank - b.rank));
  initWaiverRoundBoard(round, isEvenRound);

  if (gameMode === "multi") {
    if (isHost) {
      db.ref(`rooms/${currentRoomId}/waiverSubmit`).remove();
      currentWaiverIndex = 0;
      advanceToNextWaiverTurn();
    }
  } else {
    for (let team of waiverOrder) {
      if (sessionPool.length === 0) break;
      highlightActiveTurnCell(team.id);

      if (team.isFinished) {
        assignPick(team, PASS_PLAYER, round);
        openWaiverCell(team, PASS_PLAYER);
        renderTeams();
        await new Promise(r => setTimeout(r, 60));
        continue;
      }

      if (team.isUser) {
        writeLog(`👉 <b>あなたの指名順です(${team.rank}位)。選択してください。</b>`);
        isReNomination = false;
        prepareUserSelection("通常ウェーバー指名", true);
        let pickedPlayer = await new Promise(resolve => { window.userPickResolve = resolve; });
        
        const finalPick = pickedPlayer || PASS_PLAYER;
        assignPick(team, finalPick, round);
        if (!finalPick.isPass) {
          sessionPool = sessionPool.filter(p => p.名前 !== finalPick.名前);
          const orig = normalizeOrigin(finalPick.出身);
          writeLog(`[確定] ${team.name} ➔ <b>${finalPick.名前}</b> [${orig}] ${finalPick.所属 ? `(${finalPick.所属})` : ''}`);
        }
        openWaiverCell(team, finalPick);
        renderTeams();
      } else {
        await new Promise(r => setTimeout(r, 400));
        let picked = chooseCpuPick(sessionPool, team);
        const finalPick = picked || PASS_PLAYER;
        assignPick(team, finalPick, round);
        if (!finalPick.isPass) {
          sessionPool = sessionPool.filter(p => p.名前 !== finalPick.名前);
          const orig = normalizeOrigin(finalPick.出身);
          writeLog(`[確定] ${team.name}(${team.rank}位) ➔ <b>${finalPick.名前}</b> [${orig}] ${finalPick.所属 ? `(${finalPick.所属})` : ''}`);
        } else {
          team.isFinished = true;
        }
        openWaiverCell(team, finalPick);
        renderTeams();
      }
      await new Promise(r => setTimeout(r, 200));
    }

    triggerAllPlayersReadyWait();
  }
}

function advanceToNextWaiverTurn() {
  if (!isHost) return;

  while (currentWaiverIndex < waiverOrder.length) {
    const candidate = waiverOrder[currentWaiverIndex];

    if (!candidate.isFinished && sessionPool.length > 0) {
      db.ref(`rooms/${currentRoomId}/activeWaiverSlot`).set(candidate.id);
      return;
    }

    assignPick(candidate, PASS_PLAYER, round);
    openWaiverCell(candidate, PASS_PLAYER);
    
    db.ref(`rooms/${currentRoomId}/roundEvent`).set({
      type: "waiver_step",
      slot: candidate.id,
      playerName: PASS_PLAYER.名前,
      round: round,
      ts: Date.now()
    });

    currentWaiverIndex++;
  }

  db.ref(`rooms/${currentRoomId}/activeWaiverSlot`).set(null);
  renderTeams();
  setTimeout(triggerAllPlayersReadyWait, 250);
}

function handleWaiverTurn(activeSlotId) {
  highlightActiveTurnCell(activeSlotId);
  const currentTeam = teams[activeSlotId];

  if (currentTeam.isFinished) {
    if (activeSlotId === myPlayerSlot || (isHost && currentTeam.isCpu)) {
      setTimeout(() => {
        db.ref(`rooms/${currentRoomId}/waiverSubmit`).set({
          slot: activeSlotId,
          playerName: PASS_PLAYER.名前,
          round: round,
          ts: Date.now()
        });
      }, 50);
    }
    return;
  }

  if (activeSlotId === myPlayerSlot) {
    currentUserCurrentRoundPick = null;
    updateUserPickStatusBanner();

    writeLog(`👉 <b>あなたの指名順です！(${currentTeam.rank}位)</b> メンバーを選択してください。`);
    isReNomination = false;
    prepareUserSelection("通常ウェーバー指名", true);
  } else {
    document.getElementById("actionControls").style.display = "none";
    if (currentTeam.isCpu) {
      writeLog(`⏳ 【${currentTeam.name}】が指名検討中...`);
      if (isHost) {
        setTimeout(() => {
          let picked = chooseCpuPick(sessionPool, currentTeam);
          db.ref(`rooms/${currentRoomId}/waiverSubmit`).set({
            slot: activeSlotId,
            playerName: picked ? picked.名前 : PASS_PLAYER.名前,
            round: round,
            ts: Date.now()
          });
        }, 800);
      }
    } else {
      writeLog(`⏳ 【${currentTeam.name}】の選択を待機しています...`);
    }
  }

  const submitRef = db.ref(`rooms/${currentRoomId}/waiverSubmit`);
  submitRef.off();
  submitRef.on('value', snap => {
    const data = snap.val();
    if (!data || data.slot !== activeSlotId || data.round !== round) return;
    submitRef.off();

    if (isHost) {
      db.ref(`rooms/${currentRoomId}/roundEvent`).set({
        type: "waiver_step",
        slot: data.slot,
        playerName: data.playerName,
        round: round,
        ts: Date.now()
      });
      currentWaiverIndex++;
      setTimeout(advanceToNextWaiverTurn, 250);
    }
  });
}

function executeSyncedWaiverStep(slotId, playerName, targetRound) {
  const team = teams[slotId];
  const useRound = targetRound || round;

  const pickedPlayer = (playerName === PASS_PLAYER.名前) 
    ? PASS_PLAYER 
    : (sessionPool.find(p => p.名前 === playerName) || allMasterData.find(p => p.名前 === playerName));

  if (pickedPlayer) {
    assignPick(team, pickedPlayer, useRound);
    if (!pickedPlayer.isPass) {
      sessionPool = sessionPool.filter(p => p.名前 !== playerName);
      const orig = normalizeOrigin(pickedPlayer.出身);
      writeLog(`[確定] ${team.name} ➔ <b>${pickedPlayer.名前}</b> [${orig}] ${pickedPlayer.所属 ? `(${pickedPlayer.所属})` : ''}`);
    } else {
      team.isFinished = true;
      writeLog(`🛑 ${team.name} は【選択終了】`);
    }
    openWaiverCell(team, pickedPlayer);
    renderTeams();
  }
}

function initWaiverRoundBoard(targetRound, isEvenRound) {
  const grid = document.getElementById("roundBoardGrid");
  const title = document.getElementById("roundBoardTitle");
  const subStatus = document.getElementById("roundBoardSubStatus");

  title.innerText = `◆ 第 ${currentSession} 周目 - 第 ${targetRound} 巡目 速報 ◆`;
  subStatus.innerText = isEvenRound ? `指名順: 最下位(${maxTeams}位) ➔ 1位` : `指名順: 上位(1位) ➔ ${maxTeams}位`;
  grid.innerHTML = "";

  teams.forEach(t => {
    let cell = document.createElement("div");
    cell.className = "npb-cell";
    cell.id = `npb-cell-slot-${t.id}`;
    cell.innerHTML = `
      <div class="npb-cell-header ${t.isUser ? 'is-user' : ''}">
        <span>${t.name}</span>
        <span style="font-size:11px; color:#78909c;">${t.rank}位</span>
      </div>
      <div class="npb-cell-body">
        <div class="card-closed">${t.isFinished ? 'なし' : '【指名順 待機中】'}</div>
      </div>
    `;
    grid.appendChild(cell);
  });
}

function highlightActiveTurnCell(teamId) {
  document.querySelectorAll(".npb-cell").forEach(c => c.classList.remove("is-active-turn"));
  const cell = document.getElementById(`npb-cell-slot-${teamId}`);
  if (cell) cell.classList.add("is-active-turn");
}

function openWaiverCell(team, pick) {
  const cell = document.getElementById(`npb-cell-slot-${team.id}`);
  if (!cell) return;
  cell.classList.remove("is-active-turn");
  cell.classList.add("opening-now");

  const body = cell.querySelector(".npb-cell-body");
  if (pick && !pick.isPass) {
    const originLabel = normalizeOrigin(pick.出身);
    body.innerHTML = `
      <div class="lottery-track">
        <span style="background:#37474f; color:#fff; font-size:11px; padding:2px 5px; border-radius:3px;">${team.rank}位</span>
      </div>
      <div>
        <div class="player-name-main">${pick.名前}</div>
        <div class="player-meta-sub">
          <span>出身: <b>${originLabel}</b></span>
          <span>${pick.所属 ? `所属: <b>${pick.所属}</b>` : ''}</span>
        </div>
      </div>
    `;
  } else {
    body.innerHTML = `<div class="pass-state">なし</div>`;
  }
}

function updateRoundBoardVisualizer(targetRound, activeLoserSlotIds = null) {
  const grid = document.getElementById("roundBoardGrid");
  const title = document.getElementById("roundBoardTitle");
  const subStatus = document.getElementById("roundBoardSubStatus");

  title.innerText = `◆ 第 ${currentSession} 周目 - 第 ${targetRound} 巡目 指名確定速報 ◆`;
  subStatus.innerText = activeLoserSlotIds ? "外れ指名 入札・開票中..." : `全${maxTeams}球団 指名確定一覧`;
  grid.innerHTML = "";

  teams.forEach(t => {
    const pick = [...t.sessionPicks].filter(p => !p.isPass).sort((a, b) => b.draftRound - a.draftRound)[0] || null;
    const isLoserNow = activeLoserSlotIds && activeLoserSlotIds.includes(t.id);

    let leftTrackHtml = "";

    if (targetRound === 1 || draftSystem === "all_lottery") {
      if (t.lotteryHistory?.length) {
        t.lotteryHistory.forEach(h => {
          if (h.result === "miss") {
            leftTrackHtml += `
              <div class="lottery-step" style="display:inline-block; text-align:center; margin-right:4px;">
                <span class="stamp-red" style="font-size:9px;">入札</span>
                <span style="font-size:9px;">↓</span>
                <span style="color:#d32f2f; font-weight:bold;">✕</span>
              </div>
            `;
          } else if (h.result === "hit" || h.result === "single") {
            leftTrackHtml += `
              <div class="lottery-step" style="display:inline-block; text-align:center; margin-right:4px;">
                <span class="stamp-red" style="font-size:9px;">公表</span>
                <span style="font-size:9px;">↓</span>
                <span style="color:#2e7d32; font-weight:bold;">〇</span>
              </div>
            `;
          }
        });
      }
    } else {
      leftTrackHtml = `<span style="background:#37474f;color:#fff;font-size:11px;padding:2px 5px;border-radius:3px;">${t.rank}位</span>`;
    }

    let bodyContent = "";
    let cellConfirmedClass = "";

    if (pick) {
      const originLabel = normalizeOrigin(pick.出身);
      cellConfirmedClass = "is-confirmed-cell";

      bodyContent = `
        <div class="lottery-track">
          ${leftTrackHtml}
          <span class="stamp-green">確定</span>
        </div>
        <div>
          <div class="player-name-main">${pick.名前}</div>
          <div class="player-meta-sub">
            <span>出身: <b>${originLabel}</b></span>
            <span>${pick.所属 ? `所属: <b>${pick.所属}</b>` : ""}</span>
          </div>
          <div style="margin-top:4px; font-size:11px; color:#607d8b; font-weight:bold;">
            第${pick.draftRound}巡目指名
          </div>
        </div>
      `;
    } else if (isLoserNow) {
      bodyContent = `
        <div style="color:#d32f2f; font-weight:bold; font-size:13px; text-align:center; width:100%;">
          【外れ再入札 選択中...】
        </div>
      `;
    } else if (t.isFinished) {
      bodyContent = `<div class="pass-state">なし</div>`;
    } else {
      bodyContent = `
        <div style="color:#b0bec5; font-size:13px; text-align:center; width:100%;">
          指名待機中...
        </div>
      `;
    }

    const cell = document.createElement("div");
    cell.className = `npb-cell ${cellConfirmedClass}`;
    cell.id = `npb-cell-slot-${t.id}`;

    cell.innerHTML = `
      <div class="npb-cell-header ${t.isUser ? 'is-user' : ''}">
        <span>${t.name}</span>
        <span class="status-slot">
          ${pick ? '<span style="color:#2e7d32;font-weight:bold;">確定</span>' : `${t.rank}位`}
        </span>
      </div>
      <div class="npb-cell-body">${bodyContent}</div>
    `;

    grid.appendChild(cell);
  });
}

function assignPick(team, player, explicitRound = null) {
  const currentPickRound = explicitRound || round;
  const alreadyIndex = team.sessionPicks.findIndex(p => p.draftRound === currentPickRound);
  const item = { 
    ...player, 
    session: currentSession, 
    draftRound: currentPickRound, 
    pickRound: team.sessionPicks.length + 1 
  };

  if (alreadyIndex >= 0) team.sessionPicks[alreadyIndex] = item;
  else team.sessionPicks.push(item);

  const allAlreadyIdx = team.allPicks.findIndex(p => p.session === currentSession && p.draftRound === currentPickRound);
  if (allAlreadyIdx >= 0) team.allPicks[allAlreadyIdx] = item;
  else team.allPicks.push(item);

  if (player.isPass) {
    team.isFinished = true;
  } else if (player.名前) {
    sessionPool = sessionPool.filter(p => p.名前 !== player.名前);
  }
}

function checkEndConditions() {
  teams.forEach(t => {
    if (t.isFinished) return;
    const realPicksCount = t.sessionPicks.filter(p => !p.isPass).length;
    if (realPicksCount >= t.sessionTargetLimit) {
      t.isFinished = true;
      writeLog(`🛑 ${t.name} は目標数(${t.sessionTargetLimit}名)に達したため【選択終了】`);
    }
  });

  const allFinished = teams.every(t => t.isFinished);
  if (allFinished) endCurrentSession();
}

function endCurrentSession() {
  if (isSessionEnding) return;
  isSessionEnding = true;

  writeLog(`<br>🏁 <b>第 ${currentSession} 周目 ドラフト会議が終了しました。</b>`);
  currentUserCurrentRoundPick = null;
  updateUserPickStatusBanner();
  
  determineNextSessionRanks();
  
  renderTeams();

  if (currentSession < 7) {
    document.getElementById("roundDisplay").innerText = `第 ${currentSession} 周目 終了`;
    document.getElementById("nextSessionBtn").style.display = "inline-block";
  } else {
    isDraftCompleted = true;
    document.getElementById("roundDisplay").innerText = "全 7 周 ドラフト会議 完全終了";
    document.getElementById("teamsHeading").innerText = `【最終結果】各球団の週別獲得選手・累計総pt一覧 (全${maxTeams}球団)`;
    document.getElementById("actionControls").style.display = "none";
    document.getElementById("goToFormationBtn").style.display = "inline-block";

    announceFinalStandings();
    renderTeams();
  }
}

let globalStandings = [];
let globalTopPlayers = [];

function announceFinalStandings() {
  globalStandings = teams.map(t => ({
    team: t,
    totalPt: t.allPicks.filter(p => !p.isPass).reduce((sum, p) => sum + Number(p.ポイント || 0), 0),
    picksCount: t.allPicks.filter(p => !p.isPass).length,
    tiebreaker: Math.random()
  }));

  globalStandings.sort((a, b) => (b.totalPt !== a.totalPt) ? (b.totalPt - a.totalPt) : (a.picksCount !== b.picksCount ? b.picksCount - a.picksCount : a.tiebreaker - b.tiebreaker));

  let allPickedPlayers = [];
  teams.forEach(t => {
    t.allPicks.filter(p => !p.isPass).forEach(p => {
      allPickedPlayers.push({ ...p, teamName: t.name, isUser: t.isUser });
    });
  });

  allPickedPlayers.sort((a, b) => Number(b.ポイント || 0) - Number(a.ポイント || 0));
  globalTopPlayers = allPickedPlayers.slice(0, 10);

  writeLog("<br>==================================================");
  writeLog("🏆 <b>【全 7 周 終了】ドラフト会議 最終総合順位・獲得pt発表！</b>");
  writeLog("==================================================");

  globalStandings.forEach((item, index) => {
    writeLog(`・${index + 1}位: <b>${item.team.name}</b> - 獲得pt: <b style="color:#e91e63;">${item.totalPt} pt</b> (${item.picksCount}名)`);
  });

  if (gameMode === "multi" && isHost) {
    db.ref(`rooms/${currentRoomId}/finalResults`).set({
      standings: globalStandings.map(s => ({ teamId: s.team.id, teamName: s.team.name, totalPt: s.totalPt, picksCount: s.picksCount, isUser: s.team.isUser })),
      topPlayers: globalTopPlayers,
      ts: Date.now()
    });
    document.getElementById("closeRoomBtn").style.display = "inline-block";
  }

  showFinalTab("team");
}

function showFinalTab(tabType) {
  const panel = document.getElementById("roundBoardPanel");
  const title = document.getElementById("roundBoardTitle");
  const subStatus = document.getElementById("roundBoardSubStatus");
  const content = document.getElementById("roundBoardContent");

  title.innerText = "🏆 全7周 ドラフト会議 最終結果発表 🏆";
  subStatus.innerText = "タブを切り替えてランキングを確認できます";

  let tabHeaderHtml = `
    <div class="final-tabs">
      <button class="final-tab-btn ${tabType === 'team' ? 'active' : ''}" onclick="showFinalTab('team')">📊 球団総合順位</button>
      <button class="final-tab-btn ${tabType === 'player' ? 'active' : ''}" onclick="showFinalTab('player')">🌟 獲得選手 指名ptトップ10</button>
    </div>
  `;

  let bodyHtml = "";

  if (tabType === 'team') {
    let rowsHtml = "";
    globalStandings.forEach((item, index) => {
      const finalRank = index + 1;
      let rankBadge = `${finalRank}位`;
      if (finalRank === 1) rankBadge = `<span style="color:#d84315; font-weight:900; font-size:16px;">🥇 優勝 (1位)</span>`;
      else if (finalRank === 2) rankBadge = `<span style="color:#546e7a; font-weight:900; font-size:15px;">🥈 2位</span>`;
      else if (finalRank === 3) rankBadge = `<span style="color:#8d6e63; font-weight:900; font-size:15px;">🥉 3位</span>`;

      rowsHtml += `
        <tr class="${item.team.isUser ? 'user-row' : ''}">
          <td>${rankBadge}</td>
          <td><b>${item.team.name}</b></td>
          <td>${item.picksCount} 名</td>
          <td style="color:#d81b60; font-size:16px; font-weight:900;">${item.totalPt} pt</td>
        </tr>
      `;
    });

    bodyHtml = `
      <table class="final-table">
        <thead>
          <tr>
            <th>総合順位</th>
            <th>球団名</th>
            <th>獲得人数</th>
            <th>合計ポイント</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  } else {
    let rowsHtml = "";
    globalTopPlayers.forEach((p, idx) => {
      const rank = idx + 1;
      let medal = `${rank}位`;
      if (rank === 1) medal = `🥇 1位`;
      else if (rank === 2) medal = `🥈 2位`;
      else if (rank === 3) medal = `🥉 3位`;

      const orig = normalizeOrigin(p.出身);
      rowsHtml += `
        <tr class="${p.isUser ? 'user-row' : ''}">
          <td style="font-weight:bold;">${medal}</td>
          <td><b style="font-size:15px;">${p.名前}</b> <span class="badge badge-${orig}">${orig}</span></td>
          <td>${p.所属 || '-'}</td>
          <td><small style="color:#5e35b1;">${p.teamName}</small></td>
          <td style="color:#d81b60; font-size:16px; font-weight:900;">${p.ポイント} pt</td>
        </tr>
      `;
    });

    bodyHtml = `
      <table class="final-table">
        <thead>
          <tr>
            <th>順位</th>
            <th>選手名 / 出身</th>
            <th>所属</th>
            <th>指名球団</th>
            <th>能力値</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  content.innerHTML = `<div class="final-standing-box">${tabHeaderHtml}${bodyHtml}</div>`;
  panel.scrollIntoView({ behavior: 'smooth' });
}

function closeAndReleaseRoom() {
  if (!confirm("このルームをデータベースから完全開放（削除）して解散しますか？\n※全参加者が初期画面に戻ります。")) return;

  if (currentRoomId && db) {
    writeLog("🧹 ルームデータをデータベースから開放中...");
    db.ref(`rooms/${currentRoomId}/status`).set("closed").then(() => {
      setTimeout(() => {
        db.ref(`rooms/${currentRoomId}`).remove().then(() => {
          writeLog("✅ ルームを開放しました。");
          confirmReset();
        });
      }, 1000);
    }).catch(err => {
      confirmReset();
    });
  } else {
    confirmReset();
  }
}

function nextSession() {
  let nextS = currentSession + 1;
  if (gameMode === "multi" && isHost) {
    db.ref(`rooms/${currentRoomId}/roundEvent`).set({
      type: "next_session_start",
      session: nextS,
      ts: Date.now()
    });
  }
  startSession(nextS);
}

function renderTeams() {
  const container = document.getElementById("teamsContainer");
  container.innerHTML = "";

  teams.forEach(t => {
    let totalPt = t.allPicks.filter(p => !p.isPass).reduce((sum, p) => sum + Number(p.ポイント || 0), 0);
    let card = document.createElement("div");
    card.className = `team-card ${t.isUser ? "user" : ""} ${t.isFinished ? "finished" : ""}`;
    
    let picksHtml = "";
    for (let s = 1; s <= currentSession; s++) {
      let sPicks = t.allPicks.filter(p => p.session === s);
      if (sPicks.length > 0) {
        let sPt = sPicks.filter(p => !p.isPass).reduce((sum, p) => sum + Number(p.ポイント || 0), 0);
        let sessionPtBadge = isDraftCompleted ? `<span class="session-info-tag">週計: ${sPt} pt</span>` : "";

        picksHtml += `<div class="session-group"><strong>[第${s}周]</strong>${sessionPtBadge}<br>`;
        sPicks.sort((a, b) => (a.draftRound || a.pickRound) - (b.draftRound || b.pickRound));
        
        sPicks.forEach(p => {
          const rNum = p.draftRound || p.pickRound;
          if (p.isPass) {
            picksHtml += `
              <div class="round-pick-row" style="color:#78909c;">
                <span class="round-num-label">第${rNum}巡:</span>
                <b>なし</b> <small style="color:#78909c;">(選択終了)</small>
              </div>
            `;
          } else {
            const originLabel = normalizeOrigin(p.出身);
            const ptInfo = isDraftCompleted ? ` <small style="color:#d81b60;">(${p.ポイント}pt)</small>` : "";
            const belongInfo = p.所属 ? ` <small style="color:#5e35b1;">(${p.所属})</small>` : "";
            picksHtml += `
              <div class="round-pick-row">
                <span class="round-num-label">第${rNum}巡:</span>
                <b>${p.名前}</b><span class="badge badge-${originLabel}">${originLabel}</span>${belongInfo}${ptInfo}
              </div>
            `;
          }
        });
        picksHtml += `</div>`;
      }
    }

    let realPicksCount = t.allPicks.filter(p => !p.isPass).length;
    let scoreDisplay = isDraftCompleted 
      ? `累計総ポイント: <b style="color:#d81b60; font-size:16px;">${totalPt} pt</b>`
      : `獲得合計: <b>${realPicksCount} 名</b>`;

    let policyLabel = "";
    if (t.isCpu) {
      if (t.cpuPolicy === "academic") policyLabel = `<span class="policy-tag">育成型</span>`;
      else if (t.cpuPolicy === "popularity") policyLabel = `<span class="policy-tag">人気型</span>`;
      else if (t.cpuPolicy === "working") policyLabel = `<span class="policy-tag">実力型</span>`;
      else policyLabel = `<span class="policy-tag">総合型</span>`;
    }

    const currentSessionRealPicks = t.sessionPicks.filter(p => !p.isPass).length;

    card.innerHTML = `
      <div class="team-title">
        <span>${t.name} ${policyLabel}</span>
        <span class="rank-badge" style="background:#1a237e; color:#ffd700; font-size:12px; padding:3px 8px;">現在: ${t.rank}位</span>
      </div>
      <div style="font-size:12px; color:${t.isFinished ? '#757575' : '#e91e63'}; margin-bottom:4px; font-weight:bold;">
        ${t.isFinished ? "今周: 選択終了" : `今周獲得: ${currentSessionRealPicks}名`}
      </div>
      <div style="font-size:13px; color:#546e7a; margin-bottom:8px;">${scoreDisplay}</div>
      <div style="font-size:12px; line-height:1.5;">${picksHtml || "まだ指名はありません"}</div>
    `;
    container.appendChild(card);
  });
}

function openInteractiveLotteryModal(player, candidateTeams) {
  return new Promise(async (resolve) => {
    currentLotteryResolver = resolve;
    isLotteryLocked = false;

    const drawOrderTeams = [...candidateTeams].sort((a, b) => b.rank - a.rank);
    const totalEnvelopes = candidateTeams.length;
    const winnerEnvIdx = Math.floor(Math.random() * totalEnvelopes);

    let envelopeHolders = new Array(totalEnvelopes).fill(null);
    currentLotteryData = {
      player: player,
      drawOrderTeams: drawOrderTeams,
      winnerEnvIdx: winnerEnvIdx,
      envelopeHolders: envelopeHolders,
      hasUser: candidateTeams.some(t => t.isUser)
    };

    setupLotteryModalDOM(player, drawOrderTeams, totalEnvelopes);

    if (gameMode === "multi") {
      if (isHost) {
        const drawOrderSlots = drawOrderTeams.map(t => t.id);
        const initialHolders = {};
        for (let i = 0; i < totalEnvelopes; i++) initialHolders[`env_${i}`] = null;

        db.ref(`rooms/${currentRoomId}/lotterySync`).set({
          playerName: player.名前,
          playerOrigin: player.出身,
          playerBelong: player.所属 || "",
          totalEnvelopes: totalEnvelopes,
          winnerEnvIdx: winnerEnvIdx,
          drawOrderSlots: drawOrderSlots,
          currentStepIndex: 0,
          currentDrawerSlot: drawOrderSlots[0],
          holders: initialHolders,
          phase: "drawing",
          ts: Date.now()
        });
      }
    } else {
      await runSequentialDrawingProcess();
    }
  });
}

async function runSequentialDrawingProcess() {
  const lData = currentLotteryData;
  const total = lData.envelopeHolders.length;
  const drawOrderTeams = lData.drawOrderTeams;

  for (let stepIdx = 0; stepIdx < total; stepIdx++) {
    const activeTeam = drawOrderTeams[stepIdx];
    const stepNum = stepIdx + 1;
    const instructionEl = document.getElementById("lotteryInstruction");

    for (let i = 0; i < total; i++) {
      const holder = lData.envelopeHolders[i];
      const tagEl = document.getElementById(`tag-${i}`);
      const envEl = document.getElementById(`env-${i}`);
      if (!tagEl || !envEl) continue;

      if (holder !== null && holder !== undefined) {
        const hTeam = teams[holder];
        tagEl.className = `envelope-holder-tag ${hTeam.isUser ? 'tag-user' : 'tag-taken'}`;
        tagEl.innerText = hTeam.isUser ? "あなた" : hTeam.name.substring(0, 5);
        envEl.className = `envelope is-chosen ${hTeam.isUser ? 'selected-user' : ''}`;
        envEl.onclick = null;
      } else {
        tagEl.className = "envelope-holder-tag tag-vacant";
        tagEl.innerText = "未選択";
        envEl.className = "envelope";
        envEl.onclick = null;
      }
    }

    if (activeTeam.isUser) {
      if (instructionEl) {
        instructionEl.innerText = `👉 第 ${stepNum} 抽選者【あなた】の番です！引く封筒を1つ選んでください。`;
        instructionEl.style.color = "#d81b60";
      }

      await new Promise(resolve => {
        window.userDrawResolve = resolve;

        for (let i = 0; i < total; i++) {
          if (lData.envelopeHolders[i] === null || lData.envelopeHolders[i] === undefined) {
            const envEl = document.getElementById(`env-${i}`);
            if (envEl) {
              envEl.classList.add("selectable");
              envEl.onclick = () => {
                lData.envelopeHolders[i] = activeTeam.id;
                
                const tagEl = document.getElementById(`tag-${i}`);
                if (tagEl) {
                  tagEl.className = "envelope-holder-tag tag-user";
                  tagEl.innerText = "あなた";
                }
                envEl.className = "envelope is-chosen selected-user";
                
                for (let j = 0; j < total; j++) {
                  const el = document.getElementById(`env-${j}`);
                  if (el) {
                    el.classList.remove("selectable");
                    el.onclick = null;
                  }
                }

                if (window.userDrawResolve) {
                  const res = window.userDrawResolve;
                  window.userDrawResolve = null;
                  res();
                }
              };
            }
          }
        }
      });

    } else {
      if (instructionEl) {
        instructionEl.innerText = `⏳ 第 ${stepNum} 抽選者【${activeTeam.name}(${activeTeam.rank}位)】が引いています...`;
        instructionEl.style.color = "#5e35b1";
      }

      await new Promise(res => setTimeout(res, 800));

      const vacantIndices = [];
      for (let i = 0; i < total; i++) {
        if (lData.envelopeHolders[i] === null || lData.envelopeHolders[i] === undefined) {
          vacantIndices.push(i);
        }
      }

      if (vacantIndices.length > 0) {
        const pickIdx = vacantIndices[Math.floor(Math.random() * vacantIndices.length)];
        lData.envelopeHolders[pickIdx] = activeTeam.id;

        const tagEl = document.getElementById(`tag-${pickIdx}`);
        const envEl = document.getElementById(`env-${pickIdx}`);
        if (tagEl && envEl) {
          tagEl.className = "envelope-holder-tag tag-taken";
          tagEl.innerText = activeTeam.name.substring(0, 5);
          envEl.className = "envelope is-chosen";
        }
      }
    }
  }

  await new Promise(res => setTimeout(res, 600));
  runSoloRevealProcess(lData);
}

function runSoloRevealProcess(lData) {
  const winnerEnvIdx = lData.winnerEnvIdx;
  const winnerSlot = lData.envelopeHolders[winnerEnvIdx];
  const winnerTeam = teams[winnerSlot] || lData.drawOrderTeams[0];

  const syntheticData = {
    winnerEnvIdx: winnerEnvIdx,
    holders: {},
    drawOrderSlots: lData.drawOrderTeams.map(t => t.id),
    totalEnvelopes: lData.envelopeHolders.length,
    playerName: lData.player.名前
  };

  lData.envelopeHolders.forEach((slotId, idx) => {
    syntheticData.holders[`env_${idx}`] = slotId;
  });

  revealSyncedLotteryResult(syntheticData);
}

function setupLotteryModalDOM(player, drawOrderTeams, totalEnvelopes) {
  const originLabel = normalizeOrigin(player.出身);
  const orderString = drawOrderTeams.map((t, idx) => `第${idx + 1}引: ${t.name}(${t.rank}位)`).join(" ➔ ");

  document.getElementById("lotteryDetails").innerHTML = `
    対象メンバー: <strong>${player.名前}</strong> 【${originLabel}】${player.所属 ? ` (${player.所属})` : ''}<br>
    <div class="lottery-order-list"><b>【抽選順 (前年順位順)】</b><br>${orderString}</div>
  `;

  const envBox = document.getElementById("envelopeContainer");
  envBox.innerHTML = "";
  document.getElementById("lotteryResultStamp").style.display = "none";
  document.getElementById("lotteryActionArea").style.display = "none";

  for (let i = 0; i < totalEnvelopes; i++) {
    let wrap = document.createElement("div");
    wrap.className = "envelope-wrapper";
    wrap.innerHTML = `
      <div class="envelope-holder-tag tag-vacant" id="tag-${i}">未選択</div>
      <div class="envelope" id="env-${i}">
        <span style="font-size:11px; color:#5e35b1;">第 ${i + 1} 封</span>
        <span style="font-size:22px; margin-top:2px;">✉</span>
      </div>
    `;
    envBox.appendChild(wrap);
  }

  document.getElementById("lotteryModal").style.display = "flex";
}

function handleSyncedLotteryState(lData) {
  if (!lData) return;

  const modal = document.getElementById("lotteryModal");
  const instructionEl = document.getElementById("lotteryInstruction");
  
  if (modal.style.display !== "flex") {
    const drawOrderTeams = lData.drawOrderSlots.map(slotId => teams[slotId]);
    const mockPlayer = { 名前: lData.playerName, 出身: lData.playerOrigin, 所属: lData.playerBelong };
    setupLotteryModalDOM(mockPlayer, drawOrderTeams, lData.totalEnvelopes);
  }

  const total = lData.totalEnvelopes;

  for (let i = 0; i < total; i++) {
    const holderSlot = lData.holders ? lData.holders[`env_${i}`] : null;
    const tagEl = document.getElementById(`tag-${i}`);
    const envEl = document.getElementById(`env-${i}`);

    if (!tagEl || !envEl) continue;

    if (holderSlot !== null && holderSlot !== undefined) {
      const holderTeam = teams[holderSlot];
      tagEl.className = `envelope-holder-tag ${holderTeam.isUser ? 'tag-user' : 'tag-taken'}`;
      tagEl.innerText = holderTeam.isUser ? "あなた" : holderTeam.name.substring(0, 5);
      envEl.className = `envelope is-chosen ${holderTeam.isUser ? 'selected-user' : ''}`;
      envEl.onclick = null;
    } else {
      tagEl.className = "envelope-holder-tag tag-vacant";
      tagEl.innerText = "未選択";
      envEl.className = "envelope";
      envEl.onclick = null;
    }
  }

  if (lData.phase === "drawing") {
    const stepIdx = lData.currentStepIndex || 0;
    
    if (stepIdx >= total) {
      if (isHost) {
        db.ref(`rooms/${currentRoomId}/lotterySync`).update({ phase: "opened" });
      }
      return;
    }

    const activeSlot = lData.currentDrawerSlot;
    const activeTeam = teams[activeSlot];
    const stepNum = stepIdx + 1;

    const isMyTurn = (Number(activeSlot) === Number(myPlayerSlot)) || (activeTeam && activeTeam.isUser === true);

    if (isMyTurn) {
      instructionEl.innerText = `👉 第 ${stepNum} 抽選者【あなた】の番です！引く封筒を1つ選んでください。`;
      instructionEl.style.color = "#d81b60";

      for (let i = 0; i < total; i++) {
        const holder = lData.holders ? lData.holders[`env_${i}`] : null;
        if (holder === null || holder === undefined) {
          const envEl = document.getElementById(`env-${i}`);
          if (envEl) {
            envEl.classList.add("selectable");
            envEl.onclick = () => {
              if (isLotteryLocked) return;
              isLotteryLocked = true;

              const updates = {};
              updates[`holders/env_${i}`] = myPlayerSlot;
              const nextStep = stepIdx + 1;
              if (nextStep < total) {
                updates["currentStepIndex"] = nextStep;
                updates["currentDrawerSlot"] = lData.drawOrderSlots[nextStep];
              } else {
                updates["phase"] = "opened";
              }
              db.ref(`rooms/${currentRoomId}/lotterySync`).update(updates)
                .then(() => {
                  isLotteryLocked = false;
                })
                .catch(error => {
                  isLotteryLocked = false;
                  if (instructionEl) instructionEl.innerText = `抽選の更新に失敗しました。もう一度選んでください: ${error.message}`;
                });
            };
          }
        }
      }
    } else {
      if (instructionEl) {
        instructionEl.innerText = `⏳ 第 ${stepNum} 抽選者【${activeTeam.name}(${activeTeam.rank}位)】が引いています...`;
        instructionEl.style.color = "#5e35b1";
      }

      if (isHost && activeTeam.isCpu && !activeTeam.isUser) {
        const cpuTurnKey = `${lData.ts}:${stepIdx}:${activeSlot}`;
        if (window._cpuLotteryTurn === cpuTurnKey) return;
        window._cpuLotteryTurn = cpuTurnKey;
        window._isCpuLotteryBusy = true;

        setTimeout(() => {
          const vacantIndices = [];
          for (let i = 0; i < total; i++) {
            if (!lData.holders || lData.holders[`env_${i}`] === null || lData.holders[`env_${i}`] === undefined) {
              vacantIndices.push(i);
            }
          }
          if (vacantIndices.length > 0) {
            const pickIdx = vacantIndices[Math.floor(Math.random() * vacantIndices.length)];
            const updates = {};
            updates[`holders/env_${pickIdx}`] = activeTeam.id;
            const nextStep = stepIdx + 1;
            if (nextStep < total) {
              updates["currentStepIndex"] = nextStep;
              updates["currentDrawerSlot"] = lData.drawOrderSlots[nextStep];
            } else {
              updates["phase"] = "opened";
            }
            
            db.ref(`rooms/${currentRoomId}/lotterySync`).update(updates).then(() => {
              window._isCpuLotteryBusy = false;
            }).catch(error => {
              window._isCpuLotteryBusy = false;
              console.error("CPU抽選の更新に失敗しました:", error);
            });
          } else {
            db.ref(`rooms/${currentRoomId}/lotterySync`).update({ phase: "opened" }).then(() => {
              window._isCpuLotteryBusy = false;
            }).catch(error => {
              window._isCpuLotteryBusy = false;
              console.error("CPU抽選の完了更新に失敗しました:", error);
            });
          }
        }, 800);
      }
    }
  } else if (lData.phase === "opened") {
    window._isCpuLotteryBusy = false;
    window._cpuLotteryTurn = null;
    revealSyncedLotteryResult(lData);
  }
}

function revealSyncedLotteryResult(lData) {
  const winnerEnvIdx = lData.winnerEnvIdx;
  const winnerSlot = lData.holders ? lData.holders[`env_${winnerEnvIdx}`] : null;
  const winnerTeam = teams[winnerSlot] || teams[lData.drawOrderSlots[0]];

  const instructionEl = document.getElementById("lotteryInstruction");
  if (instructionEl) instructionEl.innerText = "【開封！】当たりくじは...？";

  const total = lData.totalEnvelopes;
  for (let i = 0; i < total; i++) {
    const env = document.getElementById(`env-${i}`);
    if (!env) continue;
    if (i === winnerEnvIdx) {
      env.className = "envelope winner";
      env.innerHTML = `<span style="font-size:11px; color:#d81b60;">交渉権</span><span style="font-size:24px;">★</span><span style="font-size:10px; color:#d81b60;">当たり</span>`;
    } else {
      env.className = "envelope loser";
      env.innerHTML = `<span style="font-size:11px; color:#757575;">ハズレ</span><span style="font-size:18px;">✖</span>`;
    }
  }

  const stamp = document.getElementById("lotteryResultStamp");
  if (stamp) {
    stamp.innerText = `交渉権獲得：${winnerTeam ? winnerTeam.name : '球団'}`;
    stamp.style.display = "inline-block";
  }

  const playerName = lData.playerName;
  const chosenPlayer = sessionPool.find(p => p.名前 === playerName) || allMasterData.find(p => p.名前 === playerName);

  if (winnerTeam && chosenPlayer) {
    const alreadyAssigned = winnerTeam.sessionPicks.some(p => p.draftRound === round && p.名前 === chosenPlayer.名前);
    
    if (!alreadyAssigned) {
      assignPick(winnerTeam, chosenPlayer, round);
      sessionPool = sessionPool.filter(p => p.名前 !== chosenPlayer.名前);

      let losers = [];
      lData.drawOrderSlots.forEach(slotId => {
        if (slotId !== winnerTeam.id) {
          losers.push(teams[slotId]);
        }
      });

      winnerTeam.lotteryHistory.push({ name: chosenPlayer.名前, result: 'hit' });
      losers.forEach(l => {
        l.lotteryHistory.push({ name: chosenPlayer.名前, result: 'miss' });
      });

      writeLog(`🎉 <span style="color:#81d4fa;">【抽選結果確定】</span><b>${winnerTeam.name}</b> が <b>${chosenPlayer.名前}</b> の交渉権を獲得！`);
    }

    if (winnerTeam.isUser) {
      currentUserCurrentRoundPick = {
        name: chosenPlayer.名前,
        origin: normalizeOrigin(chosenPlayer.出身),
        msg: "🎉 くじ引き当選！交渉権獲得！",
        isMiss: false
      };
      updateUserPickStatusBanner();
    }
  }

  setTimeout(() => {
    const modal = document.getElementById("lotteryModal");
    if (modal) modal.style.display = "none";

    const boardPanel = document.getElementById("roundBoardPanel");
    if (boardPanel) {
      boardPanel.style.display = "block";
      boardPanel.style.setProperty("display", "block", "important");
    }

    renderTeams();
    setTimeout(() => {
      const modal = document.getElementById("lotteryModal");
      if (modal) modal.style.display = "none";

      renderTeams();

      if (currentLotteryResolver) {
        const resolver = currentLotteryResolver;
        currentLotteryResolver = null;
        resolver(winnerTeam);
      }
    }, 2200);
  });
}

function getUserPicksOptionsHtml() {
  let targetTeam = null;
  if (typeof teams !== 'undefined' && teams && teams[myPlayerSlot]) {
    targetTeam = teams[myPlayerSlot];
  }

  if (targetTeam && targetTeam.allPicks && targetTeam.allPicks.length > 0) {
    const userPicks = targetTeam.allPicks.filter(p => !p.isPass);
    if (userPicks.length > 0) {
      let html = `<option value="">-- 未配置 --</option>`;
      userPicks.forEach(p => {
        const originLabel = typeof normalizeOrigin === 'function' ? normalizeOrigin(p.出身) : (p.出身 || "高卒");
        const photoUrl = p.photo || p.写真 || p.photoUrl || "";
        html += `<option value="${p.名前}" data-photo="${photoUrl}">${p.名前} (${originLabel}${p.所属 ? ` / ${p.所属}` : ''})</option>`;
      });
      return html;
    }
  }
  
  return `
    <option value="">-- 獲得メンバーがまだいません (または未配置) --</option>
    <option value="テストメンバー1">テストメンバー1 (高卒)</option>
    <option value="テストメンバー2">テストメンバー2 (大卒)</option>
  `;
}

function renderIdolForm() {
  const selectEl = document.getElementById("idolFormationSelect");
  if (!selectEl) return;

  const formKey = selectEl.value;
  const parts = formKey.split("-").map(v => parseInt(v, 10));
  const row1 = parts[0] || 4;
  const row2 = parts[1] || 5;
  const row3 = parts[2] || 7;

  const container = document.getElementById("idolFormRows");
  if (!container) return;
  
  container.innerHTML = "";
  const optionsHtml = getUserPicksOptionsHtml();

  function createRowInputSection(title, rowId, count, isCenterInc) {
    let div = document.createElement("div");
    div.style.marginBottom = "15px";
    div.innerHTML = `<h4 style="margin:0 0 8px 0; color:#ffd700; border-bottom:1px solid #444; padding-bottom:4px; font-size:13px;">${title} (${count}名)</h4>`;
    
    let grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(200px, 1fr))";
    grid.style.gap = "8px";

    for (let i = 1; i <= count; i++) {
      let isCenter = false;
      if (isCenterInc) {
        isCenter = (count % 2 === 0) ? (i === count / 2 || i === (count / 2) + 1) : (i === Math.ceil(count / 2));
      }

      let centerLabelText = (count % 2 === 0) ? `👑 Wセンター` : `👑 センター`;
      let posLabel = isCenter ? centerLabelText : `${title.split(' ')[0]} ${i}`;

      let item = document.createElement("div");
      item.className = "pos-row";
      item.style.display = "flex";
      item.style.flexDirection = "column";
      item.innerHTML = `
        <span class="pos-label" style="font-size:11px; margin-bottom:2px; ${isCenter ? 'color:#e91e63; font-weight:900;' : 'color:#b0bec5;'}">${posLabel}:</span>
        <select class="formation-select idol-select" data-row="${rowId}" data-idx="${i}" onchange="updateStageVisualizer()" style="padding:6px; font-size:12px; background:#222; color:#fff; border:1px solid #555; border-radius:4px;">${optionsHtml}</select>
      `;
      grid.appendChild(item);
    }
    div.appendChild(grid);
    return div;
  }

  container.appendChild(createRowInputSection("1列目 (フロント)", "row1", row1, true));
  container.appendChild(createRowInputSection("2列目 (中列)", "row2", row2, false));
  container.appendChild(createRowInputSection("3列目 (後列)", "row3", row3, false));

  buildStageSlots(row1, row2, row3);
}

function buildStageSlots(row1Count, row2Count, row3Count) {
  function makeSlots(containerId, count, rowId, isCenterInc) {
    const rowEl = document.getElementById(containerId);
    if (!rowEl) return;
    rowEl.innerHTML = "";
    
    for (let i = 1; i <= count; i++) {
      let isCenter = false;
      if (isCenterInc) {
        isCenter = (count % 2 === 0) ? (i === count / 2 || i === (count / 2) + 1) : (i === Math.ceil(count / 2));
      }
      let crownLabel = (count % 2 === 0) ? '👑 W-CENTER' : '👑 CENTER';

      let slot = document.createElement("div");
      slot.className = `member-slot ${isCenter ? 'is-center' : ''}`;
      slot.id = `slot-${rowId}-${i}`;
      slot.innerHTML = `
        ${isCenter ? `<div class="center-crown" style="font-size:10px; color:#ffd700; margin-bottom:2px;">${crownLabel}</div>` : ''}
        <div class="member-avatar" style="width:45px; height:45px; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; background:#455a64; margin:0 auto 4px auto; color:#fff; font-size:18px;">👤</div>
        <div class="member-slot-name" style="font-size:11px; font-weight:bold; color:#fff; text-align:center;">未配置</div>
      `;
      rowEl.appendChild(slot);
    }
  }

  makeSlots("stageBackRow", row3Count, "row3", false);
  makeSlots("stageMiddleRow", row2Count, "row2", false);
  makeSlots("stageFrontRow", row1Count, "row1", true);

  updateStageVisualizer();
}

function updateStageVisualizer() {
  const selects = document.querySelectorAll(".idol-select");
  selects.forEach(sel => {
    const row = sel.dataset.row;
    const idx = sel.dataset.idx;
    const name = sel.value || "未配置";
    
    const selectedOption = sel.options[sel.selectedIndex];
    const photoUrl = selectedOption ? selectedOption.getAttribute("data-photo") : "";

    const slot = document.getElementById(`slot-${row}-${idx}`);
    if (slot) {
      const nameEl = slot.querySelector(".member-slot-name");
      const avatarEl = slot.querySelector(".member-avatar");
      if (nameEl) nameEl.innerText = name;
      
      if (avatarEl) {
        if (name !== "未配置" && photoUrl) {
          avatarEl.innerHTML = `<img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover;" crossorigin="anonymous">`;
          avatarEl.style.background = "transparent";
        } else if (name !== "未配置") {
          avatarEl.innerText = name.charAt(0);
          avatarEl.style.background = "#5e35b1";
        } else {
          avatarEl.innerText = "👤";
          avatarEl.style.background = "#455a64";
        }
      }
    }
  });
}

function buildBaseballField() {
  const container = document.getElementById("baseballTableContainer");
  if (!container) return;
  
  const useDH = document.getElementById("dhCheck").checked;
  const positions = useDH ? ["投", "捕", "一", "二", "三", "遊", "左", "中", "右", "DH"] : ["投", "捕", "一", "二", "三", "遊", "左", "中", "右"];
  const optionsHtml = getUserPicksOptionsHtml();
  
  let html = `<table style="width:100%; border-collapse:collapse; background:rgba(0,0,0,0.4);">
    <tr style="background:#111; color:#ffd700;">
      <th style="padding:10px; border:1px solid #444; width:15%;">打順</th>
      <th style="padding:10px; border:1px solid #444; width:25%;">守備位置</th>
      <th style="padding:10px; border:1px solid #444; width:60%;">選手名</th>
    </tr>`;

  for (let i = 1; i <= 9; i++) {
    html += `<tr>
      <td style="padding:8px; border:1px solid #444; text-align:center; font-weight:bold; font-size:16px;">${i}番</td>
      <td style="padding:8px; border:1px solid #444; text-align:center;">
        <select style="width:100%; padding:6px; font-weight:bold;">
          ${positions.map((p, idx) => `<option ${idx === i-1 ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </td>
      <td style="padding:8px; border:1px solid #444;">
        <select style="width:100%; padding:6px;">${optionsHtml}</select>
      </td>
    </tr>`;
  }
  html += `</table>`;
  container.innerHTML = html;
}

function applySoccerTemplate() {
  const pitch = document.getElementById("soccerPitch");
  if (!pitch) return;
  pitch.innerHTML = "";

  const templateType = document.getElementById("soccerTemplate").value;
  let coords = [];

  switch (templateType) {
    case "442":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:35,y:70},{pos:"CB",x:62,y:70},{pos:"SB",x:15,y:65},{pos:"SB",x:82,y:65},{pos:"MF",x:30,y:45},{pos:"MF",x:68,y:45},{pos:"MF",x:42,y:45},{pos:"MF",x:56,y:45},{pos:"FW",x:38,y:20},{pos:"FW",x:60,y:20}];
      break;
    case "4231":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:35,y:70},{pos:"CB",x:62,y:70},{pos:"SB",x:15,y:65},{pos:"SB",x:82,y:65},{pos:"DMF",x:38,y:55},{pos:"DMF",x:58,y:55},{pos:"OMF",x:48,y:38},{pos:"WG",x:20,y:32},{pos:"WG",x:76,y:32},{pos:"CF",x:48,y:16}];
      break;
    case "4132":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:35,y:70},{pos:"CB",x:62,y:70},{pos:"SB",x:15,y:65},{pos:"SB",x:82,y:65},{pos:"DMF",x:48,y:60},{pos:"MF",x:22,y:40},{pos:"MF",x:48,y:42},{pos:"MF",x:74,y:40},{pos:"FW",x:38,y:18},{pos:"FW",x:60,y:18}];
      break;
    case "433":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:35,y:70},{pos:"CB",x:62,y:70},{pos:"SB",x:15,y:65},{pos:"SB",x:82,y:65},{pos:"DMF",x:48,y:52},{pos:"CMF",x:32,y:38},{pos:"CMF",x:65,y:38},{pos:"WG",x:18,y:20},{pos:"CF",x:48,y:15},{pos:"WG",x:78,y:20}];
      break;
    case "343":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:28,y:72},{pos:"CB",x:48,y:74},{pos:"CB",x:68,y:72},{pos:"MF",x:18,y:45},{pos:"MF",x:38,y:45},{pos:"MF",x:58,y:45},{pos:"MF",x:78,y:45},{pos:"WG",x:22,y:20},{pos:"CF",x:48,y:15},{pos:"WG",x:74,y:20}];
      break;
    case "3241":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:28,y:72},{pos:"CB",x:48,y:74},{pos:"CB",x:68,y:72},{pos:"DMF",x:38,y:58},{pos:"DMF",x:58,y:58},{pos:"OMF",x:18,y:38},{pos:"OMF",x:38,y:38},{pos:"OMF",x:58,y:38},{pos:"OMF",x:78,y:38},{pos:"CF",x:48,y:16}];
      break;
    case "352":
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:28,y:72},{pos:"CB",x:48,y:74},{pos:"CB",x:68,y:72},{pos:"WB",x:12,y:48},{pos:"WB",x:84,y:48},{pos:"MF",x:38,y:45},{pos:"MF",x:58,y:45},{pos:"MF",x:48,y:32},{pos:"FW",x:38,y:18},{pos:"FW",x:58,y:18}];
      break;
    default:
      coords = [{pos:"GK",x:48,y:88},{pos:"CB",x:35,y:70},{pos:"CB",x:62,y:70},{pos:"SB",x:15,y:65},{pos:"SB",x:82,y:65},{pos:"MF",x:30,y:45},{pos:"MF",x:68,y:45},{pos:"MF",x:42,y:45},{pos:"MF",x:56,y:45},{pos:"FW",x:38,y:20},{pos:"FW",x:60,y:20}];
      break;
  }

  const optionsHtml = getUserPicksOptionsHtml();

  coords.forEach((c) => {
    const slot = document.createElement("div");
    slot.className = "draggable-slot";
    slot.style.left = c.x + "%";
    slot.style.top = c.y + "%";
    slot.innerHTML = `
      <span style="font-size:10px; color:#ffd700; font-weight:bold;">${c.pos}</span>
      <select style="font-size:10px; width:100%; background:#222; color:#fff; border:none; margin-top:2px; padding:2px;">${optionsHtml}</select>
    `;
    makeDraggable(slot);
    pitch.appendChild(slot);
  });
}

function makeDraggable(elm) {
  let posX = 0, posY = 0, mouseX = 0, mouseY = 0;
  elm.onpointerdown = dragMouseDown;

  function dragMouseDown(e) {
    e.preventDefault();
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.onpointermove = elementDrag;
    document.onpointerup = closeDragElement;
  }

  function elementDrag(e) {
    e.preventDefault();
    posX = mouseX - e.clientX;
    posY = mouseY - e.clientY;
    mouseX = e.clientX;
    mouseY = e.clientY;
    
    elm.style.top = (elm.offsetTop - posY) + "px";
    elm.style.left = (elm.offsetLeft - posX) + "px";
  }

  function closeDragElement() {
    document.onpointerup = null;
    document.onpointermove = null;
  }
}

function exportCurrentSportPNG() {
  if (document.getElementById('sportPanelBaseball').style.display === 'block') {
    exportFormationToPNG('baseballCaptureArea', 'baseball_lineup.png');
  } else if (document.getElementById('sportPanelSoccer').style.display === 'block') {
    exportFormationToPNG('soccerCaptureArea', 'soccer_formation.png');
  } else {
    exportFormationToPNG('stageCaptureArea', 'idol_formation.png');
  }
}

function exportFormationToPNG(targetId, filename) {
  const target = document.getElementById(targetId);
  if (!target) return;

  html2canvas(target, {
    scale: 2,
    useCORS: true,
    backgroundColor: null
  }).then(canvas => {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }).catch(err => {
    alert("画像の生成に失敗しました: " + err.message);
  });
}
