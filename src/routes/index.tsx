import { createFileRoute } from '@tanstack/react-router'
import FileWatcher from '@/components/FileWatcher'

export const Route = createFileRoute('/')({
  component: () => <FileWatcher />,
})
