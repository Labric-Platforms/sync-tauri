import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'   // auto-generated
import './index.css'

const router = createRouter({ routeTree })

// type-safety helper
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// normal React mount
ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
