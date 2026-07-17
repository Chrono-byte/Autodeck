import { createFileRoute } from '@tanstack/react-router'
import { ConvexAppProvider } from '../components/ConvexAppProvider'
import { WorkspaceApp } from '../components/WorkspaceApp'

export const Route = createFileRoute('/')({
  ssr: false,
  component: Home,
})

function Home() {
  return <ConvexAppProvider><WorkspaceApp /></ConvexAppProvider>
}
