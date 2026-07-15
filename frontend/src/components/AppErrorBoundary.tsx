import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] unrecoverable render error', { message: error.message, componentStack: info.componentStack })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0a0a0f] p-6 text-center text-white">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">Media Codex needs a quick refresh</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">The app may have updated while it was open. Your on-device preferences are preserved.</p>
          <button onClick={() => window.location.reload()} className="mt-6 min-h-12 rounded-full bg-[#f178a9] px-5 font-semibold text-white">Reload app</button>
        </div>
      </main>
    )
  }
}
