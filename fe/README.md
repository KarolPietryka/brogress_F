# Brogress

Frontend-only app w React.

## Karuzele (Swiper)

- **Zależność:** `swiper` (Vite: `import "swiper/css"`, w Home dodatkowo `import "swiper/css/navigation"`).
- **`HomePickCarousel.jsx`** — w widoku **Today** (nad `WorkoutEditor` w `BrogressWorkspace`, wrapper `.todayCard__carousel`); nawigacja strzałkami (`Navigation`), `rewind` (z ostatniego slajdu wraca na pierwszy), `autoHeight` + reguły w `styles.css` (`.home-pick-swiper`, kafelek `.home-pick-swiper__tile`) żeby uniknąć wysokości 0 z domyślnego `height: 100%` Swipera.
- **`PlanTemplateCarousel.jsx`** — w `WorkoutEditor` (*Plans from history*), slajdy = ostatnie plany; pierwsze zdarzenie `slideChange` po mount jest pomijane, żeby `prefill` z API nie był nadpisany, dopóki użytkownik sam nie zmieni slajdu.

## Uruchomienie (port 3001)

```powershell
npm install
npm run dev
```

Otworz `http://localhost:3001`.

