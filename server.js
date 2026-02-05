const { WebSocketServer } = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end(req.url === '/ping' ? "I am awake!" : "Pro Multi-Game Server Running");
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

// --- ADVANCED CHESS VALIDATION ENGINE ---
function isMoveLegal(from, to, board, playerColor, state) {
    const piece = board[from];
    if (!piece || piece[0] !== playerColor) return false;
    const target = board[to];
    if (target && target[0] === playerColor) return false;

    const fromRow = Math.floor(from / 8), fromCol = from % 8;
    const toRow = Math.floor(to / 8), toCol = to % 8;
    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);

    switch (piece[1]) {
        case 'P': // Pawn Logic including En Passant
            const dir = playerColor === 'w' ? -1 : 1;
            // Normal move
            if (fromCol === toCol && !target) {
                if (toRow === fromRow + dir) return true;
                if (fromRow === (playerColor === 'w' ? 6 : 1) && toRow === fromRow + 2 * dir && !board[from + 8 * dir]) return true;
            }
            // Normal capture
            if (colDiff === 1 && toRow === fromRow + dir && target) return true;
            // En Passant capture
            if (colDiff === 1 && toRow === fromRow + dir && !target && state.enPassantTarget === to) return true;
            return false;

        case 'R': return (fromRow === toRow || fromCol === toCol) && isPathClear(from, to, board);
        case 'B': return (rowDiff === colDiff) && isPathClear(from, to, board);
        case 'Q': return (rowDiff === colDiff || fromRow === toRow || fromCol === toCol) && isPathClear(from, to, board);
        case 'N': return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
        
        case 'K': // King including Castling
            if (rowDiff <= 1 && colDiff <= 1) return true;
            // Castling Logic
            if (rowDiff === 0 && colDiff === 2 && !state.movedPieces.has(from)) {
                const rookIdx = toCol > fromCol ? from + 3 : from - 4;
                if (board[rookIdx] && !state.movedPieces.has(rookIdx) && isPathClear(from, rookIdx, board)) return true;
            }
            return false;
        default: return false;
    }
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
            // Simplified check to avoid recursion
            if (isMoveLegal(i, kingPos, board, enemy, { ...state, enPassantTarget: -1 })) return true;
        }
    }
    return false;
}

wss.on('connection', (ws, req) => {
    const parts = req.url.split('/');
    const roomId = parts[2] || 'default';
    const size = parseInt(parts[3]) || 3;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            board: size === 8 ? [...initialChessBoard] : Array(size * size).fill(null),
            clients: new Map(), size, turn: 'w',
            movedPieces: new Set(),
            enPassantTarget: -1,
            history: [], // For Draw by Repetition
            halfMoveClock: 0 // For 50-Move Rule
        });
    }

    const room = rooms.get(roomId);
    const playerSymbol = size === 8 ? (room.clients.size === 0 ? 'w' : 'b') : (room.clients.size === 0 ? 'X' : 'O');
    room.clients.set(ws, playerSymbol);

    ws.send(JSON.stringify({ type: 'STATE', board: room.board, turn: room.turn, myColor: playerSymbol }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'EMOTE') {
                const res = JSON.stringify({ type: 'EMOTE', emoji: msg.emoji, sender: playerSymbol });
                room.clients.forEach((s, c) => { if (c.readyState === 1) c.send(res); });
                return;
            }

            if (msg.type === 'RESET') {
                room.board = size === 8 ? [...initialChessBoard] : Array(size * size).fill(null);
                room.turn = 'w'; room.movedPieces.clear(); room.enPassantTarget = -1;
                room.history = []; room.halfMoveClock = 0;
            } 
            else if (size === 8 && msg.type === 'MOVE') {
                if (room.turn !== playerSymbol) return;

                if (isMoveLegal(msg.from, msg.to, room.board, playerSymbol, room)) {
                    const tempBoard = [...room.board];
                    const piece = tempBoard[msg.from];
                    const isPawn = piece[1] === 'P';
                    const isCapture = tempBoard[msg.to] !== null;

                    // Execute Move
                    tempBoard[msg.to] = piece;
                    tempBoard[msg.from] = null;

                    // Handle Special Rules
                    // 1. En Passant Capture
                    if (isPawn && msg.to === room.enPassantTarget) {
                        tempBoard[msg.to + (playerSymbol === 'w' ? 8 : -8)] = null;
                    }
                    // 2. Castling (Moving the Rook)
                    if (piece[1] === 'K' && Math.abs(msg.to - msg.from) === 2) {
                        const rookFrom = msg.to > msg.from ? msg.from + 3 : msg.from - 4;
                        const rookTo = msg.to > msg.from ? msg.from + 1 : msg.from - 1;
                        tempBoard[rookTo] = tempBoard[rookFrom];
                        tempBoard[rookFrom] = null;
                        room.movedPieces.add(rookFrom);
                    }

                    // Self-Check Prevention
                    if (!isKingInCheck(tempBoard, playerSymbol, room)) {
                        room.board = tempBoard;
                        room.movedPieces.add(msg.from);
                        
                        // 3. Pawn Promotion
                        const row = Math.floor(msg.to / 8);
                        if (isPawn && (row === 0 || row === 7)) room.board[msg.to] = playerSymbol + 'Q';

                        // 4. Update En Passant Target
                        room.enPassantTarget = (isPawn && Math.abs(msg.to - msg.from) === 16) ? (msg.from + msg.to) / 2 : -1;

                        // 5. Half-move clock (50-move rule)
                        if (isPawn || isCapture) room.halfMoveClock = 0;
                        else room.halfMoveClock++;

                        room.turn = room.turn === 'w' ? 'b' : 'w';

                        // 6. Draw by Repetition History
                        room.history.push(room.board.join(','));
                    }
                }
            } else if (size !== 8) {
                room.board[msg.index] = msg.symbol;
            }

            // Draw Check Logic
            const drawByRepetition = room.history.filter(b => b === room.board.join(',')).length >= 3;
            const drawBy50Move = room.halfMoveClock >= 100; // 50 full moves = 100 half moves

            const stateRes = JSON.stringify({ 
                type: 'STATE', 
                board: room.board, 
                turn: room.turn,
                winner: size === 8 ? null : checkWinner(room.board, room.size),
                isDraw: drawByRepetition || drawBy50Move || (size !== 8 && !room.board.includes(null)),
                drawReason: drawByRepetition ? "Repetition" : (drawBy50Move ? "50-Move Rule" : null)
            });
            room.clients.forEach((s, c) => { if (c.readyState === 1) c.send(stateRes); });
        } catch (e) { console.log("JSON Error", e); }
    });

    ws.on('close', () => {
        const sym = room.clients.get(ws);
        room.clients.delete(ws);
        if (room.clients.size > 0) {
            const kick = JSON.stringify({ type: 'KICK', message: `Partner (${sym}) left.` });
            room.clients.forEach((s, c) => { if (c.readyState === 1) c.send(kick); });
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

server.listen(port, () => console.log(`Pro Server on port ${port}`));
