import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    { path: '/', name: 'lobby', component: () => import('@/views/LobbyView.vue') },
    { path: '/rooms/:id', name: 'room', component: () => import('@/views/RoomView.vue') },
    { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue') },
    { path: '/history', name: 'history', component: () => import('@/views/HistoryView.vue') },
    { path: '/history/:matchId', name: 'history-detail', component: () => import('@/views/HistoryDetailView.vue') },
    { path: '/overlay', name: 'overlay', component: () => import('@/views/OverlayView.vue') }
  ]
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.ensureInitialized()
  if (to.name !== 'login' && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'lobby' }
  }
  return true
})
