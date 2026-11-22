import { useCallback, useRef, useState } from 'react'
import { isOpen, taskInput, tasks as tasksApi, type Task } from '../api/tasks'

export type Toast = { text: string; undo?: () => void; n: number }

/**
 * Tick a task done (or reopen it), with an Undo. Ticked rows stay where they are
 * until the page is left, so a second quick tap never lands on the next task.
 */
export function useTaskToggle(onToast: (t: Omit<Toast, 'n'>) => void) {
  const save = tasksApi.useSave()
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const inFlight = useRef(new Set<string>())
  const { mutate } = save
  const toggle = useCallback(
    (task: Task) => {
      if (inFlight.current.has(task.id)) return
      inFlight.current.add(task.id)
      const open = isOpen(task)
      setPinned((s) => new Set(s).add(task.id))
      mutate(
        { id: task.id, input: taskInput(task, { status: open ? 'done' : 'open' }) },
        { onSettled: () => inFlight.current.delete(task.id) },
      )
      // said at once: also true offline, and the row may move before the server answers
      onToast({
        text: open ? `Done: ${task.title}.` : `Reopened: ${task.title}.`,
        undo: () => mutate({ id: task.id, input: taskInput(task, { status: task.status }) }),
      })
    },
    [mutate, onToast],
  )
  return { toggle, pinned }
}
