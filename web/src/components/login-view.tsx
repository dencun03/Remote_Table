'use client'

import { useState } from 'react'
import { Monitor, Loader2 } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useRemotableStore } from '@/lib/store'

export function LoginView() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const login = useRemotableStore((s) => s.login)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (!data.success) {
        const msg = data.debug
          ? `${data.error}: ${data.debug}`
          : data.error || 'Ошибка входа'
        setError(msg)
        return
      }

      const user = data.user
      login(user)

      if (user.role === 'admin') {
        setCurrentView('admin-panel')
      } else if (user.role === 'specialist') {
        setCurrentView('specialist-dashboard')
      } else {
        setCurrentView('client-dashboard')
      }
    } catch {
      setError('Не удалось подключиться к серверу')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border bg-card">
        <CardHeader className="flex flex-col items-center gap-2 pb-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <Monitor className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Remotable</h1>
          <p className="text-sm text-muted-foreground">Удалённая техническая поддержка</p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-foreground/80">
                Имя пользователя
              </Label>
              <Input
                id="username"
                type="text"
                placeholder="Введите имя пользователя"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="focus-visible:ring-emerald-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground/80">
                Пароль
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="focus-visible:ring-emerald-500"
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Войти
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center pb-6">
          <button
            onClick={() => setCurrentView('register')}
            className="text-sm text-muted-foreground transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            Нет аккаунта?{' '}
            <span className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
              Зарегистрироваться
            </span>
          </button>
        </CardFooter>
      </Card>
    </div>
  )
}