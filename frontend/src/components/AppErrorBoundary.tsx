import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AppErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return <>{this.props.fallback}</>
      return (
        <div className="empty-state-panel min-h-[400px]" role="alert">
          <span className="relative grid h-14 w-14 place-items-center rounded-full glass hairline-gold" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-gradient-to-b from-error/25 to-transparent blur-md" />
            <AlertTriangle size={20} strokeWidth={1.5} className="relative text-error" />
          </span>
          <h2 className="font-display text-xl font-normal tracking-[-0.01em] text-ink">Something went wrong</h2>
          <p className="max-w-md text-[13px] leading-6 text-ink-2">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button onClick={this.handleRetry} className="btn-primary mt-2">
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
            Try again
          </button>
        </div>
      )
    }
    return <>{this.props.children}</>
  }
}
