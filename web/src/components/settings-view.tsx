'use client'

import { useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Save,
  CheckCircle,
  Loader2,
  Info,
  Sun,
  Moon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRemotableStore } from '@/lib/store'

const roleLabels: Record<string, string> = {
  user: 'Пользователь',
  specialist: 'Специалист',
  admin: 'Администратор',
}

export function SettingsView() {
  const currentUser = useRemotableStore((s) => s.currentUser)
  const { theme, setTheme } = useTheme()

  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSaveProfile = async () => {
    setSaving(true)
    setSaveSuccess(false)

    // Simulate save
    await new Promise((resolve) => setTimeout(resolve, 800))

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
    setSaving(false)
  }

  const isDark = theme === 'dark'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-foreground">Настройки</h1>

      {/* Profile section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Профиль</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-username">
              Имя пользователя
            </Label>
            <Input
              id="profile-username"
              type="text"
              value={currentUser?.username ?? ''}
              readOnly
              disabled
              className="bg-muted/50 text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email">
              Электронная почта
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Роль</Label>
            <div>
              <Badge
                variant="outline"
                className="border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              >
                {roleLabels[currentUser?.role ?? 'user']}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSaveProfile}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              size="sm"
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Сохранить
            </Button>
            {saveSuccess && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">Изменения сохранены</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* App section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Приложение</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Тема оформления</Label>
              <p className="text-xs text-muted-foreground">
                Переключение между светлой и тёмной темой
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {isDark ? 'Тёмная' : 'Светлая'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 bg-muted"
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-foreground shadow-lg ring-0 transition-transform ${
                    isDark ? 'translate-x-5' : 'translate-x-0'
                  }`}
                >
                  <span className="flex h-full w-full items-center justify-center">
                    {isDark ? (
                      <Moon className="h-3 w-3 text-background" />
                    ) : (
                      <Sun className="h-3 w-3 text-background" />
                    )}
                  </span>
                </span>
              </button>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Язык</Label>
              <p className="text-xs text-muted-foreground">Язык интерфейса</p>
            </div>
            <Select defaultValue="ru" disabled>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ru">Русский</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Версия</Label>
              <p className="text-xs text-muted-foreground">
                Текущая версия приложения
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-mono text-muted-foreground">v1.0.0</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}