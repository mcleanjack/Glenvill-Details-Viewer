import { AppShell } from './components/layout/AppShell'
import { LoginScreen } from './components/layout/LoginScreen'
import { PresentationApp } from './presentation/PresentationApp'
import { useRoute } from './routes/useRoute'

function App() {
  const { pathname, navigate } = useRoute()

  if (pathname.startsWith('/presentation')) {
    return <PresentationApp pathname={pathname} navigate={navigate} />
  }

  if (pathname === '/login') {
    return <LoginScreen onSuccess={() => navigate('/')} />
  }

  return <AppShell />
}

export default App
