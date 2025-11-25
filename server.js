
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const ADMIN_PASSWORD = 'Blob'; // admin password

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ----- Data model -----

const groups = Array.from({ length: 8 }, (_, i) => ({
  id: `G${i + 1}`,
  name: `Group ${i + 1}`,
}));

const letters = ['A', 'B', 'C', 'D'];

let slots = [];
groups.forEach(g => {
  letters.forEach(letter => {
    slots.push({
      groupId: g.id,
      letter,
      personId: null,
    });
  });
});

let nextPersonId = 1;
// person: {id, name, isRef, isCaptain, isSelected}
let people = [];

// Round-robin schedule for 8 groups (rounds 1–7)
const baseRounds = [
  [['G1','G8'], ['G2','G7'], ['G3','G6'], ['G4','G5']],
  [['G1','G7'], ['G8','G6'], ['G2','G5'], ['G3','G4']],
  [['G1','G6'], ['G7','G5'], ['G8','G4'], ['G2','G3']],
  [['G1','G5'], ['G6','G4'], ['G7','G3'], ['G8','G2']],
  [['G1','G4'], ['G5','G3'], ['G6','G2'], ['G7','G8']],
  [['G1','G3'], ['G4','G2'], ['G5','G8'], ['G6','G7']],
  [['G1','G2'], ['G3','G8'], ['G4','G7'], ['G5','G6']],
];

// Extra round 8 uses same group pairings as round 7
const round8Pairs = baseRounds[6]; // [['G1','G2'], ['G3','G8'], ['G4','G7'], ['G5','G6']]

// Mini-rounds for rounds 1–7 (cross-group)
// Mini 4 = A vs A (captains vs captains), and B-B, C-C, D-D
const miniRoundsCross = [
  // mini 1
  [['A','B'], ['B','C'], ['C','D'], ['D','A']],
  // mini 2
  [['A','C'], ['B','D'], ['C','A'], ['D','B']],
  // mini 3
  [['A','D'], ['B','A'], ['C','B'], ['D','C']],
  // mini 4 (captains vs captains and mirrors)
  [['A','A'], ['B','B'], ['C','C'], ['D','D']],
];

// Internal mini-rounds for round 8 (each instance: 2 groups playing within themselves)
// rooms 1–2 for first group, 3–4 for second group
const internalMiniRounds = [
  // miniRound 1
  [
    { room: 1, groupIndex: 0, pair: ['A','B'] },
    { room: 2, groupIndex: 0, pair: ['C','D'] },
    { room: 3, groupIndex: 1, pair: ['A','B'] },
    { room: 4, groupIndex: 1, pair: ['C','D'] },
  ],
  // miniRound 2
  [
    { room: 1, groupIndex: 0, pair: ['A','C'] },
    { room: 2, groupIndex: 0, pair: ['B','D'] },
    { room: 3, groupIndex: 1, pair: ['A','C'] },
    { room: 4, groupIndex: 1, pair: ['B','D'] },
  ],
  // miniRound 3
  [
    { room: 1, groupIndex: 0, pair: ['A','D'] },
    { room: 2, groupIndex: 0, pair: ['B','C'] },
    { room: 3, groupIndex: 1, pair: ['A','D'] },
    { room: 4, groupIndex: 1, pair: ['B','C'] },
  ],
];

let nextMatchId = 1;
let matches = [];

// Build rounds 1–7
baseRounds.forEach((roundPairs, rIdx) => {
  const roundNum = rIdx + 1;
  roundPairs.forEach((pair, instIdx) => {
    const instanceNum = instIdx + 1;
    const g1 = pair[0];
    const g2 = pair[1];
    miniRoundsCross.forEach((pairsInMini, mrIdx) => {
      const miniRoundNum = mrIdx + 1;
      pairsInMini.forEach((lettersPair, roomIdx) => {
        const roomNum = roomIdx + 1;
        matches.push({
          id: nextMatchId++,
          round: roundNum,
          instance: instanceNum,
          miniRound: miniRoundNum,
          room: roomNum,
          group1Id: g1,
          group2Id: g2,
          player1Letter: lettersPair[0],
          player2Letter: lettersPair[1],
          win1: false,
          win2: false,
        });
      });
    });
  });
});

// Build round 8 (internal matches within each group)
round8Pairs.forEach((pair, instIdx) => {
  const roundNum = 8;
  const instanceNum = instIdx + 1;
  const g1 = pair[0];
  const g2 = pair[1];
  const pairGroups = [g1, g2];

  internalMiniRounds.forEach((config, mrIdx) => {
    const miniRoundNum = mrIdx + 1;
    config.forEach(slot => {
      matches.push({
        id: nextMatchId++,
        round: roundNum,
        instance: instanceNum,
        miniRound: miniRoundNum,
        room: slot.room,
        group1Id: pairGroups[slot.groupIndex],
        group2Id: pairGroups[slot.groupIndex], // same group (internal)
        player1Letter: slot.pair[0],
        player2Letter: slot.pair[1],
        win1: false,
        win2: false,
      });
    });
  });
});

// Helpers
function getSlot(groupId, letter) {
  return slots.find(s => s.groupId === groupId && s.letter === letter);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function computeScoreboard() {
  const winsMap = new Map();
  people.forEach(p => winsMap.set(p.id, 0));

  matches.forEach(m => {
    if (m.win1) {
      const s1 = getSlot(m.group1Id, m.player1Letter);
      if (s1 && s1.personId != null && winsMap.has(s1.personId)) {
        winsMap.set(s1.personId, winsMap.get(s1.personId) + 1);
      }
    }
    if (m.win2) {
      const s2 = getSlot(m.group2Id, m.player2Letter);
      if (s2 && s2.personId != null && winsMap.has(s2.personId)) {
        winsMap.set(s2.personId, winsMap.get(s2.personId) + 1);
      }
    }
  });

  const board = people.map(p => ({
    personId: p.id,
    name: p.name,
    wins: winsMap.get(p.id) || 0,
  }));

  board.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name);
  });

  return board;
}

function getState() {
  return {
    groups,
    slots,
    people,
    matches,
    scoreboard: computeScoreboard(),
  };
}

// ----- Socket.io -----

io.on('connection', (socket) => {
  socket.data.isAdmin = false;

  socket.emit('state', getState());

  socket.on('loginAdmin', (pwd) => {
    if (pwd === ADMIN_PASSWORD) {
      socket.data.isAdmin = true;
      socket.emit('adminStatus', { ok: true });
    } else {
      socket.data.isAdmin = false;
      socket.emit('adminStatus', { ok: false });
    }
  });

  socket.on('updateGroupName', ({ groupId, name }) => {
    if (!socket.data.isAdmin) return;
    const g = groups.find(g => g.id === groupId);
    if (!g) return;
    g.name = String(name || '').slice(0, 50);
    io.emit('state', getState());
  });

  socket.on('addPerson', ({ name }) => {
    if (!socket.data.isAdmin) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const p = {
      id: nextPersonId++,
      name: trimmed,
      isRef: false,
      isCaptain: false,
      isSelected: false,
    };
    people.push(p);
    io.emit('state', getState());
  });

  socket.on('deletePerson', ({ personId }) => {
    if (!socket.data.isAdmin) return;
    const idNum = Number(personId);
    people = people.filter(p => p.id !== idNum);
    slots.forEach(s => {
      if (s.personId === idNum) s.personId = null;
    });
    io.emit('state', getState());
  });

  socket.on('updatePersonFlags', ({ personId, isRef, isCaptain }) => {
    if (!socket.data.isAdmin) return;
    const p = people.find(p => p.id === Number(personId));
    if (!p) return;
    p.isRef = !!isRef;
    p.isCaptain = !!isCaptain && p.isRef;
    io.emit('state', getState());
  });

  socket.on('setPersonSelected', ({ personId, isSelected }) => {
    if (!socket.data.isAdmin) return;
    const p = people.find(p => p.id === Number(personId));
    if (!p) return;
    p.isSelected = !!isSelected;
    io.emit('state', getState());
  });

  // Add 40 test players with 10 refs and 8 captains
  socket.on('addTestPeople', () => {
    if (!socket.data.isAdmin) return;
    for (let i = 1; i <= 40; i++) {
      const p = {
        id: nextPersonId++,
        name: 'Player ' + i,
        isRef: i <= 10,
        isCaptain: i <= 8,
        isSelected: true,
      };
      people.push(p);
    }
    io.emit('state', getState());
  });

  // Clear all remembered players
  socket.on('clearPeople', () => {
    if (!socket.data.isAdmin) return;
    people = [];
    slots.forEach(s => { s.personId = null; });
    io.emit('state', getState());
  });

  socket.on('randomizeGroups', () => {
    if (!socket.data.isAdmin) return;

    const numTeams = groups.length;
    const slotsPerTeam = letters.length;
    const totalSlots = numTeams * slotsPerTeam;

    const available = people.filter(p => p.isSelected);
    if (available.length < totalSlots) {
      socket.emit('errorMsg', { msg: 'Need at least ' + totalSlots + ' selected players to randomize (currently ' + available.length + ').' });
      return;
    }

    const captains = available.filter(p => p.isRef && p.isCaptain);
    if (captains.length < numTeams) {
      socket.emit('errorMsg', { msg: 'Need at least ' + numTeams + ' selected players marked as Ref + Captain for slot A (currently ' + captains.length + ').' });
      return;
    }

    const shuffledCaptains = shuffle(captains);
    const remaining = available.filter(p => !shuffledCaptains.includes(p));
    const shuffledOthers = shuffle(remaining);

    slots.forEach(s => { s.personId = null; });

    const aSlots = slots.filter(s => s.letter === 'A');
    for (let i = 0; i < aSlots.length; i++) {
      aSlots[i].personId = shuffledCaptains[i].id;
    }

    const otherSlots = slots.filter(s => s.letter !== 'A');
    let idx = 0;
    for (let i = 0; i < otherSlots.length; i++) {
      if (idx >= shuffledOthers.length) break;
      otherSlots[i].personId = shuffledOthers[idx].id;
      idx++;
    }

    io.emit('state', getState());
  });

  socket.on('resetTournament', () => {
    if (!socket.data.isAdmin) return;
    matches.forEach(m => {
      m.win1 = false;
      m.win2 = false;
    });
    slots.forEach(s => {
      s.personId = null;
    });
    // Untick all captains on reset (keep refs)
    people.forEach(p => {
      p.isCaptain = false;
    });
    io.emit('state', getState());
  });

  socket.on('setMatchWinner', ({ matchId, winner }) => {
    const m = matches.find(m => m.id === Number(matchId));
    if (!m) return;

    if (winner === 'p1') {
      m.win1 = true;
      m.win2 = false;
    } else if (winner === 'p2') {
      m.win1 = false;
      m.win2 = true;
    } else if (winner === 'clear') {
      m.win1 = false;
      m.win2 = false;
    } else {
      return;
    }

    io.emit('state', getState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Tournament app running on http://localhost:' + PORT);
});
