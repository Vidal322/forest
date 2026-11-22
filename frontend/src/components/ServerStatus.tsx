import { useState } from 'react'
import { useServerStatus, type ServerStatus as Status } from '../hooks/useServerStatus'

const LABEL: Record<Status, string> = {
  checking: 'Connecting…',
  online: 'Online',
  'no-network': 'No connection',
  unreachable: 'Server unreachable',
}

// (Say "saved on this device" here once the offline queue exists.)
const ANNOUNCE: Partial<Record<Status, string>> = {
  'no-network': 'No connection. This device is offline; it will reconnect automatically.',
  unreachable: "Server unreachable. It isn't answering right now; retrying automatically.",
}

/** Small pill in the top bar showing whether the API is reachable. */
export function ServerStatus({ intervalMs }: { intervalMs?: number }) {
  const status = useServerStatus(intervalMs)
  const announcement = useAnnouncement(status)

  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {LABEL[status]}
      {/* Screen readers hear only problems and recoveries — not "Connecting… Online" on every load. */}
      <output className="visually-hidden" aria-live="polite">
        {announcement}
      </output>
    </span>
  )
}

const BACK_ONLINE = 'Back online.'

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
