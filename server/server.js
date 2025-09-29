const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity
    methods: ["GET", "POST"]
  }
});

const gameRooms = {};

// --- Game Logic Helpers ---
const createDeck = () => {
    const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ suit, rank });
        }
    }
    return deck;
};

const getCardValue = (card) => {
    if (card.rank === 'A') return 1;
    if (['K', 'Q'].includes(card.rank)) return 10;
    if (card.rank === 'J') return -1;
    return parseInt(card.rank);
};

const shuffleDeck = (deck) => {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
};

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on('createRoom', ({ playerName, maxPlayers }) => {
        let roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        while (gameRooms[roomId]) {
            roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        }
        socket.join(roomId);
        gameRooms[roomId] = {
            players: [{ id: socket.id, name: playerName, hand: [], isHost: true }],
            maxPlayers: parseInt(maxPlayers, 10),
            gameState: 'waiting',
            deck: [],
            discardPile: [],
            currentPlayerIndex: 0,
        };
        socket.emit('roomCreated', { roomId, players: gameRooms[roomId].players });
        console.log(`Room ${roomId} created by ${playerName}`);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = gameRooms[roomId];
        if (room && room.players.length < room.maxPlayers) {
            socket.join(roomId);
            room.players.push({ id: socket.id, name: playerName, hand: [], isHost: false });
            io.to(roomId).emit('playerJoined', room.players);
            socket.emit('joinedRoom', { roomId, players: room.players });
            console.log(`${playerName} joined room ${roomId}`);

            if (room.players.length === room.maxPlayers) {
                startGame(roomId);
            }
        } else {
            socket.emit('error', { message: 'Room is full or does not exist.' });
        }
    });

    const startGame = (roomId) => {
        const room = gameRooms[roomId];
        if (!room) return;

        let deck = createDeck();
        deck = shuffleDeck(deck);

        // Deal 4 cards to each player
        room.players.forEach(player => {
            player.hand = deck.splice(0, 4);
        });

        room.discardPile = [deck.pop()];
        room.deck = deck;
        room.gameState = 'playing';
        room.currentPlayerIndex = 0;

        // Emit the full game state to everyone in the room
        // We hide hands of other players for each client
        room.players.forEach(player => {
            const personalGameState = {
                ...room,
                players: room.players.map(p => ({
                    ...p,
                    hand: p.id === player.id ? p.hand : p.hand.map(() => ({ suit: 'hidden', rank: 'hidden' }))
                })),
                deckSize: room.deck.length
            };
            io.to(player.id).emit('gameUpdate', personalGameState);
        });
        console.log(`Game started in room ${roomId}`);
    };
    
    // Placeholder for a game action
    socket.on('drawCard', ({ roomId }) => {
        const room = gameRooms[roomId];
        if (!room || room.players[room.currentPlayerIndex].id !== socket.id) return;
        
        const drawnCard = room.deck.pop();
        room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

        io.to(roomId).emit('message', { text: `${room.players[room.currentPlayerIndex].name} drew a card.` });
        
        // Broadcast updated state
         room.players.forEach(player => {
            const personalGameState = {
                ...room,
                players: room.players.map(p => ({
                    ...p,
                    hand: p.id === player.id ? p.hand : p.hand.map(() => ({ suit: 'hidden', rank: 'hidden' }))
                })),
                deckSize: room.deck.length
            };
            io.to(player.id).emit('gameUpdate', personalGameState);
        });
    });

    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                if (room.players.length === 0) {
                    delete gameRooms[roomId];
                    console.log(`Room ${roomId} closed.`);
                } else {
                    io.to(roomId).emit('playerLeft', room.players);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));