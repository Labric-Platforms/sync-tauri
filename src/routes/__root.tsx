import { createRootRoute, Outlet } from "@tanstack/react-router";
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createRootRoute({
  component: () => {
    // Handle app updates at the root level
    useAppUpdater();

    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <ScrollArea className="h-screen">
              {/* child routes render here */}
              <Outlet />

              {/* devtools are auto-stripped in prod builds */}
              {/* {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />} */}
            </ScrollArea>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
    );
  },
});
