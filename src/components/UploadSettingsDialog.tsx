import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUploadManager } from "@/hooks/useUploadManager";

interface UploadSettingsSheetProps {
  children: React.ReactNode;
}

function UploadSettingsSheet({ children }: UploadSettingsSheetProps) {
  const {
    config,
    isLoading,
    error,
    updateConfig,
    updateUploadDelay,
    updateIgnoredPatterns,
    toggleUploads,
    toggleIgnoreExistingFiles,
  } = useUploadManager();

  const [delayInput, setDelayInput] = useState("");
  const [concurrencyInput, setConcurrencyInput] = useState("");
  const [newPattern, setNewPattern] = useState("");

  // Initialize inputs when config loads
  useEffect(() => {
    if (config) {
      setDelayInput((config.upload_delay_ms / 1000).toString());
      setConcurrencyInput(config.max_concurrent_uploads.toString());
    }
  }, [config]);

  const handleToggleUploads = async (checked: boolean) => {
    try {
      await toggleUploads(checked);
    } catch (err) {
      console.error("Failed to toggle uploads:", err);
    }
  };

  const handleToggleIgnoreExisting = async (checked: boolean) => {
    try {
      await toggleIgnoreExistingFiles(checked);
    } catch (err) {
      console.error("Failed to toggle ignore existing files:", err);
    }
  };

  const handleUpdateDelay = async () => {
    const delay = parseFloat(delayInput);
    if (!isNaN(delay) && delay >= 0) {
      try {
        // Convert seconds to milliseconds for the backend
        await updateUploadDelay(Math.round(delay * 1000));
      } catch (err) {
        console.error("Failed to update delay:", err);
      }
    }
  };

  const handleUpdateConcurrency = async () => {
    const concurrency = parseInt(concurrencyInput);
    if (!isNaN(concurrency) && concurrency >= 1 && concurrency <= 20) {
      try {
        if (config) {
          const newConfig = { ...config, max_concurrent_uploads: concurrency };
          await updateConfig(newConfig);
        }
      } catch (err) {
        console.error("Failed to update concurrency:", err);
      }
    }
  };

  const handleAddPattern = async () => {
    if (newPattern.trim() && config) {
      try {
        const updatedPatterns = [...config.ignored_patterns, newPattern.trim()];
        await updateIgnoredPatterns(updatedPatterns);
        setNewPattern("");
      } catch (err) {
        console.error("Failed to add pattern:", err);
      }
    }
  };

  const handleRemovePattern = async (patternToRemove: string) => {
    if (config) {
      try {
        const updatedPatterns = config.ignored_patterns.filter(
          (pattern) => pattern !== patternToRemove
        );
        await updateIgnoredPatterns(updatedPatterns);
      } catch (err) {
        console.error("Failed to remove pattern:", err);
      }
    }
  };

  if (isLoading || error || !config) {
    return (
      <Sheet>
        <SheetTrigger asChild>{children}</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Upload Settings</SheetTitle>
            <SheetDescription className="sr-only">
              Configure upload behavior and file filters
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <div tabIndex={-1}>

          <SheetTrigger asChild>
            {children}
          </SheetTrigger>
          </div>
        </TooltipTrigger>
        <TooltipContent collisionPadding={8}>
          Upload Settings
        </TooltipContent>
      </Tooltip>
      <SheetContent className="overflow-y-auto w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>Upload Settings</SheetTitle>
          <SheetDescription className="sr-only">
            Configure upload behavior and file filters
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4">
          {/* Upload Control */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Enable Uploads</div>
                <div className="text-sm text-muted-foreground">
                  {config.enabled ? "Files are being uploaded on change" : "Files are not being uploaded on change"}
                </div>
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={handleToggleUploads}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Ignore Files Already in the Folder</div>
                <div className="text-sm text-muted-foreground">
                  {config.ignore_existing_files ? "Files already in the folder are not uploaded" : "Files already in the folder are uploaded"}
                </div>
              </div>
              <Switch
                checked={config.ignore_existing_files}
                onCheckedChange={handleToggleIgnoreExisting}
              />
            </div>

          </div>

          <Separator />

          {/* Server Configuration */}
          <div className="space-y-6">
            <div>
              <label htmlFor="delayInput" className="text-sm font-medium block mb-2">Upload Delay (seconds)</label>
              <div className="flex gap-2">
                <Input
                  id="delayInput"
                  type="number"
                  value={delayInput}
                  onChange={(e) => setDelayInput(e.target.value)}
                  placeholder="2"
                  min="0"
                  step="0.1"
                  className="flex-1"
                />
                <Button onClick={handleUpdateDelay} size="sm">
                  Update
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Delay before uploading to batch rapid file changes
              </p>
            </div>

            <div>
              <label htmlFor="concurrencyInput" className="text-sm font-medium block mb-2">Max Concurrent Uploads</label>
              <div className="flex gap-2">
                <Input
                  id="concurrencyInput"
                  type="number"
                  value={concurrencyInput}
                  onChange={(e) => setConcurrencyInput(e.target.value)}
                  placeholder="5"
                  min="1"
                  max="20"
                  className="flex-1"
                />
                <Button onClick={handleUpdateConcurrency} size="sm">
                  Update
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Number of files that can upload simultaneously (1-20)
              </p>
            </div>
          </div>

          <Separator />

          {/* Ignored Patterns */}
          <div>
            <label htmlFor="newPattern" className="text-sm font-medium block mb-2">Ignored File Patterns</label>
            <div className="flex gap-2">
              <Input
                id="newPattern"
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="*.tmp, .git/**, node_modules/**"
                className="flex-1"
              />
              <Button onClick={handleAddPattern} size="sm">
                Add
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {config.ignored_patterns.map((pattern, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => handleRemovePattern(pattern)}
                >
                  {pattern} ×
                </Badge>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              Matching files will not be uploaded
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default UploadSettingsSheet; 