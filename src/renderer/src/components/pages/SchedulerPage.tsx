import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function SchedulerPage() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/5 text-primary">
        <Clock size={32} />
      </div>
      <h1 className="mb-3 text-2xl font-bold tracking-tight text-foreground">{t('scheduler.title')}</h1>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        {t('scheduler.description')}
      </p>
    </div>
  )
}
