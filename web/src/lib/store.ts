import { create } from 'zustand'

// ─── Types ───────────────────────────────────────────────────────────────────

type UserRole = 'user' | 'specialist' | 'admin'
type TicketStatus = 'pending' | 'in_progress' | 'waiting_user' | 'resolved' | 'cancelled'
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'active'
type SessionStatus = 'waiting' | 'active' | 'ended'
type AppView =
  | 'login'
  | 'register'
  | 'client-dashboard'
  | 'create-ticket'
  | 'specialist-dashboard'
  | 'admin-panel'
  | 'session'
  | 'client-session'
  | 'settings'
  | 'ticket-detail'

interface User {
  id: string
  username: string
  email: string
  role: UserRole
  avatar?: string
}

interface Ticket {
  id: string
  title: string
  description: string
  category: string
  priority: number
  status: TicketStatus
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  creatorId?: string
  specialistId?: string
  creator?: { username: string }
  specialist?: { username: string }
}

interface Session {
  id: string
  ticketId?: string
  clientUserId?: string
  specialistUserId?: string
  status: SessionStatus
  durationSeconds?: number
  startedAt: string
  endedAt?: string
  notes?: string
}

interface AppNotification {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  timestamp: number
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface RemotableStore {
  // ── Auth slice ──
  currentUser: User | null
  isAuthenticated: boolean
  login: (user: User) => void
  logout: () => void
  setCurrentUser: (user: User | null) => void

  // ── View slice ──
  currentView: AppView
  previousView: AppView | null
  setCurrentView: (view: AppView) => void

  // ── Connection slice ──
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void
  relayServerRunning: boolean
  toggleRelayServer: () => void

  // ── Tickets slice ──
  tickets: Ticket[]
  selectedTicket: Ticket | null
  setTickets: (tickets: Ticket[]) => void
  addTicket: (ticket: Ticket) => void
  updateTicketStatus: (id: string, status: TicketStatus) => void
  selectTicket: (ticket: Ticket | null) => void

  // ── Session slice ──
  currentSession: Session | null
  setSession: (session: Session | null) => void
  endSession: () => void

  // ── Notifications slice ──
  notifications: AppNotification[]
  addNotification: (
    notification: Omit<AppNotification, 'id' | 'timestamp'>,
  ) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void

  // ── UI slice ──
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const useRemotableStore = create<RemotableStore>((set) => ({
  // ── Auth ──
  currentUser: null,
  isAuthenticated: false,

  login: (user) =>
    set({ currentUser: user, isAuthenticated: true }),

  logout: () =>
    set({
      currentUser: null,
      isAuthenticated: false,
      currentView: 'login',
      previousView: null,
      currentSession: null,
      selectedTicket: null,
      tickets: [],
      notifications: [],
      connectionStatus: 'disconnected',
      relayServerRunning: false,
      sidebarOpen: true,
    }),

  setCurrentUser: (user) =>
    set({
      currentUser: user,
      isAuthenticated: user !== null,
    }),

  // ── View ──
  currentView: 'login',
  previousView: null,

  setCurrentView: (view) =>
    set((state) => ({
      previousView: state.currentView,
      currentView: view,
    })),

  // ── Connection ──
  connectionStatus: 'disconnected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  relayServerRunning: false,
  toggleRelayServer: () =>
    set((state) => ({
      relayServerRunning: !state.relayServerRunning,
      connectionStatus: !state.relayServerRunning
        ? 'connecting'
        : 'disconnected',
    })),

  // ── Tickets ──
  tickets: [],
  selectedTicket: null,

  setTickets: (tickets) => set({ tickets }),

  addTicket: (ticket) =>
    set((state) => ({ tickets: [ticket, ...state.tickets] })),

  updateTicketStatus: (id, status) =>
    set((state) => ({
      tickets: state.tickets.map((t) =>
        t.id === id
          ? { ...t, status, updatedAt: new Date().toISOString() }
          : t,
      ),
      selectedTicket:
        state.selectedTicket?.id === id
          ? {
              ...state.selectedTicket,
              status,
              updatedAt: new Date().toISOString(),
              ...(status === 'resolved'
                ? { resolvedAt: new Date().toISOString() }
                : {}),
            }
          : state.selectedTicket,
    })),

  selectTicket: (ticket) => set({ selectedTicket: ticket }),

  // ── Session ──
  currentSession: null,

  setSession: (session) => set({ currentSession: session }),

  endSession: () =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            status: 'ended' as SessionStatus,
            endedAt: new Date().toISOString(),
          }
        : null,
    })),

  // ── Notifications ──
  notifications: [],

  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          ...notification,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      ],
    })),

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clearNotifications: () => set({ notifications: [] }),

  // ── UI ──
  sidebarOpen: true,
  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))

// ─── Exports ─────────────────────────────────────────────────────────────────

export type {
  UserRole,
  TicketStatus,
  ConnectionStatus,
  SessionStatus,
  AppView,
  User,
  Ticket,
  Session,
  AppNotification,
}