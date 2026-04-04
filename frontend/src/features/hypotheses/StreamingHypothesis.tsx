import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/Card'

export function StreamingHypothesis({ theme }: { theme?: string }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenRate, setTokenRate] = useState<number>(0)
  const esRef = useRef<EventSource | null>(null)
  const startTimeRef = useRef<number>(0)
  const charCountRef = useRef<number>(0)
  const rateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track previous word count to know which words are newly arrived
  const prevWordCountRef = useRef<number>(0)

  // Close connection and rate interval on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close()
      if (rateIntervalRef.current !== null) clearInterval(rateIntervalRef.current)
    }
  }, [])

  function start() {
    esRef.current?.close()
    if (rateIntervalRef.current !== null) clearInterval(rateIntervalRef.current)
    setText('')
    setDone(false)
    setError(null)
    setRunning(true)
    setTokenRate(0)
    charCountRef.current = 0
    prevWordCountRef.current = 0
    startTimeRef.current = Date.now()

    // Update token rate every 500ms while streaming
    rateIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000
      if (elapsed > 0) {
        setTokenRate(Math.round(charCountRef.current / elapsed))
      }
    }, 500)

    const url = '/api/hypotheses/stream' + (theme ? `?theme=${encodeURIComponent(theme)}` : '')
    const es = new EventSource(url)
    esRef.current = es
    es.onmessage = (e) => {
      if (e.data === '[DONE]') {
        setDone(true)
        setRunning(false)
        es.close()
        if (rateIntervalRef.current !== null) {
          clearInterval(rateIntervalRef.current)
          rateIntervalRef.current = null
        }
        return
      }
      charCountRef.current += (e.data as string).length
      setText((t) => t + e.data)
    }
    es.onerror = () => {
      setRunning(false)
      setError('Generation failed. Please try again.')
      es.close()
      if (rateIntervalRef.current !== null) {
        clearInterval(rateIntervalRef.current)
        rateIntervalRef.current = null
      }
    }
  }

  const isStreaming = running && !done

  // Split text into words for word-by-word fade-in
  // We treat whitespace-split tokens as "words" (includes punctuation attached to words)
  const words = text ? text.split(/(\s+)/) : []
  const currentWordCount = words.length
  // Number of newly arrived word tokens since last render
  const newWordCount = Math.max(0, currentWordCount - prevWordCountRef.current)
  // Update the ref after computing newWordCount (synchronous — no state, no re-render)
  prevWordCountRef.current = currentWordCount

  return (
    <Card className="space-y-3">
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .word-fade-in {
          animation: fade-in 0.2s ease both;
        }
      `}</style>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Generate hypothesis</h3>
        <div className="flex items-center gap-2">
          {isStreaming && tokenRate > 0 && (
            <span className="text-xs font-mono text-text-muted">~{tokenRate} tok/s</span>
          )}
          <button
            onClick={start}
            disabled={running}
            aria-label={running ? 'Generating hypothesis' : 'Generate hypothesis'}
            className="text-xs text-accent hover:text-accent-hover disabled:opacity-50 font-mono transition-colors"
          >
            {running ? 'generating…' : '▶ Generate'}
          </button>
        </div>
      </div>

      {/* AI generating pill */}
      {isStreaming && (
        <div className="flex items-center">
          <span className="inline-flex items-center bg-accent/10 border border-accent/30 text-accent text-xs rounded-full px-3 py-1">
            <span className="bg-accent w-1.5 h-1.5 rounded-full animate-pulse inline-block mr-1.5" />
            AI generating...
          </span>
        </div>
      )}

      {(text || running) && (
        <p
          aria-live="polite"
          aria-atomic="false"
          className="text-xs text-text-secondary font-mono leading-relaxed whitespace-pre-wrap"
        >
          {isStreaming
            ? words.map((word, i) => {
                // Words in the last `newWordCount` positions are newly arrived
                const isNew = i >= currentWordCount - newWordCount
                return (
                  <span
                    key={i}
                    className={isNew ? 'word-fade-in' : undefined}
                  >
                    {word}
                  </span>
                )
              })
            : text}
          {isStreaming && (
            <span
              aria-hidden="true"
              className="inline-block w-0.5 h-4 bg-accent ml-0.5 align-middle"
              style={{ animation: 'blink 1s ease infinite' }}
            />
          )}
        </p>
      )}
      {error && !running && (
        <p role="alert" className="text-xs text-red-500 font-mono">{error}</p>
      )}
    </Card>
  )
}
