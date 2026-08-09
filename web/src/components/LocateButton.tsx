import { useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { detectLocation, type DetectedPlace } from '../geolocate'

export function LocateButton({
  onDetected,
  onFailure,
  disabled,
}: {
  onDetected: (place: DetectedPlace) => void
  onFailure: (message: string) => void
  disabled?: boolean
}) {
  const [locating, setLocating] = useState(false)

  const useMyLocation = async () => {
    setLocating(true)
    try {
      const place = await detectLocation()
      onDetected(place)
    } catch (err) {
      onFailure((err as Error).message)
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="locate-row">
      <button className="btn-locate" onClick={useMyLocation} disabled={disabled || locating}>
        <LocateFixed />
        <span>{locating ? 'Finding you…' : 'Use my location'}</span>
      </button>
    </div>
  )
}
