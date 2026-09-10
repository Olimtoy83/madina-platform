import { useCallback, useEffect, useState } from 'react'
import type { RetailLocation } from '@madina/retail'
import { getRetailLocations } from '../../shared/api/retailApi'
import './RetailPos.css'

export function RetailPos() {
  const [locations, setLocations] = useState<RetailLocation[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState<string>()
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  )

  const loadLocations = useCallback(async () => {
    setLoadState('loading')
    setLocations([])
    setSelectedLocationId(undefined)

    try {
      const retailLocations = await getRetailLocations()
      setLocations(retailLocations.filter(
        (location) => location.status === 'active' && location.type === 'store',
      ))
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void loadLocations()
  }, [loadLocations])

  const selectedLocation = locations.find(
    (location) => location.id === selectedLocationId,
  )

  return (
    <main className="retail-pos">
      <header className="retail-pos__header">
        <h1>Розничная касса</h1>
        <p>Retail POS</p>
      </header>

      {loadState === 'loading' && (
        <p className="retail-pos__status" aria-live="polite">
          Загрузка доступных торговых точек…
        </p>
      )}

      {loadState === 'error' && (
        <section className="retail-pos__state" role="alert">
          <p>Не удалось загрузить доступные торговые точки.</p>
          <button type="button" onClick={() => void loadLocations()}>
            Повторить
          </button>
        </section>
      )}

      {loadState === 'ready' && locations.length === 0 && (
        <p className="retail-pos__status">
          Нет доступных активных торговых точек.
        </p>
      )}

      {loadState === 'ready' && locations.length > 0 && (
        <section className="retail-pos__state">
          <label htmlFor="retail-pos-location">
            Торговая точка
          </label>
          <select
            id="retail-pos-location"
            value={selectedLocationId ?? ''}
            onChange={(event) => setSelectedLocationId(event.target.value || undefined)}
          >
            <option value="">Выберите торговую точку</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code})
              </option>
            ))}
          </select>

          {selectedLocation && (
            <p className="retail-pos__selected" aria-live="polite">
              Выбрана торговая точка: {selectedLocation.name} ({selectedLocation.code})
            </p>
          )}
        </section>
      )}
    </main>
  )
}
