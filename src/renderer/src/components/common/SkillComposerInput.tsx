import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Command, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectedSkillChip {
  id: string
  name: string
  description: string
}

interface SlashQueryMatch {
  start: number
  end: number
  query: string
}

interface SkillComposerInputProps {
  value: string
  onChange: (value: string) => void
  selectedSkills: SelectedSkillChip[]
  onSelectedSkillsChange: (skills: SelectedSkillChip[]) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  placeholder?: string
  disabled?: boolean
  maxLength: number
  rows?: number
  className?: string
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
}

interface MenuPosition {
  left: number
  width: number
  top?: number
  bottom?: number
}

const DESCRIPTION_PLACEHOLDERS = new Set(['', '|', '>'])
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const TOOLTIP_DELAY_MS = 250

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function extractDescriptionFromFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return ''

  const frontmatter = match[1].replace(/\r\n/g, '\n')
  const blockMatch = frontmatter.match(/^description:\s*[>|]\s*\n((?:[ \t]+.*(?:\n|$))+)/m)
  if (blockMatch?.[1]) {
    return blockMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  const singleLineMatch = frontmatter.match(/^description:\s*(.+)$/m)
  if (!singleLineMatch?.[1]) return ''

  const description = singleLineMatch[1].trim().replace(/^['"]|['"]$/g, '')
  return DESCRIPTION_PLACEHOLDERS.has(description) ? '' : description
}

function extractDescriptionFromBody(markdown: string): string {
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, '\n').split('\n')
  const paragraph: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (paragraph.length > 0) break
      continue
    }

    if (/^#{1,6}\s+/.test(trimmed)) continue
    if (/^---+$/.test(trimmed)) continue
    if (/^>\s*/.test(trimmed)) continue
    if (/^[-*+]\s+/.test(trimmed)) continue
    if (/^\d+\.\s+/.test(trimmed)) continue
    if (/^```/.test(trimmed)) continue

    paragraph.push(trimmed)
  }

  return paragraph.join(' ').trim()
}

function deriveSkillDescription(markdown: string): string {
  return extractDescriptionFromFrontmatter(markdown) || extractDescriptionFromBody(markdown)
}

function findSlashQuery(value: string, caret: number): SlashQueryMatch | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  let start = safeCaret
  while (start > 0 && !/\s/.test(value[start - 1] || '')) {
    start -= 1
  }

  let end = safeCaret
  while (end < value.length && !/\s/.test(value[end] || '')) {
    end += 1
  }

  const token = value.slice(start, end)
  if (!token.startsWith('/')) return null
  if (token.length === 1 && start > 0 && !/\s/.test(value[start - 1] || '')) return null
  return { start, end, query: token.slice(1).toLowerCase() }
}

function removeSlashQuery(value: string, match: SlashQueryMatch): { value: string; caret: number } {
  const before = value.slice(0, match.start)
  const after = value.slice(match.end)
  const nextBefore = after ? before : before.replace(/[ \t]+$/, '')
  const nextAfter = before ? after : after.replace(/^[ \t]+/, '')

  if (!nextBefore) return { value: nextAfter, caret: 0 }
  if (!nextAfter) return { value: nextBefore, caret: nextBefore.length }
  if (/\s$/.test(nextBefore) || /^\s/.test(nextAfter)) {
    return { value: `${nextBefore}${nextAfter}`, caret: nextBefore.length }
  }
  return { value: `${nextBefore} ${nextAfter}`, caret: nextBefore.length + 1 }
}

function matchesSkill(skill: SkillInfo, query: string): boolean {
  if (!query) return true
  const text = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase()
  return text.includes(query)
}

export function buildSkillComposerPayload(input: string, selectedSkills: SelectedSkillChip[]): string {
  const commands = selectedSkills.map((skill) => `/${skill.id}`).join(' ')
  const content = input.trim()
  return [commands, content].filter(Boolean).join(' ').trim()
}

function SkillTooltip({
  description,
  children,
  open,
}: {
  description: string
  children: ReactNode
  open?: boolean
}) {
  return (
    <Tooltip.Root delayDuration={120} open={open}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={8}
          collisionPadding={12}
          className="z-[220] max-w-[280px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 shadow-[0_16px_40px_rgba(15,23,42,0.14)]"
        >
          {description || '暂无描述'}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function SkillComposerInput({
  value,
  onChange,
  selectedSkills,
  onSelectedSkillsChange,
  textareaRef,
  placeholder,
  disabled = false,
  maxLength,
  rows = 1,
  className,
  onKeyDown,
  onPaste,
}: SkillComposerInputProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [hasFocus, setHasFocus] = useState(false)
  const [caretPosition, setCaretPosition] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeReason, setActiveReason] = useState<'pointer' | 'keyboard'>('pointer')
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const [selectedChipIndex, setSelectedChipIndex] = useState<number | null>(null)
  const [delayedMenuTooltipIndex, setDelayedMenuTooltipIndex] = useState<number | null>(null)
  const [delayedChipTooltipIndex, setDelayedChipTooltipIndex] = useState<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSkills = async () => {
      const listed = await window.skills.list()
      const enriched = await Promise.all(listed.map(async (skill) => {
        const currentDescription = skill.description.trim()
        if (!DESCRIPTION_PLACEHOLDERS.has(currentDescription)) return skill
        try {
          const markdown = await window.skills.read(skill.id)
          const derivedDescription = deriveSkillDescription(markdown)
          return derivedDescription ? { ...skill, description: derivedDescription } : skill
        } catch {
          return skill
        }
      }))

      if (!cancelled) {
        setSkills(enriched.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')))
      }
    }

    void loadSkills()

    return () => {
      cancelled = true
    }
  }, [])

  const slashQuery = useMemo(
    () => findSlashQuery(value, caretPosition),
    [caretPosition, value],
  )

  const filteredSkills = useMemo(() => {
    if (!slashQuery) return []
    const selectedIds = new Set(selectedSkills.map((skill) => skill.id))
    return skills.filter((skill) => !selectedIds.has(skill.id) && matchesSkill(skill, slashQuery.query))
  }, [selectedSkills, skills, slashQuery])

  const showMenu = hasFocus && !disabled && !!slashQuery

  useEffect(() => {
    setActiveIndex(0)
  }, [slashQuery?.query, filteredSkills.length])

  useEffect(() => {
    if (!showMenu) {
      setActiveReason('pointer')
    }
  }, [showMenu])

  useEffect(() => {
    if (!showMenu || activeReason !== 'keyboard') {
      setDelayedMenuTooltipIndex(null)
      return
    }

    const timer = window.setTimeout(() => {
      setDelayedMenuTooltipIndex(activeIndex)
    }, TOOLTIP_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [activeIndex, activeReason, showMenu])

  useEffect(() => {
    if (value) {
      setSelectedChipIndex(null)
    }
  }, [value])

  useEffect(() => {
    if (selectedSkills.length === 0) {
      setSelectedChipIndex(null)
      return
    }
    setSelectedChipIndex((current) => {
      if (current === null) return current
      return Math.min(current, selectedSkills.length - 1)
    })
  }, [selectedSkills.length])

  useEffect(() => {
    if (selectedChipIndex === null) {
      setDelayedChipTooltipIndex(null)
      return
    }

    const timer = window.setTimeout(() => {
      setDelayedChipTooltipIndex(selectedChipIndex)
    }, TOOLTIP_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [selectedChipIndex])

  useEffect(() => {
    if (!showMenu) {
      setMenuPosition(null)
      return
    }

    const updateMenuPosition = () => {
      const wrapper = wrapperRef.current
      if (!wrapper) return

      const rect = wrapper.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const spaceAbove = rect.top
      const spaceBelow = viewportHeight - rect.bottom
      const preferAbove = spaceAbove >= 220 || spaceAbove >= spaceBelow

      setMenuPosition({
        left: rect.left,
        width: rect.width,
        ...(preferAbove
          ? { bottom: viewportHeight - rect.top + 12 }
          : { top: rect.bottom + 12 }),
      })
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)

    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [showMenu, selectedSkills.length, value])

  const handleSelectSkill = (skill: SkillInfo) => {
    if (!slashQuery) return

    const nextSelectedSkills = [
      ...selectedSkills,
      {
        id: skill.id,
        name: skill.name,
        description: skill.description,
      },
    ]
    const nextComposerState = removeSlashQuery(value, slashQuery)
    onSelectedSkillsChange(nextSelectedSkills)
    onChange(nextComposerState.value.slice(0, maxLength))
    setCaretPosition(nextComposerState.caret)

    requestAnimationFrame(() => {
      const textarea = textareaRef?.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(nextComposerState.caret, nextComposerState.caret)
    })
  }

  const handleRemoveSkill = (skillId: string) => {
    if (disabled) return
    onSelectedSkillsChange(selectedSkills.filter((skill) => skill.id !== skillId))
    setSelectedChipIndex(null)
    requestAnimationFrame(() => textareaRef?.current?.focus())
  }

  const handleRemoveSkillByIndex = (index: number) => {
    if (disabled) return
    const nextSelectedSkills = selectedSkills.filter((_, skillIndex) => skillIndex !== index)
    onSelectedSkillsChange(nextSelectedSkills)
    setSelectedChipIndex(
      nextSelectedSkills.length === 0
        ? null
        : Math.min(index, nextSelectedSkills.length - 1)
    )
    requestAnimationFrame(() => textareaRef?.current?.focus())
  }

  return (
    <Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
      <div ref={wrapperRef} className="relative">
        {showMenu && menuPosition && createPortal(
          <div
            className="fixed z-[160]"
            style={{
              left: menuPosition.left,
              width: menuPosition.width,
              top: menuPosition.top,
              bottom: menuPosition.bottom,
            }}
          >
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.14)]">
              {filteredSkills.length > 0 ? (
                <div>
                  <div className="max-h-64 overflow-y-auto p-2">
                    {filteredSkills.map((skill, index) => {
                      const shortcutNumber = index < 9 ? String(index + 1) : ''

                      return (
                        <SkillTooltip
                          key={skill.id}
                          description={skill.description}
                          open={showMenu && activeReason === 'keyboard' && index === delayedMenuTooltipIndex ? true : undefined}
                        >
                          <button
                            type="button"
                            onMouseEnter={() => {
                              setActiveIndex(index)
                              setActiveReason('pointer')
                            }}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              handleSelectSkill(skill)
                            }}
                            className={cn(
                              'flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left transition-colors',
                              index === activeIndex ? 'bg-slate-100 text-slate-950' : 'text-slate-700 hover:bg-slate-50'
                            )}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Sparkles size={14} className="text-slate-400" />
                                <span className="truncate text-sm font-medium">{skill.name}</span>
                              </div>
                            </div>
                            {shortcutNumber ? (
                              <span className="ml-3 inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                {isMac ? (
                                  <>
                                    <Command size={11} strokeWidth={2} />
                                    <span>+</span>
                                    <span>{shortcutNumber}</span>
                                  </>
                                ) : (
                                  <span>{`Win + ${shortcutNumber}`}</span>
                                )}
                              </span>
                            ) : null}
                          </button>
                        </SkillTooltip>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">↑↓ 选择</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">Enter 确认</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">
                      {isMac ? 'Cmd' : 'Win'} + 1-9 快速选择
                    </span>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 text-sm text-slate-500">没有匹配的技能</div>
              )}
            </div>
          </div>,
          document.body
        )}

        {selectedSkills.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectedSkills.map((skill, index) => (
              <SkillTooltip
                key={skill.id}
                description={skill.description}
                open={delayedChipTooltipIndex === index ? true : undefined}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm transition-colors',
                    selectedChipIndex === index
                      ? 'border-sky-400 bg-sky-100 text-sky-800'
                      : 'border-sky-200 bg-sky-50 text-sky-700'
                  )}
                >
                  <Sparkles size={13} className="text-sky-500" />
                  <span className="max-w-[220px] truncate">{skill.name}</span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill.id)}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-sky-500 transition-colors hover:bg-sky-100 hover:text-sky-700"
                      aria-label={`移除技能 ${skill.name}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              </SkillTooltip>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value.slice(0, maxLength)
            onChange(nextValue)
            setHasFocus(true)
            setSelectedChipIndex(null)
            setCaretPosition(event.target.selectionStart ?? nextValue.length)
          }}
          onClick={(event) => {
            setHasFocus(true)
            setSelectedChipIndex(null)
            setCaretPosition(event.currentTarget.selectionStart ?? value.length)
          }}
          onKeyUp={(event) => {
            setHasFocus(true)
            setCaretPosition(event.currentTarget.selectionStart ?? value.length)
          }}
          onFocus={(event) => {
            setHasFocus(true)
            setCaretPosition(event.currentTarget.selectionStart ?? value.length)
          }}
          onBlur={() => {
            setHasFocus(false)
            setSelectedChipIndex(null)
          }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (showMenu && filteredSkills.length > 0) {
              const quickSelectMatch = event.key.match(/^[1-9]$/)
              if (event.metaKey && quickSelectMatch) {
                const quickIndex = Number(quickSelectMatch[0]) - 1
                const targetSkill = filteredSkills[quickIndex]
                if (targetSkill) {
                  event.preventDefault()
                  setActiveIndex(quickIndex)
                  setActiveReason('keyboard')
                  handleSelectSkill(targetSkill)
                  return
                }
              }

              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveReason('keyboard')
                setActiveIndex((current) => (current + 1) % filteredSkills.length)
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveReason('keyboard')
                setActiveIndex((current) => (current - 1 + filteredSkills.length) % filteredSkills.length)
                return
              }

              if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault()
                setActiveReason('keyboard')
                handleSelectSkill(filteredSkills[activeIndex] || filteredSkills[0])
                return
              }
            }

            if (showMenu && event.key === 'Escape') {
              event.preventDefault()
              setHasFocus(false)
              return
            }

            const inputEmpty = value.length === 0
            const hasSkills = selectedSkills.length > 0

            if (!showMenu && inputEmpty && hasSkills) {
              if (event.key === 'Backspace' && selectedChipIndex === null) {
                event.preventDefault()
                setSelectedChipIndex(selectedSkills.length - 1)
                return
              }

              if (event.key === 'Tab') {
                event.preventDefault()
                if (selectedChipIndex === null) {
                  setSelectedChipIndex(event.shiftKey ? selectedSkills.length - 1 : 0)
                } else {
                  const delta = event.shiftKey ? -1 : 1
                  const nextIndex =
                    (selectedChipIndex + delta + selectedSkills.length) % selectedSkills.length
                  setSelectedChipIndex(nextIndex)
                }
                return
              }

              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                if (selectedChipIndex === null) {
                  setSelectedChipIndex(selectedSkills.length - 1)
                } else {
                  setSelectedChipIndex(Math.max(0, selectedChipIndex - 1))
                }
                return
              }

              if (event.key === 'ArrowRight') {
                event.preventDefault()
                if (selectedChipIndex === null) {
                  setSelectedChipIndex(0)
                } else if (selectedChipIndex >= selectedSkills.length - 1) {
                  setSelectedChipIndex(null)
                } else {
                  setSelectedChipIndex(selectedChipIndex + 1)
                }
                return
              }

              if ((event.key === 'Delete' || event.key === 'Backspace') && selectedChipIndex !== null) {
                event.preventDefault()
                handleRemoveSkillByIndex(selectedChipIndex)
                return
              }
            }

            if (selectedChipIndex !== null && event.key.length === 1) {
              setSelectedChipIndex(null)
            }

            onKeyDown?.(event)
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            'w-full resize-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50',
            className,
          )}
          rows={rows}
        />
      </div>
    </Tooltip.Provider>
  )
}
