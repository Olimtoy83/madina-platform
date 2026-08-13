interface HeaderProps {
  title?: string
}

export function Header({ title = 'Dashboard' }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__title">
        <h1>{title}</h1>
      </div>

      <div className="app-header__actions">
        <span className="app-header__brand">Madina CRM</span>
      </div>
    </header>
  )
}