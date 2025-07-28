
import { LogOut } from "lucide-react";
import { useClerk, useOrganization } from "@clerk/clerk-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function OrganizationButton() {
  const { signOut } = useClerk();
  const { organization } = useOrganization();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus:outline-none">
          <Avatar className="h-8 w-8 rounded-full">
            <AvatarImage
              src={organization?.imageUrl}
              alt={organization?.name}
            />
            <AvatarFallback className="rounded-full">
              {organization?.name?.charAt(0)}
            </AvatarFallback>
          </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {organization?.name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
