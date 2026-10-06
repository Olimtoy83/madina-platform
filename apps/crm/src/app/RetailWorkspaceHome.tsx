import { Navigate } from 'react-router-dom'
import { Card } from '@madina/ui'
import { useAuth } from '../context/useAuth'
import { getWorkspaceHomePath } from '../components/layout/navigation'

export function RetailWorkspaceHome() {
  const { user } = useAuth()
  const path = getWorkspaceHomePath(user, 'sabono-retail')

  if (path) {
    return <Navigate replace to={path} />
  }

  return (
    <section className="route-recovery">
      <Card>
        <h1>Нет доступа к рабочему пространству SABONO</h1>
        <p>Обратитесь к администратору, чтобы получить доступ к retail-операциям.</p>
      </Card>
    </section>
  )
}
