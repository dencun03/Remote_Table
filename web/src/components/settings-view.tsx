'use client'

import { useState } from 'react'
import {
  Save,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertCircle,
  Loader2,
  Info,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
  const connectionStatus = useRemotableStore((s) => s.connectionStatus)
  const setConnectionStatus = useRemotableStore((s) => s.setConnectionStatus)

  const [relayHost, setRelayHost] = useState('localhost')
  const [relayPort, setRelayPort] = useState('3030')
  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [darkMode, setDarkMode] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    'idle' | 'success' | 'error'
  >('idle')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult('idle')

    // Simulate connection test
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setTestResult('success')
    setConnectionStatus('connected')

    setTimeout(() => {
      setTestResult('idle')
    }, 3000)

    setTesting(false)
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    setSaveSuccess(false)

    // Simulate save
    await new Promise((resolve) => setTimeout(resolve, 800))

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
    setSaving(false)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-white">Настройки</h1>

      {/* Connection section */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Wifi className="h-4 w-4 text-emerald-400" />
            Подключение
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="relay-host" className="text-slate-300">
                Хост relay-сервера
              </Label>
              <Input
                id="relay-host"
                type="text"
                value={relayHost}
                onChange={(e) => setRelayHost(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="relay-port" className="text-slate-300">
                Порт
              </Label>
              <Input
                id="relay-port"
                type="text"
                value={relayPort}
                onChange={(e) => setRelayPort(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              onClick={handleTestConnection}
              variant="outline"
              className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
              disabled={testing}
              size="sm"
            >
              {testing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : testResult === 'success' ? (
                <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
              ) : testResult === 'error' ? (
                <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Wifi className="mr-1.5 h-3.5 w-3.5" />
              )}
              Тест соединения
            </Button>

            {testResult === 'success' && (
              <span className="text-sm text-emerald-400">Соединение установлено</span>
            )}
            {testResult === 'error' && (
              <span className="text-sm text-red-400">Ошибка подключения</span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {connectionStatus === 'connected' || connectionStatus === 'active' ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  Подключено
                </span>
              ) : connectionStatus === 'connecting' ? (
                <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                  Подключение...
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <WifiOff className="h-3 w-3" />
                  Отключено
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile section */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white">Профиль</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-username" className="text-slate-300">
              Имя пользователя
            </Label>
            <Input
              id="profile-username"
              type="text"
              value={currentUser?.username ?? ''}
              readOnly
              disabled
              className="border-slate-700 bg-slate-800/50 text-slate-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-email" className="text-slate-300">
              Электронная почта
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Роль</Label>
            <div>
              <Badge
                variant="outline"
                className="border-emerald-500/20 text-emerald-400"
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
              <span className="text-sm text-emerald-400">Изменения сохранены</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* App section */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white">Приложение</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-slate-300">Тема оформления</Label>
              <p className="text-xs text-slate-500">
                Переключение между светлой и тёмной темой
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                {darkMode ? 'Тёмная' : 'Светлая'}
              </span>
              <Switch
                checked={darkMode}
                onCheckedChange={setDarkMode}
              />
            </div>
          </div>

          <Separator className="bg-slate-800" />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-slate-300">Язык</Label>
              <p className="text-xs text-slate-500">Язык интерфейса</p>
            </div>
            <Select defaultValue="ru" disabled>
              <SelectTrigger className="w-36 border-slate-700 bg-slate-800 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                <SelectItem value="ru">Русский</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator className="bg-slate-800" />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-slate-300">Версия</Label>
              <p className="text-xs text-slate-500">
                Текущая версия приложения
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-sm font-mono text-slate-400">v1.0.0</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}