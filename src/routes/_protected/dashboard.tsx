import { createFileRoute } from '@tanstack/react-router'
import Simple from '@/components/simple'

export const Route = createFileRoute('/_protected/dashboard')({
  component: () => <Simple />,
})
