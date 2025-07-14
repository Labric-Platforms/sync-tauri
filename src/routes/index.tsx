import { createFileRoute } from '@tanstack/react-router'
import Simple from '@/components/Simple'

export const Route = createFileRoute('/')({
  component: () => <Simple />,
})
