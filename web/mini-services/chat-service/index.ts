import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Track which users are in which ticket rooms
const ticketRooms = new Map<string, Set<string>>()

io.on('connection', (socket) => {
  console.log(`[Chat] Connected: ${socket.id}`)

  // User joins a ticket chat room
  socket.on('join-ticket', (data: { ticketId: string; userId: string; username: string }) => {
    const { ticketId, userId, username } = data

    socket.join(`ticket:${ticketId}`)
    socket.data = { ticketId, userId, username }

    if (!ticketRooms.has(ticketId)) {
      ticketRooms.set(ticketId, new Set())
    }
    ticketRooms.get(ticketId)!.add(socket.id)

    // Notify others in the room
    socket.to(`ticket:${ticketId}`).emit('user-joined', {
      userId,
      username,
      timestamp: new Date().toISOString(),
    })

    console.log(`[Chat] ${username} joined ticket:${ticketId}`)
  })

  // Handle chat message
  socket.on('chat-message', (data: { ticketId: string; message: { id: string; senderId: string; senderName: string; senderRole: string; text: string; createdAt: string } }) => {
    const { ticketId, message } = data

    // Broadcast to everyone in the ticket room (including sender for confirmation)
    io.to(`ticket:${ticketId}`).emit('new-message', {
      ...message,
      timestamp: message.createdAt,
    })

    console.log(`[Chat] Message in ticket:${ticketId} from ${message.senderName}`)
  })

  // User leaves a ticket room
  socket.on('leave-ticket', (data: { ticketId: string }) => {
    const { ticketId } = data
    socket.leave(`ticket:${ticketId}`)
    const room = ticketRooms.get(ticketId)
    if (room) {
      room.delete(socket.id)
      if (room.size === 0) ticketRooms.delete(ticketId)
    }
  })

  // Handle typing indicator
  socket.on('typing', (data: { ticketId: string; username: string }) => {
    socket.to(`ticket:${ticketId}`).emit('user-typing', {
      username: data.username,
      timestamp: new Date().toISOString(),
    })
  })

  socket.on('disconnect', () => {
    const { ticketId, userId, username } = socket.data || {}
    if (ticketId) {
      socket.to(`ticket:${ticketId}`).emit('user-left', {
        userId,
        username,
        timestamp: new Date().toISOString(),
      })
      const room = ticketRooms.get(ticketId)
      if (room) {
        room.delete(socket.id)
        if (room.size === 0) ticketRooms.delete(ticketId)
      }
    }
    console.log(`[Chat] Disconnected: ${socket.id}`)
  })

  socket.on('error', (error) => {
    console.error(`[Chat] Socket error (${socket.id}):`, error)
  })
})

const PORT = 3004
httpServer.listen(PORT, () => {
  console.log(`[Chat] WebSocket chat service running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[Chat] Shutting down...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('[Chat] Shutting down...')
  httpServer.close(() => process.exit(0))
})