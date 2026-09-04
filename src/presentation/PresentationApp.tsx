import './presentation.css'
import { AccessGate } from './AccessGate'
import { Gallery } from './Gallery'
import { PresentationViewer } from './PresentationViewer'

const MODEL_PATH = /^\/presentation\/model\/([^/]+)\/?$/

/** Top-level switch for everything under `/presentation`. Reaching any of these components at all
 * already means `middleware.ts` verified a valid `presentation_session` cookie (or, for
 * `/presentation/login` itself, that no cookie is required) — see src/routes/useRoute.ts. */
export function PresentationApp({ pathname, navigate }: { pathname: string; navigate: (to: string) => void }) {
  if (pathname === '/presentation/login') {
    return <AccessGate onSuccess={() => navigate('/presentation')} />
  }

  const modelMatch = pathname.match(MODEL_PATH)
  if (modelMatch) {
    return <PresentationViewer id={decodeURIComponent(modelMatch[1])} onBack={() => navigate('/presentation')} />
  }

  return <Gallery onSelect={(id) => navigate(`/presentation/model/${id}`)} />
}
