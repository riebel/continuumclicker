import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect } from 'react'
import { type Notice, type NoticeKind, useActions, useGame } from '../game/store'
import { cn } from './cn'

const DURATION_MS: Record<NoticeKind, number> = { success: 2500, info: 9000, warning: 7000 }
const ICON = { success: CircleCheck, info: Info, warning: CircleAlert }

function NoticeItem({ notice }: { notice: Notice }) {
  const { dismiss } = useActions()
  const Icon = ICON[notice.kind]

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(notice.id), DURATION_MS[notice.kind])
    return () => clearTimeout(timeout)
  }, [dismiss, notice.id, notice.kind])

  return (
    <m.li
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
      className="panel pointer-events-auto flex w-full items-start gap-3 bg-space/85 px-4 py-3 shadow-2xl"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-5 shrink-0',
          notice.kind === 'success' && 'text-ok',
          notice.kind === 'info' && 'text-energy',
          notice.kind === 'warning' && 'text-burst',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{notice.title}</p>
        {notice.message && <p className="text-sm text-white/70">{notice.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(notice.id)}
        className="-m-1 cursor-pointer rounded-md p-1 text-white/60 hover:text-white"
      >
        <X aria-hidden="true" className="size-4" />
        <span className="sr-only">Dismiss</span>
      </button>
    </m.li>
  )
}

export function Notices() {
  const notices = useGame((s) => s.notices)
  return (
    <ul
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-3 z-40 mx-auto flex max-w-md flex-col gap-2 lg:top-auto lg:bottom-32"
    >
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} />
        ))}
      </AnimatePresence>
    </ul>
  )
}
