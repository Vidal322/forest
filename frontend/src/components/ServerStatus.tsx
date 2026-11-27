import { useState } from 'react'
import { useServerStatus, type ServerStatus as Status } from '../hooks/useServerStatus'

const LABEL: Record<Status, string> = {
  checking: 'A ligar…',
  online: 'Com rede',
  'no-network': 'Sem rede',
  unreachable: 'Servidor sem resposta',
}

// (Say "saved on this device" here once the offline queue exists.)
const ANNOUNCE: Partial<Record<Status, string>> = {
  'no-network': 'Sem rede. Este aparelho está sem ligação; volta a ligar-se sozinho.',
  unreachable: 'Servidor sem resposta. Não está a responder agora; a tentar outra vez sozinho.',
}

/** Small pill in the top bar showing whether the API is reachable. */
export function ServerStatus({ intervalMs }: { intervalMs?: number }) {
  const status = useServerStatus(intervalMs)
  const announcement = useAnnouncement(status)

  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {LABEL[status]}
      {/* Screen readers hear only problems and recoveries — not "A ligar… Com rede" on every load. */}
      <output className="visually-hidden" aria-live="polite">
        {announcement}
      </output>
    </span>
  )
}

const BACK_ONLINE = 'Com rede outra vez.'

/** What the live region should say, updated only when the status changes. */
function useAnnouncement(status: Status): string {
  const [prev, setPrev] = useState(status)
  const [text, setText] = useState('')

  if (status !== prev) {
    // adjusting state during render (React's pattern for deriving from a changed prop)
    setPrev(status)
    const problem = ANNOUNCE[status]
    if (problem) setText(problem)
    else if (status === 'online' && text !== '' && text !== BACK_ONLINE) setText(BACK_ONLINE)
  }
  return text
}
