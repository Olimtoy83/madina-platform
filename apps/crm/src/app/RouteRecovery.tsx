import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@madina/ui'

interface RouteRecoveryProps {
  notFound?: boolean
}

export function RouteRecovery({
  notFound = false,
}: RouteRecoveryProps) {
  const navigate = useNavigate()

  return (
    <section className="route-recovery">
      <Card>
        <h1>
          {notFound
            ? 'Страница не найдена'
            : 'Не удалось открыть страницу'}
        </h1>
        <p>
          {notFound
            ? 'Проверьте адрес страницы или вернитесь на главную.'
            : 'Повторите попытку или вернитесь на главную.'}
        </p>
        <Button
          type="button"
          onClick={() => navigate('/')}
        >
          Вернуться на главную
        </Button>
      </Card>
    </section>
  )
}
