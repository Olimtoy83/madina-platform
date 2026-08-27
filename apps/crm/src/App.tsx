import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthenticationBoundary } from './app/AuthenticationBoundary'
import { AuthProvider } from './context/AuthProvider'

function App() {
  return (
    <AuthProvider>
      <AuthenticationBoundary>
        <RouterProvider router={router} />
      </AuthenticationBoundary>
    </AuthProvider>
  )
}

export default App
