const { WebSocketServer } = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end(req.url === '/ping' ? "I am awake!" : "Multi-Game Server Running");
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

// Chess Initial State
const initialChessBoard = [
    "bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR",
    "bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP",
    ...Array(32).fill(null),
    "wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP",
    "wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"
];

wss.on('connection', (ws, req) => {
    const parts = req.url.split('/');
    const roomId = parts[2] || 'default';
    const size = parseInt(parts[3]) || 3;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            // IF SIZE IS 8, IT'S CHESS. ELSE, IT'S TIC-TAC-TOE.
            board: size === 8 ? [...initialChessBoard] : Array(size * size).fill(null),
            clients: new Map(),
            size: size,
            turn: 'w' // Only used for Chess
        });
    }

    const room = rooms.get(roomId);
    
    // Assign Symbols: w/b for Chess, X/O for Tic-Tac-Toe
    let playerSymbol;
    if (size === 8) {
        playerSymbol = room.clients.size === 0 ? 'w' : 'b';
    } else {
        playerSymbol = room.clients.size === 0 ? 'X' : 'O';
    }
    
    room.clients.set(ws, playerSymbol);

    // Initial Sync
    ws.send(JSON.stringify({ type: 'STATE', board: room.board, turn: room.turn }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            // 1. EMOTES (Shared by both games)
            if (msg.type === 'EMOTE') {
                const response = JSON.stringify({ type: 'EMOTE', emoji: msg.emoji, sender: playerSymbol });
                room.clients.forEach((symbol, client) => { if (client.readyState === 1) client.send(response); });
                return;
            }

            // 2. RESET
            if (msg.type === 'RESET') {
                room.board = size === 8 ? [...initialChessBoard] : Array(size * size).fill(null);
                room.turn = 'w';
            } 
            
            // 3. MOVE LOGIC
            else if (size === 8) {
                // --- CHESS MODE ---
                const piece = room.board[msg.from];
                if (piece) {
                    room.board[msg.to] = piece;
                    room.board[msg.from] = null;
                    room.turn = room.turn === 'w' ? 'b' : 'w';
                }
            } else {
                // --- TIC-TAC-TOE MODE ---
                room.board[msg.index] = msg.symbol;
            }

            // 4. WINNER CHECK (Only for Tic-Tac-Toe)
            const winner = size === 8 ? null : checkWinner(room.board, room.size);
            
            const response = JSON.stringify({
                type: 'STATE',
                board: room.board,
                winner: winner,
                turn: room.turn,
                isDraw: size !== 8 && !room.board.includes(null) && !winner
            });

            room.clients.forEach((symbol, client) => { if (client.readyState === 1) client.send(response); });
        } catch (e) { console.log("JSON Error"); }
    });

    ws.on('close', () => {
        const leavingSymbol = room.clients.get(ws);
        room.clients.delete(ws);
        if (room.clients.size > 0) {
            const kickMsg = JSON.stringify({ type: 'KICK', message: `Partner (${leavingSymbol}) disconnected.` });
            room.clients.forEach((symbol, client) => { if (client.readyState === 1) client.send(kickMsg); });
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

server.listen(port, () => console.log(`Multi-Game Server on port ${port}`));
