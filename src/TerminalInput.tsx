import { useEffect, useRef, useState } from 'react'

type Props = { value: string; onChange: (value: string) => void; onSubmit: () => void; placeholder?: string; maxLength?: number; autoFocus?: boolean }

// A real <textarea> handles typing, IME, selection and paste. It is drawn invisibly on top of a mirror of its text,
// and the mirror renders a block cursor at the caret, so the cursor is a true terminal block sitting on the input.
export default function TerminalInput({ value, onChange, onSubmit, placeholder, maxLength = 16000, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(value.length)
  const syncCaret = () => { const el = ref.current; if (el) setCaret(el.selectionEnd) }
  useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }) }, [autoFocus])
  useEffect(() => {
    const onSelection = () => { if (document.activeElement === ref.current) syncCaret() }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])
  useEffect(() => { if (document.activeElement === ref.current) syncCaret(); else setCaret(value.length) }, [value])

  const position = Math.min(caret, value.length)
  const at = value[position]
  const onChar = at !== undefined && at !== '\n'
  return <div className="term-input">
    <div className="term-mirror" aria-hidden="true">{value.slice(0, position)}<span className="term-cursor">{onChar ? at : ' '}</span>{value.slice(position + (onChar ? 1 : 0))}{!value && placeholder && <span className="term-placeholder">{placeholder}</span>}{'​'}</div>
    <textarea
      ref={ref}
      id="prompt"
      aria-label="Prompt"
      value={value}
      maxLength={maxLength}
      rows={1}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      onChange={event => { onChange(event.target.value); setCaret(event.target.selectionEnd) }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit() }
      }}
    />
  </div>
}
