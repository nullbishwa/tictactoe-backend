const { WebSocketServer } = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port });

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

    // Send the current board to the new player immediately
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
            const isDraw = !room.board.includes(null) && !winner;

            const response = JSON.stringify({
                type: 'STATE',
                board: room.board,
                winner: winner,
                isDraw: isDraw
            });

            room.clients.forEach(client => {
                if (client.readyState === 1) client.send(response);
            });
        } catch (e) {
            console.error("Invalid message received");
        }
    });

    ws.on('close', () => {
        room.clients.delete(ws);
        if (room.clients.size === 0) rooms.delete(roomId);
    });
});

function checkWinner(board, size) {
    // Rows
    for (let i = 0; i < size; i++) {
        let row = board.slice(i * size, (i + 1) * size);
        if (row[0] && row.every(v => v === row[0])) return row[0];
    }
    // Columns
    for (let i = 0; i < size; i++) {
        let col = [];
        for (let j = 0; j < size; j++) col.push(board[j * size + i]);
        if (col[0] && col.every(v => v === col[0])) return col[0];
    }
    // Diagonals
    let d1 = [], d2 = [];
    for (let i = 0; i < size; i++) {
        d1.push(board[i * size + i]);
        d2.push(board[i * size + (size - 1 - i)]);
    }
    if (d1[0] && d1.every(v => v === d1[0])) return d1[0];
    if (d2[0] && d2.every(v => v === d2[0])) return d2[0];
    return null;
}

console.log(`Tic-Tac-Toe Backend Live on Port ${port}`);
