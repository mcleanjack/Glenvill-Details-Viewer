import { useState, type FormEvent } from 'react'

/** `/login` — the owner-only gate in front of the whole editor. Reaching this screen at all
 * already means `middleware.ts` didn't find a valid `owner_session` cookie; a successful submit
 * here is what lets the caller navigate into the editor. */
export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/owner-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Incorrect password.')
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--viewport-bg)' }}>
      <form
        onSubmit={(e) => void submit(e)}
        className="w-80 rounded-lg border p-5 shadow-xl"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--panel-bg)' }}
      >
        <h1 className="mb-1 text-sm font-semibold text-[var(--text)]">3D Material Editor</h1>
        <p className="mb-4 text-xs text-[var(--text-dim)]">Owner sign-in.</p>
        <input
          autoFocus
          type="password"
          className="mb-3 w-full rounded border border-[var(--panel-border)] bg-[#2a2c33] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-blue-500"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mb-3 text-[11px] text-[var(--danger)]">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-md bg-blue-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
      </form>
    </div>
  )
}
