import { Outlet, useRouter, createFileRoute } from "@tanstack/react-router";
import { SignedIn, useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";
import { OrganizationButton } from "@/components/organization-button";

export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.navigate({ to: "/login" });
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded)
    return (
      <div>
        <header className="container mx-auto p-6 pb-0 max-w-4xl flex justify-between items-center">
          <h1 className="text-3xl font-bold">File Watcher</h1>
        </header>
      </div>
    );
  if (!isSignedIn) return null; // Prevent flash of protected content

  return (
    <>
      {/* simple header */}
      <header className="container mx-auto p-6 pb-0 max-w-4xl flex justify-between items-center">
        <nav className="flex items-center gap-4 justify-between w-full">
          <h1 className="text-3xl font-bold">File Watcher</h1>
          <div className="items-center gap-4">
            <SignedIn>
              <OrganizationButton />
            </SignedIn>
          </div>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
