const { WebSocketServer } = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end(req.url === '/ping' ? "I am awake!" : "Advanced Multi-Game Server Running");
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

// --- CORE CHESS VALIDATION ---
function isMoveLegal(from, to, board, playerColor) {
    const piece = board[from];
    if (!piece || piece[0] !== playerColor) return false;
    const target = board[to];
    if (target && target[0] === playerColor) return false;

    const fromRow = Math.floor(from / 8), fromCol = from % 8;
    const toRow = Math.floor(to / 8), toCol = to % 8;
    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);

    switch (piece[1]) {
        case 'P': // Pawn Logic
            const dir = playerColor === 'w' ? -1 : 1;
            // Forward move
            if (fromCol === toCol && !target) {
                if (toRow === fromRow + dir) return true;
                if (fromRow === (playerColor === 'w' ? 6 : 1) && toRow === fromRow + 2 * dir && !board[from + 8 * dir]) return true;
            }
            // Capture
            return (colDiff === 1 && toRow === fromRow + dir && target);
        case 'R': return (fromRow === toRow || fromCol === toCol) && isPathClear(from, to, board);
        case 'B': return (rowDiff === colDiff) && isPathClear(from, to, board);
        case 'Q': return (rowDiff === colDiff || fromRow === toRow || fromCol === toCol) && isPathClear(from, to, board);
        case 'N': return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
        case 'K': return rowDiff <= 1 && colDiff <= 1;
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

// --- ADVANCED CHECK DETECTION ---
function isKingInCheck(board, color) {
    const kingPos = board.indexOf(color + 'K');
    if (kingPos === -1) return false;
    const enemyColor = color === 'w' ? 'b' : 'w';
    for (let i = 0; i < 64; i++) {
        if (board[i] && board[i][0] === enemyColor) {
            if (isMoveLegal(i, kingPos, board, enemyColor)) return true;
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
            clients: new Map(), size, turn: 'w'
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
                room.turn = 'w';
            } 
            else if (size === 8 && msg.type === 'MOVE') {
                if (room.turn !== playerSymbol) return;
                
                if (isMoveLegal(msg.from, msg.to, room.board, playerSymbol)) {
                    const tempBoard = [...room.board];
                    tempBoard[msg.to] = tempBoard[msg.from];
                    tempBoard[msg.from] = null;

                    // ADVANCED: Block move if it leaves own King in Check
                    if (!isKingInCheck(tempBoard, playerSymbol)) {
                        room.board = tempBoard;
                        
                        // ADVANCED: Auto-Promote Pawn to Queen
                        const row = Math.floor(msg.to / 8);
                        if (room.board[msg.to] === 'wP' && row === 0) room.board[msg.to] = 'wQ';
                        if (room.board[msg.to] === 'bP' && row === 7) room.board[msg.to] = 'bQ';

                        room.turn = room.turn === 'w' ? 'b' : 'w';
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: "Illegal: King in Check!" }));
                        return;
                    }
                }
            } else if (size !== 8) {
                room.board[msg.index] = msg.symbol;
            }

            const stateRes = JSON.stringify({ 
                type: 'STATE', 
                board: room.board, 
                turn: room.turn,
                winner: size === 8 ? null : checkWinner(room.board, room.size),
                inCheck: size === 8 ? isKingInCheck(room.board, room.turn) : false 
            });
            room.clients.forEach((s, c) => { if (c.readyState === 1) c.send(stateRes); });
        } catch (e) { console.log("JSON Error"); }
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

// Reuse your original checkWinner function for Tic-Tac-Toe
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

server.listen(port, () => console.log(`Advanced Multi-Game Server on port ${port}`));
