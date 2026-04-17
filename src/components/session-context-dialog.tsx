import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { toast } from "sonner";
import { useSessionContext } from "@/hooks/use-session-context";
import { OrgMember } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, User, Clock } from "lucide-react";

interface SessionContextSheetProps {
  children: React.ReactNode;
}

type DurationUnit = "minutes" | "hours" | "days";

const UNIT_TO_MS: Record<DurationUnit, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

const DURATION_PRESETS = [
  { label: "30m", value: 30, unit: "minutes" as DurationUnit },
  { label: "1h", value: 1, unit: "hours" as DurationUnit },
  { label: "4h", value: 4, unit: "hours" as DurationUnit },
  { label: "8h", value: 8, unit: "hours" as DurationUnit },
  { label: "1d", value: 1, unit: "days" as DurationUnit },
];

function formatTimeRemaining(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getMemberDisplayName(member: OrgMember): string {
  return [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email;
}

export default function SessionContextSheet({ children }: SessionContextSheetProps) {
  const {
    context,
    members,
    isActive,
    timeRemaining,
    membersLoading,
    loadMembers,
    updateSessionContext,
    clearContext,
  } = useSessionContext();

  const [open, setOpen] = useState(false);
  const portalContainerRef = useRef<HTMLDivElement>(null);

  // Draft state
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null);
  const nextIdRef = useRef(0);
  const [metadata, setMetadata] = useState<{ id: number; key: string; value: string }[]>([]);
  const [durationValue, setDurationValue] = useState("8");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("hours");

  const durationMs = (parseFloat(durationValue) || 0) * UNIT_TO_MS[durationUnit];

  // Snapshot of initial draft state to compare against
  const initialDraftRef = useRef<{ memberId: string | null; metadata: string; durationValue: string; durationUnit: DurationUnit } | null>(null);

  const isDirty = useMemo(() => {
    if (!isActive || !initialDraftRef.current) return true;
    const snap = initialDraftRef.current;
    const metaStr = JSON.stringify(metadata.map((r) => [r.key.trim(), r.value]).filter(([k]) => k));
    return (
      (selectedMember?.user_id ?? null) !== snap.memberId ||
      metaStr !== snap.metadata ||
      durationValue !== snap.durationValue ||
      durationUnit !== snap.durationUnit
    );
  }, [isActive, selectedMember, metadata, durationValue, durationUnit]);

  const resetDraft = useCallback(() => {
    let newMemberId: string | null = null;
    let newMetadata: { key: string; value: string }[] = [];
    let newDurationValue = "8";
    let newDurationUnit: DurationUnit = "hours";

    if (context) {
      const match = members.find((m) => m.user_id === context.session_user_id) ?? null;
      setSelectedMember(match);
      newMemberId = match?.user_id ?? null;
      const entries = context.session_metadata
        ? Object.entries(context.session_metadata).map(([key, value]) => ({ id: nextIdRef.current++, key, value }))
        : [];
      setMetadata(entries);
      newMetadata = entries;
      if (context.expires_at) {
        const remaining = context.expires_at - Date.now();
        if (remaining > 0) {
          const days = remaining / UNIT_TO_MS.days;
          const hours = remaining / UNIT_TO_MS.hours;
          const minutes = remaining / UNIT_TO_MS.minutes;
          if (days >= 1 && days === Math.round(days)) {
            newDurationValue = String(Math.round(days));
            newDurationUnit = "days";
          } else if (hours >= 1) {
            newDurationValue = String(Math.round(hours * 10) / 10);
            newDurationUnit = "hours";
          } else {
            newDurationValue = String(Math.round(minutes));
            newDurationUnit = "minutes";
          }
          setDurationValue(newDurationValue);
          setDurationUnit(newDurationUnit);
        }
      }
    } else {
      setSelectedMember(null);
      setMetadata([]);
      setDurationValue("8");
      setDurationUnit("hours");
    }

    // Snapshot initial state immediately from local vars (not stale closure values)
    initialDraftRef.current = {
      memberId: newMemberId,
      metadata: JSON.stringify(newMetadata.map((r) => [r.key.trim(), r.value]).filter(([k]) => k)),
      durationValue: newDurationValue,
      durationUnit: newDurationUnit,
    };
  }, [context, members]);

  useEffect(() => {
    if (open) {
      loadMembers();
    }
  }, [open, loadMembers]);

  // Reset draft once members are loaded, then snapshot the initial state
  useEffect(() => {
    if (open && members.length > 0) {
      resetDraft();
    }
  }, [open, members, resetDraft]);

  const handleAddMetadataRow = () => {
    setMetadata((prev) => [...prev, { id: nextIdRef.current++, key: "", value: "" }]);
  };

  const handleRemoveMetadataRow = (index: number) => {
    setMetadata((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMetadataChange = (index: number, field: "key" | "value", val: string) => {
    setMetadata((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  };

  const handleSave = async () => {
    const metadataObj: Record<string, string> = {};
    const seenKeys = new Set<string>();
    for (const row of metadata) {
      const key = row.key.trim();
      if (key) {
        if (seenKeys.has(key)) {
          toast.error(`Duplicate metadata key: "${key}"`);
          return;
        }
        seenKeys.add(key);
        metadataObj[key] = row.value;
      }
    }

    const hasMetadata = Object.keys(metadataObj).length > 0;
    if (!selectedMember && !hasMetadata) {
      toast.error("Please select an operator or add metadata");
      return;
    }

    if (durationMs <= 0) {
      toast.error("Session duration must be greater than zero");
      return;
    }

    try {
      await updateSessionContext({
        session_user_id: selectedMember?.user_id ?? null,
        session_metadata: hasMetadata ? metadataObj : null,
        expires_at: Date.now() + durationMs,
      });
      toast.success("Session started");
      setOpen(false);
    } catch (err) {
      console.error("Failed to save session context:", err);
      toast.error("Failed to start session");
    }
  };

  const handleClear = async () => {
    try {
      await clearContext();
      setSelectedMember(null);
      toast.success("Session ended");
      setOpen(false);
    } catch (err) {
      console.error("Failed to clear session context:", err);
      toast.error("Failed to end session");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div tabIndex={-1}>
            <SheetTrigger asChild>{children}</SheetTrigger>
          </div>
        </TooltipTrigger>
        <TooltipContent collisionPadding={8}>Session Context</TooltipContent>
      </Tooltip>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="font-title">Session Context</SheetTitle>
          <SheetDescription className="sr-only">
            Configure session context for uploads
          </SheetDescription>
        </SheetHeader>

        {/* Active session banner */}
        {isActive && timeRemaining != null && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-accent text-accent-foreground">
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm">
              Session active for next {formatTimeRemaining(timeRemaining)}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-4">

          <FieldGroup>
            {/* Operator selection via Combobox */}
            <Field>
              <FieldContent>
                <FieldLabel>Attach user</FieldLabel>
              </FieldContent>
              <div className="relative" ref={portalContainerRef}>
                <Combobox
                  items={members}
                  itemToStringLabel={getMemberDisplayName}
                  isItemEqualToValue={(a, b) => a.user_id === b.user_id}
                  value={selectedMember}
                  onValueChange={setSelectedMember}
                >
                  <ComboboxInput
                    placeholder={membersLoading && members.length === 0 ? "Loading members..." : "Search lab members..."}
                    showClear
                    disabled={membersLoading && members.length === 0}
                  />
                  <ComboboxPrimitive.Portal container={portalContainerRef}>
                    <ComboboxPrimitive.Positioner
                      side="bottom"
                      sideOffset={6}
                      className="isolate z-50"
                    >
                      <ComboboxPrimitive.Popup className="group/combobox-content relative max-h-60 w-(--anchor-width) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
                        <ComboboxEmpty>No members found.</ComboboxEmpty>
                        <ComboboxList>
                          {(member) => (
                            <ComboboxItem key={member.user_id} value={member}>
                              <div className="flex items-center gap-3 min-w-0">
                                {member.image_url ? (
                                  <img
                                    src={member.image_url}
                                    alt=""
                                    className="w-7 h-7 rounded-full flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <User className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm truncate">{getMemberDisplayName(member)}</p>
                                  {getMemberDisplayName(member) !== member.email && (
                                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                                  )}
                                </div>
                              </div>
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxPrimitive.Popup>
                    </ComboboxPrimitive.Positioner>
                  </ComboboxPrimitive.Portal>
                </Combobox>
              </div>
            </Field>

            {/* Metadata key-value pairs */}
            <Field>
              <FieldContent>
                <FieldLabel>Attach metadata</FieldLabel>
                <FieldDescription>Pinned to files synced this session</FieldDescription>
              </FieldContent>
              <div className="space-y-2">
                {metadata.map((row, index) => (
                  <div key={row.id} className="flex gap-2 items-center">
                    <Input
                      placeholder="Key"
                      value={row.key}
                      onChange={(e) => handleMetadataChange(index, "key", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Value"
                      value={row.value}
                      onChange={(e) => handleMetadataChange(index, "value", e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => handleRemoveMetadataRow(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={handleAddMetadataRow} className="gap-1">
                  <Plus className="h-3 w-3" /> Add field
                </Button>
              </div>
            </Field>

            {/* Duration */}
            <Field>
              <FieldContent>
                <FieldLabel>Session duration</FieldLabel>
              </FieldContent>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  value={durationValue}
                  onChange={(e) => setDurationValue(e.target.value)}
                  className="w-20"
                  min="1"
                  step="1"
                />
                <Select value={durationUnit} onValueChange={(v) => setDurationUnit(v as DurationUnit)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">minutes</SelectItem>
                    <SelectItem value="hours">hours</SelectItem>
                    <SelectItem value="days">days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {DURATION_PRESETS.map((preset) => (
                  <Badge
                    key={preset.label}
                    variant={
                      durationValue === String(preset.value) && durationUnit === preset.unit
                        ? "default"
                        : "secondary"
                    }
                    className="cursor-pointer"
                    onClick={() => {
                      setDurationValue(String(preset.value));
                      setDurationUnit(preset.unit);
                    }}
                  >
                    {preset.label}
                  </Badge>
                ))}
              </div>
            </Field>
          </FieldGroup>
        </div>

        <SheetFooter className="border-t flex-col gap-2 px-4 py-4">
          {isActive && (
            <Button variant="destructive" className="w-full rounded-full" onClick={handleClear}>
              End Session
            </Button>
          )}
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1 rounded-full" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1 rounded-full" onClick={handleSave} disabled={isActive && !isDirty}>
              {isActive ? "Update" : "Start"} Session
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
