import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Image, BookOpen, Pencil, HelpCircle, Send, Puzzle } from 'lucide-react'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'

const isMac = navigator.platform.toUpperCase().includes('MAC')

export function HomePage() {
  const [input, setInput] = useState('')
  const navigate = useNavigate()
  const maxLength = 2000
  const harnessclawStatus = useHarnessclawStatus()
  const shortcutHint = useMemo(() => isMac ? '⌘ + Enter 发送' : 'Ctrl + Enter 发送', [])

  const handleSend = () => {
    if (!input.trim()) return
    navigate('/chat', { state: { initialMessage: input } })
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend()
    }
  }

  const quickActions = [
    { icon: Image, label: '创作图片', prompt: '帮我创作一张图片' },
    { icon: BookOpen, label: '学习知识', prompt: '帮我学习一个知识点' },
    { icon: Pencil, label: '编辑文本', prompt: '帮我编辑以下文本' },
    { icon: HelpCircle, label: '操作帮助', prompt: '我需要操作帮助' },
  ]

  return (
    <div className="flex flex-col items-center justify-start min-h-full px-6 pt-12 pb-8">
      <div className="w-full max-w-[720px]">

        {/* 主标题 */}
        <h1 className="text-2xl font-semibold text-foreground text-center mb-8">
          我们先从哪里开始呢?
        </h1>

        {/* 输入框卡片 */}
        <div className="relative rounded-2xl border border-border overflow-hidden shadow-sm mb-4 bg-card transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]">
          <div className="p-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, maxLength))}
              onKeyDown={handleKeyDown}
              placeholder="+ 有问题，尽管问"
              aria-label="输入您的问题"
              className="w-full bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-muted-foreground min-h-[80px] max-h-[200px]"
              rows={3}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-muted-foreground">{shortcutHint}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{input.length}/{maxLength}</span>
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  aria-label="发送"
                  className="w-7 h-7 rounded-lg bg-send-btn disabled:opacity-50 flex items-center justify-center transition-colors hover:opacity-80"
                >
                  <Send size={13} className="text-white" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 快捷操作按钮 */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => setInput(action.prompt)}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-full text-sm text-muted-foreground bg-secondary hover:bg-accent hover:text-primary transition-colors"
            >
              <action.icon size={14} aria-hidden="true" />
              {action.label}
            </button>
          ))}
        </div>

        {/* 推荐技能 */}
        <section>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
            <Puzzle size={14} aria-hidden="true" />
            推荐技能
          </div>
          <div className="border border-dashed border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {harnessclawStatus === 'connected' ? '暂无推荐技能' : '连接 Harnessclaw 后显示推荐技能'}
            </p>
          </div>
        </section>

      </div>
    </div>
  )
}
