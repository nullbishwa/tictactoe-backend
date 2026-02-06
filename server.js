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
    "bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR",
    "bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP",
    ...Array(32).fill(null),
    "wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP",
    "wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"
];

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
            if (rowDiff <= 1 && colDiff <= 1) isBasicMoveLegal = true;
            // RULE: CASTLING SAFETY
            else if (rowDiff === 0 && colDiff === 2 && !state.movedPieces.has(from)) {
                const isKingside = toCol > fromCol;
                const rookIdx = isKingside ? from + 3 : from - 4;
                if (board[rookIdx] && !state.movedPieces.has(rookIdx) && isPathClear(from, rookIdx, board)) {
                    if (!isKingInCheck(board, playerColor, state)) {
                        const step = isKingside ? 1 : -1;
                        if (!isKingInCheck(simulateMove(board, from, from + step), playerColor, state)) isBasicMoveLegal = true;
                    }
                }
            }
            break;
    }

    if (!isBasicMoveLegal) return false;
    if (skipKingCheck) return true;

    // RULE: SELF-CHECK PREVENTION
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
            if (isMoveLegal(i, kingPos, board, enemy, state, true)) return true;
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
        const hubbyIsWhite = Math.random() < 0.5;
        rooms.set(roomId, {
            board: size === 8 ? [...initialChessBoard] : Array(size * size).fill(null),
            clients: new Map(), size, turn: 'w',
            movedPieces: new Set(), enPassantTarget: -1,
            history: [], halfMoveClock: 0,
            roles: { Hubby: hubbyIsWhite ? 'w' : 'b', Wiifu: hubbyIsWhite ? 'b' : 'w' }
        });
    }

    const room = rooms.get(roomId);
    let myRole = room.clients.size === 0 ? "Hubby" : (room.clients.size === 1 ? "Wiifu" : "Observer");
    room.clients.set(ws, myRole);
    const myColor = room.roles[myRole] || 'observer';

    ws.send(JSON.stringify({ type: 'ASSIGN_ROLE', role: myRole, color: myColor }));

    const broadcast = (winner = null, isDraw = false, reason = null) => {
        const stateRes = JSON.stringify({ 
            type: 'STATE', board: room.board, turn: room.turn,
            hubbyColor: room.roles.Hubby, wiifuColor: room.roles.Wiifu,
            winner, isDraw, drawReason: reason
        });
        room.clients.forEach((r, c) => { if (c.readyState === 1) c.send(stateRes); });
    };

    broadcast();

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'EMOTE') {
                const res = JSON.stringify({ type: 'EMOTE', emoji: msg.emoji, sender: myRole });
                room.clients.forEach((r, c) => { if (c.readyState === 1) c.send(res); });
                return;
            }

            if (msg.type === 'RESET') {
                room.board = size === 8 ? [...initialChessBoard] : Array(size * size).fill(null);
                room.turn = 'w'; room.movedPieces.clear(); room.enPassantTarget = -1;
                room.history = []; room.halfMoveClock = 0;
                broadcast();
            } 
            else if (size === 8 && msg.type === 'MOVE') {
                if (room.turn !== myColor) return;

                if (isMoveLegal(msg.from, msg.to, room.board, myColor, room)) {
                    let tempBoard = simulateMove(room.board, msg.from, msg.to);
                    const piece = room.board[msg.from];
                    
                    // Special: Castling (Rook Move)
                    if (piece[1] === 'K' && Math.abs(msg.to - msg.from) === 2) {
                        const rookFrom = msg.to > msg.from ? msg.from + 3 : msg.from - 4;
                        const rookTo = msg.to > msg.from ? msg.from + 1 : msg.from - 1;
                        tempBoard[rookTo] = tempBoard[rookFrom];
                        tempBoard[rookFrom] = null;
                    }

                    // Special: Pawn Promotion
                    const row = Math.floor(msg.to / 8);
                    if (piece[1] === 'P' && (row === 0 || row === 7)) tempBoard[msg.to] = myColor + 'Q';

                    room.board = tempBoard;
                    room.movedPieces.add(msg.from);
                    room.turn = room.turn === 'w' ? 'b' : 'w';

                    // CHECKMATE / STALEMATE DETECTION
                    const nextMoves = hasLegalMoves(room.board, room.turn, room);
                    const inCheck = isKingInCheck(room.board, room.turn, room);

                    if (!nextMoves) {
                        if (inCheck) broadcast(myRole, false, "Checkmate");
                        else broadcast(null, true, "Stalemate");
                    } else {
                        broadcast();
                    }
                }
            } 
            else if (size !== 8) {
                // TIC-TAC-TOE LOGIC
                room.board[msg.index] = myColor === 'w' ? 'X' : 'O';
                const winSym = checkWinner(room.board, room.size);
                if (winSym) {
                    const winRole = (winSym === 'X' && room.roles.Hubby === 'w') || (winSym === 'O' && room.roles.Hubby === 'b') ? "Hubby" : "Wiifu";
                    broadcast(winRole);
                } else if (!room.board.includes(null)) {
                    broadcast(null, true, "Board Full");
                } else {
                    broadcast();
                }
            }
        } catch (e) { console.log("Error", e); }
    });

    ws.on('close', () => {
        room.clients.delete(ws);
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

server.listen(port, () => console.log(`Hubby & Wiifu Server Live on ${port}`));
                                       
