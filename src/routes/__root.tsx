import { createRootRoute, Outlet } from "@tanstack/react-router";
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { ClerkProvider } from "@clerk/clerk-react";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPubKey) {
  throw new Error("Missing Publishable Key");
}

export const Route = createRootRoute({
  component: () => {
    // Handle app updates at the root level
    useAppUpdater();

    return (
      <ClerkProvider publishableKey={clerkPubKey}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* child routes render here */}
          <Outlet />

          {/* devtools are auto-stripped in prod builds */}
          {/* {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />} */}
          <Toaster />
        </ThemeProvider>
      </ClerkProvider>
    );
  },
});
