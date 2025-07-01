import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import logo from '@/assets/logo.svg'
import { openUrl } from "@tauri-apps/plugin-opener"
import { DeviceInfo } from '@/types'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

interface CodeDigitProps {
  char: string;
  isLoading?: boolean;
}

const CodeDigit = ({ char, isLoading }: CodeDigitProps) => (
  <span
    className={`inline-flex w-8 h-10 items-center justify-center border-2 rounded-lg font-mono text-xl ${
      isLoading ? "bg-muted-foreground animate-pulse" : ""
    }`}
  >
    {!isLoading && char}
  </span>
);

const CodeDisplay = ({ code, isLoading = false }: { code?: string; isLoading?: boolean }) => {
  const displayCode = code || "000000";
  return (
    <div className="inline-flex items-center gap-2">
      <span className="inline-flex gap-2">
        {displayCode.slice(0, 3).split("").map((char, i) => (
          <CodeDigit key={i} char={char} isLoading={isLoading} />
        ))}
      </span>
      <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
      <span className="inline-flex gap-2">
        {displayCode.slice(3).split("").map((char, i) => (
          <CodeDigit key={i} char={char} isLoading={isLoading} />
        ))}
      </span>
    </div>
  );
};

function RouteComponent() {
  const [enrollmentCode, setEnrollmentCode] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isLoadingCode, setIsLoadingCode] = useState(true);

  const generateRandomCode = () => {
    const code = Math.floor(Math.random() * 900000) + 100000; // Generate 6-digit number
    return code.toString();
  };

  const fetchEnrollmentCode = async (deviceInfo: DeviceInfo) => {
    setIsLoadingCode(true);
    try {
      // TODO: Replace with actual API call using device info
      // const response = await fetch('/api/enrollment-code', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(deviceInfo)
      // });
      // const data = await response.json();
      // setEnrollmentCode(data.code);
      
      // For now, simulate API delay and generate random code
      await new Promise(resolve => setTimeout(resolve, 1000));
      const newCode = generateRandomCode();
      setEnrollmentCode(newCode);
      console.log('Generated code for device:', deviceInfo);
    } catch (error) {
      console.error('Failed to fetch enrollment code:', error);
      toast.error('Failed to generate enrollment code');
      // Fallback to random code
      setEnrollmentCode(generateRandomCode());
    } finally {
      setIsLoadingCode(false);
    }
  };

  const handleOpenEnrollPage = async () => {
    try {
        await openUrl("https://labric.co/enroll");
      // For now, just show a toast since we don't have the Tauri API setup
      toast.info('Would open labric.co/enroll');
    } catch (err) {
      console.error('Failed to open enrollment page:', err);
      toast.error('Failed to open enrollment page');
    }
  };

  useEffect(() => {
    // Gather device information
    const getDeviceInfo = async () => {
      try {
        const info = (await invoke("get_device_info")) as DeviceInfo;
        setDeviceInfo(info);
        // Generate initial code with device info
        await fetchEnrollmentCode(info);
      } catch (error) {
        console.error("Failed to get device info:", error);
        toast.error('Failed to get device information');
        // Fallback device info
        const fallbackInfo: DeviceInfo = {
          hostname: "Unknown",
          platform: "Unknown",
          release: "Unknown",
          arch: "Unknown",
          cpus: 0,
          total_memory: 0,
          os_type: "Unknown",
          device_id: "Unknown",
          device_fingerprint: "Unknown",
        };
        setDeviceInfo(fallbackInfo);
        await fetchEnrollmentCode(fallbackInfo);
      }
    };

    getDeviceInfo();
  }, []);

  useEffect(() => {
    // Set up interval to generate new code every 30 seconds
    if (!deviceInfo) return;

    const interval = setInterval(async () => {
      await fetchEnrollmentCode(deviceInfo);
      toast.success('New enrollment code generated');
    }, 30000);

    return () => clearInterval(interval);
  }, [deviceInfo]);

  return (
    <div className="flex flex-col items-center justify-center h-svh p-6 gap-6">
      <div className="flex items-center justify-center gap-3">
        <img src={logo} alt="Labric Sync" className="w-10 h-10" />
        <h1 className="text-2xl font-semibold">Labric Sync</h1>
      </div>
      <div className="w-full max-w-sm flex flex-col items-center justify-center gap-4">
        <CodeDisplay code={enrollmentCode || undefined} isLoading={isLoadingCode} />
      </div>
      <h2 className="text-md text-muted-foreground mb-4">
        Enter this code at{" "}
        <button
          onClick={handleOpenEnrollPage}
          className="text-blue-400 hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit"
        >
          labric.co/enroll
        </button>
      </h2>
    </div>
  );
}
