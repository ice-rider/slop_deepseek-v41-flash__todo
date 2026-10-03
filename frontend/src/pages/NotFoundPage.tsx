import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button, EmptyState } from '@/components/ui/primitives'

/** Fallback route for anything that does not match. */
export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <EmptyState
      className="py-28"
      icon={<Compass className="size-7" />}
      title="That page does not exist"
      description="The link may be out of date, or the board it pointed at was deleted."
      action={
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate('/dashboard')}>
            Go to the dashboard
          </Button>
          <Button variant="secondary" onClick={() => navigate('/boards')}>
            Browse boards
          </Button>
        </div>
      }
    />
  )
}
