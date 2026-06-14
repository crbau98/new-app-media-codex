import { useState, useRef, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageCircle, X, Send, Sparkles } from "lucide-react"
import { cn } from "@/lib/cn"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const STORAGE_KEY = "ai-assistant-history"

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ChatMessage[]
  } catch { /* ignore */ }
  return []
}

function saveHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch { /* ignore */ }
}

const SUGGESTED_PROMPTS = [
  "Find trending",
  "Suggest creators",
  "What's new",
]

export function AIAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saveHistory(messages)
  }, [messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: ChatMessage = { role: "user", content: text.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      })
      if (!res.ok || !res.body) {
        throw new Error(`${res.status} ${res.statusText}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ""

      setMessages((prev) => [...prev, { role: "assistant", content: "" }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") continue
          try {
            const parsed = JSON.parse(data) as { chunk?: string; error?: string }
            if (parsed.chunk) {
              assistantContent += parsed.chunk
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last && last.role === "assistant") {
                  last.content = assistantContent
                }
                return next
              })
            }
            if (parsed.error) {
              throw new Error(parsed.error)
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong"
      setMessages((prev) => [...prev, { role: "assistant", content: msg }])
    } finally {
      setLoading(false)
    }
  }, [loading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95",
          open ? "bg-bg-elevated text-text-primary" : "btn-primary text-white",
        )}
        aria-label={open ? "Close assistant" : "Open AI assistant"}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-20 right-6 z-50 flex w-80 sm:w-96 flex-col overflow-hidden rounded-2xl depth-floating"
            style={{ height: "28rem", maxHeight: "calc(100vh - 7rem)" }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Sparkles size={16} className="text-accent" />
              <span className="text-sm font-semibold text-text-primary">Media Assistant</span>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-xs text-text-muted py-6">
                  Ask me anything about content, creators, or trends.
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-accent text-white rounded-br-sm"
                        : "bg-bg-surface text-text-primary border border-border rounded-bl-sm",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-xl bg-bg-surface border border-border px-3 py-2">
                    <span className="loading-dot inline-block h-1.5 w-1.5 rounded-full bg-text-muted" />
                    <span className="loading-dot inline-block h-1.5 w-1.5 rounded-full bg-text-muted" />
                    <span className="loading-dot inline-block h-1.5 w-1.5 rounded-full bg-text-muted" />
                  </div>
                </div>
              )}
            </div>

            {/* Suggested prompts */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 px-4 pb-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="ui-chip text-xs"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border px-3 py-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask something..."
                className="flex-1 rounded-lg bg-bg-subtle px-3 py-2 text-sm text-text-primary placeholder:text-text-muted border border-border focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="flex h-8 w-8 items-center justify-center rounded-lg btn-primary disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Send message"
              >
                <Send size={14} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
