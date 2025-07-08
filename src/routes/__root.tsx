import { createRootRoute, Outlet, Link } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useAppUpdater } from '@/hooks/useAppUpdater'

export const Route = createRootRoute({
  component: () => {
    // Handle app updates at the root level
    useAppUpdater();

    return (
      <>
        {/* simple header */}
        <header className="border-b px-4 py-3">
          <nav className="flex gap-4 text-sm">
            <Link to="/"    className="[&.active]:font-semibold">Home</Link>
            <Link to="/login" className="[&.active]:font-semibold">Login</Link>
          </nav>
        </header>

        {/* child routes render here */}
        <Outlet />

        {/* devtools are auto-stripped in prod builds */}
        {/* {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />} */}
      </>
    )
  },
})
