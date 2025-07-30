import { Outlet, useRouter, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/store";
import { OrganizationButton } from "@/components/organization-button";

export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        const token = await getToken();
        console.log("Token check:", token);
        
        if (token && token.exp && token.exp > Date.now() / 1000) {
          // Token exists and is not expired
          setIsAuthenticated(true);
        } else {
          // No token or token is expired
          console.log("Token invalid or expired, redirecting to login");
          setIsAuthenticated(false);
          router.navigate({ to: "/login" });
          return;
        }
      } catch (error) {
        console.error("Error checking auth:", error);
        setIsAuthenticated(false);
        router.navigate({ to: "/login" });
        return;
      }
      setIsLoading(false);
    };
    checkAuth();
  }, [router]);

  if (isLoading)
    return (
      <div>
        <header className="container mx-auto p-6 pb-0 max-w-4xl flex justify-between items-center">
          <h1 className="text-3xl font-bold">File Watcher</h1>
        </header>
      </div>
    );
  if (!isAuthenticated) return null; // Prevent flash of protected content

  return (
    <>
      {/* simple header */}
      <header className="container mx-auto p-6 pb-0 max-w-4xl flex justify-between items-center">
        <nav className="flex items-center gap-4 justify-between w-full">
          <h1 className="text-3xl font-bold">File Watcher</h1>
          <div className="items-center gap-4">
            <OrganizationButton />
          </div>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
