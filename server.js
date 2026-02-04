const { WebSocketServer } = require('ws');
const http = require('http');

// Render will tell the server which port to use via process.env.PORT
const port = process.env.PORT || 8080;

// 1. Create a basic HTTP server to handle "Keep-Alive" pings
const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
        res.writeHead(200);
        res.end("I am awake!"); // External services will hit this URL
    } else {
        res.writeHead(200);
        res.end("Tic Tac Toe Server is Running");
    }
});

// 2. Attach the WebSocket server to the HTTP server
const wss = new WebSocketServer({ server });
const rooms = new Map();

wss.on('connection', (ws, req) => {
    const parts = req.url.split('/');
    const roomId = parts[2] || 'default';
    const size = parseInt(parts[3]) || 3;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            board: Array(size * size).fill(null),
            clients: new Set(),
            size: size
        });
    }

    const room = rooms.get(roomId);
    room.clients.add(ws);

    // Sync board state immediately
    ws.send(JSON.stringify({ type: 'STATE', board: room.board }));

    ws.on('message', (data) => {
        try {
            const move = JSON.parse(data);
            if (move.type === 'RESET') {
                room.board = Array(room.size * room.size).fill(null);
            } else {
                room.board[move.index] = move.symbol;
            }

            const winner = checkWinner(room.board, room.size);
            const response = JSON.stringify({
                type: 'STATE',
                board: room.board,
                winner: winner,
                isDraw: !room.board.includes(null) && !winner
            });

            room.clients.forEach(client => {
                if (client.readyState === 1) client.send(response);
            });
        } catch (e) { console.log("JSON Error"); }
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

server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
