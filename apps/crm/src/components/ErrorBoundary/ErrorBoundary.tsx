import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  Alert,
  Button,
} from '@madina/ui'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true,
    }
  }

  componentDidCatch(
    error: Error,
    errorInfo: ErrorInfo,
  ) {
    console.error(
      'Unhandled CRM error:',
      error,
      errorInfo,
    )
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <main>
          <section>
            <Alert
              variant="danger"
              title="Произошла непредвиденная ошибка"
            >
              Не удалось отобразить страницу.
              Перезагрузите приложение и попробуйте снова.
            </Alert>

            <Button
              type="button"
              variant="primary"
              onClick={this.handleReload}
            >
              Перезагрузить приложение
            </Button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}