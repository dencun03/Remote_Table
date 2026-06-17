'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRemotableStore } from '@/lib/store'

const categories = [
  { value: 'Программное обеспечение', label: 'Программное обеспечение' },
  { value: 'Аппаратное обеспечение', label: 'Аппаратное обеспечение' },
  { value: 'Сеть/Интернет', label: 'Сеть/Интернет' },
  { value: 'Другое', label: 'Другое' },
]

const priorities = [
  { value: '1', label: 'Критический' },
  { value: '2', label: 'Высокий' },
  { value: '3', label: 'Средний' },
  { value: '4', label: 'Низкий' },
  { value: '5', label: 'Информационный' },
]

export function CreateTicketView() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('3')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const currentUser = useRemotableStore((s) => s.currentUser)
  const addTicket = useRemotableStore((s) => s.addTicket)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!title.trim() || !description.trim() || !category) {
      setError('Заполните все обязательные поля')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          priority: parseInt(priority, 10),
          creatorId: currentUser?.id,
        }),
      })

      const data = await res.json()

      if (!data.success) {
        setError(data.error || 'Ошибка создания заявки')
        return
      }

      if (data.ticket) {
        addTicket(data.ticket)
      }

      setCurrentView('client-dashboard')
    } catch {
      setError('Не удалось подключиться к серверу')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="pb-4">
          <h2 className="text-lg font-bold text-white">Новая заявка</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="ticket-title" className="text-slate-300">
                Заголовок
              </Label>
              <Input
                id="ticket-title"
                type="text"
                placeholder="Кратко опишите проблему"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticket-desc" className="text-slate-300">
                Описание
              </Label>
              <Textarea
                id="ticket-desc"
                placeholder="Подробно опишите проблему..."
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-slate-300">Категория</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800">
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Приоритет</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800">
                    {priorities.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                onClick={() => setCurrentView('client-dashboard')}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={loading}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Создать
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}