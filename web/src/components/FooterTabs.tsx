import { CalendarCheck, MessageCircle } from 'lucide-react'

export type FooterTab = 'chat' | 'picks'

export function FooterTabs({
  tab,
  picksCount,
  onChange,
}: {
  tab: FooterTab
  picksCount: number
  onChange: (tab: FooterTab) => void
}) {
  return (
    <nav className="footer-tabs">
      <button className={`footer-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => onChange('chat')}>
        <MessageCircle />
        <span>Chat</span>
      </button>
      <button className={`footer-tab${tab === 'picks' ? ' active' : ''}`} onClick={() => onChange('picks')}>
        <CalendarCheck />
        <span>My picks</span>
        {picksCount > 0 && <span className="footer-tab-badge">{picksCount}</span>}
      </button>
    </nav>
  )
}
