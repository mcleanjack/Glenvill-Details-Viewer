import { useState, type FormEvent } from 'react'

/** `/presentation/login` — the client-facing area's single shared access code. No equivalent
 * screen exists in the Detail Viewer reference design, so this borrows its panel/typography
 * language directly (graphite plate, Archivo type, brass hairline) rather than inventing a new
 * visual system. */
export function AccessGate({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/presentation-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Incorrect access code.')
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pv-root pv-gate">
      <div className="pv-gate__card">
        <div className="pv-gate__brand">GLENVILL HOMES</div>
        <div className="pv-gate__title">Presentation Access</div>
        <p className="pv-gate__hint">Enter the access code you were given to view published models.</p>
        <form onSubmit={(e) => void submit(e)}>
          <input
            autoFocus
            type="password"
            inputMode="text"
            className="pv-gate__input"
            placeholder="Access code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <div className="pv-gate__error">{error}</div>}
          <button type="submit" className="pv-gate__submit" disabled={submitting || !code}>
            {submitting ? 'CHECKING…' : 'ENTER'}
          </button>
        </form>
      </div>
    </div>
  )
}
