import { Link } from 'react-router'
import { EmptyState } from '@/ui/primitives'

export default function NotFound() {
  return (
    <EmptyState title="No such chapter">
      <Link to="/" className="text-core underline underline-offset-4">
        Back to the overview
      </Link>
    </EmptyState>
  )
}
