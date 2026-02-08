const { WebSocketServer } = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end(req.url === '/ping' ? "I am awake!" : "Hubby & Wiifu Pro Server Running");
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

const initialChessBoard = [
    "bR", "bN", "bB", "bK", "bQ", "bB", "bN", "bR",
    "bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP",
    ...Array(32).fill(null),
    "wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP",
    "wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"
];

// --- ADVANCED CHESS VALIDATION ENGINE ---
// --- HELPER: SIMULATE MOVE ---
function simulateMove(board, from, to) {
    const newBoard = [...board];
    newBoard[to] = newBoard[from];
    newBoard[from] = null;
    return newBoard;
}

// --- ADVANCED CHESS VALIDATION ENGINE ---
function isMoveLegal(from, to, board, playerColor, state, skipKingCheck = false) {
    const piece = board[from];
    if (!piece || piece[0] !== playerColor) return false;
    const target = board[to];
    if (target && target[0] === playerColor) return false;

    const fromRow = Math.floor(from / 8), fromCol = from % 8;
    const toRow = Math.floor(to / 8), toCol = to % 8;
    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);

    let isBasicMoveLegal = false;

    switch (piece[1]) {
        case 'P':
            const dir = playerColor === 'w' ? -1 : 1;
            if (fromCol === toCol && !target) {
                if (toRow === fromRow + dir) isBasicMoveLegal = true;
                else if (fromRow === (playerColor === 'w' ? 6 : 1) && toRow === fromRow + 2 * dir && !board[from + 8 * dir]) isBasicMoveLegal = true;
            } else if (colDiff === 1 && toRow === fromRow + dir) {
                if (target || state.enPassantTarget === to) isBasicMoveLegal = true;
            }
            break;
        case 'R': isBasicMoveLegal = (fromRow === toRow || fromCol === toCol) && isPathClear(from, to, board); break;
        case 'B': isBasicMoveLegal = (rowDiff === colDiff) && isPathClear(from, to, board); break;
        case 'Q': isBasicMoveLegal = (rowDiff === colDiff || fromRow === toRow || fromCol === toCol) && isPathClear(from, to, board); break;
        case 'N': isBasicMoveLegal = (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2); break;
        case 'K':
            // 1. Standard 1-Square Movement
            if (rowDiff <= 1 && colDiff <= 1) {
                isBasicMoveLegal = true;
            }
            // 2. Castling Logic (Special 2-Square Move)
            else if (rowDiff === 0 && colDiff === 2 && !state.movedPieces.has(from)) {
                const isKingside = toCol > fromCol;
                const rookIdx = isKingside ? from + 3 : from - 4;

                // Rule: Rook must exist and must not have moved
                if (board[rookIdx] && !state.movedPieces.has(rookIdx) && isPathClear(from, rookIdx, board)) {

                    // Rule: Cannot castle OUT OF check
                    if (!isKingInCheck(board, playerColor, state)) {

                        const step = isKingside ? 1 : -1;
                        // Rule: Cannot castle THROUGH a square that is under attack
                        const intermediateBoard = simulateMove(board, from, from + step);

                        if (!isKingInCheck(intermediateBoard, playerColor, state)) {
                            isBasicMoveLegal = true;
                        }
                    }
                }
            }
            break;
    }

    if (!isBasicMoveLegal) return false;
    if (skipKingCheck) return true; // Prevents infinite recursion during check-checking

    // RULE: You cannot end your turn in Check
    const nextBoard = simulateMove(board, from, to);
    return !isKingInCheck(nextBoard, playerColor, state);
}

function isPathClear(from, to, board) {
    const fromRow = Math.floor(from / 8), fromCol = from % 8;
    const toRow = Math.floor(to / 8), toCol = to % 8;
    const rStep = toRow === fromRow ? 0 : (toRow > fromRow ? 1 : -1);
    const cStep = toCol === fromCol ? 0 : (toCol > fromCol ? 1 : -1);
    let r = fromRow + rStep, c = fromCol + cStep;
    while (r !== toRow || c !== toCol) {
        if (board[r * 8 + c]) return false;
        r += rStep; c += cStep;
    }
    return true;
}

function isKingInCheck(board, color, state) {
    const kingPos = board.indexOf(color + 'K');
    if (kingPos === -1) return false;
    const enemy = color === 'w' ? 'b' : 'w';
    for (let i = 0; i < 64; i++) {
        if (board[i] && board[i][0] === enemy) {
            // Check legality without self-check recursion
            if (isMoveLegal(i, kingPos, board, enemy, { ...state, enPassantTarget: -1 }, true)) return true;
        }
    }
    return false;
}

function hasLegalMoves(board, color, state) {
    for (let i = 0; i < 64; i++) {
        if (board[i] && board[i][0] === color) {
            for (let j = 0; j < 64; j++) {
                if (isMoveLegal(i, j, board, color, state)) return true;
            }
        }
    }
    return false;
}


wss.on('connection', (ws, req) => {
    const parts = req.url.split('/');
    const roomId = parts[2] || 'default';
    const size = parseInt(parts[3]) || 3;

    if (!rooms.has(roomId)) {
        // Randomly assign which role gets White
        const hubbyIsWhite = Math.random() < 0.5;
        rooms.set(roomId, {
            board: size === 8 ? [...initialChessBoard] : Array(size * size).fill(null),
            clients: new Map(), // ws -> role ("Hubby" or "Wiifu")
            size, turn: 'w',
            movedPieces: new Set(),
            enPassantTarget: -1,
            history: [],
            halfMoveClock: 0,
            roles: {
                Hubby: hubbyIsWhite ? 'w' : 'b',
                Wiifu: hubbyIsWhite ? 'b' : 'w'
            }
        });
    }

    const room = rooms.get(roomId);

    // Assign Role based on arrival: 1st is Hubby, 2nd is Wiifu
    let myRole = "Observer";
    if (room.clients.size === 0) myRole = "Hubby";
    else if (room.clients.size === 1) myRole = "Wiifu";

    room.clients.set(ws, myRole);
    const myColor = room.roles[myRole] || 'observer';

    // Inform the client of their personal identity
    ws.send(JSON.stringify({
        type: 'ASSIGN_ROLE',
        role: myRole,
        color: myColor
    }));

    // Send the current state
    ws.send(JSON.stringify({
        type: 'STATE',
        board: room.board,
        turn: room.turn,
        hubbyColor: room.roles.Hubby,
        wiifuColor: room.roles.Wiifu
    }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'EMOTE') {
                const res = JSON.stringify({ type: 'EMOTE', emoji: msg.emoji, sender: myRole });
                room.clients.forEach((role, client) => { if (client.readyState === 1) client.send(res); });
                return;
            }

            if (msg.type === 'RESET') {
                room.board = size === 8 ? [...initialChessBoard] : Array(size * size).fill(null);
                room.turn = 'w'; room.movedPieces.clear(); room.enPassantTarget = -1;
                room.history = []; room.halfMoveClock = 0;
            }
            else if (size === 8 && msg.type === 'MOVE') {
                if (room.turn !== myColor) return;

                if (isMoveLegal(msg.from, msg.to, room.board, myColor, room)) {
                    let tempBoard = simulateMove(room.board, msg.from, msg.to);
                    const piece = room.board[msg.from];
                    const isPawn = piece[1] === 'P';

                    // 1. Handle En Passant Capture
                    if (isPawn && msg.to === room.enPassantTarget) {
                        tempBoard[msg.to + (myColor === 'w' ? 8 : -8)] = null;
                    }

                    // 2. Handle Castling (Rook movement)
                    if (piece[1] === 'K' && Math.abs(msg.to - msg.from) === 2) {
                        const rookFrom = msg.to > msg.from ? msg.from + 3 : msg.from - 4;
                        const rookTo = msg.to > msg.from ? msg.from + 1 : msg.from - 1;
                        tempBoard[rookTo] = tempBoard[rookFrom];
                        tempBoard[rookFrom] = null;
                        room.movedPieces.add(rookFrom);
                    }

                    // 3. Handle Pawn Promotion (Auto-Queen)
                    const row = Math.floor(msg.to / 8);
                    if (isPawn && (row === 0 || row === 7)) tempBoard[msg.to] = myColor + 'Q';

                    // 4. Update Game State
                    room.board = tempBoard;
                    room.movedPieces.add(msg.from);
                    room.enPassantTarget = (isPawn && Math.abs(msg.to - msg.from) === 16) ? (msg.from + msg.to) / 2 : -1;
                    room.turn = room.turn === 'w' ? 'b' : 'w';

                    // 5. Checkmate / Stalemate Detection
                    // ... inside if (size === 8 && msg.type === 'MOVE')
                    // 5. Checkmate / Stalemate Detection
                    const nextMoves = hasLegalMoves(room.board, room.turn, room);
                    const inCheck = isKingInCheck(room.board, room.turn, room); // Check the player whose turn it now is

                    if (!nextMoves) {
                        const finalState = JSON.stringify({
                            type: 'STATE', board: room.board, turn: room.turn,
                            winner: inCheck ? myRole : null, // If in check and no moves, current sender wins
                            isDraw: !inCheck,
                            inCheck: inCheck, // Tell the app if the king is currently threatened
                            drawReason: !inCheck ? "Stalemate" : null,
                            hubbyColor: room.roles.Hubby, wiifuColor: room.roles.Wiifu
                        });
                        room.clients.forEach((r, c) => { if (c.readyState === 1) c.send(finalState); });
                        return;
                    } else {
                        // Normal broadcast with inCheck status for the pulsing animation
                        const stateRes = JSON.stringify({
                            type: 'STATE', board: room.board, turn: room.turn,
                            inCheck: inCheck,
                            hubbyColor: room.roles.Hubby, wiifuColor: room.roles.Wiifu
                        });
                        room.clients.forEach((r, c) => { if (c.readyState === 1) c.send(stateRes); });
                    }
                }
            }

            else if (size !== 8) {
                // --- HUBBY & WIIFU TIC-TAC-TOE LOGIC ---

                // 1. Process the move
                if (msg.type === 'RESET') {
                    room.board = Array(room.size * room.size).fill(null);
                } else if (msg.type === 'MOVE') {
                    // Use the symbol assigned to this specific player (Hubby/Wiifu)
                    room.board[msg.index] = myColor === 'w' ? 'X' : 'O';
                }

                // 2. Check for game over using your original logic
                const winner = checkWinner(room.board, room.size);
                const isDraw = !room.board.includes(null) && !winner;

                // 3. Prepare the response with Hubby/Wiifu context
                const stateRes = JSON.stringify({
                    type: 'STATE',
                    board: room.board,
                    winner: winner,
                    isDraw: isDraw,
                    hubbySymbol: room.roles.Hubby === 'w' ? 'X' : 'O',
                    wiifuSymbol: room.roles.Wiifu === 'w' ? 'X' : 'O'
                });

                // 4. Broadcast to the couple
                room.clients.forEach((role, client) => {
                    if (client.readyState === 1) client.send(stateRes);
                });
                return;
            }

            const drawByRepetition = room.history.filter(b => b === room.board.join(',')).length >= 3;
            const drawBy50Move = room.halfMoveClock >= 100;

            const stateRes = JSON.stringify({
                type: 'STATE',
                board: room.board,
                turn: room.turn,
                hubbyColor: room.roles.Hubby,
                wiifuColor: room.roles.Wiifu,
                isDraw: drawByRepetition || drawBy50Move,
                drawReason: drawByRepetition ? "Repetition" : (drawBy50Move ? "50-Move Rule" : null)
            });
            room.clients.forEach((role, client) => { if (client.readyState === 1) client.send(stateRes); });
        } catch (e) { console.log("JSON Error", e); }
    });

    ws.on('close', () => {
        const role = room.clients.get(ws);
        room.clients.delete(ws);
        if (room.clients.size > 0) {
            const kick = JSON.stringify({ type: 'KICK', message: `${role} left. Room closing.` });
            room.clients.forEach((r, c) => { if (c.readyState === 1) c.send(kick); });
        }
        if (room.clients.size === 0) rooms.delete(roomId);
    });
});

function checkWinner(board, size) {
    for (let i = 0; i < size; i++) {
        let row = board.slice(i * size, (i + 1) * size);
        if (row[0] && row.every(v => v === row[0])) return row[0];
        let col = [];
        for (let j = 0; j < size; j++) col.push(board[j * size + i]);
        if (col[0] && col.every(v => v === col[0])) return col[0];
    }
    let d1 = [], d2 = [];
    for (let i = 0; i < size; i++) {
        d1.push(board[i * size + i]);
        d2.push(board[i * size + (size - 1 - i)]);
    }
    if (d1[0] && d1.every(v => v === d1[0])) return d1[0];
    if (d2[0] && d2.every(v => v === d2[0])) return d2[0];
    return null;
}

server.listen(port, () => console.log(`Hubby & Wiifu Server on ${port}`));


