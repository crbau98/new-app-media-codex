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
          <AlertTriangle size={16} strokeWidth={1.75} className="text-error" aria-hidden="true" />
          <h2 className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink">Something went wrong</h2>
          <p className="max-w-md text-[13px] text-ink-2">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button onClick={this.handleRetry} className="btn-primary mt-1">
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
            Try again
          </button>
        </div>
      )
    }
    return <>{this.props.children}</>
  }
}
