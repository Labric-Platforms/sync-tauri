import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useUploadManager } from "@/hooks/useUploadManager";

interface UploadSettingsDialogProps {
  children: React.ReactNode;
}

function UploadSettingsDialog({ children }: UploadSettingsDialogProps) {
  const {
    config,
    isLoading,
    error,
    updateConfig,
    updateServerUrl,
    updateUploadDelay,
    updateIgnoredPatterns,
    toggleUploads,
  } = useUploadManager();

  const [serverUrlInput, setServerUrlInput] = useState("");
  const [delayInput, setDelayInput] = useState("");
  const [concurrencyInput, setConcurrencyInput] = useState("");
  const [newPattern, setNewPattern] = useState("");

  // Initialize inputs when config loads
  useState(() => {
    if (config) {
      setServerUrlInput(config.server_url);
      setDelayInput(config.upload_delay_ms.toString());
      setConcurrencyInput(config.max_concurrent_uploads.toString());
    }
  });

  const handleToggleUploads = async (checked: boolean) => {
    try {
      await toggleUploads(checked);
    } catch (err) {
      console.error("Failed to toggle uploads:", err);
    }
  };

  const handleUpdateServerUrl = async () => {
    if (serverUrlInput.trim()) {
      try {
        await updateServerUrl(serverUrlInput.trim());
      } catch (err) {
        console.error("Failed to update server URL:", err);
      }
    }
  };

  const handleUpdateDelay = async () => {
    const delay = parseInt(delayInput);
    if (!isNaN(delay) && delay >= 0) {
      try {
        await updateUploadDelay(delay);
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
      <Dialog>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Settings</DialogTitle>
            <DialogDescription>
              {isLoading && "Loading upload configuration..."}
              {error && `Error: ${error}`}
              {!config && "No upload configuration available"}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="overflow-y-auto max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Upload Settings</DialogTitle>
          <DialogDescription>
            Configure upload server settings and file patterns
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Upload Control */}
          <Card>
            <CardHeader>
              <CardTitle>Upload Control</CardTitle>
              <CardDescription>Enable or disable the upload system</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Enable Uploads</div>
                  <div className="text-sm text-muted-foreground">
                    When enabled, files will be automatically uploaded to the server
                  </div>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={handleToggleUploads}
                />
              </div>
            </CardContent>
          </Card>

          {/* Server Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Server Configuration</CardTitle>
              <CardDescription>Configure upload server settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Server URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={serverUrlInput}
                    onChange={(e) => setServerUrlInput(e.target.value)}
                    placeholder="http://localhost:8000"
                    className="flex-1 px-3 py-2 border rounded-md text-sm"
                  />
                  <Button onClick={handleUpdateServerUrl} size="sm">
                    Update
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Upload Delay (ms)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={delayInput}
                    onChange={(e) => setDelayInput(e.target.value)}
                    placeholder="2000"
                    min="0"
                    className="flex-1 px-3 py-2 border rounded-md text-sm"
                  />
                  <Button onClick={handleUpdateDelay} size="sm">
                    Update
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Delay before uploading to batch rapid file changes
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Max Concurrent Uploads</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={concurrencyInput}
                    onChange={(e) => setConcurrencyInput(e.target.value)}
                    placeholder="5"
                    min="1"
                    max="20"
                    className="flex-1 px-3 py-2 border rounded-md text-sm"
                  />
                  <Button onClick={handleUpdateConcurrency} size="sm">
                    Update
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Number of files that can upload simultaneously (1-20)
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Ignored Patterns */}
          <Card>
            <CardHeader>
              <CardTitle>Ignored File Patterns</CardTitle>
              <CardDescription>
                Patterns for files to ignore during upload (uses glob patterns)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  placeholder="*.tmp, .git/**, node_modules/**"
                  className="flex-1 px-3 py-2 border rounded-md text-sm"
                />
                <Button onClick={handleAddPattern} size="sm">
                  Add Pattern
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {config.ignored_patterns.map((pattern, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="cursor-pointer hover:bg-red-100"
                    onClick={() => handleRemovePattern(pattern)}
                  >
                    {pattern} ×
                  </Badge>
                ))}
              </div>

              <p className="text-xs text-gray-500">
                Click on a pattern to remove it. Common patterns: *.tmp, *.log, .git/**,
                node_modules/**, .DS_Store
              </p>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default UploadSettingsDialog; 