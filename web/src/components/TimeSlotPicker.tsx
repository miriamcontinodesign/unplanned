import { Moon, Sun, Sunrise, Sunset } from 'lucide-react'
import type { ComponentType } from 'react'
import type { TimeOfDay } from '../types'

const SLOTS: Array<{ value: TimeOfDay; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: 'morning', label: 'Morning', icon: Sunrise },
  { value: 'afternoon', label: 'Afternoon', icon: Sun },
  { value: 'evening', label: 'Evening', icon: Sunset },
  { value: 'night', label: 'Night', icon: Moon },
]

export function TimeSlotPicker({
  value,
  onChange,
}: {
  value: TimeOfDay
  onChange: (slot: TimeOfDay) => void
}) {
  return (
    <div className="slot-bar">
      {SLOTS.map(({ value: slot, label, icon: Icon }) => (
        <button
          key={slot}
          className={`slot-btn${value === slot ? ' active' : ''}`}
          onClick={() => onChange(slot)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
