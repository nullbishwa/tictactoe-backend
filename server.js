const { WebSocketServer } = require('ws');

// Koyeb provides the PORT environment variable automatically
const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port });

// Game state storage: RoomID -> { board, clients, size }
const rooms = new Map();

wss.on('connection', (ws, req) => {
    // Expected URL format: /play/{roomId}/{size}
    // Example: wss://your-app.koyeb.app/play/mysecretroom/4
    const pathParts = req.url.split('/');
    const roomId = pathParts[2] || 'default-room';
    const size = parseInt(pathParts[3]) || 3;

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
        console.log(`Creating room: ${roomId} with size: ${size}`);
        rooms.set(roomId, {
            board: Array(size * size).fill(null),
            clients: new Set(),
            size: size
        });
    }

    const room = rooms.get(roomId);
    room.clients.add(ws);

    // 1. Send current board state to the player who just joined
    ws.send(JSON.stringify({
        type: 'STATE',
        board: room.board,
        winner: checkWinner(room.board, room.size),
        isDraw: checkDraw(room.board)
    }));

    // 2. Handle incoming moves or resets
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            if (message.type === 'RESET') {
                room.board = Array(room.size * room.size).fill(null);
                console.log(`Room ${roomId} reset`);
            } else if (message.type === 'MOVE') {
                // Update board if the spot is empty
                if (room.board[message.index] === null) {
                    room.board[message.index] = message.symbol;
                }
            }

            // Calculate new state
            const winner = checkWinner(room.board, room.size);
            const isDraw = checkDraw(room.board) && !winner;

            const update = JSON.stringify({
                type: 'STATE',
                board: room.board,
                winner: winner,
                isDraw: isDraw
            });

            // 3. Broadcast update to BOTH players in the room
            room.clients.forEach(client => {
                if (client.readyState === 1) { // 1 = OPEN
                    client.send(update);
                }
            });

        } catch (err) {
            console.error("Error processing message:", err);
        }
    });

    // 4. Cleanup when a player leaves
    ws.on('close', () => {
        room.clients.delete(ws);
        if (room.clients.size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty)`);
        }
    });
});

// WIN DETECTION ALGORITHM (Works for any N x N size)
function checkWinner(board, size) {
    // Check Rows
    for (let i = 0; i < size; i++) {
        let row = board.slice(i * size, (i + 1) * size);
        if (row[0] && row.every(val => val === row[0])) return row[0];
    }
    // Check Columns
    for (let i = 0; i < size; i++) {
        let col = [];
        for (let j = 0; j < size; j++) col.push(board[j * size + i]);
        if (col[0] && col.every(val => val === col[0])) return col[0];
    }
    // Check Diagonals
    let diag1 = [], diag2 = [];
    for (let i = 0; i < size; i++) {
        diag1.push(board[i * size + i]);
        diag2.push(board[i * size + (size - 1 - i)]);
    }
    if (diag1[0] && diag1.every(val => val === diag1[0])) return diag1[0];
    if (diag2[0] && diag2.every(val => val === diag2[0])) return diag2[0];

    return null;
}

function checkDraw(board) {
    return board.every(cell => cell !== null);
}

console.log(`Tic-Tac-Toe Server is live on port ${port}`);
